/**
 * Branded HTML email templates for all SNAP Life email kinds.
 *
 * Each template function receives the `payload` from the `pending_emails`
 * row and returns { subject, html }. The email sender worker calls the
 * correct function by `kind`.
 *
 * Brand palette:
 *   Navy:   #1C3A4A  (backgrounds, headings)
 *   Teal:   #3ABBD4  (primary accent, links)
 *   Orange: #F47530  (CTAs, highlights)
 *   White:  #FFFFFF
 *   Light:  #F8FAFC  (card backgrounds)
 */

export interface RenderedEmail {
  subject: string;
  html: string;
}

// ---------------------------------------------------------------------------
// Shared layout helpers
// ---------------------------------------------------------------------------

const IS_STAGING = process.env.SNAP_LIFE_ENV === "staging";

function stagingBanner(): string {
  if (!IS_STAGING) return "";
  return `
      <!-- Staging warning -->
      <tr><td style="background:#D97706;border-radius:12px 12px 0 0;padding:10px 32px;text-align:center;">
        <p style="margin:0;font-size:11px;font-weight:700;color:#fff;letter-spacing:1px;text-transform:uppercase;">
          ⚠ TEST EMAIL — STAGING ENVIRONMENT — NOT SENT TO LIVE USERS ⚠
        </p>
      </td></tr>`;
}

function wrap(body: string, preheader = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>SNAP Life</title>
</head>
<body style="margin:0;padding:0;background:#F0F4F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>` : ""}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" style="max-width:560px;" cellspacing="0" cellpadding="0">
${stagingBanner()}
      <!-- Header -->
      <tr><td style="background:#1C3A4A;${IS_STAGING ? "" : "border-radius:12px 12px 0 0;"}padding:28px 32px;text-align:center;">
        <span style="font-size:22px;font-weight:700;color:#3ABBD4;letter-spacing:-0.5px;">SNAP</span>
        <span style="font-size:22px;font-weight:700;color:#FFFFFF;letter-spacing:-0.5px;"> Life</span>
        <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,0.55);letter-spacing:1px;text-transform:uppercase;">Bone Health &amp; Wellness</p>
      </td></tr>

      <!-- Body -->
      <tr><td style="background:#FFFFFF;padding:36px 32px;">
        ${body}
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#1C3A4A;border-radius:0 0 12px 12px;padding:20px 32px;text-align:center;">
        <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.5);">
          © ${new Date().getFullYear()} SNAP Life &bull;
          <a href="https://snaplife.co.uk/privacy" style="color:#3ABBD4;text-decoration:none;">Privacy</a> &bull;
          <a href="https://snaplife.co.uk/unsubscribe" style="color:#3ABBD4;text-decoration:none;">Unsubscribe</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function h1(text: string): string {
  return `<h1 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#1C3A4A;line-height:1.3;">${text}</h1>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">${text}</p>`;
}

function cta(label: string, href: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0;">
  <tr><td style="background:#F47530;border-radius:8px;padding:14px 28px;text-align:center;">
    <a href="${href}" style="color:#FFFFFF;font-size:15px;font-weight:600;text-decoration:none;display:block;">${label}</a>
  </td></tr>
</table>`;
}

function divider(): string {
  return `<hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;" />`;
}

function infoRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 12px;font-size:13px;color:#6B7280;font-weight:600;width:40%;background:#F8FAFC;border-bottom:1px solid #E5E7EB;">${label}</td>
    <td style="padding:8px 12px;font-size:13px;color:#1C3A4A;border-bottom:1px solid #E5E7EB;">${value}</td>
  </tr>`;
}

function infoTable(rows: Array<[string, string]>): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;margin:16px 0;">
    ${rows.map(([l, v]) => infoRow(l, v)).join("")}
  </table>`;
}

function tealBadge(text: string): string {
  return `<span style="display:inline-block;background:#E0F7FA;color:#0891B2;font-size:12px;font-weight:600;padding:3px 10px;border-radius:99px;">${text}</span>`;
}

