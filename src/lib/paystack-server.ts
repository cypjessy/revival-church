/**
 * Server-only Paystack utilities.
 * Separated from paystack.ts to avoid bundling Node.js `crypto` on the client.
 */
import crypto from "crypto";

export const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";
export const PAYSTACK_API_BASE = "https://api.paystack.co";

export interface PaystackInitResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  } | null;
}

export interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: {
    id: number;
    status: string;
    reference: string;
    amount: number;
    currency: string;
    paid_at: string;
    created_at: string;
    channel: string;
    metadata: Record<string, any>;
    customer: {
      email: string;
    };
  } | null;
}

/**
 * Initialize a Paystack transaction.
 * Amount is in KES — converted to kobo (×100).
 */
export async function initializeTransaction(params: {
  email: string;
  amountInKES: number;
  reference?: string;
  metadata?: Record<string, any>;
}): Promise<PaystackInitResponse> {
  const { email, amountInKES, reference, metadata } = params;

  const body: Record<string, any> = {
    email,
    amount: Math.round(amountInKES * 100),
    currency: "KES",
    callback_url: `${process.env.NEXT_PUBLIC_VERCEL_URL || ""}/admin/accounts`,
    metadata: {
      ...metadata,
      payment_type: "subscription",
    },
  };

  if (reference) body.reference = reference;

  const res = await fetch(`${PAYSTACK_API_BASE}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return res.json();
}

/**
 * Verify a Paystack transaction.
 */
export async function verifyTransaction(
  reference: string
): Promise<PaystackVerifyResponse> {
  const res = await fetch(
    `${PAYSTACK_API_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
    }
  );
  return res.json();
}

/**
 * Verify Paystack webhook HMAC signature.
 */
export function verifyWebhookSignature(
  body: string,
  signature: string
): boolean {
  const hash = crypto
    .createHmac("sha512", PAYSTACK_SECRET_KEY)
    .update(body)
    .digest("hex");
  return hash === signature;
}
