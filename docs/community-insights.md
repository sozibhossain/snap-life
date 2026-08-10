# Community Insights

SNAP Life Community Insights is an opt-in, aggregate-only reporting surface. It is designed for programme improvement and approved research without exposing individual user records or Bone Buddy conversation text.

## Privacy model

- Community analytics and approved research use are separate, explicit choices. Both default to off.
- Research use cannot be enabled unless community analytics is enabled.
- Withdrawing community analytics also withdraws research use and excludes the user from future reports.
- Reports use only users whose current `analytics_consent.community_analytics` value is `true`.
- The report is blank until the global consented cohort meets `COMMUNITY_MIN_COHORT_SIZE` (default `10`, hard minimum `3`).
- Smaller category cells are combined under `Other / suppressed`; their labels are not returned.
- Event totals require the minimum number of distinct users, not merely the minimum number of rows.
- Admin CSV export contains the same aggregate response shown on screen and never contains user identifiers.
- New Bone Buddy messages are not persisted. The former admin conversation route and navigation item have been removed.

Users can review or change consent during onboarding or from **Settings → Privacy → Community insights & research**.

## Captured structured data

- Profile: age, gender, country, journey stage, diagnosis year, goals, coexisting conditions, and fracture history.
- Bone health: DEXA/T-score, BMI, FRAX and risk factors.
- Nutrition: calcium, vitamin D, protein, magnesium and calories.
- Medication and supplements: current list, taken events and missed medication events.
- Exercise: steps, active minutes and selected exercise categories.
- Learning/wellness: completed lessons, learning time, breathing/meditation activity and streaks.
- Self-reported outcomes: confidence, knowledge, mobility, exercise participation, nutrition, sleep, stress, quality of life, falls and fractures.

Outcome check-ins are append-only and sync through `POST /sync/outcomes`. Structured health profile details sync through the existing profile queue.

## Admin use

Open **Admin → Community Insights**. The page shows privacy status, population overview, clinical and lifestyle trends, outcomes and aggregate impact totals. Use **Export aggregate CSV** for analysis outside the dashboard.

The API endpoint is `GET /api/admin/metrics/community-insights` and still requires the existing admin authorization gate.

## Deployment

1. Back up the database using the normal production procedure.
2. Apply the new schema from the repository root:

   ```sh
   pnpm -F @workspace/db push
   ```

3. Set `COMMUNITY_MIN_COHORT_SIZE` if the default threshold of 10 is not appropriate. Never configure a value below the built-in minimum of 3; production policy should normally use 10 or more.
4. Deploy the API server, mobile app and admin app together so the new sync and report contracts arrive as one release.
5. Confirm that a new account is opted out, consent changes persist, a below-threshold report is blank, and `/api/admin/chats` returns 404.

Database schema push and deletion of historical conversation rows are operational changes and are not run automatically by the application build. Historical `bone_buddy_chat_messages` should be purged only through an approved, backed-up data-retention procedure. Account export and deletion continue to cover any legacy rows until that purge is completed.
