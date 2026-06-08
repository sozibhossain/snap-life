#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
# Backfill the `users` table from existing `user_tokens` so legacy app
# users get a canonical row without waiting for their next request.
# Idempotent — safe to run on every merge.
pnpm --filter @workspace/scripts run backfill-users
# Run the admin unit test suite. Failures abort the merge and block
# promotion to production (set -e propagates the non-zero exit).
pnpm --filter @workspace/admin run test
