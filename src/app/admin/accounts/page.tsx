"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminBottomNav from "@/components/admin/AdminBottomNav";
import ToastBridge from "@/components/dashboard/ToastBridge";
import { hapticSuccess } from "@/lib/haptics";
import { Timestamp } from "firebase/firestore";
import { getAdminUsers } from "@/lib/users";
import type { UserProfile } from "@/lib/users";
import PremiumTopBar from "@/components/shared/PremiumTopBar";
import SubscriptionsTab from "@/components/admin/SubscriptionsTab";
import type { SubscriptionPayment } from "@/lib/subscriptions";

// ═══════════════════════════════════════════════
// Paystack Redirect Callback
// When the user pays on mobile (redirect flow), Paystack redirects back
// to this page with ?reference=xxx&trxref=yyy in the URL.
// We detect this and verify the payment.
// ═══════════════════════════════════════════════

interface PaystackPendingPayment {
  reference: string;
  planKey: string;
  amount: number;
  isTest: boolean;
  type: 'payment' | 'upgrade';
}

async function handlePaystackCallback(reference: string) {
  const pendingJson = sessionStorage.getItem('paystack_pending');
  if (!pendingJson) return;

  sessionStorage.removeItem('paystack_pending');
  let pending: PaystackPendingPayment;
  try {
    pending = JSON.parse(pendingJson);
  } catch { return; }

  try {
    // Call verify endpoint
    const res = await fetch('/api/paystack/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference }),
    });
    const verifyData = await res.json();

    if (!verifyData.verified) {
      window.dispatchEvent(new CustomEvent('show-toast', {
        detail: { title: 'Payment Failed', message: 'Could not verify payment. Please check your Paystack dashboard.', type: 'error', duration: 5000 },
      }));
      return;
    }

    // Record the payment to Firestore
    const { recordPayment, getSubscriptionStatus, getCurrentBillingPeriod } = await import('@/lib/subscriptions');
    const billingPeriod = getCurrentBillingPeriod();

    await recordPayment({
      reference: verifyData.reference || reference,
      amount: verifyData.amount || pending.amount,
      plan: pending.planKey as 'VPS S' | 'VPS M',
      status: 'paid',
      paidAt: Timestamp.now(),
      billingPeriod,
      email: 'admin@mountainofdeliverance.org',
      channel: verifyData.channel || 'paystack',
      church_id: process.env.NEXT_PUBLIC_CHURCH_ID || 'mountain_of_deliverance',
      isTest: pending.isTest,
    });

    // If upgrade, save the new plan
    if (pending.type === 'upgrade') {
      const { updatePlan } = await import('@/lib/subscriptions');
      await updatePlan('VPS M').catch(() => {});
    }

    // Refresh subscription status
    window.dispatchEvent(new CustomEvent('payments-refresh'));
    window.dispatchEvent(new CustomEvent('show-toast', {
      detail: { title: 'Payment Successful', message: `${pending.type === 'upgrade' ? 'Plan upgrade' : 'Subscription'} payment of KES ${pending.amount.toLocaleString()} confirmed`, type: 'success', duration: 5000 },
    }));

    // Reload the page to refresh all state
    setTimeout(() => {
      window.location.href = '/admin/accounts';
    }, 1500);
  } catch (err: any) {
    console.error('[Paystack callback] Error:', err);
    window.dispatchEvent(new CustomEvent('show-toast', {
      detail: { title: 'Verification Error', message: err.message || 'Could not verify payment after redirect', type: 'error', duration: 5000 },
    }));
  }
}

