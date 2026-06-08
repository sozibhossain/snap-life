# SNAP Life Launch Checklist

This is the go / no-go checklist. Every row must be **green** before
the production deploy is promoted. It is run twice — once on staging,
once on production — and the results captured in the team channel
release thread.

## How to use

- For each row, paste the verification artefact (screenshot, log line,
  curl output, dashboard link) into the release thread.
- A red row blocks the release. Open a fix task, do not paper over.
- For repeat releases, walk the checklist top-to-bottom; do not skip
  rows that "are always green" — the whole point is to catch the
  release where they regress.

---

## A. Build + test gates

| # | Check | How to verify | Owner |
|---|-------|---------------|-------|
| A1 | `pnpm run typecheck` clean | Run from workspace root, attach last 5 lines of output | Eng |
| A2 | `pnpm -r test` passes (modulo the pre-existing `events.test.ts:687` timezone flake) | Attach the summary line; flake is acknowledged in `replit.md` | Eng |
| A3 | No `console.log` introduced in server code in this release | `git --no-optional-locks diff --stat`, then grep for `console.log` in changed `artifacts/api-server/` files | Eng |
| A4 | Lockfile is up to date | `pnpm install --frozen-lockfile` exits 0 | Eng |
| A5 | Last nightly e2e against staging passed | Check the most recent `nightly-results/<ts>.json` (or the on-call Slack channel) is green; if red, fix before promoting | Eng |

## B. Security headers

