/**
 * Subscription payment tracking service.
 * Stores payment records and subscription status in Firestore.
 */

import { db } from "./firebase";
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  serverTimestamp,
} from "firebase/firestore";

// ═══════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════

export interface SubscriptionPayment {
  id?: string;
  reference: string;
  amount: number; // KES
  plan: "VPS S" | "VPS M";
  status: "paid" | "partial" | "failed";
  paidAt: Timestamp | null;
  billingPeriod: string; // "YYYY-MM"
  email: string;
  channel: string;
  church_id: string;
  isTest: boolean; // true = test payment (no real income), false = live payment
  createdAt?: Timestamp | null;
}

export interface SubscriptionStatus {
  plan: "VPS S" | "VPS M";
  totalDue: number; // full monthly amount
  paidThisPeriod: number; // amount paid so far
  billingPeriod: string; // "YYYY-MM"
  lastPaidAt: Timestamp | null;
  status: "paid" | "partial" | "overdue" | "pending" | "trial";
  trialStartDate?: Timestamp | null; // when the free trial started
  trialDurationDays?: number; // how many days the trial lasts (stored at activation)
  updatedAt?: Timestamp | null;
}

// ═══════════════════════════════════════════════
// Pricing
// ═══════════════════════════════════════════════

export const PLAN_PRICES: Record<string, number> = {
  "VPS S": 4372,
  "VPS M": 5790,
};

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

/**
 * Get the current billing period as "YYYY-MM".
 * Billing runs from the 10th of one month to the 9th of the next.
 */
