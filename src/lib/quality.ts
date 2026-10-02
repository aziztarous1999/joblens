// Rule-based filter for fake, scam and spam offers. The AI adds a second check while scoring.
//
// Strong signals hide an offer on their own; weak signals only when two or more add up.

import type { HiddenOffer, Job } from "./types";

const STRONG: [RegExp, string][] = [
  [/\b(registration|training|starter|application|onboarding|processing) fee\b|\bpay (for|your) (own )?(training|kit|equipment|background check)\b|\bupfront (payment|fee|deposit)\b/i, "asks the candidate to pay"],
  [/\b(whats ?app|telegram|signal)\b.{0,60}\b(contact|message|text|apply|reach|send)\b|\b(contact|message|text|apply)\b.{0,40}\b(whats ?app|telegram)\b/i, "asks to apply via WhatsApp or Telegram"],
  [/\bearn (up to |over )?[$€£]\s?\d[\d,.]*\s?(k\b)?\s?(per|a|\/)\s?(day|hour|week)\b/i, "promises unrealistic earnings"],
  [/\b(make money (fast|online|from home)|get rich (quick|fast))\b/i, "get-rich-quick wording"],
  // Asking the candidate to invest, not a fintech building a trading product.
  [/\b(guaranteed (returns|profits?)|(start|starting) investment of [$€£]?\d|invest (just|only) [$€£]?\d|binary options)\b/i, "investment scheme"],
  [/\b(send|provide) (us )?your (bank|card|credit card|iban|passport) (details|number|information)\b/i, "asks for bank or ID details"],
  [/\b(reship(p)?ing|package forwarding|parcel forwarding|money (transfer|mule)|payment processing agent|mystery shopper)\b/i, "known scam job type"],
];

// Aggregator spam such as "Relocation Jobs asPHP developer" (checked on the title only).
const SPAM_TITLE = /\b[Jj]obs as(?! well)(\s|[A-Z])/;

const WEAK: [(job: Job) => boolean, string][] = [
  [(j) => /[\w.+-]+@(gmail|yahoo|hotmail|outlook|aol|proton|icloud)\.[a-z]{2,}/i.test(j.description), "contact is a personal e-mail address"],
  [(j) => !j.company.trim() || /^(unknown company|confidential|n\/a|private|anonymous)$/i.test(j.company.trim()), "no company name"],
  [(j) => j.source !== "bundesagentur" && j.description.replace(/\s+/g, " ").trim().length < 120, "almost no description"],
  [(j) => j.title.length > 140 || (j.title.length > 12 && j.title === j.title.toUpperCase() && /[A-Z]/.test(j.title)), "spammy title"],
  [(j) => (j.title.match(/[!$€💰🔥✅]/gu) ?? []).length >= 2, "spammy title"],
  [(j) => /\b(no experience (needed|required)|anyone can do (it|this)|work (only )?\d+ hours? (a|per) (day|week))\b/i.test(j.description) && /[$€£]\s?\d/.test(j.description), "too-good-to-be-true pay"],
  [(j) => /\b(immediate start|urgent(ly)? hiring|hiring immediately)\b.*\b(no interview|without interview)\b/i.test(j.description), "no interview"],
  // Common in real commission-based sales jobs, so only a weak signal.
  [(j) => /\b(unlimited (income|earning)|be your own boss|financial freedom)\b/i.test(j.description), "MLM-style wording"],
];

/** Returns the reason an offer looks fake, or null if it looks legitimate. */
export function suspicionReason(job: Job): string | null {
  const text = `${job.title}\n${job.description}`;
  for (const [re, reason] of STRONG) if (re.test(text)) return reason;
  if (SPAM_TITLE.test(job.title)) return "spam aggregator listing";
  const weak = WEAK.filter(([test]) => test(job)).map(([, reason]) => reason);
  return weak.length >= 2 ? [...new Set(weak)].join(", ") : null;
}

/**
 * Splits offers into kept and hidden.
 * - Identical descriptions are one offer re-posted (e.g. by an aggregator): keep the first, drop the copies.
 * - The same text under 5+ different companies is template spam: hide all of them.
 */
export function filterFakeOffers(jobs: Job[]): { kept: Job[]; hidden: HiddenOffer[] } {
  const key = (j: Job) => (j.description.length >= 200 ? j.description.toLowerCase().replace(/\s+/g, " ").slice(0, 300) : null);
  const companies = new Map<string, Set<string>>();
  for (const j of jobs) {
    const k = key(j);
    if (!k) continue;
    const set = companies.get(k) ?? new Set<string>();
    set.add(j.company.toLowerCase().replace(/\b(ag|sa|sas|gmbh|ltd|inc|llc)\b\.?/g, "").trim());
    companies.set(k, set);
  }

  const kept: Job[] = [];
  const hidden: HiddenOffer[] = [];
  const seenText = new Set<string>();
  for (const job of jobs) {
    const k = key(job);
    if (k && (companies.get(k)?.size ?? 0) >= 5) {
      hidden.push({ title: job.title, company: job.company, url: job.url, reason: "same text posted by many companies" });
      continue;
    }
    if (k && seenText.has(k)) continue; // re-post of an offer already kept
    if (k) seenText.add(k);
    const reason = suspicionReason(job);
    if (reason) hidden.push({ title: job.title, company: job.company, url: job.url, reason });
    else kept.push(job);
  }
  return { kept, hidden };
}
