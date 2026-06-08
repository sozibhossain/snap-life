import { Router, type IRouter } from "express";
import { Resend } from "resend";
import { eq } from "drizzle-orm";
import { db, feedbackTable, usersTable } from "@workspace/db";
import { assertSelf, requireUserAuth } from "../lib/auth";

const TEAM_EMAIL = "teamsnap@snaplife.co.uk";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const router: IRouter = Router();

const FEEDBACK_TYPES = ["general", "testimonial", "experience"] as const;
const TIERS = ["trial", "plus", "premium"] as const;
const ALLOWED_TAGS = new Set([
  "Relaxing",
  "Easy to use",
  "Helpful",
  "Enjoyable",
  "Not working well",
]);

function isString(v: unknown): v is string {
  return typeof v === "string";
}

interface ValidatedSubmission {
  feedbackType: (typeof FEEDBACK_TYPES)[number];
  tier: (typeof TIERS)[number];
  message: string;
  tags: string[];
  allowTestimonialUse: boolean;
  claimedUserId: string | null;
  platform: string | null;
  appVersion: string | null;
}

type FeedbackTypeName = (typeof FEEDBACK_TYPES)[number];
type TierName = (typeof TIERS)[number];

function isFeedbackType(v: string): v is FeedbackTypeName {
  return (FEEDBACK_TYPES as readonly string[]).includes(v);
}
function isTier(v: string): v is TierName {
  return (TIERS as readonly string[]).includes(v);
}

function validateSubmission(body: unknown): { ok: true; data: ValidatedSubmission } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body required" };
  const b = body as Record<string, unknown>;

  if (!isString(b.feedbackType) || !isFeedbackType(b.feedbackType)) {
    return { ok: false, error: "feedbackType invalid" };
  }
  if (!isString(b.tier) || !isTier(b.tier)) {
    return { ok: false, error: "tier invalid" };
  }
  if (!isString(b.message)) return { ok: false, error: "message required" };
  const message = b.message.trim();
  if (message.length === 0) return { ok: false, error: "message required" };
  if (message.length > 2000) return { ok: false, error: "message too long" };

  let tags: string[] = [];
  if (Array.isArray(b.tags)) {
    if (b.tags.length > 10) return { ok: false, error: "too many tags" };
    for (const t of b.tags) {
      if (!isString(t) || !ALLOWED_TAGS.has(t)) return { ok: false, error: "tag invalid" };
      tags.push(t);
    }
  }

  const allowTestimonialUse = b.allowTestimonialUse === true;

  const claimedUserId =
    isString(b.appUserId) && b.appUserId.trim().length > 0 && b.appUserId.length <= 200
      ? b.appUserId.trim()
      : null;
  const platform =
    isString(b.platform) && b.platform.length <= 40 ? b.platform : null;
  const appVersion =
    isString(b.appVersion) && b.appVersion.length <= 40 ? b.appVersion : null;

  return {
    ok: true,
    data: {
      feedbackType: b.feedbackType,
      tier: b.tier,
      message,
      tags,
      allowTestimonialUse,
      claimedUserId,
      platform,
      appVersion,
    },
  };
}

router.post("/feedback", async (req, res) => {
  const appUserId = await requireUserAuth(req, res);
  if (!appUserId) return;
  const result = validateSubmission(req.body);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  const data = result.data;
  if (assertSelf(res, appUserId, data.claimedUserId)) return;
  try {
    const [row] = await db
      .insert(feedbackTable)
      .values({
        appUserId,
        tier: data.tier,
        feedbackType: data.feedbackType,
        message: data.message,
        tags: data.tags,
        allowTestimonialUse: data.allowTestimonialUse,
        platform: data.platform,
        appVersion: data.appVersion,
        metadata: {
          // Captured server-side so the value can't be spoofed by a client claim.
          receivedAt: new Date().toISOString(),
          userAgent: req.header("user-agent") ?? null,
        },
      })
      .returning();

    res.json({ ok: true, id: row?.id });

    // Notify the team whenever a testimonial is submitted (or the user
    // consents to testimonial use). Fire-and-forget — never blocks the response.
    const isTestimonial =
      data.feedbackType === "testimonial" || data.allowTestimonialUse;

    if (isTestimonial) {
      void notifyTeamOfTestimonial(appUserId, data, row?.id).catch((err) => {
        req.log?.warn({ err, appUserId }, "feedback: team testimonial notification failed (soft)");
      });
    }
  } catch (err) {
    req.log?.error({ err }, "feedback insert failed");
    res.status(500).json({ error: "internal" });
  }
});

