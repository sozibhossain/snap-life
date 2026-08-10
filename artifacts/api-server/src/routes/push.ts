import { Router, type IRouter } from "express";
import { db, pushTokensTable, webPushSubscriptionsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { sendBoneBuddyPush } from "../lib/pushSender";
import { composeDailyNudgeLine, type BuddyPushFacts } from "../lib/buddyCopy";
import { assertSelf, requireUserAuth } from "../lib/auth";
import { validateWebPushEndpoint } from "../lib/webPushValidation";

export { validateWebPushEndpoint };

const router: IRouter = Router();

const MAX_TOKEN_LEN = 200;
const MAX_KEY_LEN = 512;

// ---------------------------------------------------------------------------
// Expo push (native mobile)
// ---------------------------------------------------------------------------

interface RegisterBody {
  expoToken: string;
  platform: string | null;
  /** Optional echo of appUserId — must match authed user if provided. */
  claimedUserId: string | null;
}

function validateRegister(body: unknown): { ok: true; data: RegisterBody } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body required" };
  const b = body as Record<string, unknown>;
  if (typeof b.expoToken !== "string" || b.expoToken.length === 0 || b.expoToken.length > MAX_TOKEN_LEN) {
    return { ok: false, error: "expoToken required" };
  }
  // Expo tokens always start with ExponentPushToken[ or ExpoPushToken[
  if (!/^Expo(nent)?PushToken\[[^\]]+\]$/.test(b.expoToken)) {
    return { ok: false, error: "expoToken malformed" };
  }
  const platform =
    typeof b.platform === "string" && b.platform.length > 0 && b.platform.length <= 20
      ? b.platform
      : null;
  const claimedUserId =
    typeof b.appUserId === "string" && b.appUserId.length > 0 ? b.appUserId : null;
  return { ok: true, data: { expoToken: b.expoToken, platform, claimedUserId } };
}

/**
 * Register or refresh a device push token. Idempotent: a repeat call for
 * the same (appUserId, expoToken) flips opt-in back on and bumps
 * `updatedAt`. We DO NOT clear `lastSentAt` here — the 24h gate must
 * survive opt-in toggles to prevent gaming the rate limit.
 *
 * `appUserId` is derived from the bearer token, never the body.
 */
router.post("/push/register", async (req, res) => {
  const appUserId = await requireUserAuth(req, res);
  if (!appUserId) return;
  const result = validateRegister(req.body);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  if (assertSelf(res, appUserId, result.data.claimedUserId)) return;
  const { expoToken, platform } = result.data;
  try {
    const now = new Date();
    await db
      .insert(pushTokensTable)
      .values({
        appUserId,
        expoToken,
        platform,
        optedIn: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [pushTokensTable.appUserId, pushTokensTable.expoToken],
        set: { optedIn: true, platform, updatedAt: now },
      });
    res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err }, "push register failed");
    res.status(500).json({ error: "internal" });
  }
});

router.post("/push/unregister", async (req, res) => {
  const appUserId = await requireUserAuth(req, res);
  if (!appUserId) return;
  const body = req.body as { expoToken?: unknown; appUserId?: unknown } | undefined;
  if (assertSelf(res, appUserId, body?.appUserId ?? null)) return;
  const expoToken = typeof body?.expoToken === "string" && body.expoToken.length > 0 ? body.expoToken : null;
  try {
    if (expoToken) {
      await db
        .update(pushTokensTable)
        .set({ optedIn: false, updatedAt: new Date() })
        .where(
          and(
            eq(pushTokensTable.appUserId, appUserId),
            eq(pushTokensTable.expoToken, expoToken),
          ),
        );
    } else {
      await db
        .update(pushTokensTable)
        .set({ optedIn: false, updatedAt: new Date() })
        .where(eq(pushTokensTable.appUserId, appUserId));
    }
    res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err }, "push unregister failed");
    res.status(500).json({ error: "internal" });
  }
});

// ---------------------------------------------------------------------------
// Web Push (PWA / browser)
// ---------------------------------------------------------------------------

interface WebRegisterBody {
  endpoint: string;
  p256dhKey: string;
  authKey: string;
}

function validateWebRegister(body: unknown): { ok: true; data: WebRegisterBody } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body required" };
  const b = body as Record<string, unknown>;
  if (typeof b.endpoint !== "string" || !validateWebPushEndpoint(b.endpoint)) {
    return { ok: false, error: "endpoint must be a valid push-service URL" };
  }
  if (typeof b.p256dhKey !== "string" || b.p256dhKey.length === 0 || b.p256dhKey.length > MAX_KEY_LEN) {
    return { ok: false, error: "p256dhKey required" };
  }
  if (typeof b.authKey !== "string" || b.authKey.length === 0 || b.authKey.length > MAX_KEY_LEN) {
    return { ok: false, error: "authKey required" };
  }
  return { ok: true, data: { endpoint: b.endpoint, p256dhKey: b.p256dhKey, authKey: b.authKey } };
}

/**
 * Expose the VAPID public key so the browser can create a PushSubscription.
 * This key is not sensitive — it is the public half of the VAPID key pair.
 */
router.get("/push/web/vapid-public-key", (_req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    res.status(503).json({ error: "web push not configured" });
    return;
  }
  res.json({ vapidPublicKey: key });
});

/**
 * Register or refresh a browser Web Push subscription. Idempotent on
 * (appUserId, endpoint). The 24h gate on `push_user_state` is shared with
 * the Expo path so a user only gets one Bone Buddy nudge per 24h regardless
 * of how many channels they're subscribed on.
 */
