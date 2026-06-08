// Cross-platform replacement for the previous `sh -c` preinstall guard.
//
// Intent (unchanged): enforce pnpm usage and remove stray npm/yarn
// lockfiles. The old guard used `sh -c '...'`, which fails on Windows —
// `sh` is not on the default PATH, and even when it is, the
// `npm_config_user_agent` env var is not visible to the sh subprocess, so
// the guard wrongly rejected pnpm. Node sees the user agent correctly on
// both platforms, so we do the same check here.
import { rmSync } from "node:fs";

for (const lockfile of ["package-lock.json", "yarn.lock"]) {
  try {
    rmSync(lockfile, { force: true });
  } catch {
    // best-effort: nothing to remove
  }
}

const userAgent = process.env.npm_config_user_agent ?? "";
// Reject only when another package manager is clearly in use. Allow pnpm
// and the rare case where the user agent is unavailable, so the guard
// never blocks a legitimate pnpm install.
if (/^(npm|yarn|bun)\//.test(userAgent)) {
  console.error("Use pnpm instead");
  process.exit(1);
}
