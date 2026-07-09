import { NextRequest, NextResponse } from "next/server";
import { verifyTransaction, PAYSTACK_SECRET_KEY } from "@/lib/paystack-server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      return NextResponse.json(
        { error: "Paystack is not configured" },
        { status: 503, headers: corsHeaders }
      );
    }

    const { reference } = await req.json();

    if (!reference) {
      return NextResponse.json({ error: "Reference is required" }, { status: 400, headers: corsHeaders });
    }

    const result = await verifyTransaction(reference);

    if (!result.status || !result.data) {
      return NextResponse.json(
        { error: result.message || "Verification failed" },
        { status: 502, headers: corsHeaders }
      );
    }

    const transaction = result.data;

    // Check if payment was successful
    const isSuccessful = transaction.status === "success";

    return NextResponse.json({
      verified: isSuccessful,
      reference: transaction.reference,
      amount: transaction.amount / 100, // Convert from kobo to KES
      currency: transaction.currency,
      status: transaction.status,
      paid_at: transaction.paid_at,
      channel: transaction.channel,
      customer_email: transaction.customer?.email,
      metadata: transaction.metadata,
    }, { headers: corsHeaders });
  } catch (err: any) {
    console.error("Paystack verify error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
