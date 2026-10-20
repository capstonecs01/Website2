import { Resend } from "resend";

// Links in emails point at the website. On Render, RENDER_EXTERNAL_URL is the
// site's own https://....onrender.com address, so FRONTEND_URL can stay unset.
const FRONTEND_URL = process.env.FRONTEND_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:5173";
const FROM_EMAIL = process.env.FROM_EMAIL || "onboarding@resend.dev";
const API_KEY = process.env.RESEND_API_KEY;

// Construct the Resend client only when a key is actually set. Without this,
// a missing RESEND_API_KEY makes the SDK throw at import time and crashes the
// whole server on startup — annoying in local dev where email isn't set up.
const resend = API_KEY ? new Resend(API_KEY) : null;

export async function sendVerificationEmail({ to, fullName, token }) {
  const verifyUrl = `${FRONTEND_URL}/verify-email?token=${token}`;

  // No email provider configured — print the verification link to the server
  // console so you can still verify accounts by pasting it into the browser.
  if (!resend) {
    console.log(
      `\n[email] RESEND_API_KEY not set — email not sent.\n` +
        `        Verify link for ${to}:\n        ${verifyUrl}\n`
    );
    return;
  }

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: "Verify your Junction account",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Hi ${fullName},</h2>
        <p>Thanks for signing up for Junction. Click the link below to verify your email address:</p>
        <p>
          <a href="${verifyUrl}" style="display:inline-block; background:#FFB020; color:#0E1116; padding:12px 20px; text-decoration:none; border-radius:4px; font-weight:600;">
            Verify email
          </a>
        </p>
        <p>Or paste this link into your browser:</p>
        <p style="word-break: break-all; color: #555;">${verifyUrl}</p>
        <p>This link expires in 24 hours. If you didn't sign up for Junction, you can ignore this email.</p>
      </div>
    `,
  });

  if (error) {
    throw new Error(`Failed to send verification email: ${error.message}`);
  }
}
