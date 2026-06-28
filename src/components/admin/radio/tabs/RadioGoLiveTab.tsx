"use client";

import React from "react";
import type { Playlist, StationFile, QueueItem, Streamer } from "@/lib/azuracast";
import { getStreamers, getNowPlaying, getStationId, getApiKey, createStreamer, updateStreamer, deleteStreamer } from "@/lib/azuracast";
import { hapticSuccess } from "@/lib/haptics";

interface RadioGoLiveTabProps {
  isLive: boolean;
  listeners: number;
  streamers: Streamer[];
  setStreamers: React.Dispatch<React.SetStateAction<Streamer[]>>;
  glLoading: boolean;
  glActionLoading: string | null;
  setGlActionLoading: (v: string | null) => void;
  showStreamerForm: boolean;
  setShowStreamerForm: (v: boolean) => void;
  editingStreamerId: string | null;
  setEditingStreamerId: (v: string | null) => void;
  streamerForm: { displayName: string; username: string; password: string };
  setStreamerForm: React.Dispatch<React.SetStateAction<{ displayName: string; username: string; password: string }>>;
  glBroadcasts: { streamer: string; date: string; duration: string; startTime: string }[];
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  copyFeedback: string | null;
  setCopyFeedback: (v: string | null) => void;
  selectedStreamerId: string | null;
  setSelectedStreamerId: (v: string | null) => void;
  streamerPasswords: Record<string, string>;
  setStreamerPasswords: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  MASTER_PW: string;
}

