"use client";

import { useState, useEffect, useCallback } from "react";
import AdminBottomNav from "@/components/admin/AdminBottomNav";
import ToastBridge from "@/components/dashboard/ToastBridge";
import { useAppStore } from "@/lib/useAppStore";
import { getMeetings, createMeeting, updateMeeting, deleteMeeting, generateRoomName } from "@/lib/meetings";
import type { Meeting } from "@/lib/meetings";
import { hapticSuccess } from "@/lib/haptics";

const statusOptions = [
  { value: "scheduled", label: "Scheduled" },
  { value: "active", label: "Active" },
  { value: "ended", label: "Ended" },
];

export default function AdminMeetingsPage() {
  const userDoc = useAppStore((s) => s.userDoc);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const defaultDate = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    title: "",
    description: "",
    date: defaultDate,
    startTime: "19:00",
    endTime: "20:00",
    maxParticipants: 10,
    status: "scheduled" as Meeting["status"],
  });

  function showToast(title: string, message: string, type: string, duration: number) {
    window.dispatchEvent(new CustomEvent("show-toast", { detail: { title, message, type, duration } }));
  }

  const loadMeetings = useCallback(async () => {
    try {
      const data = await getMeetings();
      setMeetings(data);
    } catch (e) {
      console.error("Failed to load meetings:", e);
      showToast("Error", "Failed to load meetings", "error", 3000);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { setTimeout(() => loadMeetings(), 0); }, [loadMeetings]);

  const resetForm = () => {
    setForm({
      title: "",
      description: "",
      date: defaultDate,
      startTime: "19:00",
      endTime: "20:00",
      maxParticipants: 10,
      status: "scheduled",
    });
    setEditId(null);
    setShowCreate(false);
  };

  const openEdit = (m: Meeting) => {
    setForm({
      title: m.title,
      description: m.description,
      date: m.date,
      startTime: m.startTime,
      endTime: m.endTime,
      maxParticipants: m.maxParticipants,
      status: m.status,
    });
    setEditId(m.id || null);
    setShowCreate(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      showToast("Validation", "Meeting title is required", "error", 2500);
      return;
    }
    if (!form.date || !form.startTime || !form.endTime) {
      showToast("Validation", "Date and time are required", "error", 2500);
      return;
    }

    setActionLoading(true);
    try {
      if (editId) {
        await updateMeeting(editId, {
          title: form.title,
          description: form.description,
          date: form.date,
          startTime: form.startTime,
          endTime: form.endTime,
          maxParticipants: form.maxParticipants,
          status: form.status,
        });
        showToast("Updated", `"${form.title}" saved`, "success", 2500);
      } else {
        const newId = await createMeeting({
          title: form.title,
          description: form.description,
          date: form.date,
          startTime: form.startTime,
          endTime: form.endTime,
          roomName: generateRoomName("pending"),
          hostId: userDoc?.uid || "admin",
          hostName: userDoc?.display_name || "Admin",
          status: "scheduled",
          maxParticipants: form.maxParticipants,
        });
        // Update room name with real ID
        await updateMeeting(newId, { roomName: generateRoomName(newId) });
        showToast("Created", `"${form.title}" meeting created`, "success", 2500);
      }
      await hapticSuccess();
      resetForm();
      await loadMeetings();
    } catch (e) {
      showToast("Error", editId ? "Failed to update meeting" : "Failed to create meeting", "error", 3000);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (id: string, title: string) => {
    setActionLoading(true);
    try {
      await deleteMeeting(id);
      setMeetings((prev) => prev.filter((m) => m.id !== id));
      showToast("Deleted", `"${title}" removed`, "success", 2500);
      await hapticSuccess();
    } catch (e) {
      showToast("Error", "Failed to delete meeting", "error", 3000);
    } finally {
      setActionLoading(false);
      setDeleteConfirm(null);
    }
  };

  const toggleStatus = async (m: Meeting) => {
    const nextStatus = m.status === "scheduled" ? "active" : m.status === "active" ? "ended" : "scheduled";
    try {
      await updateMeeting(m.id!, { status: nextStatus as Meeting["status"] });
      setMeetings((prev) => prev.map((x) => x.id === m.id ? { ...x, status: nextStatus as Meeting["status"] } : x));
      showToast(
        nextStatus === "active" ? "Meeting Started" : nextStatus === "ended" ? "Meeting Ended" : "Meeting Reset",
        `"${m.title}" is now ${nextStatus}`,
        "success",
        2500
      );
      await hapticSuccess();
    } catch (e) {
      showToast("Error", "Failed to update status", "error", 3000);
    }
  };

  const formatTime = (date: string, startTime: string, endTime: string) => {
    const fmt = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      const ampm = h >= 12 ? "PM" : "AM";
      const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
      return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
    };
    return `${fmt(startTime)} — ${fmt(endTime)}`;
  };

  const isToday = (date: string) => date === new Date().toISOString().slice(0, 10);

  // Separate meetings into upcoming and past
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = meetings.filter((m) => m.date >= today && m.status !== "ended");
  const past = meetings.filter((m) => m.date < today || m.status === "ended");

  return (
    <>
      <style>{`
        :root { --primary: #E8A838; --primary-light: #F5C76B; --primary-dark: #C48A2A; --bg: #0F0F0F; --surface: #1A1A1A; --surface-elevated: #242424; --surface-card: #1E1E1E; --surface-hover: #2A2A2A; --text-primary: #FFFFFF; --text-secondary: #A0A0A0; --text-tertiary: #6B6B6B; --border: #2A2A2A; --error: #FF6B6B; --success: #4ADE80; --info: #38BDF8; --warning: #FBBF24; --overlay: rgba(0,0,0,0.92); --gradient-start: #E8A838; --gradient-end: #D4762A; --gradient-purple: #8B5CF6; --gradient-blue: #3B82F6; --gradient-green: #22C55E; --gradient-red: #EF4444; --shadow-soft: 0 4px 20px rgba(232,168,56,0.15); --shadow-elevated: 0 8px 32px rgba(0,0,0,0.5); --radius-sm: 10px; --radius-md: 14px; --radius-lg: 18px; --radius-xl: 22px; --radius-full: 50%; }
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; }
        html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--text-primary); }
        .app-container { height: 100%; display: flex; flex-direction: column; position: relative; overflow: hidden; }
        @media (min-width: 480px) { .app-container { max-width: 480px; margin: 0 auto; border-left: 1px solid var(--border); border-right: 1px solid var(--border); } }
        .status-bar { height: env(safe-area-inset-top, 24px); min-height: 24px; background: var(--bg); flex-shrink: 0; }

        .header { padding: 10px 16px 8px; display: flex; align-items: center; gap: 12px; flex-shrink: 0; background: var(--bg); border-bottom: 1px solid var(--border); }
        .header-logo { width: 38px; height: 38px; background: linear-gradient(135deg, var(--gradient-blue), #2563EB); border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(59,130,246,0.2); }
        .header-logo i { font-size: 16px; color: #fff; }
        .header-info { flex: 1; min-width: 0; }
        .header-title { font-size: 15px; font-weight: 700; line-height: 1.2; display: flex; align-items: center; gap: 8px; }
        .header-count { font-size: 12px; color: var(--text-tertiary); font-weight: 500; }

        .content-scroll { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: 100px; }
        .content-scroll::-webkit-scrollbar { display: none; }

        .toolbar { display: flex; align-items: center; gap: 10px; padding: 12px 16px; flex-shrink: 0; background: var(--bg); }
        .create-btn { display: flex; align-items: center; gap: 6px; padding: 10px 16px; background: linear-gradient(135deg, var(--gradient-blue), #2563EB); border: none; border-radius: var(--radius-md); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 12px rgba(59,130,246,0.2); transition: all 0.2s ease; white-space: nowrap; }
        .create-btn:active { transform: scale(0.95); }
        .create-btn i { font-size: 14px; }

        .section-label { font-size: 12px; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; padding: 0 16px; margin-bottom: 8px; }

        .meetings-list { padding: 0 16px; display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
        .meeting-card { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; transition: all 0.2s ease; }
        .meeting-card:active { transform: scale(0.98); }
        .meeting-card.active { border-color: var(--success); box-shadow: 0 0 0 1px rgba(74,222,128,0.2); }
        .meeting-card.ended { opacity: 0.6; }

        .meeting-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
        .meeting-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .meeting-info { flex: 1; min-width: 0; }
        .meeting-title { font-size: 15px; font-weight: 700; line-height: 1.3; display: flex; align-items: center; gap: 8px; }
        .meeting-title .live-tag { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px; font-size: 10px; font-weight: 700; background: rgba(74,222,128,0.15); color: var(--success); text-transform: uppercase; letter-spacing: 0.5px; }
        .meeting-title .live-tag i { font-size: 6px; }
        .meeting-desc { font-size: 13px; color: var(--text-secondary); margin-top: 4px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .meeting-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
        .meta-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; background: var(--surface-elevated); color: var(--text-secondary); }
        .meta-chip i { font-size: 11px; color: var(--primary); }
        .meeting-actions { display: flex; gap: 6px; flex-shrink: 0; align-self: flex-start; }
        .meeting-action-btn { width: 30px; height: 30px; border-radius: 8px; border: none; background: var(--surface); color: var(--text-tertiary); font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease; }
        .meeting-action-btn:active { background: var(--surface-hover); }
        .meeting-action-btn.edit:active { color: var(--primary); }
        .meeting-action-btn.delete:active { color: var(--error); }
        .meeting-action-btn.status { background: rgba(74,222,128,0.1); color: var(--success); }
        .meeting-action-btn.status.end { background: rgba(107,107,107,0.1); color: var(--text-tertiary); }

        .meeting-status-row { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-top: 1px solid var(--border); }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .status-dot.scheduled { background: var(--text-tertiary); }
        .status-dot.active { background: var(--success); animation: livePulse 1.5s ease-in-out infinite; }
        .status-dot.ended { background: var(--error); }
        .status-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
        .status-btn { margin-left: auto; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; border: none; cursor: pointer; transition: all 0.15s ease; }
        .status-btn:active { transform: scale(0.95); }
        .status-btn.go { background: var(--success); color: #fff; }
        .status-btn.end-btn { background: rgba(239,68,68,0.12); color: var(--error); }
        .status-btn.reset { background: var(--surface-elevated); color: var(--text-tertiary); }
        .status-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        @keyframes livePulse { 0%,100% { opacity:1;transform:scale(1); } 50% { opacity:0.4;transform:scale(1.5); } }

        .empty-state { display: flex; flex-direction: column; align-items: center; padding: 60px 20px; text-align: center; gap: 10px; }
        .empty-state i { font-size: 40px; color: var(--text-tertiary); opacity: 0.3; }
        .empty-state h3 { font-size: 18px; font-weight: 700; }
        .empty-state p { font-size: 14px; color: var(--text-secondary); max-width: 280px; line-height: 1.5; }

        /* Create/Edit Form */
        .form-sheet { position: fixed; bottom: 0; left: 0; right: 0; z-index: 9001; background: var(--surface); border-radius: 28px 28px 0 0; max-width: 480px; margin: 0 auto; animation: slideUp 0.35s cubic-bezier(0.32,0.72,0,1); max-height: 90vh; display: flex; flex-direction: column; }
        .form-overlay { position: fixed; inset: 0; background: var(--overlay); z-index: 9000; }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .form-handle { width: 40px; height: 5px; background: var(--text-tertiary); border-radius: 3px; margin: 12px auto 8px; opacity: 0.5; }
        .form-header { padding: 8px 24px 16px; text-align: center; }
        .form-header h2 { font-size: 20px; font-weight: 700; }
        .form-body { flex: 1; overflow-y: auto; padding: 0 24px 20px; }
        .form-body::-webkit-scrollbar { display: none; }
        .form-footer { padding: 16px 24px; border-top: 1px solid var(--border); display: flex; gap: 12px; }

        .form-group { margin-bottom: 14px; }
        .form-group label { display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
        .form-input, .form-select { width: 100%; padding: 12px 14px; background: var(--surface-card); border: 1.5px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); font-size: 14px; outline: none; }
        .form-input:focus, .form-select:focus { border-color: var(--primary); }
        .form-input::placeholder { color: var(--text-tertiary); }
        .form-select { appearance: none; -webkit-appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' fill='%236B6B6B' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 36px; }
        .form-textarea { width: 100%; padding: 12px 14px; background: var(--surface-card); border: 1.5px solid var(--border); border-radius: var(--radius-md); color: var(--text-primary); font-size: 14px; outline: none; resize: vertical; min-height: 70px; font-family: inherit; }
        .form-textarea:focus { border-color: var(--primary); }
        .form-row { display: flex; gap: 12px; }
        .form-row .form-group { flex: 1; }
        .form-row-3 { display: flex; gap: 8px; }
        .form-row-3 .form-group { flex: 1; }

        .form-input[type="date"]::-webkit-calendar-picker-indicator,
        .form-input[type="time"]::-webkit-calendar-picker-indicator { filter: invert(0.7); cursor: pointer; }

        .btn-primary { flex: 1; padding: 14px; background: linear-gradient(135deg, var(--gradient-blue), #2563EB); border: none; border-radius: var(--radius-md); color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .btn-primary:active { transform: scale(0.97); }
        .btn-primary:disabled { opacity: 0.6; }
        .btn-secondary { flex: 1; padding: 14px; background: var(--surface-elevated); border: none; border-radius: var(--radius-md); color: var(--text-secondary); font-size: 15px; font-weight: 700; cursor: pointer; }
        .btn-secondary:active { transform: scale(0.97); }

        /* Delete Confirm */
        .delete-overlay { position: fixed; inset: 0; background: var(--overlay); z-index: 9500; display: flex; align-items: center; justify-content: center; padding: 24px; }
        .delete-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-xl); padding: 24px; max-width: 340px; width: 100%; text-align: center; }
        .delete-card h3 { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
        .delete-card p { font-size: 14px; color: var(--text-secondary); margin-bottom: 20px; line-height: 1.5; }
        .delete-actions { display: flex; gap: 10px; }
        .delete-confirm { flex: 1; padding: 12px; border-radius: var(--radius-md); background: var(--error); border: none; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; }
        .delete-confirm:active { transform: scale(0.95); }
        .delete-cancel { flex: 1; padding: 12px; border-radius: var(--radius-md); background: var(--surface-elevated); border: none; color: var(--text-secondary); font-size: 14px; font-weight: 700; cursor: pointer; }
        .delete-cancel:active { transform: scale(0.95); }

        /* Skeleton */
        .skeleton-loading { background: linear-gradient(90deg, var(--surface) 25%, var(--surface-hover) 50%, var(--surface) 75%); background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite; border-radius: var(--radius-md); }
        .skeleton-line { height: 14px; width: 100%; margin-bottom: 8px; }
        .skeleton-line.w60 { width: 60%; }
        .skeleton-line.w40 { width: 40%; }
        .skeleton-line.w80 { width: 80%; }
        .skeleton-line.h24 { height: 24px; }
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

        /* ========== BOTTOM NAV ========== */
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

        {/* HEADER */}
        <header className="header">
          <div className="header-logo"><i className="fas fa-people-group"></i></div>
          <div className="header-info">
            <div className="header-title">Meetings</div>
            <div className="header-count">{meetings.length} total meetings</div>
          </div>
        </header>

        {/* TOOLBAR */}
        <div className="toolbar">
          <button className="create-btn" onClick={() => { resetForm(); setShowCreate(true); }}>
            <i className="fas fa-plus"></i> Schedule Meeting
          </button>
        </div>

        {/* SCROLLABLE CONTENT */}
        <div className="content-scroll">
          {loading ? (
            <div style={{ padding: "0 16px" }}>
              {[1,2,3].map((i) => (
                <div key={i} className="meeting-card" style={{ padding: 14, marginBottom: 10 }}>
                  <div className="skeleton-loading skeleton-line w60 h24" style={{ marginBottom: 8 }}></div>
                  <div className="skeleton-loading skeleton-line w80" style={{ marginBottom: 6 }}></div>
                  <div className="skeleton-loading skeleton-line w40"></div>
                </div>
              ))}
            </div>
          ) : meetings.length === 0 ? (
            <div className="empty-state">
              <i className="fas fa-people-group"></i>
              <h3>No Meetings Yet</h3>
              <p>Schedule your first audio meeting for members to join and pray together.</p>
            </div>
          ) : (
            <>
              {/* UPCOMING */}
              {upcoming.length > 0 && (
                <>
                  <div className="section-label" style={{ marginTop: 8 }}>Upcoming ({upcoming.length})</div>
                  <div className="meetings-list">
                    {upcoming.map((m) => (
                      <div key={m.id} className={`meeting-card ${m.status === "active" ? "active" : ""}`}>
                        <div className="meeting-body">
                          <div className="meeting-top">
                            <div className="meeting-info">
                              <div className="meeting-title">
                                {m.title}
                                {m.status === "active" && <span className="live-tag"><i className="fas fa-circle"></i> Live</span>}
                              </div>
                              {m.description && <div className="meeting-desc">{m.description}</div>}
                              <div className="meeting-meta">
                                <span className="meta-chip">
                                  <i className="fas fa-calendar"></i>
                                  {isToday(m.date) ? "Today" : new Date(m.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                </span>
                                <span className="meta-chip">
                                  <i className="fas fa-clock"></i>
                                  {formatTime(m.date, m.startTime, m.endTime)}
                                </span>
                                <span className="meta-chip">
                                  <i className="fas fa-users"></i>
                                  {m.maxParticipants} max
                                </span>
                              </div>
                            </div>
                            <div className="meeting-actions">
                              <button className="meeting-action-btn edit" onClick={() => openEdit(m)} title="Edit"><i className="fas fa-pen"></i></button>
                              <button className="meeting-action-btn delete" onClick={() => setDeleteConfirm(m.id || null)} title="Delete"><i className="fas fa-trash-can"></i></button>
                            </div>
                          </div>
                        </div>
                        <div className="meeting-status-row">
                          <div className={`status-dot ${m.status}`}></div>
                          <span className="status-label">{m.status}</span>
                          <button
                            className={`status-btn ${m.status === "scheduled" ? "go" : m.status === "active" ? "end-btn" : "reset"}`}
                            onClick={() => toggleStatus(m)}
                            disabled={actionLoading}
                          >
                            {actionLoading ? (
                              <i className="fas fa-spinner fa-spin"></i>
                            ) : m.status === "scheduled" ? (
                              "Start Meeting"
                            ) : m.status === "active" ? (
                              "End Meeting"
                            ) : (
                              "Reset"
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* PAST */}
              {past.length > 0 && (
                <>
                  <div className="section-label" style={{ marginTop: 8 }}>Past ({past.length})</div>
                  <div className="meetings-list">
                    {past.map((m) => (
                      <div key={m.id} className="meeting-card ended">
                        <div className="meeting-body">
                          <div className="meeting-top">
                            <div className="meeting-info">
                              <div className="meeting-title">{m.title}</div>
                              {m.description && <div className="meeting-desc">{m.description}</div>}
                              <div className="meeting-meta">
                                <span className="meta-chip"><i className="fas fa-calendar"></i>{new Date(m.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                                <span className="meta-chip"><i className="fas fa-clock"></i>{formatTime(m.date, m.startTime, m.endTime)}</span>
                              </div>
                            </div>
                            <div className="meeting-actions">
                              <button className="meeting-action-btn edit" onClick={() => openEdit(m)} title="Edit"><i className="fas fa-pen"></i></button>
                              <button className="meeting-action-btn delete" onClick={() => setDeleteConfirm(m.id || null)} title="Delete"><i className="fas fa-trash-can"></i></button>
                            </div>
                          </div>
                        </div>
                        <div className="meeting-status-row">
                          <div className="status-dot ended"></div>
                          <span className="status-label">ended</span>
                          <button className="status-btn reset" onClick={() => toggleStatus(m)} disabled={actionLoading}>
                            {actionLoading ? <i className="fas fa-spinner fa-spin"></i> : "Reset"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div style={{ height: 40 }}></div>
            </>
          )}
        </div>

        <AdminBottomNav />
      </div>

      {/* CREATE/EDIT FORM MODAL */}
      {showCreate && (
        <>
          <div className="form-overlay" onClick={resetForm}></div>
          <div className="form-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="form-handle"></div>
            <div className="form-header"><h2>{editId ? "Edit Meeting" : "Schedule Meeting"}</h2></div>
            <div className="form-body">
              <div className="form-group"><label>Title</label><input type="text" className="form-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Sunday Prayer Meeting" /></div>
              <div className="form-group"><label>Description</label><textarea className="form-textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe what this meeting is about..." /></div>
              <div className="form-row">
                <div className="form-group"><label>Date</label><input type="date" className="form-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
                <div className="form-group"><label>Max Participants</label><input type="number" className="form-input" value={form.maxParticipants} onChange={(e) => setForm({ ...form, maxParticipants: parseInt(e.target.value) || 1 })} min="1" max="100" /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Start Time</label><input type="time" className="form-input" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></div>
                <div className="form-group"><label>End Time</label><input type="time" className="form-input" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></div>
              </div>
              {editId && (
                <div className="form-group"><label>Status</label><select className="form-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Meeting["status"] })}>{statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              )}
            </div>
            <div className="form-footer">
              <button className="btn-secondary" onClick={resetForm}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} disabled={actionLoading}>
                {actionLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-check"></i>}
                {editId ? "Save Changes" : "Create Meeting"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* DELETE CONFIRM */}
      {deleteConfirm && (
        <div className="delete-overlay">
          <div className="delete-card">
            <h3>Delete Meeting?</h3>
            <p>This will permanently remove this meeting. Members will no longer be able to join.</p>
            <div className="delete-actions">
              <button className="delete-cancel" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="delete-confirm" onClick={() => {
                const m = meetings.find((x) => x.id === deleteConfirm);
                if (m) handleDelete(deleteConfirm, m.title);
              }} disabled={actionLoading}>
                {actionLoading ? <i className="fas fa-spinner fa-spin"></i> : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
