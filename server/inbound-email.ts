import { Webhook } from "svix";
import { sendForwardedInboundEmail } from "./email";
import { logRemoteCall, REMOTE_CALL_TIMEOUT_MS } from "./remoteLog";

/**
 * Handles mail sent to a Resend "receiving" address (see Resend dashboard >
 * Receiving) -- e.g. contact@yourdomain.com. Resend POSTs a metadata-only
 * `email.received` webhook event, then a separate authenticated API call
 * fetches the actual body. For now every inbound message is just relayed to
 * a human inbox (CONTACT_FORWARD_EMAIL); storing messages in our own
 * database is a later step.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

type InboundWebhookHeaders = {
  "svix-id": string;
  "svix-timestamp": string;
  "svix-signature": string;
};

type EmailReceivedEvent = {
  type: string;
  data: { email_id: string };
};

/**
 * Verifies the request actually came from Resend (svix-signed with the
 * secret from Resend dashboard > Webhooks > this endpoint) before trusting
 * anything in it. Must be called with the raw request body -- re-serializing
 * parsed JSON breaks the signature.
 */
export function verifyInboundEmailWebhook(
  rawBody: string,
  headers: InboundWebhookHeaders,
): EmailReceivedEvent {
  const wh = new Webhook(requireEnv("RESEND_WEBHOOK_SECRET"));
  return wh.verify(rawBody, headers) as EmailReceivedEvent;
}

type ReceivedEmail = {
  from: string;
  subject: string;
  html: string | null;
  text: string | null;
};

async function fetchReceivedEmail(emailId: string): Promise<ReceivedEmail> {
  return logRemoteCall("resend", "emails.receiving.get", async () => {
    const response = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${requireEnv("RESEND_API_KEY")}` },
      signal: AbortSignal.timeout(REMOTE_CALL_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Resend receiving API returned ${response.status} for email ${emailId}: ${body}`,
      );
    }
    return (await response.json()) as ReceivedEmail;
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Fetches the full body for a received-email webhook event and relays it to
 * CONTACT_FORWARD_EMAIL. Ignores event types other than email.received so
 * this can be safely pointed at a webhook subscribed to more events later.
 */
export async function handleInboundEmailEvent(event: EmailReceivedEvent): Promise<void> {
  if (event.type !== "email.received") return;

  const email = await fetchReceivedEmail(event.data.email_id);
  const bodyHtml = email.html ?? `<p>${escapeHtml(email.text ?? "").replace(/\n/g, "<br>")}</p>`;

  await sendForwardedInboundEmail({
    to: requireEnv("CONTACT_FORWARD_EMAIL"),
    from: email.from,
    subject: email.subject,
    bodyHtml,
  });
}
