// Official public employment services: free, no monthly quota (rate limits only).
//
// - France Travail "Offres d'emploi v2" (free app key at https://francetravail.io): all French offers,
//   including offers it collects from partner job boards.
// - Bundesagentur für Arbeit "Jobsuche" (public key, nothing to register): all German offers.
//
// Both are French/German-language: callers pass keywords in that language (see searchTerms.ts).

import { detectWorkMode, keywordTokens, stripHtml, wallClockToUtc } from "./jobs";
import { POSTED_WITHIN_HOURS, type Filters, type Job } from "./types";

const UA = { "User-Agent": "cv-job-matcher (portfolio project)" };

/**
 * Up to `max` distinct queries. `filters.keywords` already holds this source's language
 * (French / German titles from searchTerms.ts); "" means "all offers".
 */
function queriesFor(filters: Filters, max = 3): string[] {
  const out = [...new Set(filters.keywords.map((k) => keywordTokens(k).join(" ")).filter(Boolean))].slice(0, max);
  return out.length ? out : [""];
}

// ---------- France Travail ----------

export const franceTravailConfigured = () => Boolean(process.env.FRANCE_TRAVAIL_CLIENT_ID && process.env.FRANCE_TRAVAIL_CLIENT_SECRET);

let token: { value: string; expires: number } | null = null;

async function franceTravailToken(): Promise<string> {
  if (token && token.expires > Date.now() + 30_000) return token.value;
  const id = process.env.FRANCE_TRAVAIL_CLIENT_ID!;
  const res = await fetch("https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: process.env.FRANCE_TRAVAIL_CLIENT_SECRET!,
      scope: `api_offresdemploiv2 o2dsoffre application_${id}`,
    }),
  });
  if (res.status === 400 || res.status === 401) throw new Error("credentials rejected: check FRANCE_TRAVAIL_CLIENT_ID / SECRET and that the app is subscribed to “Offres d'emploi”");
  if (!res.ok) throw new Error(`token ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return token.value;
}

interface FtOffer {
  id: string;
  intitule: string;
  description?: string;
  dateCreation?: string;
  lieuTravail?: { libelle?: string };
  entreprise?: { nom?: string };
  typeContrat?: string;
  typeContratLibelle?: string;
  dureeTravailLibelleConverti?: string;
  alternance?: boolean;
  salaire?: { libelle?: string };
  origineOffre?: { urlOrigine?: string; partenaires?: { nom?: string; url?: string }[] };
}

const ftDate = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

export async function fetchFranceTravail(filters: Filters): Promise<Job[]> {
  const bearer = await franceTravailToken();
  const results = await Promise.all(
    queriesFor(filters).map(async (q) => {
      const params = new URLSearchParams({ range: "0-99" });
      // motsCles: comma-separated words; offers must contain them.
      if (q) params.set("motsCles", q.split(" ").filter((w) => w.length >= 2).join(","));
      if (filters.postedWithin && filters.postedWithin !== "any") {
        const now = new Date();
        params.set("minCreationDate", ftDate(new Date(now.getTime() - POSTED_WITHIN_HOURS[filters.postedWithin] * 3600_000)));
        params.set("maxCreationDate", ftDate(now));
      }
      if (filters.contract === "permanent") params.set("typeContrat", "CDI");
      if (filters.contract === "fixed_term") params.set("typeContrat", "CDD");
      if (filters.contract === "freelance") params.set("typeContrat", "LIB");
      if (filters.contract === "apprenticeship") params.set("natureContrat", "E2,FS");
      if (filters.schedule !== "any") params.set("tempsPlein", String(filters.schedule === "full_time"));

      const res = await fetch(`https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?${params}`, {
        headers: { ...UA, Authorization: `Bearer ${bearer}`, Accept: "application/json" },
        next: { revalidate: 300 },
      });
      if (res.status === 204) return []; // no results
      if (res.status === 429) throw new Error("rate limit, retry in a few seconds");
      if (!res.ok && res.status !== 206) throw new Error(`search ${res.status}`);
      return ((await res.json()) as { resultats?: FtOffer[] }).resultats ?? [];
    }),
  );

  return results.flat().map((o) => {
    const description = stripHtml(o.description ?? "");
    const partner = o.origineOffre?.partenaires?.[0];
    return {
      id: `francetravail-${o.id}`,
      source: "francetravail" as const,
      publisher: partner?.nom ? `${partner.nom} via France Travail` : undefined,
      title: o.intitule,
      company: o.entreprise?.nom ?? "",
      location: [o.lieuTravail?.libelle?.replace(/^\d+\s*-\s*/, ""), "France"].filter(Boolean).join(", "),
      workMode: detectWorkMode(`${o.intitule} ${description}`, false),
      contract: [o.typeContratLibelle ?? o.typeContrat, o.dureeTravailLibelleConverti, o.alternance ? "alternance" : ""].filter(Boolean).join(", "),
      salary: o.salaire?.libelle,
      url: o.origineOffre?.urlOrigine || partner?.url || `https://candidat.francetravail.fr/offres/recherche/detail/${o.id}`,
      postedAt: o.dateCreation,
      description,
    };
  });
}

