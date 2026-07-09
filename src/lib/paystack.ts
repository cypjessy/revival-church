/**
 * Paystack client-side helpers.
 * Server-only functions are in paystack-server.ts to avoid bundling Node crypto on client.
 */

// ═══════════════════════════════════════════════
// Configuration (Public key only — safe for client)
// ═══════════════════════════════════════════════

export const PAYSTACK_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || "";

/**
 * Free trial duration in days (0 = no trial).
 * During the trial, the subscription shows as paid automatically.
 * Set NEXT_PUBLIC_FREE_TRIAL_DAYS in .env.local to activate.
 */
export const FREE_TRIAL_DAYS = parseInt(
  process.env.NEXT_PUBLIC_FREE_TRIAL_DAYS || "0", 10
);

/**
 * Whether Paystack is in live (production) mode.
 * Live keys start with pk_live_. Test keys start with pk_test_,
 * or the key may be empty/unconfigured.
 * Only live-mode payments count as real income.
 */
export function isPaystackLiveMode(): boolean {
  return PAYSTACK_PUBLIC_KEY.startsWith("pk_live_");
}

export function isPaystackTestMode(): boolean {
  return !isPaystackLiveMode();
}

// ═══════════════════════════════════════════════
// Plan Pricing (single source of truth)
// ═══════════════════════════════════════════════

export const PAYSTACK_PLANS = {
  "VPS S": { amountKES: 4372, label: "KES 4,372" },
  "VPS M": { amountKES: 5790, label: "KES 5,790" },
} as const;

export type PlanKey = keyof typeof PAYSTACK_PLANS;

// ═══════════════════════════════════════════════
// Client SDK
// ═══════════════════════════════════════════════

const PAYSTACK_SDK_URL = "https://js.paystack.co/v1/inline.js";
const SDK_LOAD_TIMEOUT = 8000; // 8 seconds

/**
 * Dynamically load the Paystack inline JS SDK with a timeout.
 * If the CDN is unreachable or blocked, it rejects after 8s so the
 * calling code can fall back gracefully.
 */
export function loadPaystackSDK(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Already loaded
    if ((window as any).PaystackPop) {
      console.log("[Paystack] SDK already loaded");
      resolve();
      return;
    }

    console.log("[Paystack] Loading SDK from", PAYSTACK_SDK_URL);

    // Timeout guard
    const timeout = setTimeout(() => {
      console.warn("[Paystack] SDK load timed out after 8s — CDN may be blocked");
      reject(new Error("Paystack SDK load timed out. Check your internet connection or firewall."));
    }, SDK_LOAD_TIMEOUT);

    const script = document.createElement("script");
    script.src = PAYSTACK_SDK_URL;
    script.async = true;

    script.onload = () => {
      clearTimeout(timeout);
      console.log("[Paystack] SDK loaded successfully");
      resolve();
    };

    script.onerror = () => {
      clearTimeout(timeout);
      console.error("[Paystack] SDK script load error");
      reject(new Error("Failed to load Paystack SDK. The CDN may be blocked by your network."));
    };

    document.head.appendChild(script);
  });
}
