"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { downloadText, postJson, postStream } from "@/lib/client";
import { toPlainLetter } from "@/lib/text";
import type { Job, OutputLanguage, Profile, Source } from "@/lib/types";
import { Badge, Button, Card, Select, Spinner } from "./ui";

type Tool = "cover_letter" | "tailored_cv" | "answers" | "salary";

const TOOLS: { id: Tool; label: string; desc: string }[] = [
  { id: "cover_letter", label: "Cover letter", desc: "A tailored letter for this offer" },
  { id: "tailored_cv", label: "Tailored CV", desc: "Your CV rewritten for this offer (ATS keywords)" },
  { id: "answers", label: "Answer questions", desc: "Answers to the application form questions" },
  { id: "salary", label: "Salary estimate", desc: "Market range + cost of living, with sources" },
];

interface Output {
  status: "loading" | "done" | "error";
  text: string;
  sources?: Source[];
  other?: Source[];
}

function DocumentView({ tool, output, job }: { tool: Tool; output: Output; job: Job }) {
  const ref = useRef<HTMLDivElement>(null);
  const label = TOOLS.find((t) => t.id === tool)!.label;
  // The cover letter is plain text (no markdown), shown and exported as-is.
  const plain = tool === "cover_letter";
  const fullText =
    output.text +
    (output.sources?.length
      ? `\n\n## Sources\n${output.sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`).join("\n")}`
      : output.other?.length
        ? `\n\n## Check these figures on\n${output.other.map((s) => `- [${s.title}](${s.url})`).join("\n")}`
        : "");

  function print() {
    ref.current?.classList.add("print-target");
    window.print();
    ref.current?.classList.remove("print-target");
  }

  return (
    <div className="rounded-xl border border-line">
      <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <span className="flex items-center gap-2 font-semibold">
          {label} {output.status === "loading" && <Spinner />}
        </span>
        {output.status === "done" && (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => navigator.clipboard.writeText(fullText)}>Copy</Button>
            <Button
              variant="ghost"
              onClick={() => downloadText(`${tool}-${job.company}.${plain ? "txt" : "md"}`.replace(/\s+/g, "-").toLowerCase(), fullText)}
            >
              Download .{plain ? "txt" : "md"}
            </Button>
            <Button variant="ghost" onClick={print}>Print / PDF</Button>
          </div>
        )}
      </div>
      <div ref={ref} className="md max-h-[38rem] overflow-auto p-5">
        {output.status === "error" ? (
          <p className="text-bad">{output.text}</p>
        ) : output.text ? (
          plain ? (
            <div className="whitespace-pre-wrap">{output.text}</div>
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{output.text}</ReactMarkdown>
          )
        ) : (
          <p className="text-muted">{tool === "salary" ? "Searching Glassdoor, Numbeo, official stats… (about a minute)" : "Writing…"}</p>
        )}
        {output.sources && output.sources.length > 0 && (
          <>
            <h2>Sources</h2>
            <ol>
              {output.sources.map((s) => (
                <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></li>
              ))}
            </ol>
          </>
        )}
        {output.other && output.other.length > 0 && !output.sources?.length && (
          <>
            <h2>Check these figures on</h2>
            <ul>
              {output.other.map((s) => (
                <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></li>
              ))}
            </ul>
          </>
        )}
        {output.other && output.other.length > 0 && !!output.sources?.length && (
          <details className="no-print mt-2 text-sm text-muted">
            <summary className="cursor-pointer">Other pages consulted ({output.other.length})</summary>
            <ul>
              {output.other.map((s) => (
                <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

export function Workspace({ job, profile, country }: { job: Job; profile: Profile; country: string }) {
  const [selected, setSelected] = useState<Tool[]>(["cover_letter"]);
  const [language, setLanguage] = useState<OutputLanguage>("auto");
  const [questions, setQuestions] = useState("");
  const [notes, setNotes] = useState("");
  const [outputs, setOutputs] = useState<Partial<Record<Tool, Output>>>({});
  const [active, setActive] = useState<Tool | null>(null);

  const busy = Object.values(outputs).some((o) => o?.status === "loading");
  const update = (tool: Tool, patch: Output) => setOutputs((prev) => ({ ...prev, [tool]: patch }));

  async function runTool(tool: Tool) {
    const tidy = (t: string) => (tool === "cover_letter" ? toPlainLetter(t) : t);
    update(tool, { status: "loading", text: "" });
    try {
      if (tool === "salary") {
        const res = await postJson<{ markdown: string; sources: Source[]; other: Source[] }>("/api/salary", {
          job,
          profile,
          country,
          language,
        });
        update(tool, { status: "done", text: res.markdown, sources: res.sources, other: res.other });
      } else {
        const text = await postStream(
          "/api/generate",
          { task: tool, cvMarkdown: profile.cv_markdown, job, language, questions, notes },
          (partial) => update(tool, { status: "loading", text: tidy(partial) }),
        );
        update(tool, { status: "done", text: tidy(text) });
      }
    } catch (e) {
      update(tool, { status: "error", text: e instanceof Error ? e.message : String(e) });
    }
  }

  function generate() {
    setActive(selected[0]);
    selected.forEach(runTool);
  }

  const toggle = (tool: Tool) =>
    setSelected((s) => (s.includes(tool) ? s.filter((t) => t !== tool) : [...s, tool]));

  const shown = (Object.keys(outputs) as Tool[]).filter((t) => outputs[t]);

  return (
    <Card title={`Application kit: ${job.title} at ${job.company}`} step={4}>
      <p className="-mt-2 mb-4 text-sm text-muted">Pick what you need. Each item runs on its own, so you can select several.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {TOOLS.map((t) => (
          <label
            key={t.id}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${selected.includes(t.id) ? "border-accent bg-accent/5" : "border-line"}`}
          >
            <input type="checkbox" className="mt-1" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
            <span>
              <span className="font-medium">{t.label}</span>
              <span className="block text-sm text-muted">{t.desc}</span>
            </span>
          </label>
        ))}
      </div>

      {selected.includes("answers") && (
        <textarea
          value={questions}
          onChange={(e) => setQuestions(e.target.value)}
          placeholder={"Paste the application questions, one per line, e.g.\nWhy do you want to work at our company?\nWhat are your salary expectations?"}
          className="mt-3 min-h-28 w-full rounded-lg border border-line bg-background p-3 text-sm"
        />
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-[12rem_1fr]">
        <Select<OutputLanguage>
          label="Output language"
          value={language}
          onChange={setLanguage}
          options={[
            { value: "auto", label: "Same as the offer" },
            { value: "en", label: "English" },
            { value: "fr", label: "Français" },
            { value: "de", label: "Deutsch" },
            { value: "es", label: "Español" },
          ]}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-muted">Extra notes for the AI (optional)</span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. I'm relocating to Lyon in March, emphasise my React projects"
            className="rounded-lg border border-line bg-background px-3 py-2"
          />
        </label>
      </div>

      <div className="mt-4">
        <Button onClick={generate} disabled={busy || selected.length === 0 || (selected.includes("answers") && !questions.trim())}>
          {busy && <Spinner />} Generate {selected.length > 1 ? `${selected.length} items` : ""}
        </Button>
      </div>

      {shown.length > 0 && (
        <div className="mt-6">
          <div className="no-print mb-3 flex flex-wrap gap-2">
            {shown.map((t) => (
              <button
                key={t}
                onClick={() => setActive(t)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${active === t ? "bg-accent text-white" : "bg-subtle"}`}
              >
                {TOOLS.find((x) => x.id === t)!.label}{" "}
                {outputs[t]?.status === "loading" ? "…" : outputs[t]?.status === "error" ? <Badge tone="bad">error</Badge> : ""}
              </button>
            ))}
          </div>
          {active && outputs[active] && <DocumentView tool={active} output={outputs[active]!} job={job} />}
        </div>
      )}
    </Card>
  );
}
