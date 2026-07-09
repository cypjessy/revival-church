import { NextRequest, NextResponse } from "next/server";
import { initializeTransaction, PAYSTACK_SECRET_KEY } from "@/lib/paystack-server";
import { PAYSTACK_PLANS } from "@/lib/paystack";

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
    // Check Paystack is configured
    if (!PAYSTACK_SECRET_KEY) {
      return NextResponse.json(
        { error: "Paystack is not configured. Set PAYSTACK_SECRET_KEY in environment variables." },
        { status: 503, headers: corsHeaders }
      );
    }

    const { email, plan, amount } = await req.json();

    // Validate required fields
    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400, headers: corsHeaders });
    }

    // Validate plan
    if (!plan || !PAYSTACK_PLANS[plan as keyof typeof PAYSTACK_PLANS]) {
      return NextResponse.json(
        { error: `Invalid plan. Supported: ${Object.keys(PAYSTACK_PLANS).join(", ")}` },
        { status: 400, headers: corsHeaders }
      );
    }

    const planConfig = PAYSTACK_PLANS[plan as keyof typeof PAYSTACK_PLANS];

    // Use custom amount if provided (e.g., upgrade balance), otherwise full plan price
    const amountInKES = (amount !== undefined && amount !== null)
      ? Math.round(amount)
      : planConfig.amountKES;

    if (amountInKES <= 0) {
      return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400, headers: corsHeaders });
    }

    // Initialize transaction with Paystack
    const result = await initializeTransaction({
      email,
      amountInKES,
      metadata: {
        plan,
        church_id: process.env.NEXT_PUBLIC_CHURCH_ID || "mountain_of_deliverance",
        payment_for: `${plan} subscription${amount !== undefined ? " (upgrade balance)" : ""}`,
        originalAmount: amount !== undefined ? amountInKES : undefined,
      },
    });

    if (!result.status || !result.data) {
      console.error("Paystack init failed:", result.message);
      return NextResponse.json(
        { error: result.message || "Failed to initialize payment" },
        { status: 502, headers: corsHeaders }
      );
    }

    return NextResponse.json({
      authorization_url: result.data.authorization_url,
      access_code: result.data.access_code,
      reference: result.data.reference,
    }, { headers: corsHeaders });
  } catch (err: any) {
    console.error("Paystack initialize error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
