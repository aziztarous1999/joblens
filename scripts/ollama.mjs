// Project-local Ollama: downloads the portable build into .ollama/, starts the server and
// pulls the model. Nothing is installed system-wide; delete .ollama/ to remove everything.
//
//   node scripts/ollama.mjs install   download the portable binary (run by `npm install`)
//   node scripts/ollama.mjs pull      download the model from .env.local (OLLAMA_MODEL)
//
// The dev script (scripts/dev.mjs) uses the exported helpers.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
export const OLLAMA_VERSION = pkg.ollama?.version ?? "v0.35.0";

const HOME = join(ROOT, ".ollama");
const BIN_DIR = join(HOME, "bin");
export const MODELS_DIR = join(HOME, "models");
const LOCAL_BIN = join(BIN_DIR, process.platform === "win32" ? "ollama.exe" : "ollama");
export const HOST = "127.0.0.1:11434";
const URL_BASE = `http://${HOST}`;

const log = (msg) => console.log(`\x1b[36m[ollama]\x1b[0m ${msg}`);

/** Values from .env.local / .env (simple KEY=value parser, enough for our settings). */
export function readEnv() {
  const env = {};
  for (const file of [".env", ".env.local"]) {
    const p = join(ROOT, file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return { ...env, ...process.env };
}

export const modelName = (env = readEnv()) => env.OLLAMA_MODEL || "qwen3:4b";
export const ollamaWanted = (env = readEnv()) =>
  env.AI_PROVIDER?.toLowerCase() === "ollama" || env.AI_FALLBACK?.toLowerCase() === "ollama";

/** A system-wide Ollama install, if any (then we don't download our own). */
function systemBinary() {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", ["ollama"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() || null : null;
}

export function binaryPath() {
  if (existsSync(LOCAL_BIN)) return LOCAL_BIN;
  return systemBinary();
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get("content-length")) || 0;
  let done = 0;
  let last = 0;
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    done += chunk.length;
    if (total && Date.now() - last > 1000) {
      last = Date.now();
      process.stdout.write(`\r\x1b[36m[ollama]\x1b[0m downloading ${(done / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB (${Math.round((done / total) * 100)}%)   `);
    }
  });
  await pipeline(body, createWriteStream(dest));
  if (total) process.stdout.write("\n");
}

async function sha256(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

/** Downloads and unpacks the portable Ollama build into .ollama/bin (Windows x64). */
export async function install({ force = false } = {}) {
  if (!force && binaryPath()) {
    log(`already available: ${binaryPath()}`);
    return binaryPath();
  }
  if (process.platform !== "win32" || process.arch !== "x64") {
    log("automatic download is set up for Windows x64 only. Install Ollama from https://ollama.com instead.");
    return null;
  }
  const asset = "ollama-windows-amd64.zip";
  const base = `https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}`;
  mkdirSync(BIN_DIR, { recursive: true });
  const zip = join(HOME, asset);

  log(`downloading portable Ollama ${OLLAMA_VERSION} (~1.5 GB, one time only)…`);
  await download(`${base}/${asset}`, zip);

  // Verify against the checksum published with the release.
  const sums = await (await fetch(`${base}/sha256sum.txt`)).text();
  const expected = sums.split(/\r?\n/).find((l) => l.trim().endsWith(asset))?.split(/\s+/)[0];
  const actual = await sha256(zip);
  if (!expected || expected.toLowerCase() !== actual) {
    rmSync(zip, { force: true });
    throw new Error(`checksum mismatch for ${asset} (expected ${expected}, got ${actual}); download removed`);
  }

  log("unpacking…");
  // Windows 10+ ships bsdtar, which extracts zip files.
  const r = spawnSync("tar", ["-xf", zip, "-C", BIN_DIR], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("could not unpack the zip (tar failed)");
  rmSync(zip, { force: true });
  if (!existsSync(LOCAL_BIN)) throw new Error(`ollama.exe not found after unpacking into ${BIN_DIR}`);
  log(`installed in ${BIN_DIR}`);
  return LOCAL_BIN;
}

export async function isRunning() {
  try {
    const res = await fetch(`${URL_BASE}/api/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Starts `ollama serve` unless one is already running. Returns the child process we started, if any. */
export async function start() {
  if (await isRunning()) {
    log(`using the Ollama already running on ${HOST}`);
    return null;
  }
  const bin = binaryPath() ?? (await install());
  if (!bin) return null;
  mkdirSync(MODELS_DIR, { recursive: true });
  const child = spawn(bin, ["serve"], {
    env: { ...process.env, OLLAMA_HOST: HOST, OLLAMA_MODELS: MODELS_DIR },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
  for (let i = 0; i < 60; i++) {
    if (await isRunning()) {
      log(`server started on ${HOST} (models in .ollama/models)`);
      return child;
    }
    if (child.exitCode !== null) throw new Error(`ollama serve exited:\n${stderr}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error("ollama serve did not start within 30 s");
}

/** Downloads the model if it isn't there yet, with a progress line. */
export async function pull(model = modelName()) {
  const tags = await (await fetch(`${URL_BASE}/api/tags`)).json();
  if (tags.models?.some((m) => m.name === model || m.name === `${model}:latest`)) {
    log(`model ${model} ready`);
    return;
  }
  log(`downloading model ${model} (one time only)…`);
  const res = await fetch(`${URL_BASE}/api/pull`, { method: "POST", body: JSON.stringify({ model, stream: true }) });
  if (!res.ok || !res.body) throw new Error(`pull failed (${res.status})`);
  let last = 0;
  let buffer = "";
  for await (const chunk of res.body) {
    buffer += Buffer.from(chunk).toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const p = JSON.parse(line);
      if (p.error) throw new Error(p.error);
      if (p.total && Date.now() - last > 1000) {
        last = Date.now();
        process.stdout.write(`\r\x1b[36m[ollama]\x1b[0m ${model}: ${(p.completed / 1e6 || 0).toFixed(0)} / ${(p.total / 1e6).toFixed(0)} MB   `);
      }
      if (p.status === "success") process.stdout.write("\n");
    }
  }
  log(`model ${model} ready`);
}

// ---------- CLI ----------
const same = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
if (process.argv[1] && same(fileURLToPath(import.meta.url), process.argv[1])) {
  const cmd = process.argv[2];
  const env = readEnv();
  try {
    if (cmd === "install") {
      // Skip on CI / hosting, when disabled, or when the app isn't configured to use Ollama.
      if (env.CI || env.VERCEL || env.OLLAMA_SKIP_DOWNLOAD === "true") log("skipping download (CI / hosting / OLLAMA_SKIP_DOWNLOAD)");
      else if (!ollamaWanted(env)) log("not used (set AI_FALLBACK=ollama or AI_PROVIDER=ollama in .env.local to enable)");
      else await install();
    } else if (cmd === "pull") {
      const child = await start();
      await pull(modelName(env));
      child?.kill();
    } else {
      console.log("usage: node scripts/ollama.mjs install | pull");
    }
  } catch (error) {
    // Never fail `npm install` because of Ollama: the app still works with Gemini.
    log(`⚠️  ${error.message}`);
    if (cmd !== "install") process.exitCode = 1;
  }
}
