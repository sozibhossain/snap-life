import { Router, type IRouter, type Request, type Response } from "express";
import { Resend } from "resend";
import { db, pendingEmailsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { randomUUID } from "node:crypto";
import { serviceRequestLimiter } from "../middlewares/rateLimit";

const router: IRouter = Router();

const COACHING_EMAIL = "teamsnap@snaplife.co.uk";
const FROM_EMAIL = process.env.RESEND_FROM_ADDRESS ?? "SNAP Life <onboarding@resend.dev>";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] ?? char);
}

const SESSIONS: Record<string, { label: string; paid: boolean; checkoutUrl?: string }> = {
  consultation: { label: "Free Consultation (30 min)", paid: false },
  focus: { label: "Focus Session (45 min — £65)", paid: true, checkoutUrl: process.env.COACHING_CHECKOUT_FOCUS_URL },
  deep: { label: "Deep Support Session (60 min — £85)", paid: true, checkoutUrl: process.env.COACHING_CHECKOUT_DEEP_URL },
  transformation: { label: "Transformation Session (90 min — £125)", paid: true, checkoutUrl: process.env.COACHING_CHECKOUT_TRANSFORMATION_URL },
};

/**
 * POST /api/coaching/booking
 *
 * Receives a coaching booking request from the mobile app and emails it
 * to teamsnap@snaplife.co.uk via Resend. No auth required — users may
 * not yet have completed their profile when they enquire. Rate-limited
 * by the shared API rate-limiter upstream.
 */