export default function AdminAccountsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"accounts" | "subscriptions">("accounts");
  const [admins, setAdmins] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const showToast = (title: string, message: string, type: string, duration: number) => {
    window.dispatchEvent(new CustomEvent("show-toast", { detail: { title, message, type, duration } }));
  };

  const loadAdmins = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getAdminUsers();
      setAdmins(data);
    } catch {
      showToast("Error", "Failed to load admin accounts", "error", 3000);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { setTimeout(() => loadAdmins(), 0); }, [loadAdmins]);

  // ════ Paystack Redirect Callback ════
  // After paying on mobile (Capacitor), Paystack redirects back to this page
  // with query params. Detect and verify the payment.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('reference') || params.get('trxref');
    if (ref) {
      // Clean up URL to prevent double-processing on re-render
      window.history.replaceState({}, '', '/admin/accounts');
      handlePaystackCallback(ref);
    }
  }, []);

  const handleCopyLink = async () => {
    const token = process.env.NEXT_PUBLIC_ADMIN_REG_TOKEN || "admin-secret-token";
    const baseUrl = window.location.origin;
    const link = `${baseUrl}/admin/register?token=${token}`;
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: "Invite Admin", text: link, url: link });
    } catch {
      try {
        const { Clipboard } = await import("@capacitor/clipboard");
        await Clipboard.write({ string: link });
      } catch {
        await navigator.clipboard.writeText(link).catch(() => {});
      }
      showToast("Link Copied", "Admin registration link copied to clipboard", "success", 2500);
    }
    await hapticSuccess();
  };

  function formatDate(ts: number | Timestamp | undefined): string {
    if (!ts) return "—";
    const d = typeof ts === "number" ? new Date(ts) : (ts as { toDate?: () => Date }).toDate?.() || new Date();
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  return (
    <>
      <style>{`
        :root {
            --primary: #E8A838;
            --primary-light: #F5C76B;
            --primary-dark: #C48A2A;
            --bg: #0F0F0F;
            --surface: #1A1A1A;
            --surface-elevated: #242424;
            --surface-card: #1E1E1E;
            --surface-hover: #2A2A2A;
            --text-primary: #FFFFFF;
            --text-secondary: #A0A0A0;
            --text-tertiary: #6B6B6B;
            --border: #2A2A2A;
            --error: #FF6B6B;
            --success: #4ADE80;
            --info: #38BDF8;
            --warning: #FBBF24;
            --overlay: rgba(0,0,0,0.92);
            --gradient-start: #E8A838;
            --gradient-end: #D4762A;
            --gradient-purple: #8B5CF6;
            --gradient-blue: #3B82F6;
            --gradient-red: #EF4444;
            --gradient-green: #22C55E;
            --shadow-soft: 0 4px 20px rgba(232,168,56,0.15);
            --shadow-elevated: 0 8px 32px rgba(0,0,0,0.5);
            --radius-sm: 12px;
            --radius-md: 16px;
            --radius-lg: 20px;
            --radius-xl: 24px;
            --radius-full: 50%;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            -webkit-tap-highlight-color: transparent;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        html, body {
            height: 100%;
            overflow: hidden;
            background: var(--bg);
            color: var(--text-primary);
        }

        .app-container {
            height: 100%;
            display: flex;
            flex-direction: column;
            position: relative;
            overflow: hidden;
        }

        @media (min-width: 480px) {
            .app-container {
                max-width: 480px;
                margin: 0 auto;
                border-left: 1px solid var(--border);
                border-right: 1px solid var(--border);
            }
        }

        .status-bar {
            height: env(safe-area-inset-top, 24px);
            min-height: 24px;
            background: var(--bg);
            flex-shrink: 0;
        }

        .header {
            padding: 8px 20px 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-shrink: 0;
            background: var(--bg);
            z-index: 100;
        }

        .header-back {
            width: 40px;
            height: 40px;
            border-radius: var(--radius-full);
            background: var(--surface);
            border: none;
            color: var(--text-primary);
            font-size: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .header-back:active {
            background: var(--surface-elevated);
            transform: scale(0.92);
        }

        .header-title {
            font-size: 20px;
            font-weight: 700;
        }

        .header-actions {
            display: flex;
            gap: 8px;
        }

        .header-btn {
            width: 40px;
            height: 40px;
            border-radius: var(--radius-full);
            background: var(--surface);
            border: none;
            color: var(--text-primary);
            font-size: 17px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .header-btn:active {
            background: var(--surface-elevated);
            transform: scale(0.92);
        }

        .content-scroll {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 0 16px 100px;
        }

        .invite-card {
            background: var(--surface-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 20px;
            margin-bottom: 20px;
        }

        .invite-title {
            font-size: 16px;
            font-weight: 700;
            margin-bottom: 6px;
        }

        .invite-desc {
            font-size: 13px;
            color: var(--text-secondary);
            line-height: 1.5;
            margin-bottom: 16px;
        }

        .btn-primary {
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
            border: none;
            border-radius: var(--radius-md);
            color: #fff;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .btn-primary:active {
            transform: scale(0.97);
            opacity: 0.9;
        }

        .section-title {
            font-size: 14px;
            font-weight: 700;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 12px;
        }

        .admin-card {
            background: var(--surface-card);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 14px;
            display: flex;
            align-items: center;
            gap: 14px;
            margin-bottom: 10px;
        }

        .admin-avatar {
            width: 44px;
            height: 44px;
            border-radius: var(--radius-full);
            background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            font-weight: 700;
            color: #fff;
            flex-shrink: 0;
        }

        .admin-info {
            flex: 1;
            min-width: 0;
        }

        .admin-name {
            font-size: 15px;
            font-weight: 600;
        }

        .admin-email {
            font-size: 12px;
            color: var(--text-tertiary);
            margin-top: 2px;
        }

        .admin-role-badge {
            padding: 3px 10px;
            border-radius: 8px;
            font-size: 11px;
            font-weight: 700;
            background: rgba(232,168,56,0.15);
            color: var(--primary);
        }

        .loading-shimmer {
            background: linear-gradient(90deg, var(--surface) 25%, var(--surface-elevated) 50%, var(--surface) 75%);
            background-size: 200% 100%;
            animation: shimmer 1.5s infinite;
            border-radius: var(--radius-sm);
        }

        @keyframes shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }

        .empty-state {
            text-align: center;
            padding: 40px 20px;
        }

        .empty-state-icon {
            font-size: 40px;
            color: var(--text-tertiary);
            margin-bottom: 12px;
        }

        .empty-state h3 {
            font-size: 17px;
            font-weight: 700;
            margin-bottom: 6px;
        }

        .empty-state p {
            font-size: 13px;
            color: var(--text-secondary);
        }
      `}</style>

      <div className="app-container">
        <PremiumTopBar
          showBack
          onBack={() => router.push("/admin")}
          title="Admin Accounts"
        />

        {/* ════ Tab Bar ════ */}
        <div style={{
          display: "flex",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          background: "var(--bg)",
          padding: "0 8px",
          gap: 0,
        }}>
          <button
            onClick={() => setActiveTab("accounts")}
            style={{
              flex: 1,
              padding: "12px 6px",
              background: "none",
              border: "none",
              color: activeTab === "accounts" ? "var(--primary)" : "var(--text-tertiary)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s ease",
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
            }}
          >
            <i className="fas fa-user-shield"></i>
            Accounts
            {activeTab === "accounts" && (
              <div style={{
                position: "absolute",
                bottom: 0,
                left: "15%",
                right: "15%",
                height: 3,
                background: "var(--primary)",
                borderRadius: "3px 3px 0 0",
              }} />
            )}
          </button>
          <button
            onClick={() => setActiveTab("subscriptions")}
            style={{
              flex: 1,
              padding: "12px 6px",
              background: "none",
              border: "none",
              color: activeTab === "subscriptions" ? "var(--primary)" : "var(--text-tertiary)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s ease",
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
            }}
          >
            <i className="fas fa-server"></i>
            Subscriptions
            {activeTab === "subscriptions" && (
              <div style={{
                position: "absolute",
                bottom: 0,
                left: "15%",
                right: "15%",
                height: 3,
                background: "var(--primary)",
                borderRadius: "3px 3px 0 0",
              }} />
            )}
          </button>
        </div>

        {activeTab === "accounts" ? (
        <div className="content-scroll">
          <div className="invite-card">
            <div className="invite-title"><i className="fas fa-link"></i> Invite New Admin</div>
            <div className="invite-desc">
              Generate a registration link to invite someone as an admin. The link is valid as long as the registration token stays the same.
            </div>
            <button className="btn-primary" onClick={handleCopyLink}>
              <i className="fas fa-copy"></i> Copy Invite Link
            </button>
          </div>

          <div className="section-title"><i className="fas fa-users"></i> Current Admins ({admins.length})</div>

          {loading ? (
            [...Array(3)].map((_, i) => (
              <div className="admin-card" key={i}>
                <div className="admin-avatar loading-shimmer" style={{ width: 44, height: 44 }} />
                <div className="admin-info">
                  <div className="loading-shimmer" style={{ width: "60%", height: 14, marginBottom: 6 }} />
                  <div className="loading-shimmer" style={{ width: "40%", height: 11 }} />
                </div>
              </div>
            ))
          ) : admins.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><i className="fas fa-user-shield"></i></div>
              <h3>No admin accounts</h3>
              <p>Invite someone to be an admin using the invite link above</p>
            </div>
          ) : (
            admins.map((admin) => (
              <div className="admin-card" key={admin.uid}>
                <div className="admin-avatar">
                  {admin.display_name?.charAt(0).toUpperCase() || "A"}
                </div>
                <div className="admin-info">
                  <div className="admin-name">{admin.display_name || "Unknown"}</div>
                  <div className="admin-email">{admin.email} · Joined {formatDate(admin.created_at)}</div>
                </div>
                <div className="admin-role-badge">Admin</div>
              </div>
            ))
          )}
        </div>
        ) : (
          <div className="content-scroll">
            <SubscriptionsTab />
          </div>
        )}
      </div>

      <AdminBottomNav />
      <ToastBridge />
    </>
  );
}