| # | Check | How to verify | Owner |
|---|-------|---------------|-------|
| B1 | `api-server` returns HSTS + CSP + X-Frame-Options on `/api/healthz` | `curl -I https://api.snaplife.app/api/healthz` — confirm `strict-transport-security`, `content-security-policy`, `x-frame-options`, `referrer-policy`, `x-content-type-options` headers | Eng |
| B2 | `admin` returns the same headers on `/admin/` (production only — Replit's static-deploy mode does not emit HSTS, so this verifies the Express+Helmet shim is wired) | `curl -I https://snaplife.app/admin/` | Eng |
| B3 | Admin sets `X-Robots-Tag: noindex, nofollow` | Same curl as B2 | Eng |
| B4 | CSP allow-list covers Clerk + Google Fonts (no console errors after sign-in) | Sign in to admin in a clean browser profile, check DevTools console for CSP violations | Eng |

## C. Rate limits

| # | Check | How to verify | Owner |
|---|-------|---------------|-------|
| C1 | Auth limiter (5/min/IP) on `/api/auth/*` | Send 6 rapid `POST /api/auth/bootstrap`s from one IP — the 6th returns `429 {error:"rate_limited"}` | Eng |
| C2 | Events limiter (60/min/user) on `POST /api/events` | Burst 61 events as one tester user, the 61st returns 429 | Eng |
| C3 | Chat limiter (20/min/user) on `POST /api/chat/bone-buddy` | Burst 21 chat messages as one tester user, the 21st returns 429 | Eng |
| C4 | Bearer-resolution cache works (no DB hammering) | Tail server logs while running C2 — confirm there is at most one `user_tokens` lookup per tester per ~60s window | Eng |

## D. GDPR + global compliance endpoints

| # | Check | How to verify | Owner |
|---|-------|---------------|-------|
| D1 | `GET /api/me/export` returns a JSON archive with `Content-Disposition: attachment` | Sign in as a tester, hit Settings → Privacy & Data → Export my data, confirm download starts | Eng |
| D2 | `DELETE /api/me` soft-deletes + sets `hard_delete_after` to now+30d | Run as a throwaway tester; check the DB row | Eng |
| D3 | `requireUser` returns 410 for the soft-deleted account | Hit `/api/auth/me` with the dead session — expect 410 `account_deleted` | Eng |
| D4 | Hard-delete worker cascades all per-user tables | Manually set `hard_delete_after = now() - interval '1 hour'` for a throwaway tester, wait ≤1h or call `runHardDeletePass()` from the boot log, confirm zero rows in every per-user table | Eng |
| D5 | Clerk identity is erased on `DELETE /api/me` | Look the user up in the Clerk dashboard — should be gone | Eng |
| D6 | `pending_emails` row enqueued on deletion | `SELECT * FROM pending_emails WHERE kind='account_deletion_confirmation' ORDER BY created_at DESC LIMIT 5;` | Eng |
| D7 | Privacy Policy screen reachable from onboarding **and** Settings | Walk both paths in the PWA and the iOS build | PM |
| D8 | Cookie notice shows on first web visit, dismisses to localStorage, links to Privacy Policy (CCPA notice-at-collection) | Open PWA in an incognito window | PM |

## E. Admin dashboard

| # | Check | How to verify | Owner |
|---|-------|---------------|-------|
| E1 | `/admin/` reachable, prompts Clerk sign-in for unauthenticated visitors | Open in an incognito window | Eng |
| E2 | Non-admin Clerk user gets a friendly "not authorised" screen | Sign in as a non-admin user | Eng |
| E3 | Admin user sees Dashboard, Feedback, Users tabs and KPIs | Sign in as `admin@snaplife.app` (or equivalent) | Eng |
| E4 | Dashboard polls every 30s | Watch the Network tab | Eng |

## F. Staging tester pipeline

| # | Check | How to verify | Owner |
|---|-------|---------------|-------|
| F1 | `POST /api/admin/test-accounts` returns 404 in production | `curl -X POST https://api.snaplife.app/api/admin/test-accounts -H "Authorization: Bearer <admin-jwt>" -d '{"email":"x@y"}'` | Eng |
| F2 | `POST /api/admin/test-accounts` returns 200 in staging when called by an admin | Same curl against staging | Eng |
| F3 | `POST /api/me/reset` returns 404 in production for any caller | Hit it as a test account against production — expect 404 | Eng |
| F4 | "Reset my data" button visible only for testers | Open Settings → Privacy & Data as a non-tester, then as a tester | PM |

## G. Push notifications

| # | Check | How to verify | Owner |
|---|-------|---------------|-------|
| G1 | Push token registers on first opt-in | Tail `api-server` logs while opting in on a real device | Eng |
| G2 | Throttle: ≤1 personalised push per user per 24h | Force two `push.send` triggers within 24h — the second is suppressed | Eng |
| G3 | Unregister on opt-out clears the token row | `SELECT * FROM push_tokens WHERE app_user_id = '<id>';` after toggling off | Eng |

## H. RevenueCat

| # | Check | How to verify | Owner |
|---|-------|---------------|-------|
| H1 | Sandbox webhook delivers to staging `/api/revenuecat/webhook` | Make a sandbox purchase, watch the RevenueCat webhook delivery log | Eng |
| H2 | Production webhook delivers to production `/api/revenuecat/webhook` | Real purchase as the launch tester (real card, refund after) | Eng |
| H3 | `subscription_events` table records the event in both environments | `SELECT * FROM subscription_events ORDER BY created_at DESC LIMIT 5;` | Eng |
| H4 | Premium gates flip on within 30s of purchase webhook | Reload the mobile app post-purchase | PM |

## I. PWA quality

| # | Check | How to verify | Owner |
|---|-------|---------------|-------|
| I1 | Lighthouse PWA / Performance / Accessibility / Best Practices score ≥ 90 | Automated: `pnpm --filter @workspace/mobile run build` runs `scripts/lighthouse-ci.js` against the freshly exported PWA bundle and fails the build if any of the four categories drop below 0.90. Reports are archived under `artifacts/mobile/static-build/lighthouse/<timestamp>/` (`report.html`, `report.json`, `summary.json`) so trends are reviewable per release. The deploy pipeline runs the build with `NODE_ENV=production`, which makes the gate hard-fail; attach the latest `summary.json` to the release thread. Do **not** set `LIGHTHOUSE_SKIP=1` for production deploys — that escape hatch is for local iteration only. | Eng |
| I2 | Service worker installs on first visit and serves the app shell offline | Network tab → service workers; then airplane-mode the page reload | Eng |
| I3 | `manifest.webmanifest` icons + theme colour match brand | Lighthouse PWA audit | PM |

## J. Documentation + paperwork

| # | Check | How to verify | Owner |
|---|-------|---------------|-------|
| J1 | `replit.md` updated to reflect this release | Diff in PR | Eng |
| J2 | `docs/runbook.md` updated if any procedure changed | Diff in PR | Eng |
| J3 | App Store + Play Store privacy nutrition labels match the Privacy Policy | Manual review against `artifacts/mobile/app/settings/privacy-policy.tsx` | PM |
| J4 | Supervisory-authority contact details listed in the Privacy Policy section 11 are current | Manual review against marketing site | Legal |

---

## Sign-off

Release **vYYYY.MM.DD** is green when:
- All A–J rows above are ticked, with verification artefacts pasted in
  the release thread.
- The on-call engineer for the next 24h has acknowledged the release in
  the team channel.
- Eng + PM + Legal sign-off recorded in the release thread.
