import app from "./app";
import { logger } from "./lib/logger";
import { startBillingIssueLapseScheduler } from "./services/billingIssueLapseWorker";
import { startEmailSenderScheduler } from "./services/emailSenderWorker";
import { startHardDeleteScheduler } from "./services/hardDeleteWorker";
import { startMonthlyNewsletterScheduler } from "./services/monthlyNewsletterWorker";
import { startTestimonialScheduler } from "./services/testimonialWorker";
import { startTrialCleanupScheduler } from "./services/trialCleanupWorker";
import { startTrialReminderScheduler } from "./services/trialReminderWorker";
import { startWeeklySnapShotScheduler } from "./services/weeklySnapShotWorker";
import { startDailyPushScheduler } from "./services/dailyPushWorker";

// Last-resort safety nets. A stray rejection or throw that escapes a
// route/worker's own try/catch is logged here instead of silently taking
// the whole server down. These are backstops — errors are still handled
// at their source; this just prevents a single unhandled case from
// killing every other request and the background schedulers.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection (backstop)");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception (backstop)");
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // GDPR hard-delete scheduler. Sweeps every hour and purges accounts
  // whose 30-day grace window (set by `DELETE /api/me`) has expired.
  // No-op under NODE_ENV=test.
  startHardDeleteScheduler();
  // Trial-cleanup scheduler. Once per day, flips `isActive=false` on
  // server-trial rows whose `trialEndsAt` has elapsed so the persisted
  // state catches up with the lazy-expiry derivation. No-op under
  // NODE_ENV=test.
  startTrialCleanupScheduler();
  // Trial reminder scheduler. Sweeps hourly and enqueues "halfway"
  // (Day 14) and "ending soon" (Day 25) emails for users still on the
  // server-managed Premium trial. Idempotent per `(kind, trialEndsAt)`
  // pair. No-op under NODE_ENV=test.
  startTrialReminderScheduler();
  // Billing-issue lapse scheduler. Once per day, nulls
  // `billingIssueAt` / `gracePeriodEndsAt` on subscriber rows whose
  // grace window ended more than a day ago without a recovery webhook,
  // and emits a `billing_issue_lapsed` event into `subscription_events`.
  // No-op under NODE_ENV=test.
  startBillingIssueLapseScheduler();
  // Monthly testimonial request scheduler. Runs daily, fires for each
  // active paid subscriber who has been subscribed >= 30 days and has
  // not received a testimonial_request this calendar month. Sends a
  // push notification and enqueues a testimonial_request email.
  // No-op under NODE_ENV=test.
  startTestimonialScheduler();
  // Email sender scheduler. Runs every 5 minutes, picks up pending_emails
  // rows where sentAt IS NULL, renders templates, and calls Resend.
  // This is the single delivery mechanism for all queued transactional emails.
  // No-op under NODE_ENV=test.
  startEmailSenderScheduler();
  // Weekly SNAP Shot scheduler. Checks hourly; on Sundays enqueues a
  // personalised weekly summary email for every active user.
  // No-op under NODE_ENV=test.
  startWeeklySnapShotScheduler();
  // Monthly newsletter scheduler. Checks hourly; on the 1st of each month
  // enqueues a product update newsletter for every active user.
  // No-op under NODE_ENV=test.
  startMonthlyNewsletterScheduler();
  // Opted-in native and web devices receive one Bone Buddy nudge at 09:00
  // in the user's saved timezone. The sender enforces the global 24h cap.
  startDailyPushScheduler();
});
