import { Router, type IRouter, type Request, type Response } from "express";
import { Resend } from "resend";
import { db, pendingEmailsTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const TEAM_EMAIL = "teamsnap@snaplife.co.uk";
const FROM_EMAIL = process.env.RESEND_FROM_ADDRESS ?? "SNAP Life <onboarding@resend.dev>";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

function isString(v: unknown): v is string {
  return typeof v === "string";
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] ?? char);
}

// ── Consultant registry ───────────────────────────────────────────────────────
// Adding a new consultant = adding one entry here. The mobile app
// mirrors this list in ExpertSupportTab.tsx.
const CONSULTANTS: Record<
  string,
  { label: string; title: string; email: string }
> = {
  maria: {
    label: "Maria",
    title: "Bone Health Consultant",
    email: "mrigopoulou@hotmail.co.uk",
  },
  faye: {
    label: "Faye — Lift Nutrition",
    title: "Nutritionist & Healthy Ageing Specialist",
    email: "faye@liftnutrition.co.uk",
  },
};

/**
 * POST /api/expert-support/request
 *
 * Receives a support request from the mobile app and:
 *   1. Sends a notification to the selected consultant directly.
 *   2. Sends a CC copy to teamsnap@snaplife.co.uk (safeguarding / oversight).
 *   3. Queues a confirmation email to the user via the async worker.
 *
 * No auth required — users may not yet have a session when they enquire.
 * Rate-limited by the shared API rate-limiter upstream.
 */
async function handleExpertSupportRequest(req: Request, res: Response) {
  const b = req.body as Record<string, unknown>;

  const name         = isString(b.name)         ? b.name.trim()         : "";
  const email        = isString(b.email)         ? b.email.trim()        : "";
  const phone        = isString(b.phone)         ? b.phone.trim()        : "";
  const consultantId = isString(b.consultantId)  ? b.consultantId.trim() : "";
  const preferred    = isString(b.preferred)     ? b.preferred.trim()    : "";
  const reason       = isString(b.reason)        ? b.reason.trim()       : "";

  if (!name || !email || !consultantId) {
    res.status(400).json({ error: "name, email and consultantId are required" });
    return;
  }
  if (name.length > 200 || email.length > 320 || phone.length > 30 || preferred.length > 500 || reason.length > 2000) {
    res.status(400).json({ error: "input_too_long" });
    return;
  }
  if (!email.includes("@")) {
    res.status(400).json({ error: "invalid_email" });
    return;
  }

  const consultant = CONSULTANTS[consultantId];
  if (!consultant) {
    res.status(400).json({ error: "unknown_consultant" });
    return;
  }

  const receivedAt = new Date().toLocaleString("en-GB", { timeZone: "Europe/London" });

  if (!resend) {
    req.log?.error(
      { consultantId, name },
      "expert support: RESEND_API_KEY not set — request was not delivered",
    );
    res.status(503).json({
      error: "email_service_unavailable",
      message: "Email service is temporarily unavailable. Please contact teamsnap@snaplife.co.uk directly.",
    });
    return;
  }

  const safeConsultantLabel = escapeHtml(consultant.label);
  const safeConsultantTitle = escapeHtml(consultant.title);
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safePhone = escapeHtml(phone);
  const safePreferred = escapeHtml(preferred);
  const safeReason = escapeHtml(reason).replace(/\n/g, "<br>");

  const htmlBody = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1C3A4A;">
      <div style="background: linear-gradient(135deg, #1C3A4A, #3ABBD4); padding: 24px 28px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; color: #fff; font-size: 20px;">New Expert Support Request</h1>
        <p style="margin: 6px 0 0; color: rgba(255,255,255,0.85); font-size: 14px;">Received ${receivedAt}</p>
      </div>
      <div style="background: #f8fafc; padding: 24px 28px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-weight: 600; width: 150px; color: #64748b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">Consultant</td>
            <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-size: 15px; font-weight: 700; color: #1C3A4A;">${safeConsultantLabel} — ${safeConsultantTitle}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #64748b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">Name</td>
            <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-size: 15px;">${safeName}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #64748b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">Email</td>
            <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-size: 15px;"><a href="mailto:${safeEmail}" style="color: #3ABBD4;">${safeEmail}</a></td>
          </tr>
          ${phone ? `
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #64748b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">Phone</td>
            <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-size: 15px;">${safePhone}</td>
          </tr>` : ""}
          ${preferred ? `
          <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #64748b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">Preferred time</td>
            <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-size: 15px;">${safePreferred}</td>
          </tr>` : ""}
          ${reason ? `
          <tr>
            <td style="padding: 10px 0; font-weight: 600; color: #64748b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; vertical-align: top;">Reason</td>
            <td style="padding: 10px 0; font-size: 15px; line-height: 1.6;">${safeReason}</td>
          </tr>` : ""}
        </table>
        <div style="margin-top: 20px; padding: 14px 16px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; color: #64748b;">
          Reply directly to this email to reach <strong>${safeName}</strong> at <strong>${safeEmail}</strong>.
        </div>
        <div style="margin-top: 12px; padding: 12px 16px; background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 8px; font-size: 12px; color: #1E40AF;">
          ⚑ This request has also been sent to ${TEAM_EMAIL} for oversight and continuity of care.
        </div>
      </div>
    </div>
  `;

  try {
    // 1. Notify the consultant directly
    const { error: consultantError } = await resend.emails.send({
      from: FROM_EMAIL,
      to: consultant.email,
      replyTo: email,
      subject: `New support request for you — SNAP Life`,
      html: htmlBody,
    });

    if (consultantError) {
      req.log?.error({ consultantError, consultantId, name }, "expert support: resend error (consultant)");
      res.status(502).json({
        error: "email_delivery_failed",
        message: "Email delivery failed. Check RESEND_API_KEY and RESEND_FROM_ADDRESS sender verification.",
      });
      return;
    }

    // 2. CC the SNAP team for safeguarding / oversight
    const { error: teamError } = await resend.emails.send({
      from: FROM_EMAIL,
      to: TEAM_EMAIL,
      replyTo: email,
      subject: `Expert Support request — ${consultant.label} (${name})`,
      html: htmlBody,
    });

    if (teamError) {
      // Non-fatal — consultant already notified. Log and continue.
      req.log?.warn({ teamError, consultantId, name }, "expert support: team CC failed (non-fatal)");
    }

    req.log?.info({ consultantId, name, email }, "expert support: emails sent");

    // 3. Queue a confirmation email to the user
    let confirmationQueued = true;
    await db
      .insert(pendingEmailsTable)
      .values({
        kind: "expert_support_confirmation",
        toAddress: email,
        externalId: `expert_support_confirmation:${email}:${Date.now()}`,
        payload: {
          name,
          consultantLabel: consultant.label,
          consultantTitle: consultant.title,
          preferred: preferred || null,
        },
      })
      .onConflictDoNothing()
      .catch((err) => {
        confirmationQueued = false;
        logger.warn({ err, email }, "expert support: failed to queue confirmation email (soft)");
      });

    res.json({ ok: true, emailDelivered: true, confirmationQueued });
  } catch (err) {
    req.log?.error({ err, consultantId }, "expert support: unexpected error");
    res.status(500).json({ error: "internal" });
  }
}

router.post("/expert-support/request", handleExpertSupportRequest);
router.post("/api/expert-support/request", handleExpertSupportRequest);

export default router;
