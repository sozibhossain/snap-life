/**
 * Pure cascade helper for the dashboard's TrialPromptCard.
 *
 * Lives in its own file (instead of inside `revenuecat.tsx`) so unit
 * tests can import it without dragging in the React Native runtime —
 * Vitest can't parse RN's Flow-typed `index.js` from `revenuecat.tsx`.
 *
 * Day-of windows (per spec):
 *   - midTrialEncouragement → exactly Day 14
 *   - payment               → Day 14..21    (overlaps midTrial on Day 14)
 *   - endOfTrial            → Day 25..28
 *
 * Cascade priority (endOfTrial > midTrial > payment) is deliberate: on
 * Day 14 the gentle "great progress" card wins over the payment prompt;
 * Days 15..21 fall through to payment; Days 25..28 are reserved for
 * endOfTrial. Without this rule, payment would consume Day 14 and
 * midTrialEncouragement would never appear in production.
 */

export type TrialPromptVariant =
  | "midTrialEncouragement"
  | "payment"
  | "endOfTrial";

export function computeTrialPromptVariant(
  inTrial: boolean,
  dayOfTrial: number | null,
): TrialPromptVariant | null {
  if (!inTrial || dayOfTrial === null) return null;
  if (dayOfTrial >= 25 && dayOfTrial <= 28) return "endOfTrial";
  if (dayOfTrial === 14) return "midTrialEncouragement";
  if (dayOfTrial >= 14 && dayOfTrial <= 21) return "payment";
  return null;
}
