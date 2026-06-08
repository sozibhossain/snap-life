# SNAP Life

A bone health and wellness platform that helps users track, get AI coaching, and connect with a community to manage their bone health.

## Run & Operate

- **Run Mobile App (development):** `pnpm --filter @workspace/mobile dev`
- **Run API Server (development):** `pnpm --filter @workspace/api-server dev`
- **Run Admin App (development):** `pnpm --filter @workspace/admin dev`
- **Build All:** `pnpm build`
- **Typecheck All:** `pnpm typecheck`
- **Codegen API Client:** `pnpm --filter @workspace/api-client codegen`
- **DB Push (migrate schema):** `drizzle-kit push:pg` (from `artifacts/api-server`)
- **Required Env Vars:** `DATABASE_URL`, `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`, `REVENUECAT_WEBHOOK_SECRET`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `SNAP_LIFE_ENV` (for staging specific behavior), `SLACK_WEBHOOK_URL` (for nightly E2E results).
- **Web Push Env Vars (api-server):** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (secret), `VAPID_SUBJECT` (e.g. `mailto:admin@snaplife.app`). Generate with `pnpm --filter @workspace/scripts run generate-vapid-keys`. Web push is silently disabled if these are absent.

## Stack

- **Monorepo:** pnpm workspaces
- **Runtime:** Node.js 24
- **Language:** TypeScript 5.9
- **Mobile:** Expo, React Native, Expo Router
- **Backend:** Express 5
- **Database:** PostgreSQL
- **ORM:** Drizzle ORM
- **Validation:** Zod (`drizzle-zod`)
- **API Codegen:** Orval
- **Build Tool:** esbuild, Vite 7 (for Admin)
- **UI Frameworks:** Tailwind v4 (Admin), shadcn-style UI (Admin)
- **Auth:** Clerk (Mobile, Admin)
- **Payments:** RevenueCat
- **Data Visualization:** Recharts (Admin)

## Where things live

- **Mobile App:** `artifacts/mobile/`
- **API Server:** `artifacts/api-server/`
- **Admin Web App:** `artifacts/admin/`
- **Shared Libraries/Utils:** `packages/` (e.g., `packages/api-client`, `packages/utils`)
- **Database Schema:** `artifacts/api-server/src/db/schema/*`
- **API Contracts:** Defined implicitly by Drizzle schema and Orval codegen.
- **Mobile UI Components:** `artifacts/mobile/components/`
- **Mobile Color/Theme:** `artifacts/mobile/lib/useColors.ts`
- **Behavioural Stats Logic:** `packages/lib/behaviouralStats.ts`
- **Documentation:** `docs/` (runbook, launch checklist, e2e test plan)

## Architecture decisions

- **Monorepo Structure:** Uses pnpm workspaces to manage mobile, API, and admin apps with shared TypeScript code.
- **Offline-First Mobile Sync:** Mobile client uses AsyncStorage as an offline cache, with server as source of truth and last-write-wins reconciliation for data synchronization.
- **Server-Side Authorization:** Admin app uses Clerk for authentication but relies on a `users.isAdmin` flag in the backend for authorization.
- **Two-Tier E2E Testing:** A nightly automated HTTP test suite (`scripts/src/nightlyE2e.ts`) complements a manual UI walkthrough (`docs/e2e-test-plan.md`) to cover aspects like in-app purchases and Clerk sign-up flows that cannot be headlessly automated.
- **GDPR Compliance by Design:** Implements data export (`GET /api/me/export`) and soft/hard deletion (`DELETE /api/me`, `services/hardDeleteWorker.ts`) endpoints, with PII redaction and a DB-backed `pending_emails` queue for transactional emails.

## Product

- **Bone Health Tracking:** DEXA scan logging (Spine and Hip T-scores), activity logs, nutrition logs.
- **AI Coaching:** Personalized insights and coaching via "Bone Buddy" with adaptive tone.
- **Wellness Hub:** Movement, Breathing Studio, Guided Meditations.
- **Gamification:** Achievements, challenges, XP bar, badges.
- **Personalized Meal Plans:** Daily meal plans and nutrition guides.
- **Daily Guide:** Daily focus recommendations and smart food suggestions.
- **Subscription Model:** Premium features gated by subscription, including adaptive AI and advanced insights.
- **User Engagement:** Notifications (opt-in, personalized), weekly SNAP Shots.

## User preferences

I want iterative development.
Ask before making major changes.

## Gotchas

- `POST /api/admin/test-accounts` and `POST /api/me/reset` endpoints are only active when `SNAP_LIFE_ENV` is set to `staging`. They return 404 in production.
- Bearer tokens for rate limiting: unrecognised bearer strings are never used directly as a key to prevent quota dodging.
- Ensure `helmet()` and other security middleware are always enabled for production deployments.
- Nightly E2E tests are sequential; state changes (like soft-delete) can impact subsequent checks within a single run.
- Always check `docs/runbook.md` for operational procedures, especially for releases, key rotation, and GDPR requests.

## Pointers

- **Expo Documentation:** [https://docs.expo.dev/](https://docs.expo.dev/)
- **React Native Documentation:** [https://reactnative.dev/](https://reactnative.dev/)
- **Express Documentation:** [https://expressjs.com/](https://expressjs.com/)
- **Drizzle ORM Documentation:** [https://orm.drizzle.team/](https://orm.drizzle.team/)
- **Clerk Documentation:** [https://clerk.com/docs](https://clerk.com/docs)
- **RevenueCat Documentation:** [https://docs.revenuecat.com/](https://docs.revenuecat.com/)
- **Tailwind CSS Documentation:** [https://tailwindcss.com/docs](https://tailwindcss.com/docs)