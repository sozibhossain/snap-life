# SNAP Life — staging environment runbook

This document is the operational source of truth for the SNAP Life
staging deployment. The codebase contains the *application-side*
guardrails (env-gated routes, RevenueCat sandbox webhook secret, GDPR
queue tables, hard-delete worker). The *infrastructure-side* steps
below — provisioning a separate Replit deployment, separate database
URL, separate RevenueCat sandbox project — are applied via the Replit
deploy panel and the RevenueCat dashboard.

---

## 1. Required environment variables

| Variable                       | Production              | Staging                         | Used by                                                                |
|--------------------------------|-------------------------|---------------------------------|------------------------------------------------------------------------|
| `SNAP_LIFE_ENV`                | _(unset)_               | `staging`                       | api-server: gates `POST /api/admin/test-accounts` + `POST /api/me/reset` (404 in production) |
| `DATABASE_URL`                 | prod Postgres branch    | **separate** staging Postgres   | api-server, scripts, drizzle-kit                                       |
| `CLERK_SECRET_KEY`             | live Clerk instance     | **separate** Clerk dev instance | api-server (`clerkMiddleware`), `clerkClient.users.deleteUser`         |
| `CLERK_PUBLISHABLE_KEY`        | live Clerk instance     | matching staging Clerk          | mobile + admin                                                          |
| `REVENUECAT_API_KEY`           | live RevenueCat project | **sandbox** RevenueCat project  | api-server `routes/revenuecat.ts`                                       |
| `REVENUECAT_WEBHOOK_SECRET`    | prod webhook secret     | sandbox webhook secret          | api-server webhook signature check                                      |
| `EXPO_PUBLIC_API_URL`          | prod API origin         | staging API origin              | mobile build                                                            |
| `OPENAI_API_KEY`               | prod key                | staging key (or quota-capped)   | api-server `chat/bone-buddy`                                            |

The api-server will refuse to honour the tester-only surfaces
(`POST /api/admin/test-accounts`, `POST /api/me/reset`) unless
`SNAP_LIFE_ENV === "staging"`. This is enforced in code (see
`artifacts/api-server/src/routes/admin.ts` and `routes/me.ts`), not just
documented here.

---

## 2. Replit deployment topology

Two distinct Replit deployments share the same monorepo:

1. **Production** — `snap-life.replit.app` (or custom domain).
   - Deploys: api-server, admin, mobile (PWA build).
   - Env: production secrets, **no** `SNAP_LIFE_ENV`.

2. **Staging** — `snap-life-staging.replit.app`.
   - Deploys: same three artifacts.
   - Env: staging secrets + `SNAP_LIFE_ENV=staging`.
   - Separate `DATABASE_URL` (different Postgres branch).
   - Separate Clerk + RevenueCat keys.

Steps to provision a fresh staging deployment:

1. In the Replit deploy panel, choose **Create new deployment** for this
   repo.
2. Name it `snap-life-staging`.
3. In the deployment's **Secrets** tab, add the staging values from the
   table above (every variable, including `SNAP_LIFE_ENV=staging`).
4. Trigger the first deploy. The api-server will run `drizzle-kit push`
   on boot via the build step, populating the staging Postgres branch.
5. Smoke-test (see §4).

---

## 3. RevenueCat sandbox wiring

1. In the RevenueCat dashboard, create a **new project** named
   `snap-life-staging` (do NOT reuse the production project).
2. Add iOS + Android apps under it; pair with the same App Store /
   Play Console **sandbox** test accounts you use for QA. Production
   users / keys are not involved.
3. Generate a new **Public API key** → set as `REVENUECAT_API_KEY` in
   the staging Replit deployment.
4. Generate a **webhook secret** → set as `REVENUECAT_WEBHOOK_SECRET`.
5. Configure the webhook URL to
   `https://snap-life-staging.replit.app/api/revenuecat/webhook` and
   point it at the staging deployment.
6. Verify with a sandbox purchase: the staging api-server should log a
   `RevenueCat webhook received` line and upsert into the staging
   `subscribers` table.

---

## 4. Smoke-test checklist

Run these end-to-end against the staging URL after every fresh deploy:

- [ ] `GET https://staging/api/healthz` → `200`
- [ ] Sign in via Clerk (staging instance) on the mobile PWA.
- [ ] Log a meal + a workout; verify the rows land in staging Postgres.
- [ ] Trigger a sandbox subscription purchase; verify
      `subscribers.tier` updates within seconds.
- [ ] As a tester (provisioned via `POST /api/admin/test-accounts`),
      hit `POST /api/me/reset`; confirm 200 + per-user rows wiped +
      AsyncStorage cleared on the device.
- [ ] As any user, `GET /api/me/export` returns a JSON archive with
      every documented section.