router.post("/push/web/register", async (req, res) => {
  const appUserId = await requireUserAuth(req, res);
  if (!appUserId) return;
  const result = validateWebRegister(req.body);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  const { endpoint, p256dhKey, authKey } = result.data;
  try {
    const now = new Date();
    await db
      .insert(webPushSubscriptionsTable)
      .values({ appUserId, endpoint, p256dhKey, authKey, optedIn: true, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [webPushSubscriptionsTable.appUserId, webPushSubscriptionsTable.endpoint],
        set: { p256dhKey, authKey, optedIn: true, updatedAt: now },
      });
    res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err }, "web push register failed");
    res.status(500).json({ error: "internal" });
  }
});

/**
 * Unregister a browser Web Push subscription. Accepts an optional `endpoint`
 * to target one subscription, or unregisters all for the user.
 */
router.post("/push/web/unregister", async (req, res) => {
  const appUserId = await requireUserAuth(req, res);
  if (!appUserId) return;
  const body = req.body as { endpoint?: unknown } | undefined;
  const endpoint =
    typeof body?.endpoint === "string" && body.endpoint.length > 0 ? body.endpoint : null;
  try {
    if (endpoint) {
      await db
        .update(webPushSubscriptionsTable)
        .set({ optedIn: false, updatedAt: new Date() })
        .where(
          and(
            eq(webPushSubscriptionsTable.appUserId, appUserId),
            eq(webPushSubscriptionsTable.endpoint, endpoint),
          ),
        );
    } else {
      await db
        .update(webPushSubscriptionsTable)
        .set({ optedIn: false, updatedAt: new Date() })
        .where(eq(webPushSubscriptionsTable.appUserId, appUserId));
    }
    res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err }, "web push unregister failed");
    res.status(500).json({ error: "internal" });
  }
});

// ---------------------------------------------------------------------------
// Bone Buddy nudge trigger (user-authed)
// ---------------------------------------------------------------------------

/**
 * Internal trigger — same shared secret as the RevenueCat webhook so we
 * don't manage a second admin secret. Used by future schedulers and the
 * manual "send a test" path. The 24h gate is enforced inside the sender.
 *
 * This is server-to-server only (admin-secret authed), not user-authed.
 */
/**
 * User-authed daily nudge. Lets the mobile app ask the server to send
 * the signed-in user a single calm Bone Buddy push. The 24h gate
 * inside `sendBoneBuddyPush` keeps this safe to call on every app
 * launch / Coach-tab open — repeats inside the window return
 * `skipped_throttled` and the user only sees one nudge per day.
 *
 * Body: optional `firstName` so the copy can read warmly without us
 * having to look the user's name up server-side.
 */
router.post("/push/daily-nudge", async (req, res) => {
  const appUserId = await requireUserAuth(req, res);
  if (!appUserId) return;
  const body = req.body as
    | {
        firstName?: unknown;
        wellbeingStreak?: unknown;
        calciumOnTarget?: unknown;
        lastMood?: unknown;
        todayLocalDate?: unknown;
      }
    | undefined;

  // Validate every input narrowly. Strings are trimmed and length-bounded;
  // numbers must be finite; booleans pass-through.
  const rawName = typeof body?.firstName === "string" ? body.firstName.trim() : "";
  const firstName = rawName.length > 0 && rawName.length <= 40 ? rawName : undefined;

  const streak =
    typeof body?.wellbeingStreak === "number" &&
    Number.isFinite(body.wellbeingStreak) &&
    body.wellbeingStreak >= 0 &&
    body.wellbeingStreak <= 9999
      ? Math.floor(body.wellbeingStreak)
      : undefined;

  const calciumOnTarget =
    typeof body?.calciumOnTarget === "boolean" ? body.calciumOnTarget : undefined;

  const rawMood = typeof body?.lastMood === "string" ? body.lastMood.trim() : "";
  const lastMood = rawMood.length > 0 && rawMood.length <= 30 ? rawMood : undefined;

  const rawDate =
    typeof body?.todayLocalDate === "string" ? body.todayLocalDate.trim() : "";
  const todayLocalDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : undefined;

  const facts: BuddyPushFacts = {
    firstName,
    wellbeingStreak: streak,
    calciumOnTarget,
    lastMood,
    todayLocalDate,
  };

  // Generate the line via the chat-backend LLM so copy stays in sync
  // with Bone Buddy's voice. The composer falls back to a small static
  // line if the model errors or returns empty.
  const text = await composeDailyNudgeLine(facts);

  const result = await sendBoneBuddyPush(appUserId, {
    body: text,
    title: "Bone Buddy",
    copyId: "daily-nudge-v1",
    data: { kind: "daily-nudge", route: "/(tabs)/coach" },
  });
  res.json(result);
});

router.post("/push/send", async (req, res) => {
  const expected = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!expected) {
    res.status(503).json({ error: "admin secret not configured" });
    return;
  }
  if (req.header("authorization") !== `Bearer ${expected}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const b = req.body as { appUserId?: string; body?: string; title?: string; copyId?: string; data?: Record<string, unknown> } | undefined;
  if (!b?.appUserId || !b?.body) {
    res.status(400).json({ error: "appUserId and body required" });
    return;
  }
  const result = await sendBoneBuddyPush(b.appUserId, {
    body: b.body,
    title: b.title,
    copyId: b.copyId,
    data: b.data,
  });
  res.json(result);
});

export default router;
