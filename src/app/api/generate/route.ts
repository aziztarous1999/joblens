import { errorResponse, languageInstruction, requireProvider } from "@/lib/ai";
import { rateLimit } from "@/lib/rateLimit";
import type { Job, OutputLanguage } from "@/lib/types";

export const maxDuration = 300;

export type Task = "cover_letter" | "tailored_cv" | "answers";

interface Body {
  task: Task;
  cvMarkdown: string;
  job: Job;
  language: OutputLanguage;
  questions?: string;
  notes?: string;
}

const COMMON =
  "Never invent experience, degrees, employers, dates or numbers that are not in the candidate's CV. " +
  "No preamble or closing commentary: output only the document.";

const SYSTEM: Record<Task, string> = {
  cover_letter: `You are an expert cover letter writer. You receive the candidate's CV and a job description, and write a tailored cover letter in plain text.

Rules:
- Medium length: about 250 to 350 words, in 3 to 4 paragraphs.
- Professional, accurate, confident and specific.
- Use only information found in the CV. Do not invent or assume skills, achievements, dates, titles or education.
- Do not inflate skill levels: words like "expert", "highly proficient" or "advanced" only when the CV says so.
- Highlight the candidate's strongest matches to the job description.
- Mirror important keywords from the job description only when they are truthful and supported by the CV.
- Do not mention, apologize for, or draw attention to any gaps, missing qualifications or requirements the candidate does not meet. Never use phrases like "Although I lack", "I do not have" or "I am missing".
- Never use em dashes or en dashes. Use commas, periods, colons, semicolons or parentheses instead.
- No markdown, bullet points, tables or special formatting. Plain text only.
- Address the hiring manager by name if the job description gives one. Otherwise use "Dear Hiring Team," translated into the letter's language (French: "Madame, Monsieur,"; German: "Sehr geehrte Damen und Herren,"; Spanish: "Estimado equipo de selección,").
- Structure: a clear opening, 1 or 2 body paragraphs with evidence from the CV, and a concise closing, then a sign-off with the candidate's name.
- Do not open with a cliché introduction of the company. Start by introducing the candidate, then say what attracts them to this job offer.
- The first line of the output is a label in the form "Cover letter: <role> at <company>", followed by a blank line, then the letter.

${COMMON}`,
  tailored_cv:
    "You are an expert career coach and recruiter who writes application documents that get interviews. " +
    "If the offer asks for something the candidate lacks, either leave it out or present related experience truthfully. " +
    `Output clean Markdown. ${COMMON}`,
  answers:
    "You are an expert career coach and recruiter who writes application documents that get interviews. " +
    `Output clean Markdown. ${COMMON}`,
};

const INSTRUCTIONS: Record<Task, string> = {
  cover_letter: "Write the cover letter for this job offer, following every rule.",
  tailored_cv:
    "Rewrite the candidate's CV for this offer. Keep every fact true, but reorder, rephrase and prioritise so the most relevant experience and skills come first. " +
    "Mirror the offer's keywords where the candidate really has them (for ATS), write results-oriented bullet points (action verb + what + impact), " +
    "and keep it to about one page. Structure: name and contact, headline, 3-line profile, skills, experience, education, extras. " +
    "After the CV, add a section '## What I changed' with 3-6 bullets explaining the tailoring choices.",
  answers:
    "Answer each application question below as the candidate, in the first person, using only facts from the CV. " +
    "Be specific and concise (60-150 words each unless the question needs less). For salary-expectation questions, give a professional answer " +
    "that suggests a range and stays open to discussion. Format each as '### <question>' then the answer. " +
    "If a question needs information the CV does not contain, write a draft and mark the parts to fill in as [to complete].",
};

export async function POST(req: Request) {
  const limited = rateLimit(req);
  if (limited) return limited;
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const { task, cvMarkdown, job, language, questions, notes } = body;
  if (!INSTRUCTIONS[task] || !cvMarkdown || !job) {
    return Response.json({ error: "Missing task, CV or job" }, { status: 400 });
  }
  if (task === "answers" && !questions?.trim()) {
    return Response.json({ error: "Paste at least one question" }, { status: 400 });
  }

  const prompt = [
    `<cv>\n${cvMarkdown}\n</cv>`,
    `<job_offer>\nTitle: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location}\nContract: ${job.contract}\n\n${job.description}\n</job_offer>`,
    task === "answers" ? `<questions>\n${questions}\n</questions>` : "",
    notes?.trim() ? `<candidate_notes>\n${notes}\n</candidate_notes>` : "",
    `${INSTRUCTIONS[task]} ${languageInstruction(language)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const chunks = requireProvider().stream({ system: SYSTEM[task], prompt })[Symbol.asyncIterator]();
    // Wait for the first chunk so config and API errors become a proper JSON error, not streamed text.
    const first = await chunks.next();

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          if (!first.done) controller.enqueue(encoder.encode(first.value));
          for (let next = await chunks.next(); !next.done; next = await chunks.next()) {
            controller.enqueue(encoder.encode(next.value));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          controller.enqueue(encoder.encode(`\n\n> Error: ${message}`));
        }
        controller.close();
      },
      cancel() {
        void chunks.return?.();
      },
    });

    return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch (error) {
    return errorResponse(error);
  }
}
