import {
  activityLogsTable,
  analyticsConsentTable,
  assessmentResultsTable,
  db,
  gamificationStateTable,
  interactionEventsTable,
  nutritionLogsTable,
  outcomeEntriesTable,
  pool,
  supplementStateTable,
  userProfileTable,
  usersTable,
  wellbeingEntriesTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";

const TEST_DATASET = "ci_test_20260811";
const TEST_USER_COUNT = 10;
const testUserIds = Array.from(
  { length: TEST_USER_COUNT },
  (_, index) => `${TEST_DATASET}_${String(index + 1).padStart(2, "0")}`,
);

const command = process.argv[2];

if (command !== "seed" && command !== "cleanup") {
  throw new Error(
    "Usage: pnpm -F @workspace/scripts community-insights-test-data -- seed|cleanup",
  );
}

if (process.env.NODE_ENV === "production") {
  throw new Error("Community Insights test data is disabled in production.");
}

async function main() {
  const now = new Date();
  const nowMs = now.getTime();
  const today = now.toISOString().slice(0, 10);

  await db.transaction(async (tx) => {
    const removeDataset = async () => {
      await tx
        .delete(interactionEventsTable)
        .where(inArray(interactionEventsTable.appUserId, testUserIds));
      await tx
        .delete(wellbeingEntriesTable)
        .where(inArray(wellbeingEntriesTable.appUserId, testUserIds));
      await tx
        .delete(outcomeEntriesTable)
        .where(inArray(outcomeEntriesTable.appUserId, testUserIds));
      await tx
        .delete(assessmentResultsTable)
        .where(inArray(assessmentResultsTable.appUserId, testUserIds));
      await tx
        .delete(nutritionLogsTable)
        .where(inArray(nutritionLogsTable.appUserId, testUserIds));
      await tx
        .delete(activityLogsTable)
        .where(inArray(activityLogsTable.appUserId, testUserIds));
      await tx
        .delete(supplementStateTable)
        .where(inArray(supplementStateTable.appUserId, testUserIds));
      await tx
        .delete(gamificationStateTable)
        .where(inArray(gamificationStateTable.appUserId, testUserIds));
      await tx
        .delete(userProfileTable)
        .where(inArray(userProfileTable.appUserId, testUserIds));
      await tx
        .delete(analyticsConsentTable)
        .where(inArray(analyticsConsentTable.appUserId, testUserIds));
      await tx
        .delete(usersTable)
        .where(inArray(usersTable.appUserId, testUserIds));
    };

    await removeDataset();

    if (command === "cleanup") return;

    await tx.insert(usersTable).values(
      testUserIds.map((appUserId, index) => ({
        appUserId,
        displayName: `Community Insights Test ${index + 1}`,
        isTester: true,
        createdAt: now,
        updatedAt: now,
      })),
    );

    await tx.insert(analyticsConsentTable).values(
      testUserIds.map((appUserId) => ({
        appUserId,
        communityAnalytics: true,
        researchUse: false,
        consentVersion: "community-v1",
        consentedAt: now,
        withdrawnAt: null,
        updatedAt: now,
      })),
    );

    await tx.insert(userProfileTable).values(
      testUserIds.map((appUserId, index) => ({
        appUserId,
        name: `Community Test ${index + 1}`,
        age: 55 + (index % 10),
        gender: "Woman",
        condition: "Osteoporosis",
        country: "GB",
        timezone: "Europe/London",
        diagnosisYear: 2017 + (index % 5),
        goals: ["bone-strength", "confidence"],
        coexistingConditions: ["osteopenia"],
        fractureHistory: [{ year: 2023, location: "Hip" }],
        streakDays: 5 + index,
        updatedAtMs: nowMs,
        updatedAt: now,
      })),
    );

    await tx.insert(assessmentResultsTable).values(
      testUserIds.flatMap((appUserId, index) => [
        {
          appUserId,
          resultId: `${TEST_DATASET}_dexa_${index + 1}`,
          kind: "dexa",
          payload: {
            spineTScore: -2.8 + index * 0.04,
            hipTScore: -2.5 + index * 0.03,
            bmi: 21.5 + index * 0.2,
          },
          takenAtMs: nowMs - index * 86_400_000,
          receivedAt: now,
        },
        {
          appUserId,
          resultId: `${TEST_DATASET}_frax_${index + 1}`,
          kind: "frax",
          payload: {
            majorFractureRisk: 14 + index * 0.4,
            hipFractureRisk: 4 + index * 0.2,
            inputs: {
              previousFracture: true,
              secondaryOsteoporosis: true,
            },
          },
          takenAtMs: nowMs - index * 86_400_000,
          receivedAt: now,
        },
      ]),
    );

    await tx.insert(nutritionLogsTable).values(
      testUserIds.map((appUserId, index) => ({
        appUserId,
        day: today,
        log: {
          calcium: 900 + index * 20,
          protein: 65 + index,
          vitaminD: 12 + index * 0.5,
          magnesium: 280 + index * 3,
          calories: 1_750 + index * 25,
        },
        updatedAtMs: nowMs,
        updatedAt: now,
      })),
    );

    await tx.insert(activityLogsTable).values(
      testUserIds.map((appUserId, index) => ({
        appUserId,
        day: today,
        log: {
          steps: 5_500 + index * 250,
          activeMinutes: 25 + index,
          exerciseSessions: [{ kind: "Walking", minutes: 25 + index }],
        },
        updatedAtMs: nowMs,
        updatedAt: now,
      })),
    );

    await tx.insert(supplementStateTable).values(
      testUserIds.map((appUserId, index) => ({
        appUserId,
        state: {
          supplements: [
            {
              id: `${TEST_DATASET}_vitamin_d_${index + 1}`,
              name: "Vitamin D",
              category: "supplement",
              taken: true,
            },
            {
              id: `${TEST_DATASET}_alendronate_${index + 1}`,
              name: "Alendronate",
              category: "medication",
              taken: index !== 9,
            },
          ],
        },
        updatedAtMs: nowMs,
        updatedAt: now,
      })),
    );

    await tx.insert(gamificationStateTable).values(
      testUserIds.map((appUserId, index) => ({
        appUserId,
        state: {
          achievements: [{ id: "first-week", unlocked: true }],
          challenges: [],
          rewards: [],
          points: 250 + index * 10,
        },
        updatedAtMs: nowMs,
        updatedAt: now,
      })),
    );

    await tx.insert(outcomeEntriesTable).values(
      testUserIds.map((appUserId, index) => ({
        appUserId,
        entryId: `${TEST_DATASET}_outcome_${index + 1}`,
        entry: {
          confidence: 6 + (index % 3),
          knowledge: 7 + (index % 2),
          mobility: 6 + (index % 3),
          exerciseParticipation: 5 + (index % 4),
          nutritionQuality: 7 + (index % 2),
          sleepQuality: 6 + (index % 3),
          stressLevel: 4 + (index % 3),
          qualityOfLife: 7 + (index % 2),
          fallsLast90Days: index % 2,
          fracturesLast12Months: 0,
        },
        recordedAtMs: nowMs - index * 60_000,
        receivedAt: now,
      })),
    );

    await tx.insert(wellbeingEntriesTable).values(
      testUserIds.map((appUserId, index) => ({
        appUserId,
        entryId: `${TEST_DATASET}_wellbeing_${index + 1}`,
        entry: {
          kind: "breathing",
          sessionId: "calm-breathing",
          sessionName: "Calm Breathing",
          mood: "calm",
          durationSec: 300,
          completedAt: new Date(nowMs - index * 60_000).toISOString(),
        },
        completedAtMs: nowMs - index * 60_000,
        receivedAt: now,
      })),
    );

    const eventKinds = [
      "community_tab_opened",
      "coaching_booking_requested",
      "expert_support_requested",
      "lesson_completed",
      "bone_buddy_message_sent",
      "bone_buddy_opened",
      "breathing_session_completed",
      "meditation_session_completed",
      "nutrition_logged",
      "meal_plan_completed",
      "supplement_taken",
      "medication_taken",
      "medication_missed",
      "dexa_logged",
      "frax_logged",
      "activity_logged",
      "outcome_checkin_completed",
    ] as const;

    await tx.insert(interactionEventsTable).values(
      testUserIds.flatMap((appUserId, userIndex) =>
        eventKinds.map((kind, eventIndex) => ({
          appUserId,
          kind,
          payload:
            kind === "lesson_completed"
              ? {
                  title: "Understanding Bone Health",
                  pathway: "Foundations",
                  durationSec: 600,
                }
              : kind === "coaching_booking_requested"
                ? { sessionId: "bone-health-coaching" }
                : kind === "expert_support_requested"
                  ? { consultantId: "nutrition-specialist" }
                  : {},
          occurredAtMs:
            nowMs - (userIndex * eventKinds.length + eventIndex) * 1_000,
          receivedAt: now,
        })),
      ),
    );
  });

  console.log(
    command === "seed"
      ? `[community-insights-test-data] seeded ${TEST_USER_COUNT} users (${TEST_DATASET})`
      : `[community-insights-test-data] removed ${TEST_USER_COUNT} users (${TEST_DATASET})`,
  );
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("[community-insights-test-data] failed:", error);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
