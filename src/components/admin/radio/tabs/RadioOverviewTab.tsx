"use client";

import React from "react";
import type { Playlist, StationFile, QueueItem } from "@/lib/azuracast";
import { getApiBase, toggleAutoDJ, togglePlaylistEnabled as apiTogglePlaylist, createPlaylist as apiCreatePlaylist, addSongsToPlaylist as apiAddSongs } from "@/lib/azuracast";
import { hapticSuccess } from "@/lib/haptics";

interface RadioOverviewTabProps {
  overviewNP: any | null;
  overviewHistory: any[];
  overviewLoading: boolean;
  autoDJ: boolean;
  isLive: boolean;
  isPlaying: boolean;
  listeners: number;
  backendRunning: boolean;
  streamUrl: string;
  setAutoDJ: (v: boolean) => void;
  pcMode: "schedule" | "playlist" | "single";
  pcQueue: QueueItem[];
  pcPlaylists: Playlist[];
  pcFiles: StationFile[];
  pcActivePlaylist: string | null;
  pcActiveTrack: string;
  pcAutoDJ: boolean;
  pcActionLoading: string | null;
  setPcMode: (v: "schedule" | "playlist" | "single") => void;
  setPcPlaylists: React.Dispatch<React.SetStateAction<Playlist[]>>;
  setPcActivePlaylist: (v: string | null) => void;
  setPcActiveTrack: (v: string) => void;
  setPcActionLoading: (v: string | null) => void;
  setActiveTab: (v: string) => void;
}