// ---------------------------------------------------------------------------
// Template: welcome
// ---------------------------------------------------------------------------
export function renderWelcome(payload: Record<string, unknown>): RenderedEmail {
  const name = (payload.displayName as string | undefined) || "there";
  const firstName = name.split(" ")[0];
  return {
    subject: `Welcome to SNAP Life, ${firstName} 🦴`,
    html: wrap(
      `
      ${h1(`Welcome aboard, ${firstName}!`)}
      ${p("You've just taken a great first step toward stronger bones and a healthier life. SNAP Life is your personal bone health companion — here to track, coach, and cheer you on every day.")}
      <ul style="margin:0 0 20px;padding-left:20px;font-size:15px;line-height:2;color:#374151;">
        <li><strong>Track your DEXA scans</strong> and see your bone health trends over time</li>
        <li><strong>Chat with Bone Buddy</strong> — your AI coach, available any time</li>
        <li><strong>Log activity &amp; nutrition</strong> to build daily healthy habits</li>
        <li><strong>Join the community</strong> for motivation and shared stories</li>
      </ul>
      ${cta("Open SNAP Life", "https://snaplife.co.uk/app")}
      ${divider()}
      ${p("Questions? Just reply to this email — we're always happy to help.")}
      ${p('<span style="color:#9CA3AF;font-size:13px;">The SNAP Life Team</span>')}
    `,
      `Welcome to SNAP Life — your bone health journey starts now.`,
    ),
  };
}

