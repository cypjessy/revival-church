"use client";

import { useState, useEffect, useCallback } from "react";
import AdminBottomNav from "@/components/admin/AdminBottomNav";
import ToastBridge from "@/components/dashboard/ToastBridge";
import { hapticSuccess } from "@/lib/haptics";
import AllMembersList from "@/components/admin/AllMembersList";
import { getUsersPage } from "@/lib/users";
import type { UserProfile } from "@/lib/users";
import type { DocumentSnapshot } from "firebase/firestore";

export default function AdminMembersPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);

  const showToast = (title: string, message: string, type: string, duration: number) => {
    window.dispatchEvent(new CustomEvent("show-toast", { detail: { title, message, type, duration } }));
  };

  const loadPage = useCallback(async (cursor?: DocumentSnapshot | null) => {
    try {
      setLoading(true);
      const { users: newUsers, lastDoc: newLastDoc } = await getUsersPage(20, cursor || undefined);
      setUsers((prev) => cursor ? [...prev, ...newUsers] : newUsers);
      setLastDoc(newLastDoc);
    } catch (e) {
      console.error("Failed to load users:", e);
      showToast("Error", "Failed to load members", "error", 3000);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { setTimeout(() => loadPage(), 0); }, [loadPage]);

  const loadMore = async () => {
    if (lastDoc) await loadPage(lastDoc);
  };

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
            -webkit-overflow-scrolling: touch;
            padding-bottom: 100px;
        }

        .content-scroll::-webkit-scrollbar {
            display: none;
        }

        .member-list {
            padding: 0 20px;
        }

        .member-item {
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 14px 0;
            border-bottom: 1px solid var(--border);
            cursor: pointer;
            transition: opacity 0.2s ease;
            position: relative;
        }

        .member-item:last-child {
            border-bottom: none;
        }

        .member-item:active {
            opacity: 0.6;
        }

        .member-avatar {
            width: 48px;
            height: 48px;
            border-radius: var(--radius-full);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            font-weight: 700;
            color: #fff;
            flex-shrink: 0;
            position: relative;
        }

        .member-avatar img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            border-radius: var(--radius-full);
        }

        .member-info {
            flex: 1;
            min-width: 0;
        }

        .member-name {
            font-size: 15px;
            font-weight: 600;
            margin-bottom: 3px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .member-role {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            padding: 2px 8px;
            border-radius: 10px;
            flex-shrink: 0;
        }

        .member-role.admin {
            background: rgba(232,168,56,0.12);
            color: var(--primary);
        }

        .member-role.member {
            background: rgba(74,222,128,0.12);
            color: var(--gradient-green);
        }

        .member-meta {
            font-size: 13px;
            color: var(--text-secondary);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .member-meta .dot {
            width: 3px;
            height: 3px;
            background: var(--text-tertiary);
            border-radius: var(--radius-full);
        }

        .section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px 10px;
        }

        .section-title {
            font-size: 15px;
            font-weight: 700;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .section-count {
            font-size: 13px;
            color: var(--text-tertiary);
            font-weight: 600;
        }

        .search-filter {
            padding: 0 20px 16px;
            display: flex;
            gap: 10px;
            flex-shrink: 0;
        }

        .search-input-wrapper {
            flex: 1;
            position: relative;
            background: var(--surface);
            border: 1.5px solid var(--border);
            border-radius: var(--radius-md);
            display: flex;
            align-items: center;
            transition: all 0.25s ease;
        }

        .search-input-wrapper:focus-within {
            border-color: var(--primary);
            background: var(--surface-elevated);
            box-shadow: 0 0 0 4px rgba(232,168,56,0.08);
        }

        .search-input-wrapper i {
            position: absolute;
            left: 14px;
            color: var(--text-tertiary);
            font-size: 15px;
        }

        .search-input-wrapper input {
            width: 100%;
            padding: 12px 14px 12px 42px;
            background: transparent;
            border: none;
            outline: none;
            color: var(--text-primary);
            font-size: 14px;
            font-weight: 500;
        }

        .search-input-wrapper input::placeholder {
            color: var(--text-tertiary);
            font-weight: 400;
        }

        .skel { background: linear-gradient(90deg, var(--surface) 25%, var(--surface-hover) 50%, var(--surface) 75%); background-size: 200% 100%; animation: sk-shimmer 1.4s ease-in-out infinite; border-radius: 8px; }
        @keyframes sk-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        .skel-line { height: 13px; margin-bottom: 7px; width: 100%; }
        .skel-line.w60 { width: 60%; }
        .skel-line.w40 { width: 40%; }

        .detail-modal-overlay {
            position: fixed;
            inset: 0;
            background: var(--overlay);
            z-index: 9000;
            display: flex;
            align-items: flex-end;
            justify-content: center;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.3s ease, visibility 0.3s ease;
        }

        .detail-modal-overlay.active {
            opacity: 1;
            visibility: visible;
        }

        .detail-modal-sheet {
            width: 100%;
            max-width: 480px;
            background: var(--surface);
            border-radius: 28px 28px 0 0;
            padding: 0 0 env(safe-area-inset-bottom, 20px);
            transform: translateY(100%);
            transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1);
            max-height: 88vh;
            display: flex;
            flex-direction: column;
        }

        .detail-modal-overlay.active .detail-modal-sheet {
            transform: translateY(0);
        }

        .detail-modal-handle {
            width: 40px;
            height: 5px;
            background: var(--text-tertiary);
            border-radius: 3px;
            margin: 12px auto 8px;
            opacity: 0.5;
        }

        .detail-header {
            padding: 8px 24px 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
        }

        .detail-avatar {
            width: 80px;
            height: 80px;
            border-radius: var(--radius-full);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 28px;
            font-weight: 700;
            color: #fff;
            margin-bottom: 14px;
        }

        .detail-name {
            font-size: 20px;
            font-weight: 700;
            margin-bottom: 4px;
        }

        .detail-email {
            font-size: 14px;
            color: var(--text-secondary);
            margin-bottom: 8px;
        }

        .detail-role {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            padding: 5px 14px;
            border-radius: 20px;
        }

        .detail-role.admin { background: rgba(232,168,56,0.12); color: var(--primary); }
        .detail-role.member { background: rgba(74,222,128,0.12); color: var(--gradient-green); }

        .detail-body {
            flex: 1;
            overflow-y: auto;
            padding: 0 24px 20px;
        }

        .detail-body::-webkit-scrollbar { display: none; }

        .detail-section {
            margin-bottom: 20px;
        }

        .detail-section-title {
            font-size: 12px;
            font-weight: 700;
            color: var(--text-tertiary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 10px;
        }

        .detail-row {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 0;
            border-bottom: 1px solid var(--border);
        }

        .detail-row:last-child { border-bottom: none; }

        .detail-icon {
            width: 36px;
            height: 36px;
            border-radius: var(--radius-sm);
            background: var(--surface-elevated);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 15px;
            color: var(--text-secondary);
            flex-shrink: 0;
        }

        .detail-content { flex: 1; }

        .detail-label {
            font-size: 12px;
            color: var(--text-tertiary);
            margin-bottom: 2px;
        }

        .detail-value {
            font-size: 14px;
            font-weight: 600;
        }

        .bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; background: rgba(15,15,15,0.92); backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%); border-top: 1px solid var(--border); padding: 8px 0 calc(8px + env(safe-area-inset-bottom, 0px)); z-index: 1000; display: flex; justify-content: space-around; align-items: center; }
        @media (min-width: 480px) { .bottom-nav { max-width: 480px; margin: 0 auto; } }
        .nav-item { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 12px; background: none; border: none; color: var(--text-tertiary); cursor: pointer; transition: all 0.2s ease; position: relative; }
        .nav-item.active { color: var(--primary); }
        .nav-item i { font-size: 20px; transition: transform 0.2s ease; }
        .nav-item:active i { transform: scale(0.85); }
        .nav-item span { font-size: 10px; font-weight: 600; }
        .nav-item .nav-badge { position: absolute; top: 2px; right: 6px; width: 8px; height: 8px; background: var(--error); border-radius: var(--radius-full); border: 2px solid var(--bg); }
      `}</style>

      <ToastBridge />

      <div className="app-container">
        <div className="status-bar"></div>

        <header className="header">
          <button className="header-back" onClick={() => window.history.back()}><i className="fas fa-arrow-left"></i></button>
          <h1 className="header-title">Members</h1>
          <div className="header-actions">
            <span className="section-count">{users.length} loaded</span>
          </div>
        </header>

        <div className="search-filter">
          <div className="search-input-wrapper">
            <i className="fas fa-magnifying-glass"></i>
            <input type="text" placeholder="Filter by name or email..." id="searchInput" />
          </div>
        </div>

        <div className="content-scroll">
          <AllMembersList
            users={users}
            loading={loading}
            hasMore={!!lastDoc}
            onLoadMore={loadMore}
            onSelectUser={setSelectedUser}
          />
          <div style={{ height: 100 }}></div>
        </div>

        <AdminBottomNav />
      </div>

      {/* User Detail Modal */}
      <div
        className={`detail-modal-overlay ${selectedUser ? "active" : ""}`}
        onClick={() => setSelectedUser(null)}
      >
        <div className="detail-modal-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="detail-modal-handle"></div>
          {selectedUser && (
            <>
              <div className="detail-header">
                <div className="detail-avatar" style={{ background: "linear-gradient(135deg, var(--gradient-start), var(--gradient-end))" }}>
                  {selectedUser.display_name?.charAt(0).toUpperCase() || "?"}
                </div>
                <div className="detail-name">{selectedUser.display_name}</div>
                <div className="detail-email">{selectedUser.email}</div>
                <div className={`detail-role ${selectedUser.role}`}>
                  {selectedUser.role.charAt(0).toUpperCase() + selectedUser.role.slice(1)}
                </div>
              </div>
              <div className="detail-body">
                <div className="detail-section">
                  <div className="detail-section-title">Contact</div>
                  {selectedUser.phone && (
                    <div className="detail-row">
                      <div className="detail-icon"><i className="fas fa-phone"></i></div>
                      <div className="detail-content">
                        <div className="detail-label">Phone</div>
                        <div className="detail-value">{selectedUser.phone}</div>
                      </div>
                    </div>
                  )}
                  <div className="detail-row">
                    <div className="detail-icon"><i className="fas fa-envelope"></i></div>
                    <div className="detail-content">
                      <div className="detail-label">Email</div>
                      <div className="detail-value">{selectedUser.email}</div>
                    </div>
                  </div>
                </div>
                <div className="detail-section">
                  <div className="detail-section-title">Activity</div>
                  <div className="detail-row">
                    <div className="detail-icon"><i className="fas fa-calendar"></i></div>
                    <div className="detail-content">
                      <div className="detail-label">Joined</div>
                      <div className="detail-value">
                        {selectedUser.created_at
                          ? new Date(
                              typeof selectedUser.created_at === "number"
                                ? selectedUser.created_at
                                : selectedUser.created_at.seconds * 1000
                            ).toLocaleDateString()
                          : "Unknown"}
                      </div>
                    </div>
                  </div>
                  <div className="detail-row">
                    <div className="detail-icon"><i className="fas fa-circle"></i></div>
                    <div className="detail-content">
                      <div className="detail-label">Verified</div>
                      <div className="detail-value">
                        {selectedUser.is_verified ? "Yes" : "No"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
