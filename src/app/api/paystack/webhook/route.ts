import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature, PAYSTACK_SECRET_KEY } from "@/lib/paystack-server";
import { Timestamp } from "firebase/firestore";

/**
 * Helper to determine the billing period for a given date string.
 */
function getBillingPeriodForDate(dateStr: string | null): string {
  const d = dateStr ? new Date(dateStr) : new Date();
  const year = d.getFullYear();
  const month = d.getMonth();
  if (d.getDate() < 10) {
    const prev = new Date(year, month - 1, 1);
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

// Lazy-load the client-side Firebase SDK (works in Node.js via fetch)
async function recordPaymentViaFirestore(data: {
  reference: string;
  amount: number;
  plan: "VPS S" | "VPS M";
  status: "paid" | "failed";
  email: string;
  channel: string;
  church_id: string;
  billingPeriod: string;
  paidAt: Date;
  isTest: boolean;
}) {
  try {
    const { recordPayment } = await import("@/lib/subscriptions");
    await recordPayment({
      reference: data.reference,
      amount: data.amount,
      plan: data.plan,
      status: data.status,
      paidAt: Timestamp.fromDate(data.paidAt),
      billingPeriod: data.billingPeriod,
      email: data.email,
      channel: data.channel,
      church_id: data.church_id,
      isTest: data.isTest,
    });
    console.log(`Webhook: payment recorded for ${data.reference}`);
  } catch (err) {
    console.error(`Webhook: failed to record payment ${data.reference}:`, err);
  }
}

/**
 * Paystack Webhook Handler
 *
 * Paystack sends POST requests to this endpoint when payment events occur.
 * Acts as a backup recording path — the primary path is the client-side callback.
 *
 * Register in Paystack Dashboard → Settings → Webhooks:
 * https://your-domain.com/api/paystack/webhook
 */
export async function POST(req: NextRequest) {
  try {
    // Verify webhook signature
    const signature = req.headers.get("x-paystack-signature") || "";
    const body = await req.text();

    if (!PAYSTACK_SECRET_KEY) {
      console.error("Paystack webhook: secret key not configured");
      return NextResponse.json({ error: "Not configured" }, { status: 503 });
    }

    const isValid = verifyWebhookSignature(body, signature);
    if (!isValid) {
      console.error("Paystack webhook: invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const event = JSON.parse(body);
    const { event: eventType, data } = event;

    console.log(`Paystack webhook received: ${eventType}`, {
      reference: data?.reference,
      status: data?.status,
      amount: data?.amount,
    });

    switch (eventType) {
      case "charge.success": {
        const { reference, amount, customer, metadata, paid_at, channel } = data;
        const plan: "VPS S" | "VPS M" = metadata?.plan || "VPS S";
        const amountKES = Math.round((amount || 0) / 100);

        console.log(
          `Payment successful: ${reference}, ${amountKES} KES, ${plan}`
        );

        // Record the payment to Firestore (backup path)
        await recordPaymentViaFirestore({
          reference,
          amount: amountKES,
          plan,
          status: "paid",
          paidAt: paid_at ? new Date(paid_at) : new Date(),
          billingPeriod: getBillingPeriodForDate(paid_at),
          email: customer?.email || "admin@mountainofdeliverance.org",
          channel: channel || "paystack",
          church_id: metadata?.church_id || "mountain_of_deliverance",
          isTest: !PAYSTACK_SECRET_KEY.startsWith("sk_live_"), // live keys start with sk_live_
        });

        break;
      }

      case "charge.failed": {
        const { reference, amount, customer, metadata } = data;
        const plan: "VPS S" | "VPS M" = metadata?.plan || "VPS S";

        console.warn(
          `Payment failed: ${reference}, amount: ${amount / 100} KES, plan: ${plan}`
        );

        // Record the failed payment for audit trail
        await recordPaymentViaFirestore({
          reference,
          amount: Math.round((amount || 0) / 100),
          plan,
          status: "failed",
          paidAt: new Date(),
          billingPeriod: getBillingPeriodForDate(null),
          email: customer?.email || "admin@mountainofdeliverance.org",
          channel: "paystack",
          church_id: metadata?.church_id || "mountain_of_deliverance",
          isTest: !PAYSTACK_SECRET_KEY.startsWith("sk_live_"),
        });

        break;
      }

      default:
        console.log(`Unhandled webhook event: ${eventType}`);
    }

    // Always return 200 to acknowledge receipt
    return NextResponse.json({ status: "ok" });
  } catch (err: any) {
    console.error("Paystack webhook error:", err);
    // Still return 200 to prevent Paystack from retrying malformed payloads
    return NextResponse.json({ status: "ok" }, { status: 200 });
  }
}
