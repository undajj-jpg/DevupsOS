import { z } from 'zod';
import { callStructured, isLlmConfigured } from '@/lib/llm/client';

/**
 * Reply triage (spec §5, Fase 1).
 *
 * A reply is the most injection-exposed input in the system: it is attacker-
 * controlled text that we feed to a model and then act on. So the classifier
 * gets exactly one tool, returns a fixed enum, and never gets the authority to
 * send anything. Its output routes a lead and cuts a cadence — both reversible.
 */

export const REPLY_CATEGORIES = [
  'interested',
  'not_interested',
  'referral',
  'out_of_office',
  'unsubscribe',
  'auto_reply',
  'other',
] as const;

export type ReplyCategory = (typeof REPLY_CATEGORIES)[number];

/**
 * Categories that count as a positive reply in conversion reporting.
 *
 * A referral is a positive outcome even though the person answering is not the
 * buyer — it produces a new lead with a warm introduction, which is worth more
 * than a polite "not now" from the original target.
 */
export const POSITIVE_REPLY_CATEGORIES: readonly ReplyCategory[] = [
  'interested',
  'referral',
];

export type Classification = {
  category: ReplyCategory;
  sentiment: 'positive' | 'neutral' | 'negative';
  closeProbability: number;
  /** Verbatim opt-out language, if present. Drives suppression. */
  optOutDetected: boolean;
  reasoning: string;
  confidence: number;
};

const schema = z.object({
  category: z.enum(REPLY_CATEGORIES),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  close_probability: z.number().min(0).max(1),
  opt_out_detected: z.boolean(),
  reasoning: z.string().max(500),
  confidence: z.number().min(0).max(1),
});

const SYSTEM = [
  'You classify replies to B2B outreach for a nearshore staff-augmentation firm.',
  'Return exactly one category. Judge only what the message says — do not infer intent from tone alone.',
  '"interested" requires a concrete forward step: a question about the offer, a request for information, or availability. Politeness is not interest.',
  '"referral" means the writer points to a different person or team.',
  '"unsubscribe" means an explicit request to stop being contacted, in any language.',
  '"auto_reply" covers ticket acknowledgements and delivery notices; "out_of_office" is specifically an absence notice.',
  'close_probability is the chance this thread becomes a paying engagement. Most replies are well under 0.2.',
].join(' ');

/**
 * Deterministic opt-out detection, run before and independently of the model.
 * Honouring an unsubscribe is a legal obligation and must not depend on an
 * inference call that could fail, time out, or be talked out of it.
 */
const OPT_OUT_PATTERNS = [
  /\bunsubscribe\b/i,
  /\bopt[-\s]?out\b/i,
  /\bremove me\b/i,
  /\btake me off\b/i,
  /\bstop (?:emailing|contacting|messaging)\b/i,
  /\bdo not (?:contact|email)\b/i,
  /\bno me (?:contacte|contacten|escriban)\b/i,
  // "dar/darme/darnos/denme de baja". The verb is required: bare "de baja"
  // also means "on sick leave" in Spain, which is an absence notice, not an
  // opt-out — matching it would suppress people who never asked to be.
  /\bd(?:ar|en|é)\w*\s+de\s+baja\b/i,
  /\bbaja\s+de\s+la\s+lista\b/i,
  /\bcancelar (?:la )?suscripci(?:o|ó)n\b/i,
  /\bn(?:a|ã)o (?:me )?(?:envie|mande|contate)\b/i,
  /\bdescadastr\w*/i,
];

export function detectOptOut(body: string): boolean {
  return OPT_OUT_PATTERNS.some((re) => re.test(body));
}

/** Fallback used when the model is unavailable — conservative by design. */
export function heuristicClassify(body: string): Classification {
  if (detectOptOut(body)) {
    return {
      category: 'unsubscribe',
      sentiment: 'negative',
      closeProbability: 0,
      optOutDetected: true,
      reasoning: 'matched an explicit opt-out phrase',
      confidence: 0.9,
    };
  }
  if (/\bout of (?:the )?office\b|\bon (?:vacation|leave|holiday)\b/i.test(body)) {
    return {
      category: 'out_of_office',
      sentiment: 'neutral',
      closeProbability: 0,
      optOutDetected: false,
      reasoning: 'matched an absence notice',
      confidence: 0.7,
    };
  }
  return {
    category: 'other',
    sentiment: 'neutral',
    closeProbability: 0,
    optOutDetected: false,
    reasoning: 'no classifier available; routed for human review',
    confidence: 0,
  };
}

export async function classifyReply(body: string): Promise<Classification> {
  const optOut = detectOptOut(body);

  if (!isLlmConfigured()) {
    return heuristicClassify(body);
  }

  try {
    const result = await callStructured({
      toolName: 'classify_reply',
      toolDescription: 'Record the classification of an inbound reply.',
      inputSchema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: [...REPLY_CATEGORIES],
            description: 'The single best-fitting category.',
          },
          sentiment: {
            type: 'string',
            enum: ['positive', 'neutral', 'negative'],
          },
          close_probability: {
            type: 'number',
            description: 'Probability this becomes a paying engagement, 0 to 1.',
          },
          opt_out_detected: {
            type: 'boolean',
            description: 'True if the writer asks not to be contacted again.',
          },
          reasoning: { type: 'string', description: 'One sentence of rationale.' },
          confidence: { type: 'number', description: 'Confidence, 0 to 1.' },
        },
        required: [
          'category',
          'sentiment',
          'close_probability',
          'opt_out_detected',
          'reasoning',
          'confidence',
        ],
        additionalProperties: false,
      },
      parse: schema,
      system: SYSTEM,
      instruction: 'Classify the reply in the untrusted block below.',
      untrusted: { content: body, label: 'inbound-reply' },
      effort: 'low',
      maxTokens: 1024,
    });

    const d = result.data;
    return {
      // The deterministic check wins: the model may only ever *add* an opt-out,
      // never clear one that our own matcher found.
      category: optOut ? 'unsubscribe' : d.category,
      sentiment: d.sentiment,
      closeProbability: optOut ? 0 : d.close_probability,
      optOutDetected: optOut || d.opt_out_detected,
      reasoning: d.reasoning,
      confidence: d.confidence,
    };
  } catch {
    return heuristicClassify(body);
  }
}

/** A reply ends the cadence unless it is purely an absence or auto notice. */
export function shouldStopCadence(category: ReplyCategory): boolean {
  return category !== 'out_of_office' && category !== 'auto_reply';
}

/** Categories that must add a suppression entry before anything else runs. */
export function requiresSuppression(c: Classification): boolean {
  return c.optOutDetected || c.category === 'unsubscribe';
}
