"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BottomNavBar from "@/components/shared/BottomNavBar";
import ToastBridge from "@/components/dashboard/ToastBridge";
import { getNowPlaying, getSongHistory, getSettings, getStreamers, getApiBase, getStationId } from "@/lib/azuracast";
import type { NowPlayingData, SongHistoryItem, StationSettings, Streamer } from "@/lib/azuracast";
import { churchConfig } from "@/lib/churchConfig";
import PremiumTopBar from "@/components/shared/PremiumTopBar";
import RadioEmbed from "@/components/shared/RadioEmbed";

export default function RadioPage() {
  const router = useRouter();

  const [npData, setNpData] = useState<NowPlayingData | null>(null);
  const [songHistory, setSongHistory] = useState<SongHistoryItem[]>([]);
  const [settings, setSettings] = useState<StationSettings | null>(null);
  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [radioLoading, setRadioLoading] = useState(true);

  const stationName = settings?.name || "MOUNTAIN OF DELIVERANCE CHURCH Radio";

  /* Poll AzuraCast now playing + history every 10 seconds */
  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      const np = await getNowPlaying(getStationId()).catch(() => null);
      const history = await getSongHistory(10).catch(() => []);
      if (!mounted) return;
      if (np) setNpData(np);
      if (history.length > 0) setSongHistory(history);
      setRadioLoading(false);
    };
    poll();
    const interval = setInterval(poll, 10000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  /* Fetch playlists, files, settings, streamers on mount */
  useEffect(() => {
    let mounted = true;
    const fetchMeta = async () => {
      const [s, str] = await Promise.all([
        getSettings().catch(() => null as StationSettings | null),
        getStreamers().catch(() => [] as Streamer[]),
      ]);
      if (!mounted) return;
      setSettings(s);
      setStreamers(str);
    };
    fetchMeta();
    return () => { mounted = false; };
  }, []);

  // ========== TOAST ==========
  function showToast(title: string, message: string, type: string, duration: number) {
    window.dispatchEvent(new CustomEvent("show-toast", { detail: { title, message, type, duration } }));
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const np = npData?.nowPlaying;
  const isLive = npData?.live?.isLive ?? false;
  const liveStreamerName = npData?.live?.streamerName;
  const currentListeners = npData?.listeners?.current ?? 0;

  const activeStreamers = streamers.filter((s) => s.isLive);

  return (
    <>
      <ToastBridge />
      <div id="ts-toast-bridge-data"></div>
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
          --warning: #FBBF24;
          --info: #38BDF8;
          --gradient-start: #E8A838;
          --gradient-end: #D4762A;
          --shadow-soft: 0 4px 20px rgba(232,168,56,0.15);
          --shadow-elevated: 0 8px 32px rgba(0,0,0,0.45);
          --radius-sm: 10px;
          --radius-md: 14px;
          --radius-lg: 18px;
          --radius-xl: 22px;
          --radius-full: 50%;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--text-primary); }

        .app-container { height: 100%; display: flex; flex-direction: column; position: relative; overflow: hidden; }
        @media (min-width: 480px) { .app-container { max-width: 480px; margin: 0 auto; border-left: 1px solid var(--border); border-right: 1px solid var(--border); } }

        /* ===== PREMIUM HEADER ===== */
        .header { padding: 8px 16px 12px; display: flex; align-items: center; gap: 12px; flex-shrink: 0; background: var(--bg); border-bottom: 1px solid var(--border); }
        .header-back { width: 40px; height: 40px; border-radius: var(--radius-full); background: var(--surface); border: none; color: var(--text-primary); font-size: 18px; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; transition: all 0.2s ease; }
        .header-back:active { background: var(--surface-elevated); transform: scale(0.92); }
        .header-info { flex: 1; min-width: 0; }
        .header-name { font-size: 17px; font-weight: 800; line-height: 1.2; letter-spacing: -0.3px; color: var(--primary); }
        .header-dj { font-size: 12px; color: var(--text-secondary); margin-top: 3px; display: flex; align-items: center; gap: 6px; font-weight: 500; }
        .header-dj i { font-size: 10px; color: var(--text-tertiary); }
        .header-dj .live-dot { width: 6px; height: 6px; border-radius: var(--radius-full); background: var(--error); animation: livePulse 1.5s ease-in-out infinite; display: inline-block; }
        @keyframes livePulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.6); } }
        .header-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        .header-badge {
          display: flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 20px;
          font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px;
          transition: all 0.3s ease;
        }
        .header-badge.live { background: rgba(239,68,68,0.12); color: var(--error); border: 1px solid rgba(239,68,68,0.2); }
        .header-badge.off { background: var(--surface-elevated); color: var(--text-tertiary); border: 1px solid var(--border); }
        .listener-count { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-secondary); font-weight: 600; white-space: nowrap; background: var(--surface-elevated); padding: 4px 10px; border-radius: 20px; border: 1px solid var(--border); }
        .listener-count i { font-size: 10px; color: var(--text-tertiary); }

        /* ===== CONTENT SCROLL ===== */
        .content-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; padding-bottom: 80px; }
        .content-scroll::-webkit-scrollbar { display: none; }
        .content-inner { padding: 12px; display: flex; flex-direction: column; gap: 16px; }

        /* ===== MESSAGE CARD (loading/empty) ===== */
        .msg-card { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 20px; text-align: center; gap: 12px; }
        .msg-card i { font-size: 36px; color: var(--text-tertiary); opacity: 0.5; }
        .msg-card p { font-size: 14px; color: var(--text-secondary); }

        /* ===== NOW PLAYING CARD (premium hero) ===== */
        .np-glass {
          background: linear-gradient(180deg, rgba(232,168,56,0.08) 0%, rgba(15,15,15,0.4) 100%);
          border: 1px solid rgba(232,168,56,0.12);
          border-radius: 20px;
          padding: 28px 22px 22px;
          position: relative; overflow: hidden;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 60px rgba(232,168,56,0.04);
        }
        .np-glass::before {
          content: ''; position: absolute; top: -120px; left: 50%; transform: translateX(-50%);
          width: 400px; height: 400px;
          background: radial-gradient(circle, rgba(232,168,56,0.10) 0%, transparent 70%);
          pointer-events: none;
        }
        .np-glass::after {
          content: ''; position: absolute; bottom: -60px; right: -60px;
          width: 200px; height: 200px;
          background: radial-gradient(circle, rgba(212,118,42,0.06) 0%, transparent 70%);
          pointer-events: none;
        }
        .np-row { display: flex; align-items: center; gap: 20px; position: relative; z-index: 1; }
        .np-art { width: 88px; height: 88px; border-radius: 16px; overflow: hidden; flex-shrink: 0; box-shadow: 0 12px 32px rgba(0,0,0,0.5), 0 0 0 2px rgba(232,168,56,0.15); transition: transform 0.3s ease; }
        .np-art:hover { transform: scale(1.03); }
        .np-art img { width: 100%; height: 100%; object-fit: cover; }
        .np-art-fallback { width: 88px; height: 88px; border-radius: 16px; background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); display: flex; align-items: center; justify-content: center; font-size: 34px; color: #fff; flex-shrink: 0; box-shadow: 0 12px 32px rgba(0,0,0,0.4); }
        .np-body { flex: 1; min-width: 0; }
        .np-title { font-size: 20px; font-weight: 800; letter-spacing: -0.3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .np-artist { font-size: 14px; color: var(--primary-light); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
        .np-progress { margin-top: 14px; }
        .np-progress-bar { width: 100%; height: 4px; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden; }
        .np-progress-fill { height: 100%; background: linear-gradient(90deg, var(--gradient-start), var(--gradient-end)); border-radius: 3px; transition: width 0.5s ease; box-shadow: 0 0 8px rgba(232,168,56,0.3); }
        .np-progress-time { display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px; color: var(--text-tertiary); font-weight: 500; }
        .np-controls-row { display: flex; align-items: center; gap: 16px; margin-top: 18px; position: relative; z-index: 1; }
        .np-play-btn {
          width: 56px; height: 56px; border-radius: 50%;
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          border: none; color: #fff; font-size: 22px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0;
          box-shadow: 0 6px 24px rgba(232,168,56,0.35);
          transition: all 0.25s cubic-bezier(0.4,0,0.2,1);
        }
        .np-play-btn:active { transform: scale(0.92); }
        .np-play-btn.playing {
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          box-shadow: 0 6px 28px rgba(232,168,56,0.4), 0 0 40px rgba(232,168,56,0.1);
        }
        .np-vol-wrap { flex: 1; display: flex; align-items: center; gap: 10px; }
        .np-vol-wrap i { font-size: 14px; color: var(--text-tertiary); width: 16px; text-align: center; }
        .np-vol-slider {
          flex: 1; -webkit-appearance: none; appearance: none;
          height: 4px; border-radius: 3px;
          background: rgba(255,255,255,0.08);
          outline: none; transition: background 0.2s;
        }
        .np-vol-slider::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 18px; height: 18px; border-radius: 50%;
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          cursor: pointer; box-shadow: 0 2px 8px rgba(232,168,56,0.3);
          border: 2px solid var(--bg);
        }
        .np-vol-slider::-moz-range-thumb {
          width: 18px; height: 18px; border-radius: 50%;
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          cursor: pointer; box-shadow: 0 2px 8px rgba(232,168,56,0.3);
          border: 2px solid var(--bg);
        }
        .np-embed-wrap { margin-top: 16px; position: relative; z-index: 1; }
        .np-embed-wrap iframe { width: 100%; height: 150px; border: none; border-radius: var(--radius-md); }
        .np-bg-indicator { text-align: center; margin-top: 12px; padding: 6px 14px; background: rgba(232,168,56,0.06); border: 1px solid rgba(232,168,56,0.08); border-radius: 20px; display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-tertiary); position: relative; z-index: 1; width: auto; }

        /* ===== LIVE DJ CARD ===== */
        .dj-glass {
          background: linear-gradient(135deg, rgba(239,68,68,0.06) 0%, rgba(232,168,56,0.04) 100%);
          border: 1px solid rgba(239,68,68,0.15);
          border-radius: var(--radius-lg);
          padding: 16px; display: flex; align-items: center; gap: 14px;
          animation: djPulse 3s ease-in-out infinite;
        }
        @keyframes djPulse { 0%, 100% { border-color: rgba(239,68,68,0.15); } 50% { border-color: rgba(239,68,68,0.3); } }
        .dj-avatar { width: 48px; height: 48px; border-radius: var(--radius-full); background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); display: flex; align-items: center; justify-content: center; font-size: 20px; color: #fff; flex-shrink: 0; box-shadow: 0 0 20px rgba(232,168,56,0.2); }
        .dj-info { flex: 1; }
        .dj-name { font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 6px; }
        .dj-name .dj-live { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: rgba(239,68,68,0.1); border-radius: 10px; font-size: 9px; font-weight: 700; color: var(--error); text-transform: uppercase; letter-spacing: 0.5px; }
        .dj-name .dj-live i { width: 4px; height: 4px; border-radius: var(--radius-full); background: var(--error); animation: livePulse 1.5s ease-in-out infinite; }
        .dj-status { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
        .dj-duration { font-size: 13px; font-weight: 600; color: var(--primary); flex-shrink: 0; }

        /* ===== SECTION HEADER ===== */
        .section-hdr { display: flex; align-items: center; justify-content: space-between; }
        .section-hdr h3 { font-size: 16px; font-weight: 700; letter-spacing: -0.2px; }
        .section-hdr span { font-size: 12px; color: var(--text-tertiary); font-weight: 500; }

        /* ===== PREMIUM HISTORY LIST ===== */
        .h-list { display: flex; flex-direction: column; gap: 8px; }
        .h-card {
          display: flex; align-items: center; gap: 14px;
          padding: 12px 14px;
          background: linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01));
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: var(--radius-lg);
          transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
          cursor: pointer; position: relative; overflow: hidden;
        }
        .h-card:active { transform: scale(0.98); }
        .h-accent {
          position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
          background: linear-gradient(180deg, var(--gradient-start), var(--gradient-end));
          border-radius: 0 2px 2px 0;
        }
        .h-card.now .h-accent { background: var(--success); }
        .h-glow {
          position: absolute; top: -40px; right: -40px; width: 100px; height: 100px;
          border-radius: var(--radius-full);
          background: radial-gradient(circle, rgba(232,168,56,0.06), transparent 70%);
          pointer-events: none; transition: opacity 0.4s ease; opacity: 0;
        }
        .h-card:hover .h-glow { opacity: 1; }
        .h-cover-wrap { position: relative; flex-shrink: 0; }
        .h-cover { width: 44px; height: 44px; border-radius: var(--radius-md); object-fit: cover; display: block; border: 1px solid var(--border); }
        .h-cover-fallback { width: 44px; height: 44px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--surface-elevated), var(--surface)); color: var(--text-tertiary); font-size: 18px; border: 1px solid var(--border); }

        .h-info { flex: 1; min-width: 0; }
        .h-title { font-size: 14px; font-weight: 600; letter-spacing: -0.1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .h-artist { font-size: 12px; color: var(--text-secondary); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .h-time { font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; font-weight: 500; }

        /* ===== BOTTOM NAV (shared component) ===== */
        .bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; background: rgba(15,15,15,0.92); backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%); border-top: 1px solid var(--border); padding: 8px 0 calc(8px + env(safe-area-inset-bottom, 0px)); z-index: 1000; display: flex; justify-content: space-around; align-items: center; }
        @media (min-width: 480px) { .bottom-nav { max-width: 480px; margin: 0 auto; } }
        .nav-item { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 16px; background: none; border: none; color: var(--text-tertiary); cursor: pointer; transition: all 0.2s ease; position: relative; }
        .nav-item.active { color: var(--primary); }
        .nav-item i { font-size: 22px; transition: transform 0.2s ease; }
        .nav-item:active i { transform: scale(0.85); }
        .nav-item span { font-size: 10px; font-weight: 600; }
        .nav-item .nav-badge { position: absolute; top: 2px; right: 6px; width: 8px; height: 8px; background: var(--error); border-radius: var(--radius-full); border: 2px solid var(--bg); }

        /* ===== SECTION SPACER ===== */
        .section-spacer { display: flex; flex-direction: column; gap: 14px; }
        .section-spacer-sm { display: flex; flex-direction: column; gap: 10px; }

        /* ===== SLEEP TIMER MODAL ===== */
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: flex-end; justify-content: center; z-index: 1000; opacity: 0; pointer-events: none; transition: opacity 0.3s; }
        .modal-overlay.active { opacity: 1; pointer-events: auto; }
        .modal-sheet { background: var(--card); width: 100%; max-width: 480px; border-radius: 20px 20px 0 0; padding: 12px 20px 28px; transform: translateY(100%); transition: transform 0.3s; }
        .modal-overlay.active .modal-sheet { transform: translateY(0); }
        .modal-handle { width: 36px; height: 4px; background: var(--border); border-radius: 2px; margin: 0 auto 16px; }
        .modal-header h2 { font-size: 18px; font-weight: 700; margin: 0 0 16px; text-align: center; }
        .timer-options { display: flex; flex-direction: column; gap: 8px; }
        .timer-option { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-radius: var(--radius-md); background: var(--surface); cursor: pointer; transition: background 0.2s; font-size: 15px; }
        .timer-option i { opacity: 0; color: var(--primary); font-size: 14px; }
        .timer-option.selected { background: rgba(232,168,56,0.12); }
        .timer-option.selected i { opacity: 1; }
        .modal-footer { margin-top: 16px; }
        .modal-footer .btn-primary { width: 100%; padding: 14px; border: none; border-radius: var(--radius-md); background: var(--primary); color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; }
      `}</style>

      <div className="app-container">
        <PremiumTopBar minimal />

        {/* ===== PREMIUM HEADER ===== */}
        <header className="header">
          <button className="header-back" onClick={() => window.history.back()}><i className="fas fa-arrow-left"></i></button>
          <div className="header-info">
            <div className="header-name">MOUNTAIN OF DELIVERANCE CHURCH</div>
            <div className="header-dj">
              <i className="fas fa-tower-cell"></i> {stationName}
            </div>
          </div>
          <div className="header-right">
            <div className={`header-badge ${isLive ? "live" : "off"}`}>
              {isLive ? (
                <><span className="live-dot"></span> Live</>
              ) : "Off Air"}
            </div>
            <div className="listener-count">
              <i className="fas fa-headphones"></i> {currentListeners}
            </div>
          </div>
        </header>

        {/* ===== MAIN CONTENT ===== */}
        <div className="content-scroll">
          <div className="content-inner">
              <div className="section-spacer">
                {/* Now Playing — Premium AzuraCast Embedded Player */}
                <div className="np-glass" style={{ padding: 0, overflow: 'hidden' }}>
                  <RadioEmbed
                    src="https://azuracast.histoview.co.ke/public/mountain_of_delivarance_church/embed?autoplay=1&rounded=1&allow_popup=1&continuous=1"
                    title="MOUNTAIN OF DELIVERANCE CHURCH Radio Player"
                  />
                </div>

                {/* Live DJ */}
                {activeStreamers.length > 0 && activeStreamers.map((dj) => (
                  <div className="dj-glass" key={dj.id}>
                    <div className="dj-avatar"><i className="fas fa-user"></i></div>
                    <div className="dj-info">
                      <div className="dj-name">
                        {dj.displayName}
                        <span className="dj-live"><i></i> LIVE</span>
                      </div>
                      <div className="dj-status">Currently broadcasting live</div>
                    </div>
                    <div className="dj-duration">{dj.lastBroadcast ? "Active" : "Live"}</div>
                  </div>
                ))}

                {/* Recently Played */}
                <div className="section-spacer-sm">
                  <div className="section-hdr">
                    <h3>Recently Played</h3>
                    <span>{songHistory.length} songs</span>
                  </div>
                  {songHistory.length > 0 ? (
                    <div className="h-list">
                      {songHistory.map((item, i) => (
                        <div className={`h-card${i === 0 ? " now" : ""}`} key={i}>
                          <div className="h-glow"></div>
                          <div className="h-accent"></div>
                          <div className="h-cover-wrap">
                            {item.song.albumArt ? (
                              <img className="h-cover" src={item.song.albumArt} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            ) : (
                              <div className="h-cover-fallback"><i className="fas fa-music"></i></div>
                            )}

                          </div>
                          <div className="h-info">
                            <div className="h-title">{item.song.title}</div>
                            <div className="h-artist">{item.song.artist}</div>
                          </div>
                          <span className="h-time">
                            {item.playedAt ? new Date(item.playedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="msg-card"><i className="fas fa-history"></i><p>{radioLoading ? "Loading history..." : "No history available"}</p></div>
                  )}
                </div>
              </div>

          </div>
          <div style={{ height: "16px" }}></div>
        </div>

        {/* ===== APP BOTTOM NAV ===== */}
        <BottomNavBar activeTab="radio" />
      </div>
    </>
  );
}