export function getCurrentBillingPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  // If before the 10th, the current billing period is last month → this month
  if (now.getDate() < 10) {
    const prev = new Date(year, month - 1, 1);
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/**
 * Get the billing period label for display.
 */
export function getBillingPeriodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * Get the next billing date (10th of current or next month).
 */
export function getNextBillingDate(): Date {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const dueThisMonth = new Date(year, month, 10, 12, 0, 0);
  if (now < dueThisMonth) return dueThisMonth;
  return new Date(year, month + 1, 10, 12, 0, 0);
}

/**
 * Get countdown from milliseconds.
 */
export function getCountdown(ms: number) {
  if (ms <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  const totalSec = Math.floor(ms / 1000);
  return {
    days: Math.floor(totalSec / 86400),
    hours: Math.floor((totalSec % 86400) / 3600),
    minutes: Math.floor((totalSec % 3600) / 60),
    seconds: totalSec % 60,
  };
}

// ═══════════════════════════════════════════════
// Firestore Operations
// ═══════════════════════════════════════════════

const PAYMENTS_COL = "subscription_payments";
const STATUS_DOC = "subscription_status";

/**
 * Record a successful payment in Firestore.
 */
export async function recordPayment(data: Omit<SubscriptionPayment, "id" | "createdAt">): Promise<string> {
  const ref = await addDoc(collection(db, PAYMENTS_COL), {
    ...data,
    createdAt: serverTimestamp(),
  });
  // Update subscription status
  await updateSubscriptionStatus(data);
  return ref.id;
}

/**
 * Update the aggregated subscription status after a payment.
 */
async function updateSubscriptionStatus(payment: Omit<SubscriptionPayment, "id" | "createdAt">) {
  const statusRef = doc(db, PAYMENTS_COL, STATUS_DOC);
  const statusSnap = await getDoc(statusRef);

  const currentPeriod = payment.billingPeriod;
  const amount = payment.amount;
  const plan = payment.plan;
  const totalDue = PLAN_PRICES[plan] || 4372;

  const now = new Date();
  const day = now.getDate();
  const isOverdue = day > 10;

  if (statusSnap.exists()) {
    const existing = statusSnap.data() as SubscriptionStatus;

    // Same billing period — accumulate
    if (existing.billingPeriod === currentPeriod) {
      const newPaid = existing.paidThisPeriod + amount;
      let newStatus: SubscriptionStatus["status"];
      if (newPaid >= totalDue) {
        newStatus = "paid";
      } else if (isOverdue) {
        newStatus = "overdue";
      } else {
        newStatus = "partial";
      }

      await setDoc(statusRef, {
        ...existing,
        plan,
        totalDue,
        paidThisPeriod: Math.min(newPaid, totalDue),
        lastPaidAt: payment.paidAt || Timestamp.now(),
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
    } else {
      // New billing period
      const newPaid = amount;
      let newStatus: SubscriptionStatus["status"];
      if (newPaid >= totalDue) {
        newStatus = "paid";
      } else if (isOverdue) {
        newStatus = "overdue";
      } else {
        newStatus = "partial";
      }

      await setDoc(statusRef, {
        plan,
        totalDue,
        paidThisPeriod: Math.min(newPaid, totalDue),
        billingPeriod: currentPeriod,
        lastPaidAt: payment.paidAt || Timestamp.now(),
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
    }
  } else {
    // First payment ever
    const newPaid = amount;
    let newStatus: SubscriptionStatus["status"];
    if (newPaid >= totalDue) {
      newStatus = "paid";
    } else if (isOverdue) {
      newStatus = "overdue";
    } else {
      newStatus = "partial";
    }

    await setDoc(statusRef, {
      plan,
      totalDue,
      paidThisPeriod: Math.min(newPaid, totalDue),
      billingPeriod: currentPeriod,
      lastPaidAt: payment.paidAt || Timestamp.now(),
      status: newStatus,
      updatedAt: serverTimestamp(),
    });
  }
}

/**
 * Get the current subscription status from Firestore.
 */
export async function getSubscriptionStatus(): Promise<SubscriptionStatus | null> {
  try {
    const statusRef = doc(db, PAYMENTS_COL, STATUS_DOC);
    const snap = await getDoc(statusRef);
    if (snap.exists()) {
      return snap.data() as SubscriptionStatus;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get all payment records for history display.
 */
export async function getPaymentHistory(): Promise<SubscriptionPayment[]> {
  try {
    const q = query(
      collection(db, PAYMENTS_COL),
      where("status", "!=", "failed"),
      orderBy("paidAt", "desc"),
      limit(50)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as SubscriptionPayment));
  } catch {
    return [];
  }
}

/**
 * Compute the balance (amount still due) for the current period.
 */
export function computeBalance(status: SubscriptionStatus | null): number {
  if (!status) return 4372; // default VPS S price
  const balance = status.totalDue - status.paidThisPeriod;
  return Math.max(0, balance);
}

/**
 * Activate the free trial by creating/updating the subscription status
 * with a trial start date and a chosen duration.
 * Can only be called once — subsequent calls will overwrite but that's
 * the caller's responsibility to guard against.
 *
 * @param plan - The subscription plan to trial
 * @param durationDays - Number of days the trial should last (default 30)
 */
export async function activateTrial(plan: "VPS S" | "VPS M" = "VPS S", durationDays: number = 30): Promise<void> {
  const statusRef = doc(db, PAYMENTS_COL, STATUS_DOC);
  const totalDue = PLAN_PRICES[plan] || 4372;

  await setDoc(statusRef, {
    plan,
    totalDue,
    paidThisPeriod: 0,
    billingPeriod: getCurrentBillingPeriod(),
    lastPaidAt: null,
    status: "trial",
    trialStartDate: Timestamp.now(),
    trialDurationDays: durationDays,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Update the subscription plan in Firestore.
 */
export async function updatePlan(plan: "VPS S" | "VPS M"): Promise<void> {
  const statusRef = doc(db, PAYMENTS_COL, STATUS_DOC);
  const statusSnap = await getDoc(statusRef);

  const totalDue = PLAN_PRICES[plan] || 4372;

  if (statusSnap.exists()) {
    const existing = statusSnap.data() as SubscriptionStatus;
    await setDoc(statusRef, {
      ...existing,
      plan,
      totalDue,
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(statusRef, {
      plan,
      totalDue,
      paidThisPeriod: 0,
      billingPeriod: getCurrentBillingPeriod(),
      lastPaidAt: null,
      status: "pending",
      updatedAt: serverTimestamp(),
    });
  }
}

/**
 * Get a complete billing snapshot including overdue month tracking.
 * Detects if a new billing period has started and computes accumulated debt.
 */
export interface BillingSnapshot {
  currentPeriod: string;
  paidThisPeriod: number;
  totalDue: number;
  remaining: number;
  plan: "VPS S" | "VPS M";
  status: "paid" | "partial" | "overdue" | "pending";
  overdueMonths: number;
  accumulatedDebt: number;
  isNewPeriod: boolean;
  isTrial: boolean;
  trialDaysRemaining: number;
  trialEndDate: Date | null; // for live countdown during trial
}

export function getBillingSnapshot(subStatus: SubscriptionStatus | null): BillingSnapshot {
  const currentPeriod = getCurrentBillingPeriod();
  const plan = subStatus?.plan || "VPS S";
  const totalDue = subStatus?.totalDue || PLAN_PRICES[plan];

  // Default trial values
  let isTrial = false;
  let trialDaysRemaining = 0;

  if (!subStatus) {
    return {
      currentPeriod,
      paidThisPeriod: 0,
      totalDue,
      remaining: totalDue,
      plan,
      status: "pending",
      overdueMonths: 0,
      accumulatedDebt: 0,
      isNewPeriod: false,
      isTrial,
      trialDaysRemaining,
      trialEndDate: null,
    };
  }

  // ════ Free Trial Handling ════
  if (subStatus.status === "trial" && subStatus.trialStartDate) {
    const trialDuration = subStatus.trialDurationDays || 30;
    const trialEnd = subStatus.trialStartDate.toDate();
    trialEnd.setDate(trialEnd.getDate() + trialDuration);
    const now = new Date();
    const msRemaining = trialEnd.getTime() - now.getTime();

    if (msRemaining > 0) {
      // Still in trial — treat as fully paid
      isTrial = true;
      trialDaysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
      return {
        currentPeriod,
        paidThisPeriod: totalDue, // show as fully paid
        totalDue,
        remaining: 0,
        plan,
        status: "paid",
        overdueMonths: 0,
        accumulatedDebt: 0,
        isNewPeriod: false,
        isTrial,
        trialDaysRemaining,
        trialEndDate: trialEnd,
      };
    }
    // Trial expired — mark as pending to require payment
  }

  // Detect if we're in a new billing period (the status hasn't been updated yet)
  const isNewPeriod = subStatus.billingPeriod !== currentPeriod;

  // If it's a new period, paidThisPeriod resets to 0
  // The previous period's status tells us if last month was paid
  const paidThisPeriod = isNewPeriod ? 0 : subStatus.paidThisPeriod;

  // Calculate overdue months
  let overdueMonths = 0;
  let accumulatedDebt = 0;

  if (isNewPeriod) {
    // Previous period wasn't fully paid — add to debt
    if (subStatus.paidThisPeriod < totalDue) {
      // One month missed
      overdueMonths = 1;
      accumulatedDebt = totalDue - subStatus.paidThisPeriod;

      // Check if we're more than one period behind
      const [statusYear, statusMonth] = subStatus.billingPeriod.split("-").map(Number);
      const [currYear, currMonth] = currentPeriod.split("-").map(Number);
      const monthsDiff = (currYear - statusYear) * 12 + (currMonth - statusMonth);
      if (monthsDiff > 1) {
        overdueMonths = monthsDiff;
        accumulatedDebt = (monthsDiff - 1) * totalDue + (totalDue - subStatus.paidThisPeriod);
      }
    }
  } else {
    // Same period — check if overdue based on date
    const now = new Date();
    if (now.getDate() > 10 && subStatus.paidThisPeriod < totalDue) {
      if (subStatus.paidThisPeriod === 0) {
        overdueMonths = 1;
        accumulatedDebt = totalDue;
      } else {
        accumulatedDebt = totalDue - subStatus.paidThisPeriod;
      }
    }
  }

  // Determine status
  let status: BillingSnapshot["status"];
  if (paidThisPeriod >= totalDue) {
    status = "paid";
  } else if (overdueMonths > 0) {
    status = "overdue";
  } else if (paidThisPeriod > 0) {
    status = "partial";
  } else {
    status = "pending";
  }

  return {
    currentPeriod,
    paidThisPeriod,
    totalDue,
    remaining: Math.max(0, totalDue - paidThisPeriod),
    plan,
    status,
    overdueMonths,
    accumulatedDebt,
    isNewPeriod,
    isTrial,
    trialDaysRemaining,
    trialEndDate: null,
  };
}
