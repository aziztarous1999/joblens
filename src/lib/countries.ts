// Countries offered in the filter. `adzuna` marks countries the Adzuna API covers.

export interface Country {
  code: string;
  name: string;
  /** Extra names used to match free-text locations (e.g. Remotive's "Europe"). */
  aliases: string[];
  adzuna: boolean;
}

const EUROPE = ["europe", "emea", "eu"];

export const COUNTRIES: Country[] = [
  { code: "fr", name: "France", aliases: ["paris", "lyon", ...EUROPE], adzuna: true },
  { code: "de", name: "Germany", aliases: ["deutschland", "berlin", "munich", "münchen", "hamburg", ...EUROPE], adzuna: true },
  { code: "gb", name: "United Kingdom", aliases: ["uk", "england", "london", ...EUROPE], adzuna: true },
  { code: "us", name: "United States", aliases: ["usa", "us", "america", "north america"], adzuna: true },
  { code: "ca", name: "Canada", aliases: ["north america", "toronto", "montreal"], adzuna: true },
  { code: "es", name: "Spain", aliases: ["españa", "madrid", "barcelona", ...EUROPE], adzuna: true },
  { code: "it", name: "Italy", aliases: ["italia", "milan", "rome", ...EUROPE], adzuna: true },
  { code: "nl", name: "Netherlands", aliases: ["amsterdam", "holland", ...EUROPE], adzuna: true },
  { code: "be", name: "Belgium", aliases: ["brussels", "bruxelles", ...EUROPE], adzuna: true },
  { code: "ch", name: "Switzerland", aliases: ["schweiz", "suisse", "zurich", "geneva", "genève"], adzuna: true },
  { code: "at", name: "Austria", aliases: ["österreich", "vienna", "wien", ...EUROPE], adzuna: true },
  { code: "pl", name: "Poland", aliases: ["polska", "warsaw", ...EUROPE], adzuna: true },
  { code: "ie", name: "Ireland", aliases: ["dublin", ...EUROPE], adzuna: false },
  { code: "pt", name: "Portugal", aliases: ["lisbon", "lisboa", ...EUROPE], adzuna: false },
  { code: "ma", name: "Morocco", aliases: ["maroc", "casablanca", "rabat", "africa"], adzuna: false },
  { code: "tn", name: "Tunisia", aliases: ["tunisie", "tunis", "africa"], adzuna: false },
  { code: "ae", name: "United Arab Emirates", aliases: ["uae", "dubai", "abu dhabi", "middle east"], adzuna: false },
  { code: "au", name: "Australia", aliases: ["sydney", "melbourne", "apac"], adzuna: true },
  { code: "in", name: "India", aliases: ["bangalore", "bengaluru", "apac"], adzuna: true },
  { code: "sg", name: "Singapore", aliases: ["apac", "asia"], adzuna: true },
  { code: "br", name: "Brazil", aliases: ["brasil", "latam"], adzuna: true },
];

export function countryByCode(code: string): Country | undefined {
  return COUNTRIES.find((c) => c.code === code);
}
