import * as z from "zod/v4";
import { errorResponse, requireProvider } from "@/lib/ai";
import { FIELDS, type CvUpload } from "@/lib/types";

export const maxDuration = 120;

const ProfileSchema = z.object({
  full_name: z.string(),
  headline: z.string().describe("Short professional headline, e.g. 'Junior full-stack developer (React, Node)'"),
  seniority: z.enum(["student", "junior", "mid", "senior", "lead"]),
  years_experience: z.number(),
  field: z.enum(FIELDS),
  location: z.string().describe("City, country if stated, otherwise empty string"),
  languages: z.array(z.string()).describe("Spoken languages with level, e.g. 'French (native)'"),
  skills: z.array(z.string()).describe("10-25 concrete skills and tools, most important first"),
  search_keywords: z
    .array(z.string())
    .describe("3-5 short job-board search queries (1-3 words each, in English) for the roles this person should target"),
  summary: z.string().describe("2-3 sentence summary of the candidate"),
  cv_markdown: z.string().describe("The full CV faithfully transcribed to clean Markdown, nothing invented or dropped"),
});

export async function POST(req: Request) {
  try {
    const { cv } = (await req.json()) as { cv: CvUpload };
    if (!cv) return Response.json({ error: "No CV provided" }, { status: 400 });

    const profile = await requireProvider().json({
      schema: ProfileSchema,
      effort: "low",
      input: {
        cv,
        text: "Read this CV and extract the candidate profile. Only use facts present in the CV; use empty strings or empty lists when something is missing.",
      },
    });
    return Response.json({ profile });
  } catch (error) {
    return errorResponse(error);
  }
}
