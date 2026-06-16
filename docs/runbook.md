# SNAP Life Operations Runbook

This runbook covers the day-to-day operational tasks the team performs
once the staging + production deployments are live. It is the
authoritative source for "how do I do X" — the in-repo tests cover
"does X still work", `STAGING.md` covers environment topology, and this
file covers the human procedures.

If you are reading this for the first time after onboarding, read it
top-to-bottom once; afterwards, jump to the section you need via the
table of contents.

## Contents

1. [Publishing a release](#1-publishing-a-release)
2. [Rotating Clerk keys](#2-rotating-clerk-keys)
3. [Adding a new admin](#3-adding-a-new-admin)
4. [Promoting a tester](#4-promoting-a-tester)
5. [Handling a RevenueCat webhook outage](#5-handling-a-revenuecat-webhook-outage)
6. [Inspecting a user's data](#6-inspecting-a-users-data)
7. [Honouring a GDPR delete request manually](#7-honouring-a-gdpr-delete-request-manually)
8. [Nightly end-to-end staging check](#8-nightly-end-to-end-staging-check)
9. [On-call response checklist](#9-on-call-response-checklist)

---

## 1. Publishing a release

Production has three deployable artifacts: `api-server`, `admin`, and
`mobile` (PWA build). The native iOS/Android builds are released
separately through the App Store / Play Console using the same Expo
project.

### 1.1 Cut a staging release

1. Confirm the working tree is clean: `git --no-optional-locks status`.
2. Run `pnpm run typecheck` from the workspace root. Must be clean.
3. Run the full test suite: `pnpm -r test`. The single pre-existing
   timezone flake in `events.test.ts` is acknowledged; everything else
   must pass.
4. Open the Replit deploy panel, select the **staging** target, and
   click **Redeploy**. The deploy uses `[services.production.run]` from
   each artifact's `.replit-artifact/artifact.toml`.
5. After the deploy finishes, run the staging smoke checklist in
   `STAGING.md` section 4. Do not promote to production until every
   row is ticked.

### 1.2 Promote staging → production

1. Tag the commit: `git tag -a vYYYY.MM.DD -m "release notes"` and push
   the tag.
2. In the Replit deploy panel, select the **production** target and
   click **Redeploy**. Production must **not** carry the
   `SNAP_LIFE_ENV=staging` env var — verify in the env-var view before
   confirming.
3. Run the smoke checklist again against the production URLs (only the
   non-tester rows — there are no tester accounts in production).
4. Announce the release in the team channel with the tag and the link
   to the deployment logs.

### 1.3 Native mobile release

1. Bump the `version` in `artifacts/mobile/app.json`.
2. `eas build --platform ios --profile production` and likewise for
   Android (run from `artifacts/mobile`).
3. Submit via `eas submit`; wait for App Store / Play review.
4. Once approved, the new build will use the production API URL baked
   in via `EXPO_PUBLIC_API_URL`.

---

## 2. Rotating Clerk keys

Clerk publishes a public + secret key per environment. Production and
staging each have their own pair. Rotation is required if a key is
suspected leaked, when an admin with key access leaves the team, or on
the standard 12-month cadence.

1. In the Clerk dashboard, open the relevant environment (production
   *or* staging — never both at once).
2. Settings → API Keys → **Generate new secret key**. Leave the old key
   active for now.
3. In Replit, update the deployment secrets for the corresponding
   environment:
   - `CLERK_SECRET_KEY` (api-server)
   - `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (mobile + admin) — only if the
     publishable key was rotated too.
4. Trigger a redeploy of `api-server`, `admin`, and (if the publishable
   key changed) the PWA build of `mobile`.
5. Verify a sign-in works end-to-end against the deployed environment.
6. In the Clerk dashboard, **revoke the old secret key**.
7. If the publishable key rotated, force-quit and reopen the native
   apps that have the old key bundled — they will hit a sign-in failure
   until the next App Store / Play release ships with the new key.
   Coordinate with the mobile release in section 1.3.

---

## 3. Adding a new admin

Admin status is gated on `users.isAdmin = true` in the Postgres `users`
table. There is intentionally no UI to grant admin — it requires
database access so that team membership changes are auditable in source
control / DB logs.

### 3.1 Production / staging

1. The new admin must already have signed up via Clerk and signed into
   either the mobile app or the admin web at least once (this creates
   the `users` row).
2. Connect to the relevant Postgres instance (Replit DB tab → SQL
   shell).
3. Run, replacing the email:

   ```sql
   UPDATE users
      SET is_admin = true
    WHERE email = 'newadmin@snaplife.app';
   ```

4. Confirm one row was updated. Have the new admin reload the admin
   web at `/admin/` — they should now see the dashboard.

### 3.2 Local development

Same SQL against the local DATABASE_URL. No deploy required.

### 3.3 Removing admin access

```sql
UPDATE users SET is_admin = false WHERE email = '<email>';
```

If the person also leaves the team, follow section 2 to rotate the
Clerk secret key.

---

## 4. Promoting a tester

Testers (`users.isTester = true`) get the "Reset my data" affordance on
the Privacy & Data screen and are exempt from certain rate-limit
guardrails in staging. Test accounts only exist in **staging** —
production has zero testers.

### 4.1 Provision (staging only)

`POST /api/admin/test-accounts` is admin-gated and idempotent on email.
It will create the user if they don't exist, or reactivate them if
soft-deleted, and set `isTester = true`.

```bash
curl -X POST https://staging.snaplife.app/api/admin/test-accounts \
  -H "Authorization: Bearer <admin-clerk-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"email": "tester@snaplife.app", "displayName": "QA Tester"}'
```

The endpoint returns **HTTP 404** if `SNAP_LIFE_ENV !== "staging"`,
which is the production guardrail.

### 4.2 Promote an existing user (staging only, manual fallback)

```sql
UPDATE users SET is_tester = true WHERE email = '<email>';
```

### 4.3 Demote

```sql
UPDATE users SET is_tester = false WHERE email = '<email>';
```

### 4.4 Self-service tester reset

Testers can clear their own server-side data + AsyncStorage from
**Settings → Privacy & Data → Reset my data**. This calls
`POST /api/me/reset` (also staging-gated, returns 404 in production).

---

## 5. Handling a RevenueCat webhook outage

RevenueCat → `POST /api/revenuecat/webhook` is the source of truth for
subscription state changes. If the webhook is delayed or down,
`users.subscriptionStatus` will fall behind reality.

### 5.1 Detect

- Admin Dashboard → Subscriptions tile shows a count that doesn't
  match RevenueCat dashboard.
- Users in support reporting "I paid but Premium isn't unlocked."
- `subscription_events` table has no rows in the last hour despite
  active subscribers in the RevenueCat dashboard.

### 5.2 Mitigate

1. Check the RevenueCat status page (`status.revenuecat.com`) and the
   webhook delivery log in the RevenueCat dashboard.
2. If RevenueCat itself is degraded, no action — they will retry. The
   app already falls back to `Purchases.getCustomerInfo()` on every
   foreground, so most users will reconcile within minutes of the
   webhook coming back.
3. If RevenueCat is healthy but our endpoint is rejecting (check
   `req.log` entries for `revenuecat.webhook` warn/error), verify the
   `REVENUECAT_WEBHOOK_SECRET` env var matches the dashboard. If a
   signature mismatch caused the rejections, fix the secret then in
   the RevenueCat dashboard click **Resend** on the failed deliveries
   (they are retained for 7 days).
4. For affected users who can't wait, manually grant Premium for 24h
   while the queue catches up:

   ```sql
   UPDATE users
      SET subscription_status = 'active',
          subscription_expires_at = now() + interval '24 hours'
    WHERE email = '<user>';
   ```

   Once the webhook backlog clears, RevenueCat's payload will overwrite
   this row with the real values.

### 5.3 Post-mortem

For any outage longer than 1h, write a short post-mortem in the team
channel listing affected users, mitigation taken, and prevention.

---

## 6. Inspecting a user's data

For support tickets, GDPR right-to-know requests, or debugging.

### 6.1 Via the admin dashboard (preferred)

`/admin/users` → search by email. Shows account status, subscription,
recent events, and feedback. No raw health data — that requires the
DB.

### 6.2 Via the export endpoint (mirror what the user sees)

If you have temporary auth as the user (test account in staging only),
hit `GET /api/me/export`. The JSON payload is exactly what the user
gets when they tap "Export my data".

### 6.3 Via the database (privileged break-glass)

For incident response only. Log the lookup in the team channel before
running.

```sql
-- Identity
SELECT id, email, display_name, is_admin, is_tester,
       subscription_status, deleted_at, hard_delete_after, created_at
  FROM users
 WHERE email = '<email>';

-- Most-recent activity
SELECT kind, created_at
  FROM interaction_events
 WHERE app_user_id = '<id>'
 ORDER BY created_at DESC
 LIMIT 50;

-- Health logs
SELECT date, calcium_mg, vitamin_d_ug, protein_g
  FROM nutrition_logs
 WHERE app_user_id = '<id>'
 ORDER BY date DESC
 LIMIT 30;
```

Never paste raw query output into a public channel. Summarise.

---

## 7. Honouring a GDPR delete request manually

If a user emails `teamsnap@snaplife.co.uk` asking to be deleted, the
fastest path is to walk them through the in-app flow (Settings →
Privacy & Data → Delete my account). If that is not possible (locked
out of the account, deceased estate, regulator request, etc), use this
manual procedure.

1. Identity-verify the requester via the email registered against
   the account. For estate / regulator requests, accept a written
   instruction on letterhead and log it in the request file.
2. Look up the user id:

   ```sql
   SELECT id FROM users WHERE email = '<email>';
   ```

3. **Preferred path** — trigger the admin GDPR delete from the
   admin web app. Sign in to `/admin/`, search the user by email,
   and click **Delete account (GDPR)** on the user detail card.
   Confirm the dialog. This calls `DELETE /api/admin/users/<id>`
   under the hood, which runs the **same** soft-delete cascade as
   the user-facing `DELETE /api/me`: PII redacted, push tokens +
   legacy bearer tokens hard-deleted, free-text on retained rows
   scrubbed, upstream Clerk identity erased (best-effort), and a
   confirmation email row appended to `pending_emails`.

   To trigger from a shell instead (useful for scripts or when the
   admin UI is unavailable):

   ```bash
   # Replace <user-id> with the result above. <admin-jwt> is your
   # Clerk JWT.
   curl -X DELETE https://api.snaplife.app/api/admin/users/<user-id> \
     -H "Authorization: Bearer <admin-jwt>"
   ```

   The endpoint refuses to delete your own account (returns 400
   `cannot_delete_self`) — use the user-facing `DELETE /api/me`
   path for that. A 404 means the appUserId did not match any row
   (re-check the lookup in step 2).

4. **DB-only fallback** — only if the admin endpoint is unavailable.
   Soft-delete now; the hard-delete worker handles the 30-day cascade
   automatically:

   ```sql
   UPDATE users
      SET email = concat('deleted-', id, '@snaplife.local'),
          display_name = 'Deleted user',
          deleted_at = now(),
          hard_delete_after = now() + interval '30 days'
    WHERE id = '<user-id>';
   ```

   Then redact retained free-text manually:

   ```sql
   UPDATE feedback     SET message = '[redacted]', tags = '[]'::jsonb WHERE app_user_id = '<id>';
   UPDATE interaction_events SET payload = '{}'::jsonb WHERE app_user_id = '<id>';
   UPDATE wellbeing_entries  SET entry = '{"kind":"redacted"}'::jsonb WHERE app_user_id = '<id>';
   DELETE FROM push_tokens   WHERE app_user_id = '<id>';
   DELETE FROM user_tokens   WHERE app_user_id = '<id>';
   ```

5. Erase the upstream Clerk identity:

   ```bash
   curl -X DELETE https://api.clerk.com/v1/users/<clerk-user-id> \
     -H "Authorization: Bearer <CLERK_SECRET_KEY>"
   ```

6. Send the confirmation email — either via the queued `pending_emails`
   row (insert one manually if you used the DB-only fallback) or via
   your normal mail tool — and reply to the requester within the
   regulatory SLA (30 days GDPR, 45 days CCPA, 15 days LGPD).
7. The hourly hard-delete worker will purge the cascaded rows on day
   30. No further manual action required.

---

## 8. Nightly end-to-end staging check

A Replit Scheduled Deployment runs `pnpm --filter @workspace/scripts run nightly-e2e`
every day at **03:00 UTC** against staging. The script
(`scripts/src/nightlyE2e.ts`) walks the journey **sequentially** so
rate-limit buckets, soft-delete state, and admin reflection can be
reasoned about. It deliberately uses two distinct identities:

- The long-lived **Clerk-backed staging tester**
  (`STAGING_TESTER_JWT` + `STAGING_TESTER_EMAIL`) — has a real row
  in `users`, which is what `requireUser`'s soft-delete check, the
  GDPR export, the bone-buddy behavioural-context composer, and the
  admin lookup all key off. Reused across runs; never deleted.
- A throwaway **legacy-bearer ephemeral identity** minted via
  `/auth/bootstrap` per run — exists in `user_tokens` only
  (`auth/bootstrap` does not write to `users`). Used to test the
  bearer-token lifecycle seam in isolation: mint → log event →
  DELETE /me → same bearer rejected with 401 "unknown bearer
  token". Asserting 410 here would be wrong — with no `users` row
  the soft-delete check is a no-op, the cascade hard-deletes the
  `user_tokens` row, and the auth layer fails first. The full
  Clerk-user 410 cascade is exercised in the manual UI walkthrough.

Sequence: liveness → security headers on api + admin SPA →
`GET /auth/me` as the tester (captures `appUserId`) → `POST /events`
→ `GET /events/weekly` reads it back → seed a fresh bootstrap bearer
+ write a `calcium_logged` event under it → `POST /chat/bone-buddy`
with that same bearer opens an SSE stream (the chat route resolves
the user via `softUserId()` which only looks up legacy bearer
tokens — Clerk JWTs do not resolve there, so we use a bootstrap
bearer here on purpose, with a freshly-written event under the same
appUserId so the `softUserId() → buildEngagementProfile() →
renderBehaviouralContext()` path actually has data to ground on)
→ `GET /me/export` returns a JSON attachment whose `appUserId`
matches `/auth/me` → `GET /admin/users/lookup?email=<tester>`
returns the same `appUserId` (proves admin reflection of the same
identity) → `/admin/metrics/{users,engagement,subscriptions}` each
return a JSON object (and `users.totalUsers` is numeric) →
admin-gate probe: a fresh non-admin bearer hitting
`/admin/test-accounts` is rejected with 403 → ephemeral bearer
lifecycle: bootstrap → log event → DELETE /me → re-call /me/export
with same bearer → 401 `unknown bearer token` → 65s cooldown →
deliberate 6-burst against `/auth/bootstrap` confirms the auth
limiter returns 429 on the 6th call. Non-zero exit pages on-call.
Results are written to `nightly-results/<ts>.json` (gitignored) and
posted to the on-call Slack channel via `SLACK_WEBHOOK_URL`.

### 8.1 Schedule + env-vars

Configure once in the Replit deploy panel under
**Deployments → Scheduled → New scheduled deployment**:

| Field | Value |
|-------|-------|
| Command | `pnpm --filter @workspace/scripts run nightly-e2e` |
| Schedule | `0 3 * * *` (03:00 UTC daily) |
| Timeout | 5 min (the script includes a 65s cooldown before the auth-limiter burst) |
| Env vars | `STAGING_API_URL`, `STAGING_ADMIN_URL`, `STAGING_ADMIN_JWT`, `STAGING_TESTER_JWT`, `STAGING_TESTER_EMAIL`, `SLACK_WEBHOOK_URL` |

The two JWTs are long-lived Clerk session tokens minted from a
dedicated "E2E Admin" account and "E2E Tester" account in staging
(via `POST /api/admin/test-accounts` plus a one-time Clerk session
mint through the Clerk dashboard). `STAGING_TESTER_EMAIL` is the
tester's email, used by the admin lookup reflection check. Rotate
both JWTs every 90 days as part of the Clerk-key rotation in
section 2. The ephemeral bearer-lifecycle portion of the journey
mints its own throwaway identities per run via `/auth/bootstrap` —
no shared state between runs there.

### 8.2 Escalation owner

The **on-call engineer for the current 24h window** owns nightly
failures. Pager flow:

1. Slack `#snap-life-ops` posts the `:x: SNAP Life nightly e2e` summary
   with the failing checks.
2. On-call acknowledges in-thread within 30 minutes.
3. If a failing check is a real production-relevant regression, follow
   the on-call response checklist in section 9. If the failure is
   transient (third-party blip), re-run manually:
   `pnpm --filter @workspace/scripts run nightly-e2e` from a local
   shell with the same env vars.

### 8.3 Manual run

To run the same probe ad-hoc (locally or in a one-off Replit shell):

```bash
STAGING_API_URL=https://staging.snaplife.app/api \
STAGING_ADMIN_URL=https://staging.snaplife.app/admin/ \
STAGING_ADMIN_JWT=<clerk-jwt> \
STAGING_TESTER_JWT=<clerk-jwt> \
STAGING_TESTER_EMAIL=e2e-tester@snaplife-test.com \
NIGHTLY_E2E_SKIP_RATELIMIT=1 \
pnpm --filter @workspace/scripts run nightly-e2e
```

Setting `NIGHTLY_E2E_SKIP_RATELIMIT=1` skips the 65s cooldown +
deliberate burst — useful for fast ad-hoc verification. Leave it
unset in the scheduled deployment.

The full UI walkthrough (`docs/e2e-test-plan.md`) covers the user-
journey surfaces this script can't reach (RevenueCat sandbox purchase,
Bone Buddy chat that references the user's real numbers, weekly SNAP
Shot rendering, the admin dashboard 30s polling tile). Run it manually
via the testing skill before each production promotion.

---

## 9. On-call response checklist

When a page or "the app is down" report comes in:

1. **Open the deploy logs** for `api-server` first — most user-visible
   issues originate there. Look for stack traces, a recent deploy, or
   an env-var change.
2. **Hit `/api/healthz`** on production. 200 → server is up; the issue
   is upstream (Clerk, RevenueCat, OpenAI) or in a specific route.
3. **Check the third-party status pages**: Clerk, RevenueCat, OpenAI,
   Replit.
4. **Roll back** if a recent deploy caused the issue: Replit deploy
   panel → previous deployment → **Promote**. Faster than fixing
   forward.
5. **Communicate** in the team channel within 5 minutes of confirming
   the incident — even if you don't yet know the cause.
6. **Write up** a short post-mortem within 48h of resolution.

---

## 10. Setting up Web Push (VAPID keys)

Web Push (used by the installed PWA) requires a VAPID key pair. This is a one-time
setup step per environment.

### Generating keys

```bash
pnpm --filter @workspace/scripts run generate-vapid-keys
```

This prints three lines. Set them as environment variables on the `api-server`:

| Variable | Description | Secret? |
|---|---|---|
| `VAPID_PUBLIC_KEY` | Base64url public key | No |
| `VAPID_PRIVATE_KEY` | Base64url private key | **Yes** |
| `VAPID_SUBJECT` | Contact URI, e.g. `mailto:admin@snaplife.app` | No |

The `api-server` exposes the public key via `GET /api/push/web/vapid-public-key` so
the PWA client can subscribe without needing a separate env var.

If any of the three vars are absent, the server starts normally but web push delivery
is silently skipped — no error is thrown.

### Rotating keys

**Do not rotate VAPID keys once real users have subscribed.** Existing browser
subscriptions are cryptographically bound to the original key pair; sending with a
different pair returns HTTP 401 from the push service and the notification is dropped.

If rotation is unavoidable:

1. Set all `web_push_subscriptions` rows to `opted_in = false` in the DB.
2. Set the new `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` env vars and redeploy.
3. Users will see the "Turn on daily nudges" toggle as off and can re-subscribe.

### Checking web push delivery

Failed deliveries are logged at `error` level by `webPushSender.ts`. A 410 / 404
response from the push service means the subscription expired — those rows are
automatically set to `opted_in = false` by the sender.
