/**
 * GET /api/engagement/profile — per-user adaptive engagement profile.
 *
 * Drives the Premium-only adaptive Today's Focus on the mobile dashboard.
 * Plus users still hit this endpoint, but the mobile client only uses the
 * payload when `hasPremiumOrTrial` is true; we don't gate at the API
 * layer because (a) the entitlement signal lives in RevenueCat and we
 * don't want to add a round-trip on every read, and (b) leaking
 * "completed/shown" counts to a non-Premium client is harmless.
 */

import { Router, type IRouter } from "express";
import { requireUserAuth } from "../lib/auth";
import { buildEngagementProfile } from "../lib/engagementProfile";

const router: IRouter = Router();

router.get("/engagement/profile", async (req, res) => {
  const appUserId = await requireUserAuth(req, res);
  if (!appUserId) return;
  try {
    const profile = await buildEngagementProfile(appUserId);
    res.json(profile);
  } catch (err) {
    req.log?.error({ err }, "engagement profile build failed");
    res.status(500).json({ error: "internal" });
  }
});

export default router;
