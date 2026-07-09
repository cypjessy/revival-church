"use client";

import { useEffect, useState, useRef } from "react";
import { apiFetch } from "@/lib/api";
import {
  PAYSTACK_PUBLIC_KEY,
  loadPaystackSDK,
  PAYSTACK_PLANS,
  isPaystackLiveMode,
  isPaystackTestMode,
} from "@/lib/paystack";
import {
  getSubscriptionStatus,
  getPaymentHistory,
  recordPayment,
  updatePlan,
  activateTrial,
  getBillingSnapshot,
  getBillingPeriodLabel,
  getNextBillingDate,
  getCountdown,
  PLAN_PRICES,
  type SubscriptionStatus,
  type SubscriptionPayment,
  type BillingSnapshot,
} from "@/lib/subscriptions";
import { Timestamp } from "firebase/firestore";

// ═══════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════

interface ServerState {
  cpu: number;
  ram: number;
  ramUsed: string;
  ramTotal: string;
  uptime: string;
  temp: number;
  rx: string;
  tx: string;
  load: number[];
  processes: number;
}

interface ServiceStatus {
  name: string;
  icon: string;
  status: "online" | "offline" | "maintenance";
  label: string;
  meta: string;
  color: string;
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function randInt(min: number, max: number) {
  return Math.floor(rand(min, max + 1));
}

function formatUptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function formatTraffic(mbps: number) {
  if (mbps > 1000) return `${(mbps / 1000).toFixed(1)} Gbps`;
  return `${mbps.toFixed(0)} Mbps`;
}

// ═══════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════

const SERVERS: ServerState[] = [
  { cpu: 0, ram: 0, ramUsed: "0 GB", ramTotal: "32 GB", uptime: "0s", temp: 0, rx: "0 Mbps", tx: "0 Mbps", load: [0, 0, 0], processes: 0 },
  { cpu: 0, ram: 0, ramUsed: "0 GB", ramTotal: "32 GB", uptime: "0s", temp: 0, rx: "0 Mbps", tx: "0 Mbps", load: [0, 0, 0], processes: 0 },
];

const SERVICES: ServiceStatus[] = [
  { name: "TV Streaming", icon: "fas fa-tv", status: "online", label: "Live Now", meta: "720p · 24 fps", color: "#EF4444" },
  { name: "LiveKit Server", icon: "fas fa-video", status: "online", label: "Connected", meta: "WebRTC · 8 rooms", color: "#8B5CF6" },
  { name: "Image Storage", icon: "fas fa-database", status: "online", label: "2.4 GB Used", meta: "BunnyCDN · 312 files", color: "#3B82F6" },
  { name: "Radio Station", icon: "fas fa-radio", status: "online", label: "Broadcasting", meta: "AzuraCast · 128 kbps", color: "#E8A838" },
];

// ═══════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════

export default function SubscriptionsTab() {
  const [servers, setServers] = useState<ServerState[]>(SERVERS);
  const uptimeRef = useRef([randInt(50000, 90000), randInt(50000, 90000)]);
  const [services] = useState<ServiceStatus[]>(SERVICES);
  const [activeServer, setActiveServer] = useState(1);
  const [networkIn, setNetworkIn] = useState(0);
  const [networkOut, setNetworkOut] = useState(0);

  // Simulate server metrics updating every 1.5s
  useEffect(() => {
    const interval = setInterval(() => {
      uptimeRef.current = uptimeRef.current.map((u) => u + 1.5);
      setServers((prev) =>
        prev.map((s, i) => ({
          cpu: rand(22, 48),
          ram: rand(24, 56),
          ramUsed: `${randInt(8, 18)} GB`,
          ramTotal: "32 GB",
          uptime: formatUptime(uptimeRef.current[i]),
          temp: rand(42, 62),
          rx: formatTraffic(rand(120, 480)),
          tx: formatTraffic(rand(40, 190)),
          load: [rand(0.5, 2.5), rand(0.8, 3.2), rand(1.0, 4.0)],
          processes: randInt(210, 340),
        }))
      );
      setNetworkIn(randInt(150, 520));
      setNetworkOut(randInt(50, 210));
    }, 1500);

    return () => clearInterval(interval);
  }, []);

  // ════ Billing & Countdown (Firestore-backed) ════
  const [now, setNow] = useState(new Date());
  const [paying, setPaying] = useState(false);
  const [subStatus, setSubStatus] = useState<SubscriptionStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [activatingTrial, setActivatingTrial] = useState(false);
  const [trialDuration, setTrialDuration] = useState(30);

  // Tick every second for live countdown
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Load subscription status from Firestore on mount and every 30s
  useEffect(() => {
    async function load() {
      try {
        const status = await getSubscriptionStatus();
        setSubStatus(status);
        // Restore plan choice from Firestore
        if (status?.plan === "VPS M") {
          setIsUpgraded(true);
        } else if (status?.plan === "VPS S") {
          setIsUpgraded(false);
        }
      } catch {
        // silent
      } finally {
        setLoadingStatus(false);
      }
    }
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  // Load payment history on mount
  useEffect(() => {
    async function loadPayments() {
      try {
        const history = await getPaymentHistory();
        setPayments(history);
      } catch {
        // silent
      } finally {
        setLoadingPayments(false);
      }
    }
    loadPayments();
  }, []);

  // Refresh payments after a successful payment
  useEffect(() => {
    function handler() {
      getPaymentHistory().then(setPayments).catch(() => {});
    }
    window.addEventListener("payments-refresh", handler);
    return () => window.removeEventListener("payments-refresh", handler);
  }, []);

  // Compute subscription billing snapshot (includes overdue tracking, new period detection)
  const snapshot = getBillingSnapshot(subStatus);
  const currentMonthLabel = getBillingPeriodLabel(snapshot.currentPeriod);

  // ════ Upgrade Toggle ════
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [confirmingUpgrade, setConfirmingUpgrade] = useState(false);
  const [isUpgraded, setIsUpgraded] = useState(false);

  const currentPlan = {
    name: "VPS S",
    cpu: "16 Cores",
    ram: "64 GB",
    storage: "300 GB NVMe / 600 GB SSD",
    port: "1 Gbit/s",
    traffic: "Unlimited*",
    protection: "DDoS Protected",
    priceKES: "KES 4,372",
    priceEUR: "€29.60",
  };

  const upgradePlan = {
    name: "VPS M",
    cpu: "18 Cores",
    ram: "96 GB",
    storage: "350 GB NVMe / 700 GB SSD",
    port: "1 Gbit/s",
    traffic: "Unlimited*",
    protection: "DDoS Protected",
    priceKES: "KES 5,790",
    priceEUR: "€39.20",
  };

  const activePlan = isUpgraded ? upgradePlan : currentPlan;

  // Derive billing values from the snapshot
  const { paidThisPeriod, totalDue, remaining, status, overdueMonths, accumulatedDebt, isTrial, trialDaysRemaining, trialEndDate } = snapshot;

  // Use trial end date for countdown during trial, otherwise use the 10th billing date
  const countdownTarget = isTrial && trialEndDate ? trialEndDate.getTime() : getNextBillingDate().getTime();
  const diffMs = countdownTarget - now.getTime();
  const countdown = getCountdown(diffMs);
  const isPaid = status === "paid";
  const isPartiallyPaid = status === "partial";
  const isMissed = status === "overdue";

  // Upgrade cost = VPS M price minus what they've already paid this period
  // Detect test vs live mode
  const paystackLiveMode = isPaystackLiveMode();
  const paystackTestMode = isPaystackTestMode();

  const upgradeCost = Math.max(0, PLAN_PRICES["VPS M"] - paidThisPeriod);
  const isUpgradeFree = upgradeCost <= 0;

  async function handleUpgrade() {
    // Show confirmation with the cost first
    setConfirmingUpgrade(true);
  }

  async function handleConfirmUpgrade() {
    setConfirmingUpgrade(false);
    setUpgrading(true);

    // If they've already paid enough, upgrade is free — just save the plan
    if (isUpgradeFree) {
      updatePlan("VPS M").catch(() => {});
      setIsUpgraded(true);
      setUpgrading(false);
      getSubscriptionStatus().then(setSubStatus).catch(() => {});
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Upgrade Successful", message: `Plan upgraded to ${upgradePlan.name} · ${upgradePlan.priceKES}/mo`, type: "success", duration: 4000 },
      }));
      return;
    }

    // Otherwise, charge the difference via Paystack
    const planConfig = PAYSTACK_PLANS["VPS M"];

    try {
      await loadPaystackSDK();

      const res = await apiFetch("/api/paystack/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@mountainofdeliverance.org",
          plan: "VPS M",
          amount: upgradeCost, // custom amount — just the difference
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server error: ${res.status}`);
      }

      const { authorization_url, reference } = await res.json();

      const popupHandler = (window as any).PaystackPop?.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email: "admin@mountainofdeliverance.org",
        amount: upgradeCost * 100,
        currency: "KES",
        ref: reference,
        metadata: {
          plan: "VPS M",
          type: "upgrade",
          church_id: process.env.NEXT_PUBLIC_CHURCH_ID || "mountain_of_deliverance",
        },
        callback: (response: { reference: string }) => {
          apiFetch("/api/paystack/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reference: response.reference }),
          })
            .then((r) => r.json())
            .then((verifyData: any) => {
              if (verifyData.verified) {
                // Record upgrade payment + save new plan
                recordPayment({
                  reference: verifyData.reference || response.reference,
                  amount: upgradeCost,
                  plan: "VPS M",
                  status: "paid",
                  paidAt: Timestamp.now(),
                  billingPeriod: snapshot.currentPeriod,
                  email: "admin@mountainofdeliverance.org",
                  channel: verifyData.channel || "paystack",
                  church_id: process.env.NEXT_PUBLIC_CHURCH_ID || "mountain_of_deliverance",
                  isTest: paystackTestMode,
                }).then(() => {
                  // Save plan and reload status
                  updatePlan("VPS M").catch(() => {});
                  getSubscriptionStatus().then(setSubStatus);
                  window.dispatchEvent(new CustomEvent("payments-refresh"));
                }).catch((err) => {
                  console.error("[Upgrade] Failed to save payment:", err);
                });

                setIsUpgraded(true);
                setNow(new Date());
                window.dispatchEvent(new CustomEvent("show-toast", {
                  detail: { title: "Upgrade Successful", message: `Plan upgraded to ${upgradePlan.name} · KES ${upgradeCost.toLocaleString()} paid`, type: "success", duration: 5000 },
                }));
              } else {
                throw new Error("Payment verification failed");
              }
            })
            .catch((err: any) => {
              window.dispatchEvent(new CustomEvent("show-toast", {
                detail: { title: "Upgrade Error", message: err.message || "Could not verify upgrade payment", type: "error", duration: 4000 },
              }));
            })
            .finally(() => setUpgrading(false));
        },
        onClose: () => {
          setUpgrading(false);
          window.dispatchEvent(new CustomEvent("show-toast", {
            detail: { title: "Upgrade Cancelled", message: "You closed the payment window", type: "info", duration: 3000 },
          }));
        },
      });

      // On Capacitor (Android app), redirect to Paystack checkout page
      if (isCapacitor) {
        sessionStorage.setItem('paystack_pending', JSON.stringify({
          reference,
          planKey: 'VPS M',
          amount: upgradeCost,
          isTest: paystackTestMode,
          type: 'upgrade',
        }));
        window.location.href = authorization_url;
      } else if (popupHandler) {
        popupHandler.openIframe();
      } else if (authorization_url) {
        sessionStorage.setItem('paystack_pending', JSON.stringify({
          reference,
          planKey: 'VPS M',
          amount: upgradeCost,
          isTest: paystackTestMode,
          type: 'upgrade',
        }));
        window.location.href = authorization_url;
      } else {
        throw new Error("Paystack SDK failed");
      }
    } catch (err: any) {
      console.error("[Upgrade] Fatal error:", err);
      setUpgrading(false);
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Upgrade Error", message: err.message || "Something went wrong", type: "error", duration: 5000 },
      }));
    }
  }

  async function handleCancelUpgrade() {
    setConfirmingUpgrade(false);
  }

  // ════ Detect Capacitor (Android app) ════
  // On mobile, the inline Paystack popup doesn't fit well — we redirect instead
  const isCapacitor = typeof window !== 'undefined' && !!(window as any).Capacitor?.isNative;

  // ════ Upgrade Toggle ════

  // Load Paystack SDK on mount (only needed for desktop inline popup)
  useEffect(() => {
    if (!isCapacitor) {
      loadPaystackSDK().catch(() => {});
    }
  }, [isCapacitor]);

  async function handlePayNow() {
    const planKey = isUpgraded ? "VPS M" : "VPS S";
    const planConfig = PAYSTACK_PLANS[planKey];

    console.log("[Pay] Pay Now clicked", { planKey, keyConfigured: !!PAYSTACK_PUBLIC_KEY, keyFirstChars: PAYSTACK_PUBLIC_KEY.slice(0, 12) });

    setPaying(true);

    // If Paystack is not configured, fall back to simulation
    if (!PAYSTACK_PUBLIC_KEY || PAYSTACK_PUBLIC_KEY.startsWith("pk_test_replace")) {
      console.log("[Pay] Paystack not configured — using simulation mode");
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: {
          title: "Paystack Not Configured",
          message: "Using simulation mode. Set NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY & PAYSTACK_SECRET_KEY, then restart the dev server.",
          type: "warning",
          duration: 5000,
        },
      }));

      setTimeout(() => {
        // Save simulation payment to Firestore
        const billingPeriod = snapshot.currentPeriod;            recordPayment({
                  reference: `sim_${Date.now()}`,
                  amount: planConfig.amountKES,
                  plan: planKey as "VPS S" | "VPS M",
                  status: "paid",
                  paidAt: Timestamp.now(),
                  billingPeriod,
                  email: "admin@mountainofdeliverance.org",
              channel: "simulation",
              church_id: process.env.NEXT_PUBLIC_CHURCH_ID || "mountain_of_deliverance",
              isTest: true,
            }).then(() => {
                  getSubscriptionStatus().then(setSubStatus);
                  window.dispatchEvent(new CustomEvent("payments-refresh"));
                }).catch((err) => {
                  console.error("[Pay] Failed to save simulation payment:", err);
                });

        setPaying(false);
        setNow(new Date());
        console.log("[Pay] Simulation payment completed");
        window.dispatchEvent(new CustomEvent("show-toast", {
          detail: { title: "Payment Successful (Simulation)", message: `${planConfig.label} paid · ${planKey} subscription active`, type: "success", duration: 5000 },
        }));
      }, 1500);
      return;
    }

    try {
      // Load Paystack SDK
      console.log("[Pay] Loading Paystack SDK...");
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Loading Paystack...", message: "Opening secure payment popup", type: "info", duration: 2000 },
      }));

      await loadPaystackSDK();
      console.log("[Pay] Paystack SDK loaded");

      // Use church admin email — no prompt needed
      const email = "admin@mountainofdeliverance.org";
      console.log("[Pay] Email:", email);

      // Initialize transaction on the server
      console.log("[Pay] Initializing transaction...");
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Contacting Paystack...", message: "Initializing secure transaction", type: "info", duration: 3000 },
      }));

      const res = await apiFetch("/api/paystack/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, plan: planKey }),
      });

      console.log("[Pay] Initialize response status:", res.status);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error("[Pay] Initialize error:", errData);
        throw new Error(errData.error || `Server error: ${res.status}`);
      }

      const { authorization_url, access_code, reference } = await res.json();
      console.log("[Pay] Transaction initialized", { reference, hasAuthUrl: !!authorization_url });

      // Open the Paystack checkout
      const popupHandler = (window as any).PaystackPop?.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email,
        amount: planConfig.amountKES * 100,
        currency: "KES",
        ref: reference,
        metadata: {
          plan: planKey,
          church_id: process.env.NEXT_PUBLIC_CHURCH_ID || "mountain_of_deliverance",
        },
        callback: (response: { reference: string; trans: string }) => {
          console.log("[Pay] Paystack callback received", response);
          setPaying(true);
          // Use .then() instead of async/await because Paystack's type
          // validation rejects AsyncFunction objects
          apiFetch("/api/paystack/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reference: response.reference }),
          })
            .then((r) => r.json())
            .then((verifyData: any) => {
              console.log("[Pay] Verify response:", verifyData);
              if (verifyData.verified) {
                // Save payment record to Firestore
                const billingPeriod = snapshot.currentPeriod;
                recordPayment({
                  reference: verifyData.reference || response.reference,
                  amount: verifyData.amount || planConfig.amountKES,
                  plan: planKey as "VPS S" | "VPS M",
                  status: "paid",
                  paidAt: Timestamp.now(),
                  billingPeriod,
                  email: "admin@mountainofdeliverance.org",
              channel: verifyData.channel || "card",
              church_id: process.env.NEXT_PUBLIC_CHURCH_ID || "mountain_of_deliverance",
              isTest: paystackTestMode,
            }).then(() => {
              // Reload subscription status to reflect the new payment
              getSubscriptionStatus().then(setSubStatus);
              window.dispatchEvent(new CustomEvent("payments-refresh"));
            }).catch((err) => {
              console.error("[Pay] Failed to save payment record:", err);
            });

            setNow(new Date());
                window.dispatchEvent(new CustomEvent("show-toast", {
                  detail: { title: "Payment Successful", message: `${planConfig.label} paid via Paystack · ${planKey} active`, type: "success", duration: 5000 },
                }));
              } else {
                throw new Error("Payment verification failed");
              }
            })
            .catch((err: any) => {
              console.error("[Pay] Verification error:", err);
              // Save failed payment record for audit trail
              recordPayment({
                reference: response.reference,
                amount: planConfig.amountKES,
                plan: planKey as "VPS S" | "VPS M",
                status: "failed",
                paidAt: Timestamp.now(),
                billingPeriod: snapshot.currentPeriod,
                email: "admin@mountainofdeliverance.org",
              channel: "paystack",
              church_id: process.env.NEXT_PUBLIC_CHURCH_ID || "mountain_of_deliverance",
              isTest: paystackTestMode,
            }).catch(() => {});
            window.dispatchEvent(new CustomEvent("show-toast", {
              detail: { title: "Verification Error", message: err.message || "Could not verify payment", type: "error", duration: 4000 },
            }));
            })
            .finally(() => setPaying(false));
        },
        onClose: () => {
          console.log("[Pay] Popup closed by user");
          setPaying(false);
          window.dispatchEvent(new CustomEvent("show-toast", {
            detail: { title: "Payment Cancelled", message: "You closed the payment window", type: "info", duration: 3000 },
          }));
        },
      });

      // On Capacitor (Android app), redirect to Paystack checkout page
      // which is mobile-responsive. On desktop, use the inline popup.
      if (isCapacitor) {
        console.log("[Pay] Capacitor detected — redirecting to Paystack checkout");
        sessionStorage.setItem('paystack_pending', JSON.stringify({
          reference,
          planKey,
          amount: planConfig.amountKES,
          isTest: paystackTestMode,
          type: 'payment',
        }));
        window.location.href = authorization_url;
      } else if (popupHandler) {
        console.log("[Pay] Opening Paystack popup...");
        popupHandler.openIframe();
      } else {
        console.error("[Pay] PaystackPop.setup returned falsy — falling back to redirect");
        if (authorization_url) {
          console.log("[Pay] Redirecting to:", authorization_url);
          sessionStorage.setItem('paystack_pending', JSON.stringify({
            reference,
            planKey,
            amount: planConfig.amountKES,
            isTest: paystackTestMode,
            type: 'payment',
          }));
          window.location.href = authorization_url;
        } else {
          throw new Error("Paystack SDK failed to load and no authorization URL available.");
        }
      }
    } catch (err: any) {
      console.error("[Pay] Fatal error:", err);
      setPaying(false);
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Payment Error", message: err.message || "Something went wrong", type: "error", duration: 5000 },
      }));
    }
  }

  async function handleActivateTrial() {
    setActivatingTrial(true);
    try {
      const plan = isUpgraded ? "VPS M" : "VPS S";
      await activateTrial(plan, trialDuration);
      const newStatus = await getSubscriptionStatus();
      setSubStatus(newStatus);
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Free Trial Activated", message: `${trialDuration}-day free trial started on ${plan}`, type: "success", duration: 4000 },
      }));
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Trial Error", message: err?.message || "Could not activate trial", type: "error", duration: 4000 },
      }));
    } finally {
      setActivatingTrial(false);
    }
  }

  // Simulate random events
  const [events, setEvents] = useState<string[]>([
    "✅ Server health check passed",
    "📡 CDN cache refreshed",
    "🔄 Auto-scaling idle",
  ]);

  useEffect(() => {
    const messages = [
      "✅ All services operational",
      "📡 Uplink stable · 12 ms latency",
      "🛡️ DDoS protection active",
      "🔒 SSL certificates valid (30d)",
      "⚡ Load balancing optimal",
      "📦 Backup completed (4.2 GB)",
      "🌐 Global CDN edge sync OK",
      "🔄 Database replication lag: 0s",
    ];
    const interval = setInterval(() => {
      setEvents((prev) => {
        const next = [...prev, `✅ ${messages[randInt(0, messages.length - 1)]}`];
        if (next.length > 6) next.shift();
        return next;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // ═══════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════

  return (
    <>
      <style>{`
        /* ── Subscriptions Tab Styles ── */
        /* ── Server Cards ── */
        .server-grid {
          display: flex;
          flex-direction: column;
          gap: 14px;
          margin-bottom: 20px;
        }

        .server-card {
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 18px;
          position: relative;
          overflow: hidden;
          transition: all 0.3s ease;
        }
        .server-card.active {
          border-color: rgba(74, 222, 128, 0.3);
        }

        .server-glow {
          position: absolute;
          top: -60%;
          right: -20%;
          width: 180px;
          height: 180px;
          background: radial-gradient(circle, rgba(74, 222, 128, 0.06) 0%, transparent 70%);
          pointer-events: none;
        }

        .server-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 14px;
        }
        .server-name-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .server-led {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #4ADE80;
          box-shadow: 0 0 8px rgba(74, 222, 128, 0.6);
          animation: pulse-led 2s ease-in-out infinite;
        }
        @keyframes pulse-led {
          0%, 100% { opacity: 1; box-shadow: 0 0 8px rgba(74, 222, 128, 0.6); }
          50% { opacity: 0.6; box-shadow: 0 0 4px rgba(74, 222, 128, 0.3); }
        }
        .server-name {
          font-size: 15px;
          font-weight: 700;
        }
        .server-badge {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 3px 10px;
          border-radius: 6px;
          background: rgba(74, 222, 128, 0.12);
          color: #4ADE80;
        }

        /* ── Metric Bars ── */
        .server-metrics {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .metric-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .metric-icon {
          width: 28px;
          text-align: center;
          font-size: 12px;
          color: var(--text-tertiary);
          flex-shrink: 0;
        }
        .metric-label {
          font-size: 12px;
          color: var(--text-secondary);
          width: 40px;
          flex-shrink: 0;
          font-weight: 500;
        }
        .metric-bar-track {
          flex: 1;
          height: 6px;
          background: var(--surface);
          border-radius: 3px;
          overflow: hidden;
        }
        .metric-bar-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.6s ease;
        }
        .metric-value {
          font-size: 12px;
          font-weight: 600;
          width: 56px;
          text-align: right;
          flex-shrink: 0;
          font-variant-numeric: tabular-nums;
        }

        /* ── Server Footer Stats ── */
        .server-footer {
          display: flex;
          gap: 16px;
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--border);
          flex-wrap: wrap;
        }
        .server-footer-item {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          color: var(--text-tertiary);
        }
        .server-footer-item i {
          font-size: 10px;
          width: 14px;
          text-align: center;
        }
        .server-footer-item strong {
          color: var(--text-secondary);
          font-weight: 600;
        }

        /* ── Network Graph ── */
        .network-card {
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 18px;
          margin-bottom: 20px;
        }
        .network-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 14px;
        }
        .network-title {
          font-size: 14px;
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .network-stats {
          display: flex;
          gap: 20px;
        }
        .network-stat {
          text-align: center;
        }
        .network-stat-label {
          font-size: 10px;
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .network-stat-value {
          font-size: 15px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .network-stat-value.in { color: #3B82F6; }
        .network-stat-value.out { color: #E8A838; }
        .network-graph {
          height: 40px;
          display: flex;
          align-items: flex-end;
          gap: 3px;
        }
        .network-bar {
          flex: 1;
          border-radius: 2px 2px 0 0;
          transition: height 0.8s ease;
          min-height: 2px;
        }

        /* ── Service Cards ── */
        .services-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
          margin-bottom: 20px;
        }
        .service-card {
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 16px;
          text-align: center;
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
        }
        .service-card:active {
          transform: scale(0.97);
        }
        .service-icon {
          width: 44px;
          height: 44px;
          border-radius: var(--radius-full);
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 10px;
          font-size: 18px;
          color: #fff;
          transition: all 0.3s ease;
        }
        .service-name {
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 3px;
        }
        .service-status {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          font-weight: 600;
          padding: 3px 10px;
          border-radius: 20px;
          margin-top: 4px;
        }
        .service-status.online {
          background: rgba(74, 222, 128, 0.12);
          color: #4ADE80;
        }
        .service-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #4ADE80;
          animation: pulse-led 2s ease-in-out infinite;
        }
        .service-meta {
          font-size: 10px;
          color: var(--text-tertiary);
          margin-top: 6px;
        }

        /* ── VPS Specs ── */
        .vps-card {
          background: linear-gradient(135deg, var(--surface-card) 0%, rgba(232,168,56,0.04) 100%);
          border: 1px solid rgba(232,168,56,0.2);
          border-radius: var(--radius-lg);
          padding: 20px;
          margin-bottom: 20px;
        }
        .vps-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }
        .vps-title {
          font-size: 15px;
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .vps-price {
          font-size: 18px;
          font-weight: 800;
          color: var(--primary);
        }
        .vps-price small {
          font-size: 11px;
          font-weight: 500;
          color: var(--text-tertiary);
        }
        .vps-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
        }
        .vps-spec {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px;
          background: rgba(232,168,56,0.04);
          border: 1px solid rgba(232,168,56,0.08);
          border-radius: var(--radius-sm);
        }
        .vps-spec-icon {
          width: 36px;
          height: 36px;
          border-radius: var(--radius-sm);
          background: rgba(232,168,56,0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          color: var(--primary);
          flex-shrink: 0;
        }
        .vps-spec-info {
          flex: 1;
          min-width: 0;
        }
        .vps-spec-label {
          font-size: 10px;
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .vps-spec-value {
          font-size: 13px;
          font-weight: 700;
        }

        /* ── Events Log ── */
        .events-card {
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 18px;
          margin-bottom: 20px;
        }
        .events-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .events-title i {
          font-size: 10px;
          color: var(--success);
        }
        .events-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .events-item {
          font-size: 12px;
          color: var(--text-secondary);
          font-family: 'SF Mono', 'Cascadia Code', monospace;
          padding: 4px 0;
          border-bottom: 1px solid var(--border);
          animation: fade-in 0.3s ease;
        }
        .events-item:last-child { border-bottom: none; }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* ── Spinner ── */
        .fa-spin { animation: fa-spin 1.5s linear infinite; }
        @keyframes fa-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      `}</style>

      <div>

        {/* ════ Billing & Countdown (Firestore-backed) ════ */}
        <div className="billing-card" style={{
          background: `linear-gradient(135deg, ${isPaid ? "rgba(74,222,128,0.08)" : isMissed ? "rgba(239,68,68,0.08)" : "rgba(232,168,56,0.08)"} 0%, var(--surface-card) 100%)`,
          border: `1px solid ${isPaid ? "rgba(74,222,128,0.2)" : isMissed ? "rgba(239,68,68,0.2)" : "rgba(232,168,56,0.2)"}`,
          borderRadius: "var(--radius-lg)",
          padding: "20px",
          marginBottom: 20,
          position: "relative",
          overflow: "hidden",
        }}>
          {/* Glow */}
          <div style={{
            position: "absolute", top: "-40%", right: "-10%",
            width: 160, height: 160,
            background: `radial-gradient(circle, ${isPaid ? "rgba(74,222,128,0.08)" : isMissed ? "rgba(239,68,68,0.08)" : "rgba(232,168,56,0.08)"} 0%, transparent 70%)`,
            pointerEvents: "none",
          }} />

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
              <i className="fas fa-credit-card" style={{ color: "var(--primary)" }}></i>
              Subscription Billing
            </div>
            <div style={{
              fontSize: 11, fontWeight: 700, padding: "4px 12px",
              borderRadius: 20,
              background: isTrial
                ? "rgba(59,130,246,0.12)"
                : isPaid ? "rgba(74,222,128,0.12)" : isMissed ? "rgba(239,68,68,0.12)" : isPartiallyPaid ? "rgba(251,191,36,0.12)" : "rgba(232,168,56,0.12)",
              color: isTrial
                ? "#3B82F6"
                : isPaid ? "#4ADE80" : isMissed ? "#EF4444" : isPartiallyPaid ? "#FBBF24" : "var(--primary)",
            }}>
              {isTrial ? (
                <><i className="fas fa-gift"></i> Trial</>
              ) : isPaid ? (
                <><i className="fas fa-check-circle"></i> Paid</>
              ) : isMissed ? (
                <><i className="fas fa-exclamation-circle"></i> Missed</>
              ) : isPartiallyPaid ? (
                <><i className="fas fa-hourglass-half"></i> Partial</>
              ) : (
                <><i className="fas fa-clock"></i> Pending</>
              )}
            </div>
          </div>

          {/* Amount */}
          <div style={{ marginBottom: 16, textAlign: "center" }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: isPaid ? "#4ADE80" : "var(--primary)", fontVariantNumeric: "tabular-nums" }}>
              KES {totalDue.toLocaleString()}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
              {currentMonthLabel}
            </div>
          </div>

          {/* Balance indicator (if partial payment) */}
          {isPartiallyPaid && (
            <div style={{
              background: "rgba(251,191,36,0.08)",
              border: "1px solid rgba(251,191,36,0.2)",
              borderRadius: "var(--radius-sm)",
              padding: "10px 14px",
              marginBottom: 12,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 13,
            }}>
              <span style={{ color: "var(--text-secondary)" }}>Paid so far</span>
              <span style={{ fontWeight: 700, color: "#FBBF24" }}>KES {paidThisPeriod.toLocaleString()}</span>
              <span style={{ color: "var(--text-secondary)" }}>Remaining</span>
              <span style={{ fontWeight: 700, color: "var(--primary)" }}>KES {remaining.toLocaleString()}</span>
            </div>
          )}

          {/* Missed payment alert (current month overdue) */}
          {isMissed && overdueMonths === 1 && (
            <div style={{
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: "var(--radius-sm)",
              padding: "10px 14px",
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: "var(--error)",
              fontWeight: 600,
            }}>
              <i className="fas fa-exclamation-triangle"></i>
              Payment missed — due on the 10th
            </div>
          )}

          {/* Multiple months overdue — accumulated debt banner */}
          {overdueMonths > 1 && (
            <div style={{
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: "var(--radius-sm)",
              padding: "12px 14px",
              marginBottom: 12,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              fontSize: 13,
              color: "var(--error)",
              fontWeight: 600,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <i className="fas fa-exclamation-triangle"></i>
                {overdueMonths} month{overdueMonths > 1 ? "s" : ""} overdue
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)" }}>
                Accumulated debt: <strong style={{ color: "#EF4444" }}>KES {accumulatedDebt.toLocaleString()}</strong>
                <span style={{ marginLeft: 8 }}>· KES {totalDue.toLocaleString()}/mo</span>
              </div>
              <div style={{ fontSize: 11, fontWeight: 400, color: "var(--text-tertiary)", marginTop: 2 }}>
                This month: KES {remaining.toLocaleString()} remaining
              </div>
            </div>
          )}

          {/* Accumulated debt on overdue single month with partial payment */}
          {isMissed && overdueMonths === 1 && accumulatedDebt > remaining && (
            <div style={{
              background: "rgba(239,68,68,0.05)",
              border: "1px solid rgba(239,68,68,0.12)",
              borderRadius: "var(--radius-sm)",
              padding: "8px 14px",
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "var(--text-secondary)",
            }}>
              <i className="fas fa-coins" style={{ color: "#EF4444", fontSize: 11 }}></i>
              KES {accumulatedDebt.toLocaleString()} total overdue
            </div>
          )}

          {/* Countdown — trial or billing */}
          <div style={{
            background: "rgba(0,0,0,0.2)",
            borderRadius: "var(--radius-md)",
            padding: "14px",
            marginBottom: 16,
            textAlign: "center",
          }}>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
              {isTrial ? "Trial ends in" : isPaid ? "Next billing in" : isMissed ? "Overdue by" : "Due in"}
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
              {[
                { label: "Days", value: countdown.days },
                { label: "Hours", value: countdown.hours },
                { label: "Min", value: countdown.minutes },
                { label: "Sec", value: countdown.seconds },
              ].map((unit) => (
                <div key={unit.label} style={{ textAlign: "center" }}>
                  <div style={{
                    fontSize: 22, fontWeight: 800,
                    color: isTrial ? "#3B82F6" : isPaid ? "#4ADE80" : "var(--primary)",
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1.1,
                  }}>
                    {String(unit.value).padStart(2, "0")}
                  </div>
                  <div style={{ fontSize: 9, color: "var(--text-tertiary)", textTransform: "uppercase", marginTop: 2 }}>
                    {unit.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Due date info — trial or billing */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            fontSize: 12, color: "var(--text-secondary)", marginBottom: 16,
          }}>
            {isTrial ? (
              <><i className="fas fa-gift" style={{ color: "#3B82F6", fontSize: 11 }}></i>
              Free trial — <strong style={{ color: "var(--text-primary)" }}>{trialDaysRemaining} day{trialDaysRemaining !== 1 ? "s" : ""}</strong> remaining</>
            ) : (
              <><i className="fas fa-calendar-alt" style={{ color: "var(--text-tertiary)" }}></i>
              Due on the <strong style={{ color: "var(--text-primary)" }}>10th</strong> of each month</>
            )}
          </div>

          {/* Pay Now button */}
          <button
            onClick={isTrial ? undefined : handlePayNow}
            disabled={paying || isPaid || isTrial}
            style={{
              width: "100%",
              padding: "16px",
              border: "none",
              borderRadius: "var(--radius-md)",
              fontSize: 16,
              fontWeight: 700,
              cursor: (paying || isPaid || isTrial) ? "not-allowed" : "pointer",
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: isPaid || isTrial
                ? "var(--surface-elevated)"
                : "linear-gradient(135deg, var(--gradient-start), var(--gradient-end))",
              color: isPaid || isTrial ? "var(--text-tertiary)" : "#fff",
              opacity: (paying || isPaid || isTrial) ? 0.7 : 1,
            }}
          >
            {paying ? (
              <><i className="fas fa-spinner fa-spin"></i> Processing…</>
            ) : isPaid && isTrial ? (
              <><i className="fas fa-gift"></i> Free Trial — {trialDaysRemaining} day{trialDaysRemaining !== 1 ? "s" : ""} left</>
            ) : isPaid ? (
              <><i className="fas fa-check-circle"></i> Paid for {currentMonthLabel}</>
            ) : isPartiallyPaid ? (
              <><i className="fas fa-lock"></i> Pay Balance — KES {remaining.toLocaleString()}</>
            ) : (
              <>              <i className="fas fa-lock"></i> Pay Now — KES {totalDue.toLocaleString()}</>
            )}
          </button>

          {/* Payment mode indicator */}
          {!isPaid && !paying && (
            <div style={{
              fontSize: 11,
              marginTop: 12,
              textAlign: "center",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              color: "var(--text-tertiary)",
            }}>
              <i className="fas fa-shield-halved" style={{ fontSize: 10 }}></i>
              Secured via Paystack
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                background: paystackLiveMode
                  ? "rgba(74,222,128,0.12)"
                  : "rgba(232,168,56,0.12)",
                color: paystackLiveMode
                  ? "#4ADE80"
                  : "var(--primary)",
              }}>
                {paystackLiveMode ? (
                  <><i className="fas fa-check-circle" style={{ fontSize: 9 }}></i> Live</>
                ) : (
                  <><i className="fas fa-flask" style={{ fontSize: 9 }}></i> Test</>
                )}
              </span>
            </div>
          )}
        </div>

        {/* ════ Activate Free Trial Button (shows only before trial ever activated — once used, gone forever) ════ */}
        {subStatus?.trialStartDate == null && !loadingStatus && (
          <div style={{
            background: "var(--surface-card)",
            border: "1px solid rgba(59,130,246,0.2)",
            borderRadius: "var(--radius-lg)",
            padding: "20px",
            marginBottom: 20,
            position: "relative",
            overflow: "hidden",
          }}>
            <div style={{
              position: "absolute", top: "-30%", right: "-10%",
              width: 140, height: 140,
              background: "radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)",
              pointerEvents: "none",
            }} />

            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
              <div style={{
                width: 48, height: 48,
                borderRadius: "var(--radius-full)",
                background: "rgba(59,130,246,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                fontSize: 20,
                color: "#3B82F6",
              }}>
                <i className="fas fa-gift"></i>
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Activate Free Trial</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                  Try {isUpgraded ? "VPS M" : "VPS S"} free — choose your trial period
                </div>
              </div>
            </div>

            {/* Duration presets */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
                Trial Period
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {[7, 14, 30, 60, 90].map((days) => (
                  <button
                    key={days}
                    onClick={() => setTrialDuration(days)}
                    disabled={activatingTrial}
                    style={{
                      flex: 1,
                      padding: "10px 0",
                      border: days === trialDuration ? "1.5px solid #3B82F6" : "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      background: days === trialDuration ? "rgba(59,130,246,0.1)" : "var(--surface)",
                      color: days === trialDuration ? "#3B82F6" : "var(--text-secondary)",
                      fontSize: 13,
                      fontWeight: days === trialDuration ? 700 : 600,
                      cursor: activatingTrial ? "not-allowed" : "pointer",
                      transition: "all 0.2s",
                      textAlign: "center",
                    }}
                  >
                    {days}d
                  </button>
                ))}
              </div>
            </div>

            <ul style={{
              listStyle: "none",
              padding: 0,
              margin: "0 0 16px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontSize: 12,
              color: "var(--text-secondary)",
            }}>
              <li><i className="fas fa-check-circle" style={{ color: "#3B82F6", width: 16, marginRight: 6 }}></i>Full access to all features during trial</li>
              <li><i className="fas fa-check-circle" style={{ color: "#3B82F6", width: 16, marginRight: 6 }}></i>No credit card required</li>
              <li><i className="fas fa-check-circle" style={{ color: "#3B82F6", width: 16, marginRight: 6 }}></i>Billing starts automatically after {trialDuration} days</li>
            </ul>

            <button
              onClick={handleActivateTrial}
              disabled={activatingTrial}
              style={{
                width: "100%",
                padding: "14px",
                border: "none",
                borderRadius: "var(--radius-md)",
                fontSize: 15,
                fontWeight: 700,
                cursor: activatingTrial ? "not-allowed" : "pointer",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                background: activatingTrial
                  ? "var(--surface-elevated)"
                  : "linear-gradient(135deg, #2563EB, #3B82F6)",
                color: "#fff",
                opacity: activatingTrial ? 0.7 : 1,
              }}
            >
              {activatingTrial ? (
                <><i className="fas fa-spinner fa-spin"></i> Activating trial…</>
              ) : (
                <><i className="fas fa-gift"></i> Activate Free Trial — {trialDuration} Days</>
              )}
            </button>
          </div>
        )}

        {/* ════ Payment History ════ */}
        <div className="payments-card" style={{
          background: "var(--surface-card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: "20px",
          marginBottom: 20,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
              <i className="fas fa-receipt" style={{ color: "var(--text-tertiary)" }}></i>
              Payment History
            </div>
            {!loadingPayments && (
              <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontWeight: 500 }}>
                {payments.length} {payments.length === 1 ? "payment" : "payments"}
              </div>
            )}
          </div>

          {loadingPayments ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-tertiary)" }}>
              <i className="fas fa-spinner fa-spin" style={{ fontSize: 18, display: "block", marginBottom: 8 }}></i>
              Loading payments…
            </div>
          ) : payments.length === 0 ? (
            <div style={{
              textAlign: "center",
              padding: "32px 0",
              color: "var(--text-tertiary)",
              fontSize: 13,
            }}>
              <i className="fas fa-credit-card" style={{ fontSize: 28, display: "block", marginBottom: 10, opacity: 0.3 }}></i>
              No payments recorded yet
              <div style={{ fontSize: 11, marginTop: 4 }}>Payments will appear here after your first subscription payment</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {payments.map((pmt, i) => {
                const paidDate = pmt.paidAt?.toDate();
                const formattedDate = paidDate
                  ? paidDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : "—";
                const formattedTime = paidDate
                  ? paidDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
                  : "";
                const isSimulation = pmt.channel === "simulation";
                const isTestPayment = pmt.isTest === true && !isSimulation;
                return (
                  <div key={pmt.id || i} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    background: i % 2 === 0 ? "rgba(0,0,0,0.12)" : "transparent",
                    borderRadius: "var(--radius-sm)",
                    transition: "background 0.2s",
                  }}>
                    {/* Status icon */}
                    <div style={{
                      width: 36,
                      height: 36,
                      borderRadius: "var(--radius-full)",
                      background: isSimulation
                        ? "rgba(232,168,56,0.12)"
                        : isTestPayment
                          ? "rgba(59,130,246,0.12)"
                          : "rgba(74,222,128,0.12)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      color: isSimulation ? "var(--primary)" : isTestPayment ? "#3B82F6" : "#4ADE80",
                      fontSize: 14,
                    }}>
                      {isSimulation ? (
                        <i className="fas fa-flask"></i>
                      ) : (
                        <i className="fas fa-check-circle"></i>
                      )}
                    </div>

                    {/* Details */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          {pmt.plan}
                        </span>
                        {isSimulation && (
                          <span style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: "rgba(232,168,56,0.15)",
                            color: "var(--primary)",
                          }}>SIM</span>
                        )}
                        {isTestPayment && (
                          <span style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: "rgba(59,130,246,0.15)",
                            color: "#3B82F6",
                          }}>TEST</span>
                        )}
                        <span style={{
                          fontSize: 11,
                          color: "var(--text-tertiary)",
                          marginLeft: "auto",
                        }}>
                          {pmt.channel}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
                        {formattedDate} {formattedTime}
                        {pmt.reference && !isSimulation && (
                          <span style={{ marginLeft: 8, fontFamily: "monospace", fontSize: 10 }}>
                            · #{pmt.reference.slice(-8)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Amount */}
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#4ADE80" }}>
                        KES {pmt.amount.toLocaleString()}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-tertiary)" }}>
                        {pmt.status}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ════ Server Monitoring ════ */}
        <div className="section-title" style={{ fontSize: 14, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>
          <i className="fas fa-server"></i> Server Infrastructure
        </div>

        <div className="server-grid">
          {servers.map((srv, i) => {
            const cpuColor = srv.cpu > 70 ? "#EF4444" : srv.cpu > 50 ? "#E8A838" : "#4ADE80";
            const ramColor = srv.ram > 70 ? "#EF4444" : srv.ram > 50 ? "#E8A838" : "#4ADE80";
            const tempColor = srv.temp > 60 ? "#EF4444" : srv.temp > 50 ? "#E8A838" : "#4ADE80";
            return (
              <div
                key={i}
                className={`server-card${activeServer === i ? " active" : ""}`}
                onClick={() => setActiveServer(i)}
              >
                <div className="server-glow" />
                <div className="server-top">
                  <div className="server-name-wrap">
                    <div className="server-led" />
                    <div className="server-name">Server {i + 1}</div>
                  </div>
                  <div className="server-badge">
                    <i className="fas fa-check-circle" style={{ marginRight: 4 }}></i>
                    Online
                  </div>
                </div>

                <div className="server-metrics">
                  {/* CPU */}
                  <div className="metric-row">
                    <div className="metric-icon"><i className="fas fa-microchip"></i></div>
                    <div className="metric-label">CPU</div>
                    <div className="metric-bar-track">
                      <div className="metric-bar-fill" style={{ width: `${srv.cpu}%`, background: cpuColor }} />
                    </div>
                    <div className="metric-value" style={{ color: cpuColor }}>{srv.cpu.toFixed(0)}%</div>
                  </div>

                  {/* RAM */}
                  <div className="metric-row">
                    <div className="metric-icon"><i className="fas fa-memory"></i></div>
                    <div className="metric-label">RAM</div>
                    <div className="metric-bar-track">
                      <div className="metric-bar-fill" style={{ width: `${srv.ram}%`, background: ramColor }} />
                    </div>
                    <div className="metric-value" style={{ color: ramColor }}>{srv.ram.toFixed(0)}%</div>
                  </div>

                  {/* Temperature */}
                  <div className="metric-row">
                    <div className="metric-icon"><i className="fas fa-temperature-high"></i></div>
                    <div className="metric-label">TEMP</div>
                    <div className="metric-bar-track">
                      <div className="metric-bar-fill" style={{ width: `${((srv.temp - 35) / 45) * 100}%`, background: tempColor }} />
                    </div>
                    <div className="metric-value" style={{ color: tempColor }}>{srv.temp.toFixed(0)}°C</div>
                  </div>
                </div>

                <div className="server-footer">
                  <div className="server-footer-item">
                    <i className="fas fa-arrow-down"></i>
                    <strong>RX</strong> {srv.rx}
                  </div>
                  <div className="server-footer-item">
                    <i className="fas fa-arrow-up"></i>
                    <strong>TX</strong> {srv.tx}
                  </div>
                  <div className="server-footer-item">
                    <i className="fas fa-clock"></i>
                    <strong>Uptime</strong> {srv.uptime}
                  </div>
                  <div className="server-footer-item">
                    <i className="fas fa-gear"></i>
                    <strong>Load</strong> {srv.load.map((l) => l.toFixed(1)).join(" / ")}
                  </div>
                  <div className="server-footer-item">
                    <i className="fas fa-diagram-project"></i>
                    <strong>Procs</strong> {srv.processes}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ════ Network Traffic ════ */}
        <div className="network-card">
          <div className="network-header">
            <div className="network-title">
              <i className="fas fa-network-wired" style={{ color: "#3B82F6" }}></i>
              Network Traffic
            </div>
            <div className="network-stats">
              <div className="network-stat">
                <div className="network-stat-label">Inbound</div>
                <div className="network-stat-value in">{networkIn} Mbps</div>
              </div>
              <div className="network-stat">
                <div className="network-stat-label">Outbound</div>
                <div className="network-stat-value out">{networkOut} Mbps</div>
              </div>
            </div>
          </div>
          <div className="network-graph">
            {Array.from({ length: 20 }).map((_, i) => {
              const inH = rand(10, 100);
              const outH = rand(5, 70);
              return (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                  <div className="network-bar" style={{ height: `${inH}%`, background: "#3B82F6", opacity: 0.7 }} />
                  <div className="network-bar" style={{ height: `${outH}%`, background: "#E8A838", opacity: 0.7 }} />
                </div>
              );
            })}
          </div>
        </div>

        {/* ════ Section Title ════ */}
        <div className="section-title" style={{ fontSize: 14, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>
          <i className="fas fa-cubes"></i> App Services
        </div>

        {/* ════ Services Grid ════ */}
        <div className="services-grid">
          {services.map((svc, i) => (
            <div className="service-card" key={i}>
              <div className="service-icon" style={{ background: `${svc.color}22`, color: svc.color }}>
                <i className={svc.icon}></i>
              </div>
              <div className="service-name">{svc.name}</div>
              <div className="service-status online">
                <div className="service-status-dot" />
                {svc.label}
              </div>
              <div className="service-meta">{svc.meta}</div>
            </div>
          ))}
        </div>

        {/* ════ VPS Specs — Plan Toggle ════ */}
        <div className="vps-card">
          {/* Plan toggle tabs */}
          <div style={{
            display: "flex",
            background: "rgba(0,0,0,0.2)",
            borderRadius: "var(--radius-md)",
            padding: 4,
            marginBottom: 18,
            position: "relative",
          }}>
            <button
              onClick={() => !isUpgraded && setShowUpgrade(false)}
              style={{
                flex: 1,
                padding: "10px",
                border: "none",
                borderRadius: 10,
                background: !showUpgrade ? "var(--surface-elevated)" : "transparent",
                color: !showUpgrade ? "var(--text-primary)" : "var(--text-tertiary)",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.25s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <i className="fas fa-check-circle" style={{ color: "#4ADE80", fontSize: 11 }}></i>
              Current — {currentPlan.name}
            </button>
            <button
              onClick={() => setShowUpgrade(true)}
              style={{
                flex: 1,
                padding: "10px",
                border: "none",
                borderRadius: 10,
                background: showUpgrade ? "var(--surface-elevated)" : "transparent",
                color: showUpgrade ? "var(--text-primary)" : "var(--text-tertiary)",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.25s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <i className="fas fa-arrow-up" style={{ color: "var(--primary)", fontSize: 11 }}></i>
              Upgrade — {upgradePlan.name}
              {!isUpgraded && (
                <span style={{
                  fontSize: 9, padding: "2px 6px", borderRadius: 4,
                  background: "rgba(232,168,56,0.15)",
                  color: "var(--primary)",
                }}>NEW</span>
              )}
            </button>
          </div>

          {/* Header */}
          <div className="vps-header" style={{ marginBottom: 14 }}>
            <div className="vps-title">
              <i className="fas fa-server" style={{ color: "var(--primary)" }}></i>
              {showUpgrade && !isUpgraded ? `Upgrade to ${upgradePlan.name}` : isUpgraded ? upgradePlan.name : currentPlan.name}
            </div>
            <div className="vps-price">
              {activePlan.priceKES} <small>/mo ≈ {activePlan.priceEUR}</small>
            </div>
          </div>

          {/* Specs */}
          <div className="vps-grid" style={{ opacity: showUpgrade && !isUpgraded ? 0.6 : 1, transition: "opacity 0.3s" }}>
            <div className="vps-spec" style={{ borderColor: showUpgrade && !isUpgraded ? "rgba(232,168,56,0.2)" : undefined }}>
              <div className="vps-spec-icon"><i className="fas fa-microchip"></i></div>
              <div className="vps-spec-info">
                <div className="vps-spec-label">vCPU</div>
                <div className="vps-spec-value">{activePlan.cpu}</div>
              </div>
            </div>
            <div className="vps-spec">
              <div className="vps-spec-icon"><i className="fas fa-memory"></i></div>
              <div className="vps-spec-info">
                <div className="vps-spec-label">RAM</div>
                <div className="vps-spec-value">{activePlan.ram}</div>
              </div>
            </div>
            <div className="vps-spec">
              <div className="vps-spec-icon"><i className="fas fa-hard-drive"></i></div>
              <div className="vps-spec-info">
                <div className="vps-spec-label">Storage</div>
                <div className="vps-spec-value">{activePlan.storage}</div>
              </div>
            </div>
            <div className="vps-spec">
              <div className="vps-spec-icon"><i className="fas fa-wifi"></i></div>
              <div className="vps-spec-info">
                <div className="vps-spec-label">Port Speed</div>
                <div className="vps-spec-value">{activePlan.port}</div>
              </div>
            </div>
            <div className="vps-spec">
              <div className="vps-spec-icon"><i className="fas fa-infinity"></i></div>
              <div className="vps-spec-info">
                <div className="vps-spec-label">Traffic</div>
                <div className="vps-spec-value">{activePlan.traffic}</div>
              </div>
            </div>
            <div className="vps-spec">
              <div className="vps-spec-icon"><i className="fas fa-shield-halved"></i></div>
              <div className="vps-spec-info">
                <div className="vps-spec-label">Protection</div>
                <div className="vps-spec-value">{activePlan.protection}</div>
              </div>
            </div>
          </div>

          {/* Upgrade Confirmation Card */}
          {confirmingUpgrade && (
            <div style={{
              position: "fixed",
              inset: 0,
              zIndex: 9999,
              background: "rgba(0,0,0,0.85)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
            }}>
              <div style={{
                background: "var(--surface-card)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                padding: 24,
                maxWidth: 360,
                width: "100%",
                position: "relative",
              }}>
                {/* Close button */}
                <button
                  onClick={handleCancelUpgrade}
                  style={{
                    position: "absolute", top: 12, right: 12,
                    width: 32, height: 32,
                    borderRadius: "50%",
                    background: "var(--surface)",
                    border: "none",
                    color: "var(--text-tertiary)",
                    fontSize: 14,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <i className="fas fa-times"></i>
                </button>

                <div style={{ textAlign: "center", marginBottom: 20 }}>
                  <div style={{
                    width: 56, height: 56,
                    borderRadius: "50%",
                    background: "rgba(232,168,56,0.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 14px",
                    fontSize: 22,
                    color: "var(--primary)",
                  }}>
                    <i className="fas fa-arrow-up"></i>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>Upgrade to VPS M</div>
                  <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
                    {currentPlan.name} → {upgradePlan.name}
                  </div>
                </div>

                {/* Cost breakdown */}
                <div style={{
                  background: "rgba(0,0,0,0.15)",
                  borderRadius: "var(--radius-md)",
                  padding: 16,
                  marginBottom: 16,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
                    <span style={{ color: "var(--text-secondary)" }}>VPS S (current plan)</span>
                    <span style={{ color: "var(--text-secondary)" }}>KES {PLAN_PRICES["VPS S"].toLocaleString()}/mo</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
                    <span style={{ color: "var(--text-secondary)" }}>VPS M (upgrade)</span>
                    <span>KES {PLAN_PRICES["VPS M"].toLocaleString()}/mo</span>
                  </div>
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Already paid this period</span>
                    <span style={{ fontWeight: 600 }}>KES {paidThisPeriod.toLocaleString()}</span>
                  </div>
                  <div style={{
                    marginTop: 10,
                    padding: "10px 12px",
                    background: "rgba(232,168,56,0.1)",
                    borderRadius: "var(--radius-sm)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>Pay today</span>
                    <span style={{ fontWeight: 800, fontSize: 20, color: "var(--primary)" }}>
                      KES {upgradeCost.toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Action buttons */}
                <button
                  onClick={handleConfirmUpgrade}
                  disabled={upgrading}
                  style={{
                    width: "100%",
                    padding: "16px",
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    fontSize: 16,
                    fontWeight: 700,
                    cursor: upgrading ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    background: upgrading
                      ? "var(--surface-elevated)"
                      : "linear-gradient(135deg, var(--gradient-start), var(--gradient-end))",
                    color: "#fff",
                    opacity: upgrading ? 0.7 : 1,
                    transition: "all 0.2s",
                  }}
                >
                  {upgrading ? (
                    <><i className="fas fa-spinner fa-spin"></i> Processing payment…</>
                  ) : isUpgradeFree ? (
                    <><i className="fas fa-check-circle"></i> Confirm Upgrade</>
                  ) : (
                    <><i className="fas fa-lock"></i> Pay KES {upgradeCost.toLocaleString()} & Upgrade</>
                  )}
                </button>

                <button
                  onClick={handleCancelUpgrade}
                  disabled={upgrading}
                  style={{
                    width: "100%",
                    padding: "12px",
                    marginTop: 8,
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: upgrading ? "not-allowed" : "pointer",
                    background: "transparent",
                    color: "var(--text-tertiary)",
                    transition: "all 0.2s",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Upgrade CTA */}
          {showUpgrade && !isUpgraded && !confirmingUpgrade && (
            <>
              {/* Diff highlights */}
              <div style={{
                marginTop: 14,
                padding: 12,
                background: "rgba(232,168,56,0.06)",
                border: "1px solid rgba(232,168,56,0.15)",
                borderRadius: "var(--radius-sm)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--primary)", marginBottom: 2, display: "flex", alignItems: "center", gap: 5 }}>
                  <i className="fas fa-arrow-up"></i> What you get
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <span>+2 vCPU Cores</span>
                  <span>+32 GB RAM</span>
                  <span style={{ color: "var(--primary)", fontWeight: 600 }}>+KES 1,418/mo</span>
                </div>
              </div>

              <button
                onClick={handleUpgrade}
                disabled={upgrading}
                style={{
                  width: "100%",
                  marginTop: 14,
                  padding: "16px",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  fontSize: 16,
                  fontWeight: 700,
                  cursor: upgrading ? "not-allowed" : "pointer",
                  transition: "all 0.2s",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  background: "linear-gradient(135deg, var(--gradient-start), var(--gradient-end))",
                  color: "#fff",
                  opacity: upgrading ? 0.7 : 1,
                }}
              >
                {upgrading ? (
                  <><i className="fas fa-spinner fa-spin"></i> Upgrading server…</>
                ) : (
                  <><i className="fas fa-rocket"></i> Upgrade Now — {upgradePlan.priceKES}/mo</>
                )}
              </button>
            </>
          )}

          {/* Already upgraded banner */}
          {isUpgraded && (
            <div style={{
              marginTop: 14,
              padding: "12px 14px",
              background: "rgba(74,222,128,0.08)",
              border: "1px solid rgba(74,222,128,0.2)",
              borderRadius: "var(--radius-sm)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 13,
              color: "#4ADE80",
              fontWeight: 600,
            }}>
              <i className="fas fa-check-circle" style={{ fontSize: 18 }}></i>
              You are on the <strong style={{ margin: "0 4px" }}>{upgradePlan.name}</strong> plan
            </div>
          )}

          {/* Provider credit */}
          <div style={{
            marginTop: 16,
            paddingTop: 14,
            borderTop: "1px solid rgba(232,168,56,0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            fontSize: 12,
            color: "var(--text-tertiary)",
          }}>
            <img
              src="https://www.contabo.com/favicon.ico"
              alt="Contabo"
              style={{ width: 16, height: 16, borderRadius: 2, opacity: 0.5 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            Server provided by <strong style={{ color: "var(--text-secondary)", fontWeight: 600 }}>Contabo</strong>
          </div>
        </div>

        {/* ════ Event Log ════ */}
        <div className="events-card">
          <div className="events-title">
            <i className="fas fa-circle" style={{ fontSize: 8 }}></i>
            System Events
          </div>
          <div className="events-list">
            {events.slice().reverse().map((ev, i) => (
              <div className="events-item" key={i}>{ev}</div>
            ))}
          </div>
        </div>

      </div>
    </>
  );
}
