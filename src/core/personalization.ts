import { z } from 'zod';
import { callStructured, isLlmConfigured } from '@/lib/llm/client';

/**
 * Signal-based first touch (spec §5).
 *
 * The opening line must cite the lead's actual trigger — an open req, a stack
 * choice, a funding round. When no signal exists we fall back to a generic
 * template rather than letting the model invent one, because a fabricated
 * "I saw you're hiring Go engineers" is worse than saying nothing specific.
 */

export type Signal = {
  kind: 'job_posting' | 'tech_stack' | 'funding' | 'expansion' | 'other';
  summary: string;
  sourceUrl?: string;
};

export type DraftContext = {
  contactName: string;
  contactTitle: string | null;
  companyName: string;
  language: 'en' | 'es' | 'pt';
  signal: Signal | null;
  senderName: string;
  variantKey: string;
};

export type EmailDraft = {
  subject: string;
  body: string;
  /** Quotes the real trigger rather than a generic opener. */
  usedSignal: boolean;
  /** Model's own confidence, used against the agent threshold (§3.5). */
  confidence: number;
};

const draftSchema = z.object({
  subject: z.string().min(3).max(120),
  body: z.string().min(40).max(2000),
  signal_referenced: z.boolean(),
  confidence: z.number().min(0).max(1),
});

const SYSTEM = [
  'You write first-touch outreach for DevUps, a nearshore staff-augmentation firm that places senior LATAM engineers with companies in North America and Europe.',
  'House style: short, specific, and plain. Four sentences at most. No superlatives, no "I hope this finds you well", no bullet lists, no emoji.',
  'Open by referencing the concrete trigger you were given. Never invent a trigger, a mutual connection, a metric, or a customer name.',
  'Close with one low-friction question, not a demand for a 30-minute call.',
  'Write in the requested language.',
].join(' ');

const FALLBACK: Record<DraftContext['language'], (c: DraftContext) => EmailDraft> =
  {
    en: (c) => ({
      subject: `Senior engineers for ${c.companyName}`,
      body: `Hi ${firstName(c.contactName)},\n\nI'm ${c.senderName} at DevUps — we place senior LATAM engineers with teams in your time zone.\n\nIf hiring is on your roadmap this quarter, is it worth a short note comparing what we'd charge against your current sourcing cost?\n\n${c.senderName}`,
      usedSignal: false,
      confidence: 0.4,
    }),
    es: (c) => ({
      subject: `Ingenieros senior para ${c.companyName}`,
      body: `Hola ${firstName(c.contactName)}:\n\nSoy ${c.senderName}, de DevUps. Ubicamos ingenieros senior de LATAM en equipos que trabajan en tu mismo huso horario.\n\nSi tienen contrataciones previstas este trimestre, ¿te sirve que te pase una comparación de costos frente a lo que gastan hoy?\n\n${c.senderName}`,
      usedSignal: false,
      confidence: 0.4,
    }),
    pt: (c) => ({
      subject: `Engenheiros senior para ${c.companyName}`,
      body: `Olá ${firstName(c.contactName)},\n\nSou ${c.senderName}, da DevUps. Colocamos engenheiros senior da América Latina em times que trabalham no mesmo fuso que vocês.\n\nSe houver contratações previstas neste trimestre, faz sentido eu enviar uma comparação de custos com o que vocês gastam hoje?\n\n${c.senderName}`,
      usedSignal: false,
      confidence: 0.4,
    }),
  };

function firstName(full: string): string {
  const trimmed = full.trim();
  const space = trimmed.indexOf(' ');
  return space === -1 ? trimmed : trimmed.slice(0, space);
}

export function genericDraft(ctx: DraftContext): EmailDraft {
  return FALLBACK[ctx.language](ctx);
}

export async function draftFirstTouch(ctx: DraftContext): Promise<EmailDraft> {
  if (!ctx.signal || !isLlmConfigured()) return genericDraft(ctx);

  const instruction = [
    `Recipient: ${ctx.contactName}${ctx.contactTitle ? `, ${ctx.contactTitle}` : ''} at ${ctx.companyName}.`,
    `Language: ${ctx.language}.`,
    `Sender: ${ctx.senderName}.`,
    `Variant: ${ctx.variantKey} — vary the angle and subject line across variants.`,
    'The trigger to reference is in the untrusted block below. Use only the facts it contains.',
  ].join('\n');

  try {
    const result = await callStructured({
      toolName: 'compose_first_touch',
      toolDescription: 'Return the subject and body of a first-touch email.',
      inputSchema: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'Subject line, under 60 chars.' },
          body: { type: 'string', description: 'Plain-text body, max 4 sentences.' },
          signal_referenced: {
            type: 'boolean',
            description: 'True only if the opening cites the supplied trigger.',
          },
          confidence: {
            type: 'number',
            description: 'Confidence the trigger is relevant, 0 to 1.',
          },
        },
        required: ['subject', 'body', 'signal_referenced', 'confidence'],
        additionalProperties: false,
      },
      parse: draftSchema,
      system: SYSTEM,
      instruction,
      untrusted: {
        content: `${ctx.signal.kind}: ${ctx.signal.summary}${
          ctx.signal.sourceUrl ? `\nsource: ${ctx.signal.sourceUrl}` : ''
        }`,
        label: 'lead-signal',
      },
      effort: 'medium',
    });

    return {
      subject: result.data.subject,
      body: result.data.body,
      usedSignal: result.data.signal_referenced,
      confidence: result.data.confidence,
    };
  } catch {
    // A model failure must not stall the pipeline; the generic template is a
    // correct, if duller, message.
    return genericDraft(ctx);
  }
}
