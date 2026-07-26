/**
 * Lead prioritization (spec §5 — "prioritizes by score/intent").
 *
 * Weights live in one place so the results→ICP loop (§5 governance) can tune
 * them from measured outcomes rather than by editing scattered conditionals.
 */

export type IcpWeights = {
  hasSignal: number;
  verifiedEmail: number;
  titleMatch: number;
  companySizeFit: number;
  techStackMatch: number;
  languageMatch: number;
};

export const DEFAULT_ICP_WEIGHTS: IcpWeights = {
  hasSignal: 35,
  verifiedEmail: 15,
  titleMatch: 20,
  companySizeFit: 10,
  techStackMatch: 15,
  languageMatch: 5,
};

export type ScorableLead = {
  hasSignal: boolean;
  emailVerified: boolean;
  title: string | null;
  employeeCount: number | null;
  techStack: readonly string[];
  language: string;
};

const TITLE_KEYWORDS = [
  'cto',
  'vp engineering',
  'vp of engineering',
  'head of engineering',
  'engineering manager',
  'director of engineering',
  'founder',
  'co-founder',
  'head of talent',
  'technical recruiter',
];

const TARGET_STACK = ['node', 'react', 'typescript', 'python', 'aws', 'go'];
const SUPPORTED_LANGUAGES = new Set(['en', 'es', 'pt']);

export function scoreLead(
  lead: ScorableLead,
  weights: IcpWeights = DEFAULT_ICP_WEIGHTS,
): number {
  let score = 0;

  if (lead.hasSignal) score += weights.hasSignal;
  if (lead.emailVerified) score += weights.verifiedEmail;

  const title = lead.title?.toLowerCase() ?? '';
  if (title && TITLE_KEYWORDS.some((k) => title.includes(k))) {
    score += weights.titleMatch;
  }

  // Nearshore staff-aug lands best at companies big enough to have a real
  // hiring budget but small enough that procurement isn't a six-month cycle.
  const size = lead.employeeCount;
  if (size !== null && size >= 20 && size <= 2000) {
    score += weights.companySizeFit;
  }

  const stack = lead.techStack.map((s) => s.toLowerCase());
  const overlap = TARGET_STACK.filter((t) => stack.some((s) => s.includes(t)));
  if (overlap.length > 0) {
    score += Math.min(weights.techStackMatch, overlap.length * 5);
  }

  if (SUPPORTED_LANGUAGES.has(lead.language)) score += weights.languageMatch;

  return Math.round(Math.max(0, Math.min(100, score)));
}

/** Highest score first; ties broken deterministically so batches are stable. */
export function prioritize<T extends { score: number; id: string }>(
  leads: readonly T[],
): T[] {
  return [...leads].sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.id.localeCompare(b.id),
  );
}