- [ ] As any user, `DELETE /api/me` returns 200, subsequent
      `GET /api/me` returns **HTTP 410 `account_deleted`**, and a row
      appears in `pending_emails` for the confirmation email.
- [ ] On production (separate deploy), `POST /api/admin/test-accounts`
      and `POST /api/me/reset` both return **404** — proving the env
      guardrail is active.
- [ ] Admin dashboard at `https://staging/admin/` returns
      `Strict-Transport-Security`, `Content-Security-Policy`,
      `X-Frame-Options: SAMEORIGIN`, and `X-Robots-Tag: noindex,
      nofollow` HTTP response headers (not just meta tags).

---

## 5. Hard-delete worker

The api-server starts a periodic in-process scan
(`startHardDeleteScheduler`, 1h interval) that purges every account
whose `users.hardDeleteAfter < now`. Both deployments run it; staging
testers can verify by manually setting `hardDeleteAfter` to the past
and waiting one hour (or restarting the api-server, which triggers a
boot-time pass).

---

## 6. Global compliance posture

The application surfaces (Privacy Policy screen, Cookie Notice, GDPR
endpoints, retention worker) cover the obligations of every regime
listed below. Operational obligations that live outside the codebase
(supervisory-authority registration, DPO appointment, breach-response
runbook) are owned by the legal/compliance owner; this section is the
mapping from each regime to the code that implements its
data-subject-facing parts.

| Regime                            | Data-subject right                | Where it's implemented                                                                                       |
|-----------------------------------|-----------------------------------|--------------------------------------------------------------------------------------------------------------|
| EU GDPR (2016/679)                | Access, portability               | `GET /api/me/export` returns full JSON archive                                                              |
| EU GDPR / UK GDPR                 | Erasure                           | `DELETE /api/me` (soft-delete + 30d hard-delete worker + Clerk SDK delete + queued confirmation email)      |
| EU GDPR / UK GDPR                 | Rectification                     | Profile edit screens write through to `userProfile` rows; tester reset wipes per-user state                 |
| EU GDPR / UK GDPR                 | Restriction / objection           | Account delete is the universal restriction; granular toggles tracked as a follow-up                        |
| EU GDPR Art. 8 (under-16 consent) | Children                          | Privacy Policy section 9 + onboarding footer; in-product age-verification gate is a follow-up                |
| ePrivacy / PECR                   | Cookie / storage notice           | `components/CookieNotice.tsx` (web only)                                                                     |
| California CCPA / CPRA            | Right to know / delete / correct  | Same `GET /api/me/export` + `DELETE /api/me`; Privacy Policy section 4–5                                    |
| California CPRA                   | Limit Sensitive PI                | Health data is treated as SPI and used solely to provide the service (Privacy Policy section 6)             |
| California CPRA                   | Do Not Sell / Share               | We do not sell or share for cross-context behavioural advertising — attested in Privacy Policy section 6    |
| Brazil LGPD                       | Art. 18 access / correction / portability / deletion | Same export + delete endpoints; 15-day SLA documented in Privacy Policy section 5         |
| Canada PIPEDA                     | Access + withdrawal of consent    | Export endpoint + DELETE /me; Privacy Policy section 4 + 11                                                  |
| Australia Privacy Act 1988 (APPs) | Access (APP 12) + correction (APP 13) | Same export + delete endpoints; OAIC complaint route in Privacy Policy section 11                       |
| HIPAA-adjacent (US health context)| Not a covered entity              | We are a wellness app, not a HIPAA Business Associate — disclosed plainly in the Terms                      |
| App Store / Play Store            | Privacy nutrition labels          | Owned in App Store Connect / Play Console; mirror our Privacy Policy disclosures                            |

The Privacy Policy screen (`artifacts/mobile/app/settings/privacy-policy.tsx`)
renders the June 2026 legal document and is reachable from the onboarding
footer plus the Privacy & Data settings entry. The marketing site
(`www.snaplife.co.uk/privacy`) should mirror the same legal text and publish
any required representative or DPO contact details.

### Compliance follow-ups (not yet in code)

- Age-verification gate during onboarding (block <16 EEA / <13 US).
- Consent receipt log (audit trail of which version of the policy a
  user accepted, with timestamp + IP).
- Granular processing-purpose toggles (analytics opt-out, AI training
  opt-out) in Settings.
- Data Processing Impact Assessment (DPIA) for the AI coach feature.
- Tested 72-hour breach-notification runbook + supervisory-authority
  contact list.

---

## 7. Pending-email queue

`DELETE /api/me` enqueues a row into `pending_emails`
(`kind = "account_deletion_confirmation"`). The api-server itself does
not deliver email — a separate worker (Replit scheduled deployment or
external SES/SendGrid lambda) reads `WHERE sent_at IS NULL`, calls the
provider, then sets `sent_at` on success or appends to `last_error` on
failure. The schema lives in
`lib/db/src/schema/pendingEmails.ts`.