export function RadioGoLiveTab(props: RadioGoLiveTabProps) {
  const {
    isLive, listeners, streamers, setStreamers,
    glLoading, glActionLoading, setGlActionLoading,
    showStreamerForm, setShowStreamerForm,
    editingStreamerId, setEditingStreamerId,
    streamerForm, setStreamerForm,
    glBroadcasts,
    showPassword, setShowPassword,
    copyFeedback, setCopyFeedback,
    selectedStreamerId, setSelectedStreamerId,
    streamerPasswords, setStreamerPasswords,
    MASTER_PW,
  } = props;

  const saveStreamer = async () => {
    if (glActionLoading) return;
    setGlActionLoading("save");
    try {
      if (editingStreamerId) {
        const updated = await updateStreamer(editingStreamerId, {
          displayName: streamerForm.displayName,
          username: streamerForm.username,
        });
        setStreamers((prev) => prev.map((s) => (s.id === editingStreamerId ? updated : s)));
        if (streamerForm.password) {
          setStreamerPasswords((prev) => ({ ...prev, [editingStreamerId]: streamerForm.password }));
        }
      } else {
        const created = await createStreamer({
          displayName: streamerForm.displayName,
          username: streamerForm.username,
          password: streamerForm.password,
        });
        setStreamers((prev) => [...prev, created]);
        if (streamerForm.password) {
          setStreamerPasswords((prev) => ({ ...prev, [created.id]: streamerForm.password }));
        }
        setSelectedStreamerId(created.id);
      }
      setShowStreamerForm(false);
      setEditingStreamerId(null);
      setStreamerForm({ displayName: "", username: "", password: "" });
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Streamer Saved", message: editingStreamerId ? "Streamer updated" : "Streamer created", type: "success", duration: 2500 },
      }));
      await hapticSuccess();
    } catch {
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Error", message: "Failed to save streamer", type: "error", duration: 3000 },
      }));
    }
    setGlActionLoading(null);
  };

  const deleteStreamerHandler = async (id: string) => {
    if (glActionLoading) return;
    setGlActionLoading(id);
    try {
      await deleteStreamer(id);
      setStreamers((prev) => prev.filter((s) => s.id !== id));
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Deleted", message: "Streamer removed", type: "success", duration: 2500 },
      }));
      await hapticSuccess();
    } catch {
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Error", message: "Failed to delete streamer", type: "error", duration: 3000 },
      }));
    }
    setGlActionLoading(null);
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(label);
      setTimeout(() => setCopyFeedback(null), 2000);
      window.dispatchEvent(new CustomEvent("show-toast", {
        detail: { title: "Copied", message: `${label} copied to clipboard`, type: "success", duration: 1500 },
      }));
    } catch {}
  };

  const activeStreamer = streamers.find((s) => s.isLive);
  const selStreamer = streamers.find((s) => s.id === selectedStreamerId) || activeStreamer || streamers[0] || null;
  const selPassword = selStreamer ? (streamerPasswords[selStreamer.id] || MASTER_PW) : MASTER_PW;

  return (
    <div className="golive-content">
      <style>{`
        .golive-content { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
        .section-block { display: flex; flex-direction: column; }
        .section-block-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .section-block-header h3 { font-size: 16px; font-weight: 700; }
        .section-block-count { font-size: 12px; color: var(--text-tertiary); font-weight: 500; }
        .gl-status-card { display: flex; align-items: center; gap: 14px; padding: 18px; background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); }
        .gl-status-left { display: flex; align-items: center; }
        .gl-live-indicator { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 64px; height: 64px; border-radius: var(--radius-md); background: var(--surface-elevated); justify-content: center; }
        .gl-live-indicator.live { background: rgba(239,68,68,0.12); }
        .gl-live-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--text-tertiary); }
        .gl-live-dot.pulse { background: var(--error); animation: livePulse 1.5s ease-in-out infinite; }
        @keyframes livePulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.5); } }
        .gl-live-label { font-size: 8px; font-weight: 700; letter-spacing: 1px; color: var(--text-tertiary); }
        .gl-live-indicator.live .gl-live-label { color: var(--error); }
        .gl-status-info { flex: 1; min-width: 0; }
        .gl-status-title { font-size: 16px; font-weight: 700; }
        .gl-status-sub { font-size: 13px; color: var(--text-secondary); margin-top: 2px; }
        .gl-listeners { display: inline-flex; align-items: center; gap: 5px; margin-top: 6px; font-size: 12px; font-weight: 600; color: var(--primary); }
        .gl-player-container { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
        .gl-player-header { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--border); font-size: 13px; font-weight: 600; }
        .gl-player-header i { color: var(--text-tertiary); font-size: 14px; }
        .gl-player-badge { margin-left: auto; display: flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 6px; font-size: 10px; font-weight: 700; background: var(--surface-elevated); color: var(--text-tertiary); }
        .gl-player-badge.live { background: rgba(239,68,68,0.12); color: var(--error); }
        .gl-player-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-tertiary); }
        .gl-player-dot.pulse { background: var(--error); animation: livePulse 1.5s ease-in-out infinite; }
        .gl-player-iframe { width: 100%; height: 120px; border: none; display: block; }
        .gl-connection-box { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
        .gl-conn-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--border); cursor: pointer; transition: background 0.15s ease; }
        .gl-conn-row:last-child { border-bottom: none; }
        .gl-conn-row:active { background: var(--surface-hover); }
        .gl-conn-label { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-secondary); }
        .gl-conn-label i { width: 16px; font-size: 13px; color: var(--text-tertiary); }
        .gl-conn-value { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; font-family: 'JetBrains Mono', 'Fira Code', monospace; }
        .gl-conn-value i { font-size: 13px; color: var(--text-tertiary); cursor: pointer; }
        .gl-conn-value i:active { color: var(--primary); }
        .gl-pw-input { background: var(--surface-elevated); border: 1.5px solid var(--border); border-radius: 6px; padding: 4px 8px; color: var(--text-primary); font-size: 13px; font-weight: 700; font-family: 'JetBrains Mono', 'Fira Code', monospace; outline: none; width: 130px; text-align: center; }
        .gl-pw-input:focus { border-color: var(--primary); }
        .gl-pw-toggle { background: none; border: none; color: var(--text-tertiary); cursor: pointer; font-size: 14px; padding: 0; }
        .gl-pw-toggle:active { color: var(--primary); }
        .gl-conn-note { display: flex; align-items: center; gap: 6px; padding: 8px 0 0; font-size: 11px; color: var(--text-tertiary); }
        .gl-conn-note i { font-size: 12px; }
        .gl-streamer-list { display: flex; flex-direction: column; gap: 6px; }
        .gl-streamer-item.selected { border-color: var(--primary); border-left: 3px solid var(--primary); padding-left: 12px; }
        .gl-streamer-check { margin-left: 4px; color: var(--success); font-size: 14px; }
        .gl-streamer-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
        .gl-streamer-edit { width: 28px; height: 28px; border-radius: 50%; border: none; background: none; color: var(--text-tertiary); cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; }
        .gl-streamer-edit:active { background: var(--surface-elevated); color: var(--primary); }
        .gl-streamer-item { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-md); transition: all 0.2s ease; }
        .gl-streamer-item.live { border-color: rgba(239,68,68,0.2); background: rgba(239,68,68,0.03); }
        .gl-streamer-status { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; background: var(--text-tertiary); }
        .gl-streamer-status.live { background: var(--error); }
        .gl-streamer-dot.pulse { animation: livePulse 1.5s ease-in-out infinite; }
        .gl-streamer-info { flex: 1; min-width: 0; }
        .gl-streamer-name { font-size: 14px; font-weight: 600; }
        .gl-streamer-user { font-size: 12px; color: var(--text-tertiary); }
        .gl-streamer-meta { flex-shrink: 0; }
        .gl-streamer-live-tag { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; background: rgba(239,68,68,0.12); color: var(--error); }
        .gl-streamer-off-tag { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; background: var(--surface-elevated); color: var(--text-tertiary); }
        .gl-streamer-delete { width: 28px; height: 28px; border-radius: 50%; border: none; background: none; color: var(--text-tertiary); cursor: pointer; font-size: 13px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .gl-streamer-delete:active { background: rgba(239,68,68,0.1); color: var(--error); }
        .gl-streamer-delete:disabled { opacity: 0.4; }
        .gl-empty { display: flex; flex-direction: column; align-items: center; padding: 30px 0; text-align: center; gap: 6px; }
        .gl-empty i { font-size: 28px; color: var(--text-tertiary); opacity: 0.4; }
        .gl-empty p { font-size: 15px; font-weight: 600; margin: 0; }
        .gl-empty span { font-size: 13px; color: var(--text-tertiary); }
        .gl-history-list { display: flex; flex-direction: column; gap: 4px; }
        .gl-history-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-sm); }
        .gl-history-icon { width: 32px; height: 32px; border-radius: var(--radius-sm); background: rgba(232,168,56,0.08); color: var(--primary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .gl-history-icon i { font-size: 14px; }
        .gl-history-info { flex: 1; }
        .gl-history-date { font-size: 13px; font-weight: 600; }
        .gl-history-time { font-size: 11px; color: var(--text-tertiary); }
        .gl-form-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
        .gl-form-row label { font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
        .gl-form-note { display: flex; align-items: flex-start; gap: 6px; padding: 10px 12px; background: rgba(232,168,56,0.04); border: 1px solid rgba(232,168,56,0.1); border-radius: var(--radius-sm); font-size: 12px; color: var(--text-secondary); line-height: 1.4; }
        .gl-form-note i { font-size: 13px; color: var(--primary); margin-top: 1px; flex-shrink: 0; }
        .skeleton-loading { background: linear-gradient(90deg, var(--surface) 25%, var(--surface-hover) 50%, var(--surface) 75%); background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite; border-radius: var(--radius-md); }
        .skeleton-line { height: 14px; width: 100%; margin-bottom: 8px; }
        .skeleton-line.w60 { width: 60%; }
        .skeleton-line.w40 { width: 40%; }
        .skeleton-line.w80 { width: 80%; }
        .skeleton-line.w30 { width: 30%; }
        .skeleton-line.h20 { height: 20px; }
        .skeleton-line.h24 { height: 24px; }
        .skeleton-line.h32 { height: 32px; }
        .skeleton-line.h40 { height: 40px; }
        .skeleton-line.h50 { height: 50px; }
        .skeleton-card { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        .media-modal-overlay { position: fixed; inset: 0; background: var(--overlay); z-index: 9000; animation: fadeSlideUp 0.2s ease; }
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .media-modal-sheet { position: fixed; bottom: 0; left: 0; right: 0; z-index: 9001; max-width: 480px; margin: 0 auto; background: var(--surface); border-radius: 28px 28px 0 0; animation: slideUp 0.35s cubic-bezier(0.32, 0.72, 0, 1); max-height: 80vh; display: flex; flex-direction: column; }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .media-modal-handle { width: 40px; height: 5px; background: var(--text-tertiary); border-radius: 3px; margin: 12px auto 8px; opacity: 0.5; }
        .media-modal-header { padding: 8px 24px 16px; text-align: center; }
        .media-modal-header h2 { font-size: 20px; font-weight: 700; }
        .media-modal-header p { font-size: 13px; color: var(--text-secondary); margin-top: 4px; }
        .media-modal-body { flex: 1; overflow-y: auto; padding: 0 24px 20px; -webkit-overflow-scrolling: touch; }
        .media-modal-body::-webkit-scrollbar { display: none; }
        .media-modal-close { width: 32px; height: 32px; border-radius: 50%; border: none; background: var(--surface-elevated); color: var(--text-secondary); font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .media-modal-close:active { background: var(--surface-hover); }
        .pl-create-btn { display: flex; align-items: center; gap: 6px; padding: 10px 16px; background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); border: none; border-radius: var(--radius-md); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s ease; white-space: nowrap; box-shadow: var(--shadow-soft); }
        .pl-create-btn:active { transform: scale(0.95); }
        .pl-form-input { padding: 11px 14px; background: var(--surface-elevated); border: 1.5px solid var(--border); border-radius: var(--radius-sm); color: var(--text-primary); font-size: 14px; font-weight: 500; outline: none; color-scheme: dark; }
        .pl-form-input:focus { border-color: var(--primary); }
        .pl-form-actions { display: flex; gap: 8px; margin-top: 4px; }
        .pl-form-save { padding: 10px 20px; background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); border: none; border-radius: var(--radius-sm); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s ease; }
        .pl-form-save:active { transform: scale(0.95); }
        .pl-form-cancel { padding: 10px 20px; background: var(--surface-elevated); border: none; border-radius: var(--radius-sm); color: var(--text-secondary); font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s ease; }
        .pl-form-cancel:active { transform: scale(0.95); }
        .pl-picker-footer { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-top: 1px solid var(--border); }
        .pl-picker-count { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
      `}</style>

      <div className="gl-status-card">
        <div className="gl-status-left">
          <div className={`gl-live-indicator ${isLive ? "live" : ""}`}>
            <span className={`gl-live-dot ${isLive ? "pulse" : ""}`}></span>
            <span className="gl-live-label">{isLive ? "LIVE" : "OFF AIR"}</span>
          </div>
        </div>
        <div className="gl-status-info">
          <div className="gl-status-title">{isLive ? "You are live!" : "Station is offline"}</div>
          <div className="gl-status-sub">
            {isLive
              ? `Broadcasting as ${activeStreamer?.displayName || "someone"}`
              : selStreamer
                ? `Selected: ${selStreamer.displayName}`
                : "Add a streamer to start broadcasting"
            }
          </div>
          {listeners > 0 && (
            <div className="gl-listeners">
              <i className="fas fa-headphones"></i> {listeners} listening now
            </div>
          )}
        </div>
      </div>

      <div className="gl-player-container">
        <div className="gl-player-header">
          <i className="fas fa-headphones"></i>
          <span>Monitor Broadcast</span>
          <span className={`gl-player-badge ${isLive ? "live" : ""}`}>
            <span className={`gl-player-dot ${isLive ? "pulse" : ""}`}></span>
            {isLive ? "LIVE" : "Off Air"}
          </span>
        </div>
        <iframe
          className="gl-player-iframe"
          src="https://azuracast.histoview.co.ke/public/turningpoint_church/embed?autoplay=true"
          allow="autoplay"
          title="Station Player"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      </div>

      {selStreamer && (
        <div className="section-block">
          <div className="section-block-header">
            <h3><i className="fas fa-plug" style={{ marginRight: 6 }}></i>Connection Details</h3>
            <span className="section-block-count">
              <i className="fas fa-user"></i> {selStreamer.displayName}
            </span>
          </div>
          <div className="gl-connection-box">
            <div className="gl-conn-row" onClick={() => copyToClipboard("173.249.50.98", "Server")}>
              <div className="gl-conn-label">
                <i className="fas fa-server"></i>
                <span>Server</span>
              </div>
              <div className="gl-conn-value">
                <span>173.249.50.98</span>
                <i className={`fas ${copyFeedback === "Server" ? "fa-check" : "fa-copy"}`}></i>
              </div>
            </div>
            <div className="gl-conn-row" onClick={() => copyToClipboard("8015", "Port")}>
              <div className="gl-conn-label">
                <i className="fas fa-plug"></i>
                <span>Port</span>
              </div>
              <div className="gl-conn-value">
                <span>8015</span>
                <i className={`fas ${copyFeedback === "Port" ? "fa-check" : "fa-copy"}`}></i>
              </div>
            </div>
            <div className="gl-conn-row" onClick={() => copyToClipboard("/radio.mp3", "Mount")}>
              <div className="gl-conn-label">
                <i className="fas fa-folder"></i>
                <span>Mount</span>
              </div>
              <div className="gl-conn-value">
                <span>/radio.mp3</span>
                <i className={`fas ${copyFeedback === "Mount" ? "fa-check" : "fa-copy"}`}></i>
              </div>
            </div>
            <div className="gl-conn-row" onClick={() => copyToClipboard(selStreamer.username, "Username")}>
              <div className="gl-conn-label">
                <i className="fas fa-user"></i>
                <span>Username</span>
              </div>
              <div className="gl-conn-value">
                <span>{selStreamer.username}</span>
                <i className={`fas ${copyFeedback === "Username" ? "fa-check" : "fa-copy"}`}></i>
              </div>
            </div>
            <div className="gl-conn-row">
              <div className="gl-conn-label">
                <i className="fas fa-lock"></i>
                <span>Password</span>
              </div>
              <div className="gl-conn-value">
                <input className="gl-pw-input" type={showPassword ? "text" : "password"}
                  value={selPassword}
                  onChange={(e) => {
                    if (selStreamer) {
                      setStreamerPasswords((prev) => ({ ...prev, [selStreamer.id]: e.target.value }));
                    }
                  }}
                  placeholder="Enter password"
                  onClick={(e) => e.stopPropagation()}
                />
                <button className="gl-pw-toggle" onClick={(e) => { e.stopPropagation(); setShowPassword(!showPassword); }}>
                  <i className={`fas ${showPassword ? "fa-eye-slash" : "fa-eye"}`}></i>
                </button>
                <i className={`fas ${copyFeedback === "Password" ? "fa-check" : "fa-copy"}`}
                  onClick={() => copyToClipboard(selPassword, "Password")}></i>
              </div>
            </div>
          </div>
          <div className="gl-conn-note">
            <i className="fas fa-info-circle"></i>
            {streamerPasswords[selStreamer.id]
              ? `Using ${selStreamer.displayName}'s individual password`
              : `Using master streamer password (set a custom password in Edit to use a different one)`
            }
          </div>
        </div>
      )}

      <div className="section-block">
        <div className="section-block-header">
          <h3><i className="fas fa-users" style={{ marginRight: 6 }}></i>Streamers</h3>
          <button className="pl-create-btn" onClick={() => {
            setStreamerForm({ displayName: "", username: "", password: "" });
            setEditingStreamerId(null);
            setShowStreamerForm(true);
          }}>
            <i className="fas fa-plus"></i> Add
          </button>
        </div>
        {glLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[1, 2].map((i) => (
              <div key={i} className="skeleton-card" style={{ padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
                <div className="skeleton-loading" style={{ width: 8, height: 8, borderRadius: "50%" }}></div>
                <div style={{ flex: 1 }}>
                  <div className="skeleton-loading skeleton-line w50 h20" style={{ marginBottom: 4 }}></div>
                  <div className="skeleton-loading skeleton-line w30"></div>
                </div>
              </div>
            ))}
          </div>
        ) : streamers.length === 0 ? (
          <div className="gl-empty">
            <i className="fas fa-microphone"></i>
            <p>No streamers configured</p>
            <span>Tap &quot;Add&quot; to create your first DJ account</span>
          </div>
        ) : (
          <div className="gl-streamer-list">
            {streamers.map((s) => (
              <div
                className={`gl-streamer-item ${s.isLive ? "live" : ""} ${selectedStreamerId === s.id ? "selected" : ""}`}
                key={s.id}
                onClick={() => setSelectedStreamerId(s.id)}
              >
                <div className={`gl-streamer-status ${s.isLive ? "live" : ""}`}>
                  <span className={`gl-streamer-dot ${s.isLive ? "pulse" : ""}`}></span>
                </div>
                <div className="gl-streamer-info">
                  <div className="gl-streamer-name">{s.displayName}</div>
                  <div className="gl-streamer-user">@{s.username}</div>
                </div>
                <div className="gl-streamer-meta">
                  {s.isLive ? (
                    <span className="gl-streamer-live-tag">LIVE</span>
                  ) : (
                    <span className="gl-streamer-off-tag">Offline</span>
                  )}
                  {selectedStreamerId === s.id && (
                    <span className="gl-streamer-check"><i className="fas fa-check-circle"></i></span>
                  )}
                </div>
                <div className="gl-streamer-actions">
                  <button className="gl-streamer-edit"
                    onClick={(e) => {
                      e.stopPropagation();
                      setStreamerForm({ displayName: s.displayName, username: s.username, password: "" });
                      setEditingStreamerId(s.id);
                      setShowStreamerForm(true);
                    }}>
                    <i className="fas fa-pen"></i>
                  </button>
                  <button className="gl-streamer-delete"
                    disabled={glActionLoading === s.id}
                    onClick={(e) => { e.stopPropagation(); deleteStreamerHandler(s.id); }}
                  >
                    {glActionLoading === s.id ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-trash-can"></i>}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section-block">
        <div className="section-block-header">
          <h3><i className="fas fa-clock-rotate-left" style={{ marginRight: 6 }}></i>Recent Broadcasts</h3>
          {glBroadcasts.length > 0 && (
            <span className="section-block-count">{glBroadcasts.length} total</span>
          )}
        </div>
        {glBroadcasts.length === 0 ? (
          <div className="gl-empty" style={{ padding: "20px 0" }}>
            <i className="fas fa-tower-broadcast"></i>
            <p>No broadcasts yet</p>
            <span>Live sessions will appear here after you broadcast</span>
          </div>
        ) : (
          <div className="gl-history-list">
            {glBroadcasts.slice(0, 20).map((b, i) => (
              <div className="gl-history-item" key={i}>
                <div className="gl-history-icon">
                  <i className="fas fa-tower-broadcast"></i>
                </div>
                <div className="gl-history-info">
                  <div className="gl-history-date">{b.streamer} &middot; {b.date}</div>
                  <div className="gl-history-time">{b.startTime} &middot; {b.duration}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showStreamerForm && (
        <>
          <div className="media-modal-overlay" onClick={() => { setShowStreamerForm(false); setEditingStreamerId(null); }}></div>
          <div className="media-modal-sheet">
            <div className="media-modal-handle"></div>
            <div className="media-modal-header">
              <h2>{editingStreamerId ? "Edit Streamer" : "New Streamer"}</h2>
              <p>Configure a DJ account for live broadcasting</p>
              <button className="media-modal-close" onClick={() => { setShowStreamerForm(false); setEditingStreamerId(null); }}>
                <i className="fas fa-xmark"></i>
              </button>
            </div>
            <div className="media-modal-body">
              <div className="gl-form-row">
                <label>Display Name</label>
                <input type="text" className="pl-form-input" value={streamerForm.displayName}
                  onChange={(e) => setStreamerForm({ ...streamerForm, displayName: e.target.value })}
                  placeholder="e.g. Pastor John" />
              </div>
              <div className="gl-form-row">
                <label>Username</label>
                <input type="text" className="pl-form-input" value={streamerForm.username}
                  onChange={(e) => setStreamerForm({ ...streamerForm, username: e.target.value })}
                  placeholder="e.g. pastorjohn" />
              </div>
              <div className="gl-form-row">
                <label>Password {editingStreamerId && "(leave blank to keep current)"}</label>
                <input type="text" className="pl-form-input" value={streamerForm.password}
                  onChange={(e) => setStreamerForm({ ...streamerForm, password: e.target.value })}
                  placeholder={editingStreamerId ? "New password (optional)" : "Streamer password"} />
              </div>
              <div className="gl-form-note">
                <i className="fas fa-info-circle"></i>
                After creating, the streamer can connect using these credentials via any Icecast source client on port 8015.
                {editingStreamerId && (
                  <span style={{ marginTop: 4, display: "block" }}>
                    Set a new password here to override the master password. If left blank, the master password is used.
                  </span>
                )}
              </div>
            </div>
            <div className="pl-picker-footer">
              <span className="pl-picker-count"></span>
              <div className="pl-form-actions">
                <button className="pl-form-cancel" onClick={() => { setShowStreamerForm(false); setEditingStreamerId(null); }}>
                  Cancel
                </button>
                <button className="pl-form-save" onClick={saveStreamer}
                  disabled={glActionLoading === "save" || !streamerForm.displayName || !streamerForm.username}>
                  {glActionLoading === "save" ? <i className="fas fa-spinner fa-spin"></i> : null}
                  {glActionLoading === "save" ? " Saving..." : editingStreamerId ? "Save Changes" : "Create Streamer"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