export function RadioOverviewTab(props: RadioOverviewTabProps) {
  const {
    overviewNP, overviewHistory, overviewLoading,
    autoDJ, isLive, isPlaying, listeners, backendRunning,
    streamUrl, setAutoDJ,
    pcMode, pcQueue, pcPlaylists, pcFiles,
    pcActivePlaylist, pcActiveTrack, pcAutoDJ, pcActionLoading,
    setPcMode, setPcPlaylists, setPcActivePlaylist, setPcActiveTrack, setPcActionLoading,
    setActiveTab,
  } = props;

  const np = overviewNP?.nowPlaying;
  const progressPct = np && np.duration > 0 ? Math.round((np.elapsed / np.duration) * 100) : 0;
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const timeAgo = (iso: string) => {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  if (overviewLoading && !overviewNP) {
    return (
      <div className="overview-content">
        <style>{`
          .skeleton-loading { background: linear-gradient(90deg, var(--surface) 25%, var(--surface-hover) 50%, var(--surface) 75%); background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite; border-radius: var(--radius-md); }
          .skeleton-line { height: 14px; width: 100%; margin-bottom: 8px; }
          .skeleton-line.w60 { width: 60%; }
          .skeleton-line.w40 { width: 40%; }
          .skeleton-line.w80 { width: 80%; }
          .skeleton-line.w30 { width: 30%; }
          .skeleton-line.h24 { height: 24px; }
          .skeleton-line.h40 { height: 40px; }
          .skeleton-line.h100 { height: 100px; }
          .skeleton-block { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; }
          .skeleton-img { background: linear-gradient(90deg, var(--surface) 25%, var(--surface-hover) 50%, var(--surface) 75%); background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite; border-radius: var(--radius-md); }
          .skeleton-card { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
          @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
          .overview-content { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
          .overview-cards-row { display: flex; gap: 12px; }
        `}</style>
        <div className="overview-cards-row">
          <div className="skeleton-card" style={{ flex: 1, padding: 16 }}>
            <div className="skeleton-loading skeleton-line w40 h24" style={{ marginBottom: 12 }}></div>
            <div className="skeleton-loading skeleton-line w60 h40" style={{ marginBottom: 8 }}></div>
            <div className="skeleton-loading skeleton-line w30" style={{ marginBottom: 4 }}></div>
          </div>
          <div className="skeleton-card" style={{ flex: 1, padding: 16 }}>
            <div className="skeleton-loading skeleton-line w40 h24" style={{ marginBottom: 12 }}></div>
            <div className="skeleton-loading skeleton-line w60 h40" style={{ marginBottom: 8 }}></div>
            <div className="skeleton-loading skeleton-line w30" style={{ marginBottom: 4 }}></div>
          </div>
        </div>
        <div className="skeleton-card" style={{ padding: 16, display: "flex", gap: 16, alignItems: "center", marginTop: 16 }}>
          <div className="skeleton-loading" style={{ width: 80, height: 80, borderRadius: "var(--radius-md)", flexShrink: 0 }}></div>
          <div style={{ flex: 1 }}>
            <div className="skeleton-loading skeleton-line w80 h24"></div>
            <div className="skeleton-loading skeleton-line w40"></div>
            <div className="skeleton-loading skeleton-line w60"></div>
          </div>
        </div>
        <div className="skeleton-block" style={{ marginTop: 16 }}>
          <div className="skeleton-loading skeleton-line w40 h24" style={{ marginBottom: 12 }}></div>
          <div className="skeleton-loading skeleton-line w80" style={{ marginBottom: 6 }}></div>
          <div className="skeleton-loading skeleton-line w60" style={{ marginBottom: 6 }}></div>
          <div className="skeleton-loading skeleton-line w80" style={{ marginBottom: 6 }}></div>
        </div>
      </div>
    );
  }

  return (
    <div className="overview-content">
      <style>{`
        .overview-content { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
        .overview-cards-row { display: flex; gap: 12px; }
        .status-card { flex: 1; background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; display: flex; flex-direction: column; gap: 12px; }
        .status-card-header { display: flex; align-items: center; justify-content: space-between; }
        .status-card-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
        .status-badge { display: flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
        .status-badge.live { background: rgba(34,197,94,0.12); color: var(--success); }
        .status-badge.offline { background: var(--surface-elevated); color: var(--text-tertiary); }
        .status-dot { width: 6px; height: 6px; border-radius: var(--radius-full); background: var(--success); }
        .status-dot.pulse { animation: livePulse 1.5s ease-in-out infinite; }
        @keyframes livePulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.5); } }
        .status-card-body { display: flex; flex-direction: column; gap: 10px; }
        .status-card-info { display: flex; flex-direction: column; }
        .status-card-stat { font-size: 28px; font-weight: 800; line-height: 1; letter-spacing: -0.5px; }
        .status-card-stat-label { font-size: 12px; color: var(--text-tertiary); font-weight: 500; margin-top: 2px; }
        .broadcast-ctrl-btn { width: 100%; padding: 10px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; gap: 6px; border: none; }
        .broadcast-ctrl-btn:active { transform: scale(0.97); }
        .broadcast-ctrl-btn.stop { background: rgba(239,68,68,0.12); color: var(--error); }
        .broadcast-ctrl-btn.start { background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); color: #fff; box-shadow: var(--shadow-soft); }
        .now-playing-card { background: linear-gradient(135deg, rgba(232,168,56,0.08) 0%, rgba(139,92,246,0.04) 100%); border: 1px solid rgba(232,168,56,0.1); border-radius: var(--radius-lg); padding: 16px; display: flex; align-items: center; gap: 14px; }
        .now-playing-cover { width: 72px; height: 72px; border-radius: var(--radius-md); overflow: hidden; position: relative; flex-shrink: 0; border: 1px solid var(--border); }
        .now-playing-cover img { width: 100%; height: 100%; object-fit: cover; }
        .now-playing-equalizer { position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%); display: flex; gap: 2px; align-items: flex-end; height: 16px; }
        .now-playing-equalizer span { width: 3px; background: var(--primary); border-radius: 2px; animation: equalizer 0.8s ease-in-out infinite alternate; }
        .now-playing-equalizer span:nth-child(1) { height: 8px; animation-delay: 0s; }
        .now-playing-equalizer span:nth-child(2) { height: 14px; animation-delay: 0.2s; }
        .now-playing-equalizer span:nth-child(3) { height: 10px; animation-delay: 0.4s; }
        .now-playing-equalizer span:nth-child(4) { height: 6px; animation-delay: 0.6s; }
        @keyframes equalizer { 0% { height: 4px; } 100% { height: 16px; } }
        .now-playing-info { flex: 1; min-width: 0; }
        .now-playing-title { font-size: 15px; font-weight: 700; line-height: 1.3; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .now-playing-artist { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; }
        .now-playing-progress { display: flex; flex-direction: column; gap: 4px; }
        .progress-bar { width: 100%; height: 4px; background: var(--surface-card); border-radius: 2px; overflow: hidden; }
        .progress-fill { height: 100%; background: linear-gradient(90deg, var(--gradient-start), var(--gradient-end)); border-radius: 2px; transition: width 0.3s ease; }
        .progress-time { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-tertiary); }
        .mini-player-btn { width: 42px; height: 42px; border-radius: var(--radius-full); background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); border: none; color: #fff; font-size: 16px; box-shadow: var(--shadow-soft); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s ease; flex-shrink: 0; }
        .mini-player-btn:active { transform: scale(0.9); }
        .section-block { display: flex; flex-direction: column; }
        .section-block-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .section-block-header h3 { font-size: 16px; font-weight: 700; }
        .section-block-count { font-size: 12px; color: var(--text-tertiary); font-weight: 500; }
        .quick-actions-row { display: flex; gap: 10px; }
        .quick-action-btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px 8px; background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s ease; }
        .quick-action-btn:active { background: var(--surface-elevated); transform: scale(0.96); }
        .quick-action-btn span { font-size: 11px; font-weight: 600; color: var(--text-secondary); text-align: center; }
        .qab-icon { width: 44px; height: 44px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; font-size: 18px; }
        .qab-icon.blue { background: rgba(59,130,246,0.12); color: var(--gradient-blue); }
        .qab-icon.purple { background: rgba(139,92,246,0.12); color: var(--gradient-purple); }
        .ov-pc-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
        .ov-pc-dot.green { background: var(--success); }
        .ov-pc-dot.gray { background: var(--text-tertiary); }
        .ov-pc-mode-row { display: flex; gap: 6px; margin-bottom: 10px; }
        .ov-pc-mode-btn { flex: 1; padding: 8px 6px; border-radius: var(--radius-sm); border: none; background: var(--surface-elevated); color: var(--text-secondary); font-size: 11px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px; transition: all 0.2s ease; }
        .ov-pc-mode-btn i { font-size: 12px; }
        .ov-pc-mode-btn.active { background: var(--primary); color: white; }
        .ov-pc-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
        .ov-pc-item { display: flex; align-items: center; justify-content: space-between; background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 12px; }
        .ov-pc-item-info { flex: 1; min-width: 0; }
        .ov-pc-item-name { font-size: 13px; font-weight: 600; }
        .ov-pc-item-sub { font-size: 11px; color: var(--text-tertiary); margin-top: 1px; }
        .ov-pc-play-btn { width: 32px; height: 32px; border-radius: 50%; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s ease; flex-shrink: 0; background: var(--primary); color: white; font-size: 12px; }
        .ov-pc-play-btn.active { background: rgba(74,222,128,0.15); color: var(--success); }
        .ov-pc-play-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .ov-pc-active { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--success); padding: 8px 0 4px; }
        .ov-pc-now-playing { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--success); padding: 6px 0; margin-bottom: 2px; }
        .ov-pc-empty { font-size: 12px; color: var(--text-tertiary); padding: 12px 0; text-align: center; }
        .ov-pc-queue-header { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
        .ov-pc-queue-count { font-size: 10px; color: var(--text-tertiary); font-weight: 600; text-transform: none; }
        .ov-pc-queue { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
        .ov-pc-q-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--border); }
        .ov-pc-q-item:last-child { border-bottom: none; }
        .ov-pc-q-num { width: 18px; height: 18px; border-radius: 50%; background: var(--surface-elevated); display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; color: var(--text-tertiary); flex-shrink: 0; }
        .ov-pc-q-info { flex: 1; min-width: 0; }
        .ov-pc-q-title { font-size: 12px; font-weight: 600; }
        .ov-pc-q-artist { font-size: 10px; color: var(--text-tertiary); }
        .pl-toggle { position: relative; display: inline-block; width: 42px; height: 24px; cursor: pointer; }
        .pl-toggle input { display: none; }
        .pl-toggle-slider { position: absolute; inset: 0; background: var(--surface-elevated); border-radius: 12px; transition: all 0.25s ease; }
        .pl-toggle-slider::before { content: ''; position: absolute; left: 3px; top: 3px; width: 18px; height: 18px; background: var(--text-tertiary); border-radius: 50%; transition: all 0.25s ease; }
        .pl-toggle input:checked + .pl-toggle-slider { background: var(--primary); }
        .pl-toggle input:checked + .pl-toggle-slider::before { background: #fff; transform: translateX(18px); }
        .skeleton-loading { background: linear-gradient(90deg, var(--surface) 25%, var(--surface-hover) 50%, var(--surface) 75%); background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite; border-radius: var(--radius-md); }
        .skeleton-line { height: 14px; width: 100%; margin-bottom: 8px; }
        .skeleton-line.w60 { width: 60%; }
        .skeleton-line.w40 { width: 40%; }
        .skeleton-line.w80 { width: 80%; }
        .skeleton-line.w30 { width: 30%; }
        .skeleton-line.h24 { height: 24px; }
        .skeleton-line.h40 { height: 40px; }
        .skeleton-block { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; }
        .skeleton-card { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `}</style>

      {/* Station Status + AutoDJ Row */}
      <div className="overview-cards-row">
        <div className="status-card">
          <div className="status-card-header">
            <span className="status-card-label">Station</span>
            <div className={`status-badge ${isLive ? "live" : "offline"}`}>
              <span className={`status-dot ${isLive ? "pulse" : ""}`}></span>
              {isLive ? "Online" : "Offline"}
            </div>
          </div>
          <div className="status-card-body">
            <div className="status-card-info">
              <span className="status-card-stat">{listeners}</span>
              <span className="status-card-stat-label">Listeners</span>
            </div>
            <a href={overviewNP?.station ? `${getApiBase()}/public/${overviewNP.station.shortName}` : "#"}
              target="_blank" rel="noopener noreferrer"
              className={`broadcast-ctrl-btn ${isLive ? "stop" : "start"}`}
              style={{ textDecoration: "none", textAlign: "center", lineHeight: "44px" }}>
              <i className="fas fa-external-link"></i> Public Page
            </a>
          </div>
        </div>

        <div className="status-card">
          <div className="status-card-header">
            <span className="status-card-label">AutoDJ</span>
            <div className={`status-badge ${autoDJ ? "live" : "offline"}`}>
              <span className={`status-dot ${autoDJ ? "pulse" : ""}`}></span>
              {autoDJ ? "Running" : "Stopped"}
            </div>
          </div>
          <div className="status-card-body">
            <div className="status-card-info">
              <span className="status-card-stat">{overviewHistory.length}</span>
              <span className="status-card-stat-label">Recent Songs</span>
            </div>
            <button
              className={`broadcast-ctrl-btn ${autoDJ ? "stop" : "start"}`}
              onClick={async () => {
                const newAutoDJ = !autoDJ;
                setAutoDJ(newAutoDJ);
                try {
                  await toggleAutoDJ();
                  await hapticSuccess();
                } catch {
                  setAutoDJ(!newAutoDJ);
                }
              }}
            >
              <i className={`fas ${autoDJ ? "fa-pause" : "fa-play"}`}></i>
              {autoDJ ? "Pause AutoDJ" : "Start AutoDJ"}
            </button>
          </div>
        </div>
      </div>

      {/* Now Playing - Premium AzuraCast Embedded Player */}
      <div style={{ background: "var(--surface-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 0, overflow: "hidden" }}>
        <iframe
          src="https://azuracast.histoview.co.ke/public/turningpoint_church/embed?primary_color=E8A838&bg_color=1E1E1E&volume=100&rounded=1&allow_popup=1&continuous=1"
          frameBorder="0"
          // @ts-expect-error - React 19 requires lowercase HTML attributes
          allowtransparency="true"
          allow="autoplay; encrypted-media; fullscreen"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
          loading="eager"
          style={{ width: '100%', minHeight: '150px', height: '150px', border: 0, display: 'block' }}
          title="Kingdom Seekers Radio Player"
        />
      </div>

      {/* Quick Actions */}
      <div className="section-block">
        <div className="section-block-header">
          <h3>Quick Actions</h3>
        </div>
        <div className="quick-actions-row">
          <button className="quick-action-btn" onClick={() => setActiveTab("media")}>
            <div className="qab-icon blue"><i className="fas fa-cloud-arrow-up"></i></div>
            <span>Upload Media</span>
          </button>
          <button className="quick-action-btn" onClick={() => setActiveTab("playlists")}>
            <div className="qab-icon purple"><i className="fas fa-list"></i></div>
            <span>New Playlist</span>
          </button>
        </div>
      </div>



      {/* Play Control */}
      <div className="section-block">
        <div className="section-block-header">
          <h3><i className="fas fa-play-circle" style={{ marginRight: 6 }}></i>Play Control</h3>
          <span className="section-block-count" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className={`ov-pc-dot ${pcAutoDJ ? "green" : "gray"}`}></span>
            AutoDJ: {pcAutoDJ ? "On" : "Off"}
          </span>
        </div>

        {backendRunning && (pcActivePlaylist || pcActiveTrack) && (
          <div className="ov-pc-now-playing">
            <i className="fas fa-circle-play" style={{ color: "var(--success)" }}></i>
            {pcActiveTrack
              ? `Playing: ${pcActiveTrack}`
              : `Playing: ${pcPlaylists.find((p) => p.id === pcActivePlaylist)?.name || "Unknown"}`
            }
          </div>
        )}

        <div className="ov-pc-mode-row">
          {([
            { id: "schedule" as const, label: "Schedule", icon: "fa-calendar-days" },
            { id: "playlist" as const, label: "Playlists", icon: "fa-list" },
            { id: "single" as const, label: "Single Track", icon: "fa-music" },
          ]).map((m) => (
            <button
              key={m.id}
              className={`ov-pc-mode-btn ${pcMode === m.id ? "active" : ""}`}
              onClick={() => setPcMode(m.id)}
            >
              <i className={`fas ${m.icon}`}></i>
              {m.label}
            </button>
          ))}
        </div>

        {pcMode === "schedule" && (
          <div className="ov-pc-list">
            {pcPlaylists.filter((p) => p.schedule).length === 0 ? (
              <div className="ov-pc-empty">No scheduled playlists</div>
            ) : (
              pcPlaylists.filter((p) => p.schedule).map((pl) => (
                <div className="ov-pc-item" key={pl.id}>
                  <div className="ov-pc-item-info">
                    <div className="ov-pc-item-name">{pl.name}</div>
                    <div className="ov-pc-item-sub">
                      {pl.schedule!.days.map((d) => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d]).join(", ")}
                      &middot; {pl.schedule!.startTime} - {pl.schedule!.endTime}
                    </div>
                  </div>
                  <label className="pl-toggle" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={pl.enabled}
                      disabled={pcActionLoading !== null}
                      onChange={async () => {
                        if (pcActionLoading) return;
                        setPcActionLoading(pl.id);
                        try {
                          const updated = await apiTogglePlaylist(pl.id);
                          setPcPlaylists((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
                          await hapticSuccess();
                        } catch {}
                        setPcActionLoading(null);
                      }}
                    />
                    <span className="pl-toggle-slider"></span>
                  </label>
                </div>
              ))
            )}
          </div>
        )}

        {pcMode === "playlist" && (
          <div className="ov-pc-list">
            {pcActivePlaylist && (
              <div className="ov-pc-active">
                <i className="fas fa-circle-play"></i>
                Playing: {pcPlaylists.find((p) => p.id === pcActivePlaylist)?.name || "Unknown"}
              </div>
            )}
            {pcPlaylists.filter((p) => !p.schedule).length === 0 ? (
              <div className="ov-pc-empty">No playlists yet</div>
            ) : (
              pcPlaylists.filter((p) => !p.schedule).map((pl) => (
                <div className="ov-pc-item" key={pl.id}>
                  <div className="ov-pc-item-info">
                    <div className="ov-pc-item-name">{pl.name}</div>
                    <div className="ov-pc-item-sub">{pl.songCount} songs &middot; weight {pl.weight}</div>
                  </div>
                  <button
                    className={`ov-pc-play-btn ${pcActivePlaylist === pl.id ? "active" : ""}`}
                    onClick={async () => {
                      if (pcActionLoading) return;
                      setPcActionLoading(pl.id);
                      const current = pcPlaylists;
                      for (const p of current) {
                        if (p.enabled !== (p.id === pl.id)) {
                          try { const u = await apiTogglePlaylist(p.id); setPcPlaylists((prev) => prev.map((pp) => (pp.id === u.id ? u : pp))); } catch {}
                        }
                      }
                      setPcActivePlaylist(pl.id);
                      await hapticSuccess();
                      setPcActionLoading(null);
                    }}
                    disabled={pcActivePlaylist === pl.id || pcActionLoading !== null}
                  >
                    <i className={`fas ${pcActionLoading === pl.id ? "fa-spinner fa-spin" : pcActivePlaylist === pl.id ? "fa-check" : "fa-play"}`}></i>
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {pcMode === "single" && (
          <div className="ov-pc-list">
            <div className="ov-pc-empty" style={{ fontSize: 12 }}>
              <i className="fas fa-info-circle"></i> Click a file to create a temp playlist and play it
            </div>
            {pcFiles.length === 0 ? (
              <div className="ov-pc-empty">No media files</div>
            ) : (
              pcFiles.map((f) => (
                <div className="ov-pc-item" key={f.id}>
                  <div className="ov-pc-item-info">
                    <div className="ov-pc-item-name">{f.title || f.path}</div>
                    <div className="ov-pc-item-sub">{f.artist} &middot; {f.duration}</div>
                  </div>
                  <button className="ov-pc-play-btn" onClick={async () => {
                    if (pcActionLoading) return;
                    setPcActionLoading(f.id);
                    try {
                      let pl = pcPlaylists.find((p) => p.name === "__single__");
                      if (!pl) {
                        const created = await apiCreatePlaylist({ name: "__single__", type: "standard", order: "shuffle", weight: 1 });
                        pl = created;
                        setPcPlaylists((prev) => [...prev, created]);
                      }
                      await apiAddSongs(pl.id, [f.id]);
                      const current = pcPlaylists;
                      for (const p of current) {
                        if (p.enabled !== (p.id === pl!.id)) {
                          try { const u = await apiTogglePlaylist(p.id); setPcPlaylists((prev) => prev.map((pp) => (pp.id === u.id ? u : pp))); } catch {}
                        }
                      }
                      setPcActivePlaylist(pl.id);
                      setPcActiveTrack(f.title || f.path);
                      window.dispatchEvent(new CustomEvent("show-toast", {
                        detail: { title: "Playing", message: f.title, type: "success", duration: 2000 },
                      }));
                      await hapticSuccess();
                    } catch {}
                    setPcActionLoading(null);
                  }}
                    disabled={pcActionLoading !== null}
                  >
                    <i className={`fas ${pcActionLoading === f.id ? "fa-spinner fa-spin" : "fa-play"}`}></i>
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        <div className="ov-pc-queue-header">
          <span>Upcoming Queue</span>
          <span className="ov-pc-queue-count">{pcQueue.length} songs</span>
        </div>
        <div className="ov-pc-queue">
          {pcQueue.length === 0 ? (
            <div className="ov-pc-empty" style={{ padding: "8px 0" }}>No upcoming songs</div>
          ) : (
            pcQueue.slice(0, 5).map((item, i) => (
              <div className="ov-pc-q-item" key={i}>
                <span className="ov-pc-q-num">{i + 1}</span>
                <div className="ov-pc-q-info">
                  <div className="ov-pc-q-title">{item.song.title || "Unknown"}</div>
                  <div className="ov-pc-q-artist">{item.song.artist || "Unknown"}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