// ---------- Bundesagentur für Arbeit ----------

interface BaOffer {
  referenznummer: string;
  stellenangebotsTitel?: string;
  stellenangebotsart?: string;
  hauptberuf?: string;
  firma?: string;
  stellenlokationen?: { adresse?: { ort?: string; region?: string } }[];
  homeofficemoeglich?: boolean;
  arbeitszeitVollzeit?: boolean;
  vertragsdauer?: string;
  datumErsteVeroeffentlichung?: string;
  /** Current publication window; re-published offers get a new start date. */
  veroeffentlichungszeitraum?: { von?: string };
  aenderungsdatum?: string;
  externeURL?: string;
}

const BA_TYPE: Record<string, string> = { ARBEIT: "job", AUSBILDUNG: "apprenticeship (Ausbildung)", PRAKTIKUM_TRAINEE: "internship / trainee" };

/**
 * Posting time: the current publication day (re-published offers count as new, like the API's own
 * date filter), with the change timestamp when it falls on that day. Times are Berlin time.
 */
function baDate(o: BaOffer): string | undefined {
  const first = o.veroeffentlichungszeitraum?.von ?? o.datumErsteVeroeffentlichung;
  if (o.aenderungsdatum && (!first || o.aenderungsdatum.startsWith(first))) return wallClockToUtc(o.aenderungsdatum, "Europe/Berlin");
  return first ? wallClockToUtc(`${first}T00:00:00`, "Europe/Berlin") : undefined;
}

export async function fetchBundesagentur(filters: Filters): Promise<Job[]> {
  const results = await Promise.all(
    queriesFor(filters).map(async (q) => {
      const params = new URLSearchParams({ size: "100", page: "1" });
      if (q) params.set("was", q);
      if (filters.postedWithin && filters.postedWithin !== "any") {
        // Only 0, 1, 7, 14 and 28 (days) are accepted; other values are silently ignored.
        // Round up; the app's own date filter then trims to the exact window.
        const days = Math.ceil(POSTED_WITHIN_HOURS[filters.postedWithin] / 24);
        params.set("veroeffentlichtseit", String([1, 7, 14, 28].find((d) => d >= days) ?? 28));
      }
      if (filters.contract === "apprenticeship") params.set("angebotsart", "4");
      if (filters.contract === "internship") params.set("angebotsart", "34");
      if (filters.contract === "permanent") params.set("befristung", "2");
      if (filters.contract === "fixed_term") params.set("befristung", "1");
      if (filters.schedule === "part_time") params.set("arbeitszeit", "tz");
      if (filters.schedule === "full_time") params.set("arbeitszeit", "vz");

      const res = await fetch(`https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs?${params}`, {
        // Public key published for this API (no registration).
        headers: { ...UA, "X-API-Key": "jobboerse-jobsuche" },
        next: { revalidate: 300 },
      });
      if (!res.ok) throw new Error(`Jobsuche ${res.status}`);
      return ((await res.json()) as { ergebnisliste?: BaOffer[] }).ergebnisliste ?? [];
    }),
  );

  return results.flat().map((o) => {
    const place = o.stellenlokationen?.[0]?.adresse;
    const contract = [
      BA_TYPE[o.stellenangebotsart ?? ""] ?? "",
      o.vertragsdauer === "UNBEFRISTET" ? "permanent" : o.vertragsdauer === "BEFRISTET" ? "fixed-term" : "",
      o.arbeitszeitVollzeit ? "full-time" : "part-time",
    ].filter(Boolean);
    return {
      id: `bundesagentur-${o.referenznummer}`,
      source: "bundesagentur" as const,
      title: o.stellenangebotsTitel || o.hauptberuf || "Job offer",
      company: o.firma ?? "",
      location: [place?.ort, "Germany"].filter(Boolean).join(", "),
      workMode: o.homeofficemoeglich ? ("hybrid" as const) : ("onsite" as const),
      contract: contract.join(", "),
      url: `https://www.arbeitsagentur.de/jobsuche/jobdetail/${encodeURIComponent(o.referenznummer)}`,
      postedAt: baDate(o),
      // The list API has no description: give the AI the job family and conditions instead.
      description: [
        o.hauptberuf ? `Occupation: ${o.hauptberuf}` : "",
        contract.length ? `Conditions: ${contract.join(", ")}` : "",
        o.homeofficemoeglich ? "Home office possible." : "",
        place?.region ? `Region: ${place.region.replace(/_/g, " ").toLowerCase()}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  });
}
