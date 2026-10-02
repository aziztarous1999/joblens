// `npm run dev`: starts the project-local Ollama (when enabled in .env.local), makes sure the
// model is downloaded, then runs `next dev`. Stopping the app (Ctrl+C) also stops Ollama.
// Extra arguments are passed to Next.js, e.g. `npm run dev -- --port 3456`.

import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { modelName, ollamaWanted, pull, readEnv, start } from "./ollama.mjs";

const env = readEnv();
let ollama = null;

if (ollamaWanted(env) && env.OLLAMA_AUTOSTART !== "false") {
  try {
    ollama = await start();
    // Pull in the background so the app is usable right away (Gemini answers meanwhile).
    pull(modelName(env)).catch((e) => console.log(`\x1b[36m[ollama]\x1b[0m ⚠️  model download failed: ${e.message}`));
  } catch (error) {
    console.log(`\x1b[36m[ollama]\x1b[0m ⚠️  not started (${error.message}). The app runs without the local model.`);
  }
}

// PowerShell drops the `--` in `npm run dev -- --port 3001`, so Next.js would receive a bare
// "3001" (and npm eats "--port"). Accept a bare number as the port, plus PORT in .env.local.
const args = process.argv.slice(2);
const nextArgs = args.flatMap((a, i) => (/^\d{2,5}$/.test(a) && !["--port", "-p"].includes(args[i - 1]) ? ["--port", a] : [a]));
const port = env.PORT && !nextArgs.some((a) => a === "--port" || a === "-p") ? ["--port", env.PORT] : [];

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const next = spawn(process.execPath, [nextBin, "dev", ...port, ...nextArgs], { stdio: "inherit" });

// On Windows, killing a process leaves its children running (Next.js workers, Ollama
// runners) and they keep the ports busy, so stop the whole process tree.
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill();
}

const stop = () => {
  killTree(ollama);
  killTree(next);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("SIGHUP", stop);
next.on("exit", (code) => {
  killTree(ollama);
  process.exit(code ?? 0);
});