/**
 * Sends a formatted email to the SNAP team when a testimonial (or
 * consent-flagged submission) arrives. Best-effort — caller catches errors.
 */
async function notifyTeamOfTestimonial(
  appUserId: string,
  data: ValidatedSubmission,
  feedbackId: number | undefined,
): Promise<void> {
  if (!resend) return;

  // Look up the user's name and email for context
  const [user] = await db
    .select({ displayName: usersTable.displayName, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.appUserId, appUserId))
    .limit(1);

  const userName = user?.displayName ?? "Anonymous";
  const userEmail = user?.email ?? null;
  const receivedAt = new Date().toLocaleString("en-GB", { timeZone: "Europe/London" });
  const tagsHtml = data.tags.length
    ? data.tags
        .map(
          (t) =>
            `<span style="display:inline-block;background:#E0F7FA;color:#0891B2;font-size:12px;font-weight:600;padding:2px 10px;border-radius:99px;margin:2px 4px 2px 0;">${t}</span>`,
        )
        .join("")
    : "<em style='color:#9CA3AF;font-size:13px;'>None</em>";

  const consentBadge = data.allowTestimonialUse
    ? `<span style="display:inline-block;background:#D1FAE5;color:#065F46;font-size:12px;font-weight:700;padding:2px 10px;border-radius:99px;">✓ Consented to testimonial use</span>`
    : `<span style="display:inline-block;background:#FEF3C7;color:#92400E;font-size:12px;font-weight:700;padding:2px 10px;border-radius:99px;">No testimonial consent</span>`;

  const typeLabel =
    data.feedbackType === "testimonial"
      ? "Testimonial"
      : data.feedbackType === "experience"
      ? "Experience"
      : "General";

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_ADDRESS ?? "SNAP Life <onboarding@resend.dev>",
    to: TEAM_EMAIL,
    ...(userEmail ? { replyTo: userEmail } : {}),
    subject: `New ${typeLabel} from ${userName} — SNAP Life`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#1C3A4A;">
        <!-- Header -->
        <div style="background:linear-gradient(135deg,#1C3A4A,#3ABBD4);padding:24px 28px;border-radius:12px 12px 0 0;">
          <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">New ${typeLabel} Received</h1>
          <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">Received ${receivedAt}</p>
        </div>
        <!-- Body -->
        <div style="background:#f8fafc;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">

          <!-- Consent banner -->
          <div style="margin-bottom:20px;">${consentBadge}</div>

          <!-- Meta table -->
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-weight:600;width:130px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">From</td>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:15px;font-weight:600;">${userName}${userEmail ? ` &lt;<a href="mailto:${userEmail}" style="color:#3ABBD4;font-weight:400;">${userEmail}</a>&gt;` : ""}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-weight:600;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Tier</td>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:14px;">${data.tier.charAt(0).toUpperCase() + data.tier.slice(1)}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-weight:600;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Type</td>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:14px;">${typeLabel}</td>
            </tr>
            ${data.tags.length ? `
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-weight:600;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;vertical-align:top;padding-top:14px;">Tags</td>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;padding-top:12px;">${tagsHtml}</td>
            </tr>` : ""}
            ${data.platform ? `
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-weight:600;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Platform</td>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:14px;">${data.platform}${data.appVersion ? ` v${data.appVersion}` : ""}</td>
            </tr>` : ""}
            ${feedbackId !== undefined ? `
            <tr>
              <td style="padding:10px 0;font-weight:600;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Feedback ID</td>
              <td style="padding:10px 0;font-size:13px;color:#9CA3AF;">#${feedbackId}</td>
            </tr>` : ""}
          </table>

          <!-- Message -->
          <div style="background:#fff;border:1px solid #e2e8f0;border-left:4px solid #3ABBD4;border-radius:0 8px 8px 0;padding:16px 20px;">
            <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Message</p>
            <p style="margin:0;font-size:15px;line-height:1.7;color:#1C3A4A;white-space:pre-wrap;">${data.message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
          </div>

          ${userEmail ? `<p style="margin:20px 0 0;font-size:13px;color:#64748b;">Reply directly to this email to reach <strong>${userName}</strong>.</p>` : ""}
        </div>
      </div>
    `,
  });

  if (error) {
    throw new Error(error.message ?? "Resend error");
  }
}

// Admin feedback listing was moved to GET /api/admin/feedback (Clerk
// session-gated by `users.isAdmin`). The legacy webhook-secret-gated
// endpoint here was removed in favour of that contract.

export default router;
