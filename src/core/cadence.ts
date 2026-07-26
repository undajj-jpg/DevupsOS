/**
 * Follow-up cadence (spec §5): +3d / +7d / +14d from the first touch, cut the
 * moment the lead replies or opts out.
 */

export const CADENCE_OFFSET_DAYS = [3, 7, 14] as const;

export type PlannedFollowUp = { step: number; dueAt: Date };

/** Sends land inside business hours in the recipient's rough working day. */
const SEND_HOUR_UTC = 14;

function atSendHour(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(SEND_HOUR_UTC, 0, 0, 0);
  return d;
}

/** Nudges weekend sends to the following Monday. */
function skipWeekend(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  if (day === 6) d.setUTCDate(d.getUTCDate() + 2);
  else if (day === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

export function planFollowUps(firstTouchAt: Date): PlannedFollowUp[] {
  return CADENCE_OFFSET_DAYS.map((offset, index) => {
    const due = new Date(firstTouchAt);
    due.setUTCDate(due.getUTCDate() + offset);
    return { step: index + 1, dueAt: skipWeekend(atSendHour(due)) };
  });
}

export type CadenceState = {
  hasReplied: boolean;
  optedOut: boolean;
  suppressed: boolean;
  meetingBooked: boolean;
};

export function shouldCancelCadence(state: CadenceState): {
  cancel: boolean;
  reason: string | null;
} {
  if (state.optedOut) return { cancel: true, reason: 'opted_out' };
  if (state.suppressed) return { cancel: true, reason: 'suppressed' };
  if (state.hasReplied) return { cancel: true, reason: 'replied' };
  if (state.meetingBooked) return { cancel: true, reason: 'meeting_booked' };
  return { cancel: false, reason: null };
}
