/**
 * Shared on/off switch for the in-process background schedulers that
 * `index.ts` starts once the server is listening.
 *
 * Enabled by default, so a deploy that never sets the variable keeps
 * running its workers. Set `WORKERS_ENABLED=false` to turn them off.
 * The intended use is local development: the email sender polls every
 * five minutes, which is exactly Neon's default scale-to-zero window,
 * so a dev server left running pins the Postgres compute awake around
 * the clock and drains the monthly compute allowance.
 *
 * Always off under `NODE_ENV=test` so vitest runs don't keep open
 * handles — this subsumes the per-worker test check.
 */
export function workersEnabled(): boolean {
  if (process.env.NODE_ENV === "test") return false;
  const raw = process.env.WORKERS_ENABLED?.trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off" && raw !== "no";
}
