/** Unicode arrow used as the separator in date-range chips (U+2192 →).
 *  Defined here so the chip JSX and any tests share a single source of truth,
 *  preventing silent regressions if an auto-formatter or editor swaps the
 *  character for an ASCII hyphen-arrow or an HTML entity.
 */
export const DATE_RANGE_SEPARATOR = "\u2192";

export const ACTION_LABELS: Record<string, string> = {
  test_account_provisioned: "Test account provisioned",
  account_deleted: "Account deleted",
  tester_data_reset: "Tester data reset",
  sign_in_token_generated: "Sign-in token generated",
};

export interface AuditFilters {
  actionFilter?: string;
  actorFilter?: string;
  targetFilter?: string;
  fromFilter?: string;
  toFilter?: string;
}

/**
 * Builds a plain-language summary string for the active audit-log filters.
 * Returns `null` when no filters are set (nothing to display).
 */
export function buildFilterSummary(filters: AuditFilters): string | null {
  const { actionFilter, actorFilter, targetFilter, fromFilter, toFilter } =
    filters;

  const segments: string[] = [];

  if (actionFilter) {
    segments.push(`Action: ${ACTION_LABELS[actionFilter] ?? actionFilter}`);
  }
  if (actorFilter) {
    segments.push(`Actor: ${actorFilter}`);
  }
  if (targetFilter) {
    segments.push(`Target: ${targetFilter}`);
  }
  if (fromFilter || toFilter) {
    segments.push(`Date: ${fromFilter ?? "…"} ${DATE_RANGE_SEPARATOR} ${toFilter ?? "…"}`);
  }

  return segments.length > 0 ? segments.join(" · ") : null;
}