// ---------------------------------------------------------------------------
// Template: account_deletion_confirmation
// ---------------------------------------------------------------------------
export function renderAccountDeletion(
  payload: Record<string, unknown>,
): RenderedEmail {
  const name = (payload.displayName as string | undefined) || "there";
  const hardDeleteAfter = payload.hardDeleteAfter as string | undefined;
  const deleteDate = hardDeleteAfter
    ? new Date(hardDeleteAfter).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "30 days from now";
  return {
    subject: "Your SNAP Life account has been deleted",
    html: wrap(
      `
      ${h1("Account deleted")}
      ${p(`Hi ${name}, we've received your request to delete your SNAP Life account. Your data has been scheduled for permanent removal.`)}
      ${infoTable([
        ["Status", "Soft-deleted — data retained for 30-day grace window"],
        ["Permanent deletion", deleteDate],
        ["Data export", "If you need a copy of your data, contact us before the date above"],
      ])}
      ${p("If you deleted your account by mistake, please contact us at <a href='mailto:support@snaplife.co.uk' style='color:#3ABBD4;'>support@snaplife.co.uk</a> before the date above and we can restore it.")}
      ${divider()}
      ${p("Thank you for being part of the SNAP Life community. We hope to welcome you back one day.")}
      ${p('<span style="color:#9CA3AF;font-size:13px;">The SNAP Life Team</span>')}
    `,
      "Your SNAP Life account deletion has been confirmed.",
    ),
  };
}

// ---------------------------------------------------------------------------
// Template: trial_reminder_7d
// ---------------------------------------------------------------------------
export function renderTrialReminder7d(
  payload: Record<string, unknown>,
): RenderedEmail {
  const trialEndsAt = payload.trialEndsAt as string | undefined;
  const endDate = trialEndsAt
    ? new Date(trialEndsAt).toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : "in 7 days";
  return {
    subject: "Your SNAP Life Premium trial ends in 7 days",
    html: wrap(
      `
      ${h1("7 days left on your free trial")}
      ${p(`Your SNAP Life Premium trial ends on <strong>${endDate}</strong>. Don't lose access to your personalised coaching and bone health insights.`)}
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0;">
        <tr>
          <td width="50%" style="padding:12px;background:#F8FAFC;border:1px solid #E5E7EB;border-radius:8px;text-align:center;">
            <p style="margin:0;font-size:28px;">🦴</p>
            <p style="margin:6px 0 0;font-size:13px;font-weight:600;color:#1C3A4A;">Bone Buddy AI</p>
            <p style="margin:4px 0 0;font-size:12px;color:#6B7280;">Personalised coaching</p>
          </td>
          <td width="8px"></td>
          <td width="50%" style="padding:12px;background:#F8FAFC;border:1px solid #E5E7EB;border-radius:8px;text-align:center;">
            <p style="margin:0;font-size:28px;">📊</p>
            <p style="margin:6px 0 0;font-size:13px;font-weight:600;color:#1C3A4A;">Advanced Insights</p>
            <p style="margin:4px 0 0;font-size:12px;color:#6B7280;">Trends &amp; fracture risk</p>
          </td>
        </tr>
      </table>
      ${cta("Upgrade to Premium", "https://snaplife.co.uk/app/subscription")}
      ${divider()}
      ${p("Still enjoying the trial? Keep going — every day of activity and logging is building your bone health picture. We'll remind you again closer to the end.")}
      ${p('<span style="color:#9CA3AF;font-size:13px;">The SNAP Life Team</span>')}
    `,
      "Your SNAP Life Premium trial ends in 7 days — keep your coaching access.",
    ),
  };
}

// ---------------------------------------------------------------------------
// Template: trial_reminder_2d
// ---------------------------------------------------------------------------
export function renderTrialReminder2d(
  payload: Record<string, unknown>,
): RenderedEmail {
  const trialEndsAt = payload.trialEndsAt as string | undefined;
  const endDate = trialEndsAt
    ? new Date(trialEndsAt).toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : "in 2 days";
  return {
    subject: "⏰ Last chance — Premium trial ends in 2 days",
    html: wrap(
      `
      <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:16px;margin-bottom:24px;text-align:center;">
        <p style="margin:0;font-size:32px;">⏰</p>
        <p style="margin:8px 0 0;font-size:16px;font-weight:700;color:#C2410C;">Trial ends ${endDate}</p>
      </div>
      ${h1("Don't lose your progress")}
      ${p("Your free Premium trial is almost over. Everything you've built — your scan history, coaching conversations, streaks, and insights — stays with you when you subscribe.")}
      ${cta("Upgrade now — keep everything", "https://snaplife.co.uk/app/subscription")}
      ${p('<span style="font-size:13px;color:#6B7280;">After your trial ends, you\'ll move to the free plan. You can upgrade any time to restore Premium access.</span>')}
    `,
      "Your SNAP Life Premium trial ends in just 2 days.",
    ),
  };
}

// ---------------------------------------------------------------------------
// Template: billing_issue
// ---------------------------------------------------------------------------
export function renderBillingIssue(
  payload: Record<string, unknown>,
): RenderedEmail {
  const gracePeriodEndsAt = payload.gracePeriodEndsAt as string | undefined;
  const graceDate = gracePeriodEndsAt
    ? new Date(gracePeriodEndsAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "soon";
  return {
    subject: "Action needed — payment issue with your SNAP Life subscription",
    html: wrap(
      `
      <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:16px;margin-bottom:24px;">
        <p style="margin:0;font-size:14px;font-weight:600;color:#DC2626;">⚠️ Payment could not be processed</p>
      </div>
      ${h1("We couldn't process your payment")}
      ${p("There was a problem charging the payment method linked to your SNAP Life Premium subscription. Don't worry — you still have full access during the grace period.")}
      ${infoTable([
        ["Access until", graceDate],
        ["Action needed", "Update your payment method in the app or via your App Store / Google Play settings"],
      ])}
      ${cta("Update payment method", "https://snaplife.co.uk/app/subscription")}
      ${divider()}
      ${p("If you believe this is an error, please contact us at <a href='mailto:support@snaplife.co.uk' style='color:#3ABBD4;'>support@snaplife.co.uk</a>.")}
      ${p('<span style="color:#9CA3AF;font-size:13px;">The SNAP Life Team</span>')}
    `,
      "Action needed: there was a payment issue with your SNAP Life subscription.",
    ),
  };
}

// ---------------------------------------------------------------------------
// Template: subscription_confirmation
// ---------------------------------------------------------------------------
export function renderSubscriptionConfirmation(
  payload: Record<string, unknown>,
): RenderedEmail {
  const entitlementId = payload.entitlementId as string | undefined;
  const tierLabel =
    entitlementId === "snap_premium" ? "Premium" : "Plus";
  return {
    subject: `Welcome to SNAP Life ${tierLabel}! 🎉`,
    html: wrap(
      `
      <div style="text-align:center;margin-bottom:24px;">
        <p style="margin:0;font-size:48px;">🎉</p>
        <p style="margin:8px 0 0;font-size:13px;">${tealBadge(`SNAP Life ${tierLabel}`)}</p>
      </div>
      ${h1(`You're now on SNAP Life ${tierLabel}`)}
      ${p("Thank you for subscribing! You now have full access to all your Premium features — personalised AI coaching, advanced bone health insights, adaptive meal plans, and more.")}
      <ul style="margin:0 0 20px;padding-left:20px;font-size:15px;line-height:2;color:#374151;">
        <li>Bone Buddy AI with adaptive tone</li>
        <li>Advanced fracture risk insights</li>
        <li>Personalised daily meal plans</li>
        <li>Unlimited coaching conversations</li>
      </ul>
      ${cta("Start exploring Premium", "https://snaplife.co.uk/app")}
      ${divider()}
      ${p("You'll receive a receipt from the App Store or Google Play. If you have any questions about your subscription, please reply to this email.")}
      ${p('<span style="color:#9CA3AF;font-size:13px;">The SNAP Life Team</span>')}
    `,
      `Your SNAP Life ${tierLabel} subscription is confirmed.`,
    ),
  };
}

// ---------------------------------------------------------------------------
// Template: subscription_cancelled
// ---------------------------------------------------------------------------
export function renderSubscriptionCancelled(
  payload: Record<string, unknown>,
): RenderedEmail {
  const entitlementId = payload.entitlementId as string | undefined;
  const tierLabel =
    entitlementId === "snap_premium" ? "Premium" : "Plus";
  return {
    subject: `Your SNAP Life ${tierLabel} subscription has been cancelled`,
    html: wrap(
      `
      ${h1("We're sorry to see you go")}
      ${p(`Your SNAP Life ${tierLabel} subscription has been cancelled. You'll keep access until the end of your current billing period.`)}
      ${p("Your data — scan history, achievements, streaks, and coaching conversations — is all saved. If you ever decide to come back, everything will be right where you left it.")}
      ${cta("Resubscribe any time", "https://snaplife.co.uk/app/subscription")}
      ${divider()}
      ${p("Want to tell us why you cancelled? Your feedback helps us improve. Just reply to this email.")}
      ${p('<span style="color:#9CA3AF;font-size:13px;">The SNAP Life Team</span>')}
    `,
      `Your SNAP Life ${tierLabel} subscription has been cancelled.`,
    ),
  };
}

// ---------------------------------------------------------------------------
// Template: payment_receipt
// ---------------------------------------------------------------------------
export function renderPaymentReceipt(
  payload: Record<string, unknown>,
): RenderedEmail {
  const entitlementId = payload.entitlementId as string | undefined;
  const tierLabel =
    entitlementId === "snap_premium" ? "Premium" : "Plus";
  const productId = payload.productId as string | undefined;
  const eventType = payload.eventType as string | undefined;
  const isRenewal = eventType === "RENEWAL";
  const date = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return {
    subject: `SNAP Life — ${isRenewal ? "Renewal" : "Purchase"} confirmed`,
    html: wrap(
      `
      <div style="text-align:center;margin-bottom:24px;">
        <p style="margin:0;font-size:48px;">✅</p>
      </div>
      ${h1(isRenewal ? "Subscription renewed" : "Purchase confirmed")}
      ${p(`Thank you! Your SNAP Life ${tierLabel} ${isRenewal ? "subscription has been renewed" : "purchase is confirmed"}.`)}
      ${infoTable([
        ["Plan", `SNAP Life ${tierLabel}`],
        ["Date", date],
        ...(productId ? [["Product ID", productId] as [string, string]] : []),
        ["Billed via", "App Store / Google Play"],
      ])}
      ${p("A full receipt is available in your App Store or Google Play account. If you have any billing questions, contact us at <a href=\"mailto:support@snaplife.co.uk\" style=\"color:#3ABBD4;\">support@snaplife.co.uk</a>.")}
      ${cta("Open SNAP Life", "https://snaplife.co.uk/app")}
    `,
      `Your SNAP Life ${tierLabel} ${isRenewal ? "renewal" : "purchase"} is confirmed.`,
    ),
  };
}

// ---------------------------------------------------------------------------
// Template: testimonial_request
// ---------------------------------------------------------------------------
export function renderTestimonialRequest(
  _payload: Record<string, unknown>,
): RenderedEmail {
  return {
    subject: "How has SNAP Life helped you? Share your story 💬",
    html: wrap(
      `
      ${h1("Would you share your bone health story?")}
      ${p("You've been on your SNAP Life journey for at least a month — and we'd love to hear how it's going. Your story can inspire others who are just starting out.")}
      <div style="background:#F0FDF4;border-left:4px solid #22C55E;border-radius:0 8px 8px 0;padding:16px 20px;margin:20px 0;">
        <p style="margin:0;font-size:14px;font-style:italic;color:#374151;">"It only takes a minute, and your words could make a real difference to someone else's bone health journey."</p>
        <p style="margin:8px 0 0;font-size:13px;font-weight:600;color:#16A34A;">— Catherine, SNAP Life founder</p>
      </div>
      ${cta("Share my story", "https://snaplife.co.uk/app/community")}
      ${p('<span style="font-size:13px;color:#6B7280;">This is completely optional and won\'t affect your experience. We\'re simply grateful for every person who helps us grow our community.</span>')}
    `,
      "Share your SNAP Life story and inspire others on their bone health journey.",
    ),
  };
}

// ---------------------------------------------------------------------------
// Template: referral_invite
// ---------------------------------------------------------------------------
export function renderReferralInvite(
  payload: Record<string, unknown>,
): RenderedEmail {
  const referrerName =
    (payload.referrerName as string | undefined) || "A friend";
  const referralCode = payload.referralCode as string | undefined;
  const referralLink = referralCode
    ? `https://snaplife.co.uk/join?ref=${referralCode}`
    : "https://snaplife.co.uk/join";
  return {
    subject: `${referrerName} thinks you'd love SNAP Life`,
    html: wrap(
      `
      ${h1(`${referrerName} invited you to SNAP Life`)}
      ${p(`${referrerName} is tracking their bone health with SNAP Life and wanted to share it with you. Join them and get a <strong>free Premium trial</strong> to start your bone health journey.`)}
      <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
        <p style="margin:0;font-size:12px;font-weight:600;color:#3B82F6;letter-spacing:1px;text-transform:uppercase;">Your personal invite link</p>
        <p style="margin:8px 0;font-size:20px;font-weight:700;color:#1C3A4A;letter-spacing:2px;">${referralCode ?? ""}</p>
        <p style="margin:0;font-size:12px;color:#6B7280;">Use this code when you sign up</p>
      </div>
      ${cta("Join SNAP Life free", referralLink)}
      <ul style="margin:0 0 20px;padding-left:20px;font-size:14px;line-height:2;color:#374151;">
        <li>Track your DEXA scans &amp; bone health trends</li>
        <li>Chat with Bone Buddy — your AI bone health coach</li>
        <li>Build healthy habits with daily activity &amp; nutrition logging</li>
        <li>Join a community that understands your journey</li>
      </ul>
      ${divider()}
      ${p('<span style="font-size:12px;color:#9CA3AF;">If you don\'t want to receive referral invites, you can ignore this email.</span>')}
    `,
      `${referrerName} invited you to SNAP Life — start your free Premium trial.`,
    ),
  };
}

// ---------------------------------------------------------------------------
// Template: referral_converted (to the referrer)
// ---------------------------------------------------------------------------
export function renderReferralConverted(
  payload: Record<string, unknown>,
): RenderedEmail {
  const refereeName =
    (payload.refereeName as string | undefined) || "Your friend";
  const xpAwarded = (payload.xpAwarded as number | undefined) ?? 250;
  return {
    subject: `🎉 ${refereeName} joined SNAP Life — you've earned ${xpAwarded} XP!`,
    html: wrap(
      `
      <div style="text-align:center;margin-bottom:24px;">
        <p style="margin:0;font-size:48px;">🎉</p>
      </div>
      ${h1(`Your referral worked!`)}
      ${p(`${refereeName} just joined SNAP Life using your referral link. As a thank you, we've added <strong>${xpAwarded} XP</strong> to your account.`)}
      <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
        <p style="margin:0;font-size:14px;color:#92400E;font-weight:600;">XP Awarded</p>
        <p style="margin:8px 0 0;font-size:36px;font-weight:700;color:#F47530;">+${xpAwarded}</p>
        <p style="margin:4px 0 0;font-size:13px;color:#6B7280;">Added to your account</p>
      </div>
      ${p("Keep sharing your referral link — every friend you bring to SNAP Life earns you more XP and helps grow our community.")}
      ${cta("See my XP &amp; achievements", "https://snaplife.co.uk/app/profile")}
    `,
      `${refereeName} joined SNAP Life — you've earned ${xpAwarded} XP!`,
    ),
  };
}

// ---------------------------------------------------------------------------
// Template: coaching_confirmation_to_user
// ---------------------------------------------------------------------------
export function renderCoachingConfirmation(
  payload: Record<string, unknown>,
): RenderedEmail {
  const name = (payload.name as string | undefined) || "there";
  const sessionLabel = payload.sessionLabel as string | undefined;
  const preferred = payload.preferred as string | undefined;
  return {
    subject: "Your coaching request has been received — SNAP Life",
    html: wrap(
      `
      ${h1("Your coaching request is confirmed")}
      ${p(`Hi ${name}, thank you for reaching out to Catherine Shaw. Your booking request has been received and she'll be in touch shortly to confirm your session.`)}
      ${infoTable([
        ...(sessionLabel ? [["Session type", sessionLabel] as [string, string]] : []),
        ...(preferred ? [["Preferred time", preferred] as [string, string]] : []),
        ["Coach", "Catherine Shaw, Systemic Coach"],
        ["Contact", "teamsnap@snaplife.co.uk"],
      ])}
      <div style="background:#F0FDF4;border-left:4px solid #22C55E;border-radius:0 8px 8px 0;padding:16px 20px;margin:20px 0;">
        <p style="margin:0;font-size:14px;color:#374151;">While you wait, why not continue tracking your bone health in the app? Every log brings you closer to stronger bones.</p>
      </div>
      ${cta("Open SNAP Life", "https://snaplife.co.uk/app")}
      ${divider()}
      ${p("If you have any questions in the meantime, just reply to this email.")}
      ${p('<span style="color:#9CA3AF;font-size:13px;">The SNAP Life Team</span>')}
    `,
      "Your SNAP Life coaching request has been received — Catherine will be in touch soon.",
    ),
  };
}

// ---------------------------------------------------------------------------
// Template: weekly_snap_shot
// ---------------------------------------------------------------------------
export function renderWeeklySnapShot(
  payload: Record<string, unknown>,
): RenderedEmail {
  const name = (payload.displayName as string | undefined) || "there";
  const firstName = name.split(" ")[0];
  const streakDays = (payload.streakDays as number | undefined) ?? 0;
  const weekXp = (payload.weekXp as number | undefined) ?? 0;
  const totalPoints = (payload.totalPoints as number | undefined) ?? 0;
  const scanCount = (payload.scanCount as number | undefined) ?? 0;
  const tip = (payload.tip as string | undefined) ?? "Keep logging your daily activity — consistency is the key to strong bones.";
  const weekRange = (payload.weekRange as string | undefined) ?? "this week";
  return {
    subject: `Your SNAP Life weekly summary — ${weekRange}`,
    html: wrap(
      `
      ${h1(`Your weekly SNAP Shot, ${firstName}`)}
      ${p(`Here's how your bone health journey looked ${weekRange}:`)}

      <!-- Stats grid -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0;">
        <tr>
          <td width="31%" style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:8px;padding:16px;text-align:center;">
            <p style="margin:0;font-size:28px;">🔥</p>
            <p style="margin:6px 0 0;font-size:22px;font-weight:700;color:#0369A1;">${streakDays}</p>
            <p style="margin:2px 0 0;font-size:11px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Day streak</p>
          </td>
          <td width="4%"></td>
          <td width="31%" style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:16px;text-align:center;">
            <p style="margin:0;font-size:28px;">⭐</p>
            <p style="margin:6px 0 0;font-size:22px;font-weight:700;color:#C2410C;">+${weekXp}</p>
            <p style="margin:2px 0 0;font-size:11px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">XP this week</p>
          </td>
          <td width="4%"></td>
          <td width="31%" style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:16px;text-align:center;">
            <p style="margin:0;font-size:28px;">🦴</p>
            <p style="margin:6px 0 0;font-size:22px;font-weight:700;color:#15803D;">${totalPoints}</p>
            <p style="margin:2px 0 0;font-size:11px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Total XP</p>
          </td>
        </tr>
      </table>

      ${scanCount > 0 ? `<p style="margin:16px 0;font-size:14px;color:#374151;">📋 You logged <strong>${scanCount} DEXA scan${scanCount > 1 ? "s" : ""}</strong> this week.</p>` : ""}

      ${divider()}
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#3ABBD4;letter-spacing:1px;text-transform:uppercase;">Bone Tip of the Week</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#374151;font-style:italic;">"${tip}"</p>

      ${cta("View my full journey", "https://snaplife.co.uk/app")}
      ${p('<span style="font-size:13px;color:#6B7280;">You\'re getting this weekly because you\'re a SNAP Life member. <a href="https://snaplife.co.uk/unsubscribe" style="color:#3ABBD4;">Unsubscribe</a></span>')}
    `,
      `Your SNAP Life weekly summary for ${weekRange} — see your streaks, XP, and bone health tip.`,
    ),
  };
}

// ---------------------------------------------------------------------------
// Template: monthly_newsletter
// ---------------------------------------------------------------------------
export function renderMonthlyNewsletter(
  payload: Record<string, unknown>,
): RenderedEmail {
  const monthLabel = (payload.monthLabel as string | undefined) ?? new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const headline = (payload.headline as string | undefined) ?? "What's new in SNAP Life";
  const updates = (payload.updates as string[] | undefined) ?? [
    "Bone Buddy AI has been updated with the latest bone health research",
    "New guided meditations added to the Wellness Hub",
    "Community coaching sessions now available to book in-app",
  ];
  const tip = (payload.tip as string | undefined) ?? "Did you know? Weight-bearing exercise for just 30 minutes a day can significantly improve bone density over time.";
  return {
    subject: `SNAP Life — ${monthLabel} update`,
    html: wrap(
      `
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#3ABBD4;letter-spacing:1px;text-transform:uppercase;">${monthLabel}</p>
      ${h1(headline)}
      ${p("Here's everything that's new and what's happening in the SNAP Life community this month.")}

      <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#1C3A4A;">📣 What's new</p>
      <ul style="margin:0 0 20px;padding-left:20px;font-size:14px;line-height:2;color:#374151;">
        ${updates.map((u) => `<li>${u}</li>`).join("")}
      </ul>

      ${divider()}
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#F47530;letter-spacing:1px;text-transform:uppercase;">Bone health spotlight</p>
      <div style="background:#F8FAFC;border:1px solid #E5E7EB;border-radius:8px;padding:16px 20px;margin:0 0 20px;">
        <p style="margin:0;font-size:14px;line-height:1.7;color:#374151;font-style:italic;">"${tip}"</p>
      </div>

      ${cta("Open SNAP Life", "https://snaplife.co.uk/app")}
      ${divider()}
      ${p('<span style="font-size:12px;color:#9CA3AF;">You\'re receiving this as a SNAP Life member. <a href="https://snaplife.co.uk/unsubscribe" style="color:#3ABBD4;">Unsubscribe from newsletters</a></span>')}
    `,
      `SNAP Life ${monthLabel} update — what's new and your monthly bone health tip.`,
    ),
  };
}

// ---------------------------------------------------------------------------
// Template: expert_support_confirmation
// ---------------------------------------------------------------------------
export function renderExpertSupportConfirmation(
  payload: Record<string, unknown>,
): RenderedEmail {
  const name = (payload.name as string | undefined) || "there";
  const firstName = name.split(" ")[0];
  const consultantLabel = (payload.consultantLabel as string | undefined) ?? "your selected consultant";
  const consultantTitle = (payload.consultantTitle as string | undefined) ?? "";
  const preferred = payload.preferred as string | undefined;
  return {
    subject: "Your support request has been received — SNAP Life",
    html: wrap(
      `
      ${h1("Your request has been received")}
      ${p(`Hi ${firstName}, thank you for reaching out. Your support request has been received and a member of the SNAP Expert Support team will be in touch shortly.`)}
      ${infoTable([
        ["Consultant", `${consultantLabel}${consultantTitle ? ` — ${consultantTitle}` : ""}`],
        ...(preferred ? [["Preferred time", preferred] as [string, string]] : []),
        ["Team contact", "teamsnap@snaplife.co.uk"],
      ])}
      <div style="background:#F0F9FF;border-left:4px solid #3ABBD4;border-radius:0 8px 8px 0;padding:16px 20px;margin:20px 0;">
        <p style="margin:0;font-size:15px;font-weight:600;color:#1C3A4A;">What happens next?</p>
        <p style="margin:8px 0 0;font-size:14px;color:#374151;line-height:1.6;">Your consultant will reach out to you directly using the email address you provided. If you have any questions in the meantime, contact us at <a href="mailto:teamsnap@snaplife.co.uk" style="color:#3ABBD4;">teamsnap@snaplife.co.uk</a>.</p>
      </div>
      ${cta("Open SNAP Life", "https://snaplife.co.uk/app")}
      ${divider()}
      ${p('<span style="color:#9CA3AF;font-size:13px;">The SNAP Life Expert Support Team</span>')}
    `,
      "Your SNAP Life expert support request has been received — your consultant will be in touch shortly.",
    ),
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

type TemplateRenderer = (payload: Record<string, unknown>) => RenderedEmail;

const RENDERERS: Record<string, TemplateRenderer> = {
  welcome: renderWelcome,
  account_deletion_confirmation: renderAccountDeletion,
  trial_reminder_7d: renderTrialReminder7d,
  trial_reminder_2d: renderTrialReminder2d,
  billing_issue: renderBillingIssue,
  subscription_confirmation: renderSubscriptionConfirmation,
  subscription_cancelled: renderSubscriptionCancelled,
  payment_receipt: renderPaymentReceipt,
  testimonial_request: renderTestimonialRequest,
  referral_invite: renderReferralInvite,
  referral_converted: renderReferralConverted,
  coaching_confirmation: renderCoachingConfirmation,
  expert_support_confirmation: renderExpertSupportConfirmation,
  weekly_snap_shot: renderWeeklySnapShot,
  monthly_newsletter: renderMonthlyNewsletter,
};

/**
 * Render a pending_emails row into subject + HTML.
 * Returns null for unknown kinds (the worker will skip/log).
 */
export function renderEmail(
  kind: string,
  payload: Record<string, unknown>,
): RenderedEmail | null {
  const renderer = RENDERERS[kind];
  if (!renderer) return null;
  const result = renderer(payload);
  if (IS_STAGING) {
    result.subject = `[STAGING] ${result.subject}`;
  }
  return result;
}
