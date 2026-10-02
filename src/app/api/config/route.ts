import { adzunaConfigured, jsearchConfigured } from "@/lib/jobs";
import { franceTravailConfigured } from "@/lib/officialJobs";
import type { JobSource } from "@/lib/types";

// Which key-based job sources this server can use (no secrets exposed, only true/false).
// The UI greys out the others instead of showing "missing key" warnings to visitors.
export function GET() {
  const available: Partial<Record<JobSource, boolean>> = {
    adzuna: adzunaConfigured(),
    jsearch: jsearchConfigured(),
    francetravail: franceTravailConfigured(),
  };
  return Response.json({ available });
}