async function handleCoachingBooking(req: Request, res: Response) {
  const b = req.body as Record<string, unknown>;

  const name      = isString(b.name)      ? b.name.trim()      : "";
  const email     = isString(b.email)     ? b.email.trim()     : "";
  const sessionId = isString(b.sessionId) ? b.sessionId.trim() : "";
  const preferred = isString(b.preferred) ? b.preferred.trim() : "";
  const message   = isString(b.message)   ? b.message.trim()   : "";

  const transactionId = isString(b.transactionId) ? b.transactionId.trim() : "";
  const paymentMethod = isString(b.paymentMethod) ? b.paymentMethod.trim() : (transactionId ? "Apple In-App Purchase" : "Web Checkout");

  if (!name || !email || !sessionId) {
    res.status(400).json({ error: "name, email and sessionId are required" });
    return;
  }
  if (name.length > 200 || email.length > 320 || preferred.length > 500 || message.length > 2000) {
    res.status(400).json({ error: "input too long" });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "invalid email" });
    return;
  }

  const session = SESSIONS[sessionId];
  if (!session) {
    res.status(400).json({ error: "unknown_session" });
    return;
  }
  if (session.paid && !transactionId && (!session.checkoutUrl || !/^https:\/\//i.test(session.checkoutUrl))) {
    // If not paid via IAP and web checkout is missing, still allow booking as requested if no strict checkout required
    if (b.requireCheckoutUrl) {
      req.log?.error({ sessionId }, "coaching checkout URL missing or invalid");
      res.status(503).json({
        error: "payment_unavailable",
        message: "Secure payment is temporarily unavailable for this session. Please try again shortly or contact teamsnap@snaplife.co.uk.",
      });
      return;
    }
  }
  const sessionLabel = session.label;
  const bookingReference = `coach-${randomUUID()}`;
  const receivedAt   = new Date().toLocaleString("en-GB", { timeZone: "Europe/London" });
  const safeSessionLabel = escapeHtml(sessionLabel);
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safePreferred = escapeHtml(preferred);
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br>");
  const safeTransactionId = escapeHtml(transactionId);
  const safePaymentMethod = escapeHtml(paymentMethod);

  if (!resend) {
    req.log?.error(
      { sessionId, name },
      "coaching booking: RESEND_API_KEY not set — request was not delivered",
    );
    res.status(503).json({
      error: "email_service_unavailable",
      message: "Email service is temporarily unavailable. Please contact teamsnap@snaplife.co.uk directly.",
    });
    return;
  }

  const emailSubject = transactionId
    ? `[PAID] Coaching session booked — ${sessionLabel}`
    : session.paid
    ? `Paid coaching checkout started — ${sessionLabel}`
    : `Coaching booking request — ${sessionLabel}`;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: COACHING_EMAIL,
      replyTo: email,
      subject: emailSubject,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1C3A4A;">
          <div style="background: linear-gradient(135deg, #F47530, #FFB07A); padding: 24px 28px; border-radius: 12px 12px 0 0;">
            <h1 style="margin: 0; color: #fff; font-size: 20px;">${transactionId ? "Coaching Session Booked (PAID)" : "New Coaching Booking Request"}</h1>
            <p style="margin: 6px 0 0; color: rgba(255,255,255,0.85); font-size: 14px;">Received ${receivedAt}</p>
          </div>
          <div style="background: #f8fafc; padding: 24px 28px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-weight: 600; width: 140px; color: #64748b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">Session</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-size: 15px; font-weight: 700; color: #F47530;">${safeSessionLabel}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #64748b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">Payment Status</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-size: 15px; font-weight: 600; color: ${transactionId ? "#16a34a" : "#ca8a04"};">
                  ${transactionId ? `PAID (${safePaymentMethod}) — Ref: ${safeTransactionId}` : (session.paid ? `Pending (${safePaymentMethod})` : "Free Consultation")}
                </td>
              </tr>
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #64748b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">Reference</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-size: 15px;">${escapeHtml(bookingReference)}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #64748b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">Name</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-size: 15px;">${safeName}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #64748b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">Email</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-size: 15px;"><a href="mailto:${safeEmail}" style="color: #3ABBD4;">${safeEmail}</a></td>
              </tr>
              ${preferred ? `
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #64748b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;">Preferred time</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; font-size: 15px;">${safePreferred}</td>
              </tr>` : ""}
              ${message ? `
              <tr>
                <td style="padding: 10px 0; font-weight: 600; color: #64748b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; vertical-align: top;">Message</td>
                <td style="padding: 10px 0; font-size: 15px; line-height: 1.6;">${safeMessage}</td>
              </tr>` : ""}
            </table>
            <div style="margin-top: 20px; padding: 14px 16px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; color: #64748b;">
              Reply directly to this email to reach <strong>${safeName}</strong> at <strong>${safeEmail}</strong>.
            </div>
          </div>
        </div>
      `,
    });

    if (error) {
      req.log?.error({ error, sessionId, name }, "coaching booking: resend error");
      res.status(502).json({
        error: "email_delivery_failed",
        message: "Email delivery failed. Check RESEND_API_KEY and RESEND_FROM_ADDRESS sender verification.",
      });
      return;
    }

    req.log?.info({ sessionId, name, email }, "coaching booking: email sent");

    // Also queue a confirmation email to the person who booked
    let confirmationQueued = true;
    await db
      .insert(pendingEmailsTable)
      .values({
        kind: "coaching_confirmation",
        toAddress: email,
        externalId: `coaching_confirmation:${bookingReference}`,
        payload: {
          name,
          sessionLabel,
          preferred: preferred || null,
          bookingReference,
          paymentRequired: session.paid,
          checkoutUrl: session.paid ? session.checkoutUrl : null,
        },
      })
      .onConflictDoNothing()
      .catch((err) => {
        confirmationQueued = false;
        logger.warn({ err, email }, "coaching booking: failed to queue confirmation email (soft)");
      });

    res.json({
      ok: true,
      emailDelivered: true,
      confirmationQueued,
      bookingReference,
      nextAction: session.paid ? "payment" : "await_confirmation",
      paymentUrl: session.paid ? session.checkoutUrl : null,
    });
  } catch (err) {
    req.log?.error({ err, sessionId }, "coaching booking: unexpected error");
    res.status(500).json({ error: "internal" });
  }
}

router.post("/coaching/booking", serviceRequestLimiter, handleCoachingBooking);
router.post("/api/coaching/booking", serviceRequestLimiter, handleCoachingBooking);

export default router;
