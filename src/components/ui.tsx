"use client";

import { useId, useState, type ReactNode } from "react";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className={`h-5 w-5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true">
      <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A section panel that can be collapsed (click the title or the chevron).
 * Collapsed content stays mounted, so form values and generated documents are kept.
 */
export function Card({
  title,
  step,
  children,
  aside,
  defaultOpen = true,
}: {
  title: string;
  step?: number;
  children: ReactNode;
  aside?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section className="rounded-2xl border border-line bg-panel p-5 shadow-sm">
      <header className={`flex items-center justify-between gap-3 ${open ? "mb-4" : ""}`}>
        <h2 className="min-w-0 text-lg font-semibold">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls={bodyId}
            className="flex items-center gap-2 text-left hover:text-accent"
          >
            {step !== undefined && (
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-white">{step}</span>
            )}
            <span>{title}</span>
          </button>
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {open && aside}
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
            aria-expanded={open}
            aria-controls={bodyId}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-foreground"
          >
            <Chevron open={open} />
          </button>
        </div>
      </header>
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost";
  type?: "button" | "submit";
}) {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-accent text-white hover:bg-accent-strong"
      : "border border-line bg-transparent hover:bg-subtle";
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>
      {children}
    </button>
  );
}

export function Select<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded-lg border border-line bg-background px-3 py-2"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "accent" }) {
  const tones = {
    neutral: "bg-subtle text-muted",
    good: "bg-good/15 text-good",
    warn: "bg-warn/15 text-warn",
    bad: "bg-bad/15 text-bad",
    accent: "bg-accent/15 text-accent",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="mt-3 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{message}</p>;
}
