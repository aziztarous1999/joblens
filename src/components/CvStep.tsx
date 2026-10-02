"use client";

import { useState } from "react";
import { fileToBase64, postJson } from "@/lib/client";
import type { CvUpload, Profile } from "@/lib/types";
import { Badge, Button, Card, ErrorNote, Spinner } from "./ui";

const MAX_PDF_MB = 10;

export function CvStep({ profile, onProfile }: { profile: Profile | null; onProfile: (p: Profile | null) => void }) {
  const [pasted, setPasted] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyse() {
    setError(null);
    setLoading(true);
    try {
      let cv: CvUpload;
      if (file && file.type === "application/pdf") {
        if (file.size > MAX_PDF_MB * 1024 * 1024) throw new Error(`PDF is larger than ${MAX_PDF_MB} MB.`);
        cv = { kind: "pdf", name: file.name, base64: await fileToBase64(file) };
      } else if (file) {
        cv = { kind: "text", name: file.name, text: await file.text() };
      } else {
        cv = { kind: "text", name: "pasted-cv", text: pasted };
      }
      const { profile } = await postJson<{ profile: Profile }>("/api/profile", { cv });
      onProfile(profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (profile) {
    return (
      <Card title="Your profile" step={1} aside={<Button variant="ghost" onClick={() => onProfile(null)}>Change CV</Button>}>
        <p className="text-base font-semibold">{profile.full_name || "Candidate"}</p>
        <p className="text-muted">{profile.headline}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge tone="accent">{profile.seniority}</Badge>
          <Badge>{profile.years_experience} yrs experience</Badge>
          {profile.location && <Badge>{profile.location}</Badge>}
          {profile.languages.map((l) => <Badge key={l}>{l}</Badge>)}
        </div>
        <p className="mt-3 text-sm">{profile.summary}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {profile.skills.map((s) => (
            <span key={s} className="rounded-md bg-subtle px-2 py-0.5 text-xs">{s}</span>
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card title="Upload your CV" step={1}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line p-4 text-center text-sm hover:bg-subtle">
          <span className="text-2xl">📄</span>
          <span className="font-medium">{file ? file.name : "Choose a PDF, .txt or .md file"}</span>
          <span className="text-muted">Your CV is only sent to the AI you configured (or stays on your PC with Ollama).</span>
          <input
            type="file"
            accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="…or paste your CV text here"
          className="min-h-36 rounded-xl border border-line bg-background p-3 text-sm"
          disabled={!!file}
        />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={analyse} disabled={loading || (!file && pasted.trim().length < 50)}>
          {loading && <Spinner />} {loading ? "Reading your CV…" : "Analyse CV"}
        </Button>
        {file && <Button variant="ghost" onClick={() => setFile(null)}>Remove file</Button>}
      </div>
      <ErrorNote message={error} />
    </Card>
  );
}
