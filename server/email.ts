import { Resend } from "resend";
import { logRemoteCall } from "./remoteLog";

export type EmailProvider = "console" | "resend";

export function getEmailProvider(): EmailProvider {
  const value = process.env.EMAIL_PROVIDER ?? "console";
  if (value === "console" || value === "resend") return value;
  throw new Error(
    `EMAIL_PROVIDER must be "console" or "resend" — got ${JSON.stringify(value)}`,
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

let resendClient: Resend;

function getResendClient(): Resend {
  if (resendClient) return resendClient;
  resendClient = new Resend(requireEnv("RESEND_API_KEY"));
  return resendClient;
}

type EmailAttachment = { filename: string; content: string };
type Email = {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
};

/**
 * EMAIL_PROVIDER=console (the default) logs instead of sending, so signup
 * and password reset work in local dev without a Resend account -- the
 * verification/reset link lands in the server console instead of an inbox.
 */
async function sendEmail({ to, subject, html, replyTo, attachments }: Email): Promise<void> {
  const provider = getEmailProvider();
  if (provider === "console") {
    console.log(`[email] to=${to} subject=${JSON.stringify(subject)}\n${html}`);
    return;
  }

  const { error } = await logRemoteCall("resend", "emails.send", () =>
    getResendClient().emails.send({
      from: requireEnv("EMAIL_FROM"),
      to,
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
      ...(attachments ? { attachments } : {}),
    }),
  );
  if (error) {
    throw new Error(`Resend failed to send to ${to}: ${error.message}`);
  }
}


/**
 * Relays a message received at an inbound address (see inboundEmail.ts) to a
 * human inbox. replyTo is set to the original sender so replying from that
 * inbox goes straight back to them, not to us.
 */
export async function sendForwardedInboundEmail(message: {
  to: string;
  from: string;
  subject: string;
  bodyHtml: string;
}): Promise<void> {
  await sendEmail({
    to: message.to,
    subject: `[Placekeeping] ${message.subject}`,
    html: `<p><b>From:</b> ${message.from}</p><hr>${message.bodyHtml}`,
    replyTo: message.from,
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

