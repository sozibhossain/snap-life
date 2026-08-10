# SNAP Life iOS UAT release checklist

Use this checklist for the build that follows the 31 July 2026 iOS UAT report.
Items marked **external** must be completed in the named service; they cannot
be guaranteed by the application repository alone.

## 1. Repository validation

- [ ] Run `pnpm run typecheck` from the repository root.
- [ ] Run `pnpm -F @workspace/mobile test`.
- [ ] Run `pnpm -F @workspace/api-server test` with `DATABASE_URL` available
  when an integration suite requires it.
- [ ] Run `pnpm -F @workspace/api-server build`.
- [ ] From `artifacts/mobile`, run `pnpm exec expo config --type public` in an
  environment where the Expo CLI is available and inspect the iOS splash and
  bundle identifiers.
- [ ] Confirm the TestFlight build uses iOS build number 13 or later.

## 2. Database and API deployment

- [ ] Back up the production database.
- [ ] Apply the current schema with `pnpm -F @workspace/db push` using the
  production `DATABASE_URL`.
- [ ] Deploy the API server after the schema update.
- [ ] Confirm `GET /api/admin/community-insights` returns the new contract and
  the admin Community Insights screen renders without its legacy-contract
  warning.
- [ ] Confirm `GET /api/events/weekly` returns both aggregate `totals` and
  per-day `daily` buckets.
- [ ] Check startup logs for `dailyPushWorker`, billing, trial-reminder and
  email-worker errors.

### Required API environment (**external: Render**)

- [ ] `DATABASE_URL`
- [ ] `CLERK_SECRET_KEY` and the live Clerk publishable key expected by the API
- [ ] `OPENAI_API_KEY` for Bone Buddy
- [ ] `REVENUECAT_SECRET_API_KEY` (preferred) or `REVENUECAT_API_KEY`
- [ ] `REVENUECAT_WEBHOOK_SECRET`
- [ ] `RESEND_API_KEY`
- [ ] `RESEND_FROM_ADDRESS` using a sender/domain verified in Resend
- [ ] Web-push VAPID variables if browser push is enabled

Never put API secret keys in `EXPO_PUBLIC_*` mobile variables.

## 3. RevenueCat and App Store subscriptions (**external**)

- [ ] In App Store Connect, confirm the monthly products are cleared for sale
  and attached to the app version:
  - Founder Premium — GBP 9.99/month
  - SNAP Premium — GBP 14.99/month
  - SNAP Plus — GBP 6.99/month
- [ ] In RevenueCat, confirm the current offering contains these package IDs:
  - `founder_premium`
  - `premium`
  - `$rc_monthly`
- [ ] Map Founder Premium and SNAP Premium to the `snap_premium` entitlement.
- [ ] Map SNAP Plus to the `snap_plus` entitlement.
- [ ] Confirm the iOS public SDK key belongs to the production RevenueCat
  project and matches the TestFlight profile.
- [ ] Configure any one-month introductory trial in App Store Connect. The app
  now shows trial copy only when RevenueCat says that Apple ID is eligible.
- [ ] Point the RevenueCat webhook to the production API and send a test event.
- [ ] Test purchase, app relaunch, foreground refresh, expiry and Restore
  Purchases with a sandbox tester.
- [ ] If Founder Premium is absent from the current offering, the app will show
  it as unavailable instead of allowing a broken purchase.

## 4. TestFlight build and push credentials (**external: Expo/Apple**)

- [ ] Confirm the `testflight` EAS profile points to
  `https://snap-life-api.onrender.com` and uses live Clerk/RevenueCat public
  keys.
- [ ] Confirm Apple distribution certificate and provisioning profile are
  valid.
- [ ] Confirm the APNs key is registered in the Expo/EAS credentials for the
  SNAP Life bundle identifier.
- [ ] Build with the `testflight` profile, submit it to App Store Connect and
  install it from TestFlight on a physical iPhone.
- [ ] On first opt-in, accept iOS notification permission and confirm an Expo
  push token is registered by the production API.

## 5. UAT scenarios

### Splash and navigation

- [ ] Cold-start on a small iPhone and a large iPhone. The splash logo is
  centred, contained and not cropped.
- [ ] Open a Learning Pathway from Learning and from Bone Buddy. Back returns
  to the previous lesson/list and the bottom tabs remain available.
- [ ] Type in Bone Buddy, dismiss the keyboard and move between all five tabs.
  The tab bar remains consistent.

### Bone Buddy

- [ ] Send a message on a fast connection and a throttled connection. A typing
  loader appears while waiting and streaming text is not truncated.
- [ ] Confirm a request stops with a useful error after the client timeout and
  the API/OpenAI timeout is visible in server logs.
- [ ] Re-enter an existing chat and confirm the daily in-chat check-in does not
  duplicate.

### Premium features and media

- [ ] Open advanced Learning while Free/Plus (paywall), then while Premium
  (lesson opens and progress persists).
- [ ] Start each guided meditation route from the Daily Focus card.
- [ ] Test Breathing Studio and Meditation with the iPhone silent switch on;
  narration/music must remain audible and pause/resume correctly.
- [ ] Verify My Insights aggregates Learning, Bone Buddy, Wellness, nutrition,
  supplements, medication, activity and Community events.

### Notifications

- [ ] Enable each reminder in Settings, leave the screen, reopen it and confirm
  the choice persists.
- [ ] Verify supplement, activity, challenge, achievement and streak reminders
  at their configured local times, plus the Monday weekly report.
- [ ] Tap local and remote notifications; each opens the intended SNAP screen
  and records a `push_opened` event.
- [ ] Confirm the API sends at most one daily Bone Buddy push per user in 24
  hours and respects push opt-out.

### Coaching and progress

- [ ] Submit Catherine Shaw's Book Consultation form and confirm success UI,
  API response and received email.
- [ ] Reconfirm Maria Rigopoulou and Lift Nutrition expert requests.
- [ ] Record activity across every requested app area, then verify both My
  Insights and the admin aggregate CSV after the next sync.

## 6. Release sign-off

- [ ] No production secret appears in the mobile bundle or committed files.
- [ ] API error rate, Bone Buddy latency, push failures and email failures have
  been checked after deployment.
- [ ] Product owner completes a full end-to-end TestFlight pass and records the
  build number, iPhone model and iOS version.
- [ ] Wider beta is approved only after all High Priority and Subscription
  scenarios above pass.
