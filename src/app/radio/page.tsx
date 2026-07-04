"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAudio } from "@/lib/audio/AudioContext";
import BottomNavBar from "@/components/shared/BottomNavBar";
import ToastBridge from "@/components/dashboard/ToastBridge";
import { getNowPlaying, getSongHistory, getPlaylists, getStationFiles, getSettings, getStreamers, getApiBase, getStationId, getPublicPlayerUrl } from "@/lib/azuracast";
import type { NowPlayingData, SongHistoryItem, Playlist, StationFile, StationSettings, Streamer } from "@/lib/azuracast";
import { churchConfig } from "@/lib/churchConfig";
import { db } from "@/lib/firebase";
import { collection, addDoc, query, where, getDocs, orderBy, serverTimestamp, Timestamp, limit } from "firebase/firestore";

export default function RadioPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("home");

  const [npData, setNpData] = useState<NowPlayingData | null>(null);
  const [songHistory, setSongHistory] = useState<SongHistoryItem[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [stationFiles, setStationFiles] = useState<StationFile[]>([]);
  const [settings, setSettings] = useState<StationSettings | null>(null);
  const [streamers, setStreamers] = useState<Streamer[]>([]);
  const [radioLoading, setRadioLoading] = useState(true);

  // Song request state
  const [requestSearch, setRequestSearch] = useState("");
  const [requestedSongs, setRequestedSongs] = useState<Set<string>>(new Set());
  const [lastRequestTime, setLastRequestTime] = useState<number | null>(null);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [requestLoading, setRequestLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const [sessionId] = useState(() => `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);



  const audio = useAudio();
  const listenUrl = npData?.station?.listenUrl || `${getApiBase()}/listen/${getStationId()}/radio.mp3`;
  const embedUrl = `${getPublicPlayerUrl()}/embed`;
  const stationName = settings?.name || "Kingdom Seekers Radio";
  // YouTube live indicator removed

  // Push now-playing metadata to Android media notification
  useEffect(() => {
    if (audio.isPlaying) {
      const np = npData?.nowPlaying;
      const title = np?.song?.title || stationName;
      const artist = np?.song?.artist || "Kingdom Seekers Church Nakuru";
      const albumArt = np?.song?.albumArt;
      audio.updateMediaSession(title, artist, albumArt);
    }
  }, [audio.isPlaying, audio.currentStationId, npData?.nowPlaying?.song?.title, npData?.nowPlaying?.song?.artist, npData?.nowPlaying?.song?.albumArt, audio.updateMediaSession, stationName]);

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
      const [pl, files, s, str] = await Promise.all([
        getPlaylists().catch(() => [] as Playlist[]),
        getStationFiles().catch(() => [] as StationFile[]),
        getSettings().catch(() => null as StationSettings | null),
        getStreamers().catch(() => [] as Streamer[]),
      ]);
      if (!mounted) return;
      setPlaylists(pl);
      setStationFiles(files);
      setSettings(s);
      setStreamers(str);
    };
    fetchMeta();
    return () => { mounted = false; };
  }, []);

  // Request cooldown timer
  useEffect(() => {
    if (!lastRequestTime) return;
    const elapsed = Math.floor((currentTime - lastRequestTime) / 1000);
    const remaining = Math.max(0, 1800 - elapsed);
    if (remaining <= 0) return;
    setTimeout(() => setCooldownLeft(remaining), 0);
    const interval = setInterval(() => {
      const e = Math.floor((currentTime - lastRequestTime) / 1000);
      setCooldownLeft(Math.max(0, 1800 - e));
    }, 1000);
    return () => clearInterval(interval);
  }, [lastRequestTime]);

  const handleRequest = async (fileId: string, songTitle: string, songArtist: string) => {
    const now = currentTime;
    if (lastRequestTime && (now - lastRequestTime) < 1800000) {
      const mins = Math.ceil((1800000 - (now - lastRequestTime)) / 60000);
      showToast("Cooldown Active", `Please wait ${mins} min before requesting again`, "warning", 3000);
      return;
    }
    setRequestLoading(true);
    try {
      await addDoc(collection(db, "radio_requests"), {
        sessionId,
        songId: fileId,
        songTitle,
        songArtist,
        stationId: Number(getStationId()),
        stationName: stationName || "Radio",
        requestedAt: serverTimestamp(),
      });
      setRequestedSongs(new Set(requestedSongs).add(fileId));
      setLastRequestTime(now);
      showToast("Request Submitted!", `"${songTitle}" has been sent to the DJ`, "success", 3000);
    } catch (err) {
      showToast("Request Failed", "Could not send request. Please try again.", "error", 3000);
    }
    setRequestLoading(false);
  };

  /* Load user's request history from Firestore on mount */
  useEffect(() => {
    let mounted = true;
    const loadRequests = async () => {
      try {
        const q = query(
          collection(db, "radio_requests"),
          where("sessionId", "==", sessionId),
          orderBy("requestedAt", "desc"),
          limit(50)
        );
        const snap = await getDocs(q);
        if (!mounted) return;
        setRequestedSongs(new Set(snap.docs.map((d) => d.data().songId)));
      } catch {}
    };
    loadRequests();
    return () => { mounted = false; };
  }, [sessionId]);

  const handleCopyStream = async () => {
    try {
      const { Clipboard } = await import("@capacitor/clipboard");
      await Clipboard.write({ string: embedUrl });
    } catch {
      navigator.clipboard.writeText(embedUrl).catch(() => {});
    }
    showToast("Copied!", "Stream URL copied to clipboard", "success", 2000);
  };

  const handleShare = async () => {
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: `${stationName} Radio`, text: `Tune in to ${stationName} Radio!`, url: embedUrl });
    } catch {
      if (navigator.share) {
        navigator.share({ title: `${stationName} Radio`, text: `Tune in to ${stationName} Radio!`, url: embedUrl }).catch(() => {});
      } else {
        handleCopyStream();
      }
    }
  };

  // ========== TOAST ==========
  function showToast(title: string, message: string, type: string, duration: number) {
    window.dispatchEvent(new CustomEvent("show-toast", { detail: { title, message, type, duration } }));
  }

  const formatCooldown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const np = npData?.nowPlaying;
  const isLive = npData?.live?.isLive ?? false;
  const liveStreamerName = npData?.live?.streamerName;
  const currentListeners = npData?.listeners?.current ?? 0;

  /* Filter requestable songs */
  const filteredRequests = stationFiles.filter(
    (s) => !requestSearch || s.title.toLowerCase().includes(requestSearch.toLowerCase()) || s.artist.toLowerCase().includes(requestSearch.toLowerCase())
  );

  const activeStreamers = streamers.filter((s) => s.isLive);

  /* ===== SCHEDULE TAB DERIVATION ===== */
  const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const getNextNDays = (n: number) => {
    const today = new Date().getDay();
    return Array.from({ length: n }, (_, i) => (today + i) % 7);
  };
  const scheduledPlaylists = playlists.filter((p) => p.type === "scheduled" && p.schedule);
  const nextDays = getNextNDays(7);
  const scheduleByDay = nextDays.map((dayIdx) => {
    const dayName = DAY_NAMES[dayIdx];
    const isToday = dayIdx === new Date().getDay();
    const items = scheduledPlaylists
      .filter((p) => p.schedule!.days.includes(dayIdx))
      .map((p) => ({
        name: p.name,
        time: p.schedule!.startTime?.slice(0, 5) || "09:00",
        type: (p.name.toLowerCase().includes("worship") ? "worship" : p.name.toLowerCase().includes("sermon") ? "sermon" : "praise") as "worship" | "sermon" | "praise",
      }))
      .sort((a, b) => a.time.localeCompare(b.time));
    return { dayName, isToday, items };
  }).filter((d) => d.items.length > 0);
  const nextShow = scheduleByDay[0]?.items[0] || null;
  const nextShowTime = nextShow ? `${scheduleByDay[0]?.dayName === "Sun" ? "Today" : scheduleByDay[0]?.dayName} at ${nextShow.time}` : "";
  const now = new Date();
  const nowH = now.getHours();
  const nowM = now.getMinutes();
  const nowStr = `${String(nowH).padStart(2, "0")}:${String(nowM).padStart(2, "0")}`;

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
        .status-bar { height: env(safe-area-inset-top, 24px); min-height: 24px; background: var(--bg); flex-shrink: 0; }

        /* ===== PREMIUM HEADER ===== */
        .header { padding: 12px 16px 10px; display: flex; align-items: center; gap: 12px; flex-shrink: 0; background: var(--bg); border-bottom: 1px solid var(--border); }
        .header-logo { width: 40px; height: 40px; background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: var(--shadow-soft); }
        .header-logo i { font-size: 18px; color: #fff; }
        .header-info { flex: 1; min-width: 0; }
        .header-name { font-size: 16px; font-weight: 700; line-height: 1.2; letter-spacing: -0.2px; }
        .header-dj { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; display: flex; align-items: center; gap: 5px; }
        .header-dj .live-dot { width: 6px; height: 6px; border-radius: var(--radius-full); background: var(--error); animation: livePulse 1.5s ease-in-out infinite; }
        @keyframes livePulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.6); } }
        .header-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .header-badge {
          display: flex; align-items: center; gap: 5px; padding: 4px 12px; border-radius: 20px;
          font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px;
          transition: all 0.3s ease;
        }
        .header-badge.live { background: rgba(239,68,68,0.12); color: var(--error); border: 1px solid rgba(239,68,68,0.2); }
        .header-badge.off { background: var(--surface-elevated); color: var(--text-tertiary); border: 1px solid var(--border); }
        .listener-count { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-secondary); font-weight: 600; white-space: nowrap; background: var(--surface-elevated); padding: 4px 10px; border-radius: 20px; border: 1px solid var(--border); }
        .listener-count i { font-size: 10px; color: var(--text-tertiary); }
        .yt-live-indicator { display: flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: #FF0000; cursor: pointer; padding: 4px 10px; border-radius: 20px; background: rgba(255,0,0,0.08); border: 1px solid rgba(255,0,0,0.15); white-space: nowrap; transition: all 0.2s; }
        .yt-live-indicator:active { transform: scale(0.95); background: rgba(255,0,0,0.15); }

        /* ===== CONTENT SCROLL ===== */
        .content-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; padding-bottom: 80px; }
        .content-scroll::-webkit-scrollbar { display: none; }
        .content-inner { padding: 16px; display: flex; flex-direction: column; gap: 20px; }

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

        /* ===== TAB BAR (premium) ===== */
        .radio-tabs {
          display: flex; gap: 4px; padding: 8px 12px;
          background: var(--bg); border-bottom: 1px solid var(--border); flex-shrink: 0;
        }
        .radio-tab {
          flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;
          padding: 10px 4px 8px;
          border-radius: var(--radius-md);
          border: none; background: transparent;
          color: var(--text-tertiary); font-size: 10px; font-weight: 600;
          cursor: pointer; transition: all 0.25s cubic-bezier(0.4,0,0.2,1); position: relative;
        }
        .radio-tab i { font-size: 20px; transition: transform 0.2s ease; }
        .radio-tab:active i { transform: scale(0.85); }
        .radio-tab.active { color: var(--primary); background: var(--surface-elevated); }
        .radio-tab.active::after {
          content: ''; position: absolute; bottom: -8px; left: 20%; right: 20%;
          height: 2.5px; border-radius: 2px;
          background: linear-gradient(90deg, var(--gradient-start), var(--gradient-end));
        }

        /* ===== SCHEDULE TAB (premium) ===== */
        .sched-next {
          background: linear-gradient(135deg, rgba(232,168,56,0.08), rgba(232,168,56,0.02));
          border: 1px solid rgba(232,168,56,0.15);
          border-radius: var(--radius-lg);
          padding: 16px 18px;
          display: flex; align-items: center; gap: 14px;
        }
        .sched-next-icon {
          width: 44px; height: 44px; border-radius: var(--radius-md);
          background: rgba(232,168,56,0.1);
          display: flex; align-items: center; justify-content: center;
          font-size: 20px; color: var(--primary); flex-shrink: 0;
        }
        .sched-next-info { flex: 1; }
        .sched-next-label { font-size: 10px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 1px; font-weight: 600; }
        .sched-next-name { font-size: 15px; font-weight: 700; margin-top: 3px; }
        .sched-next-time { font-size: 13px; color: var(--primary); font-weight: 700; flex-shrink: 0; }

        .sched-day-group { margin-bottom: 16px; }
        .sched-day-header {
          font-size: 12px; font-weight: 700; margin-bottom: 8px;
          padding: 0 2px; display: flex; align-items: center; gap: 8px;
          text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-tertiary);
        }
        .sched-day-header.today { color: var(--primary); }
        .sched-day-header .day-line { flex: 1; height: 1px; background: var(--border); }

        .sched-item {
          display: flex; align-items: center; gap: 14px;
          padding: 12px 14px;
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          margin-bottom: 8px;
          transition: all 0.2s ease; cursor: pointer;
        }
        .sched-item:active { background: var(--surface-elevated); transform: scale(0.98); }
        .sched-item.active { border-color: rgba(34,197,94,0.3); }
        .sched-time { font-size: 13px; font-weight: 700; color: var(--text-secondary); min-width: 52px; }
        .sched-dot { width: 8px; height: 8px; border-radius: var(--radius-full); flex-shrink: 0; }
        .sched-dot.worship { background: var(--primary); box-shadow: 0 0 8px rgba(232,168,56,0.4); }
        .sched-dot.sermon { background: var(--info); box-shadow: 0 0 8px rgba(56,189,248,0.4); }
        .sched-dot.praise { background: #8B5CF6; box-shadow: 0 0 8px rgba(139,92,246,0.4); }
        .sched-info { flex: 1; min-width: 0; }
        .sched-name { font-size: 14px; font-weight: 600; }
        .sched-host { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
        .sched-type-badge {
          padding: 3px 10px; border-radius: 6px; font-size: 10px; font-weight: 700;
          flex-shrink: 0; letter-spacing: 0.3px;
        }
        .sched-type-badge.worship { background: rgba(232,168,56,0.1); color: var(--primary); }
        .sched-type-badge.sermon { background: rgba(56,189,248,0.1); color: var(--info); }
        .sched-type-badge.praise { background: rgba(139,92,246,0.1); color: #8B5CF6; }
        .sched-now { padding: 2px 8px; border-radius: 10px; font-size: 9px; font-weight: 800; background: rgba(74,222,128,0.12); color: var(--success); text-transform: uppercase; letter-spacing: 0.5px; flex-shrink: 0; }
        .sched-empty-state { text-align: center; padding: 40px 20px; }
        .sched-empty-state i { font-size: 40px; color: var(--text-tertiary); margin-bottom: 12px; display: block; opacity: 0.5; }
        .sched-empty-state h3 { font-size: 18px; font-weight: 700; margin-bottom: 6px; }
        .sched-empty-state p { font-size: 14px; color: var(--text-secondary); }

        /* ===== REQUESTS TAB (premium) ===== */
        .req-search-wrap { position: relative; }
        .req-search-wrap i { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); font-size: 16px; pointer-events: none; z-index: 1; }
        .req-search-wrap input {
          width: 100%; padding: 14px 14px 14px 44px;
          background: var(--surface-card); border: 1.5px solid var(--border);
          border-radius: var(--radius-lg); color: var(--text-primary);
          font-size: 14px; font-weight: 500; outline: none;
        }
        .req-search-wrap input:focus { border-color: var(--primary); box-shadow: 0 0 0 4px rgba(232,168,56,0.08); }
        .req-search-wrap input::placeholder { color: var(--text-tertiary); font-weight: 400; }

        .req-cooldown {
          padding: 12px 14px;
          background: rgba(251,191,36,0.06); border: 1px solid rgba(251,191,36,0.15);
          border-radius: var(--radius-md);
          display: flex; align-items: center; gap: 10px;
          font-size: 13px; color: var(--warning);
        }
        .req-cooldown .req-cool-icon { font-size: 18px; color: var(--warning); flex-shrink: 0; }

        .req-list { display: flex; flex-direction: column; gap: 8px; }
        .req-card {
          display: flex; align-items: center; gap: 14px;
          padding: 12px 14px;
          background: var(--surface-card); border: 1px solid var(--border);
          border-radius: var(--radius-md);
          transition: all 0.2s ease;
        }
        .req-card:active { background: var(--surface-elevated); }
        .req-cover { width: 42px; height: 42px; border-radius: 8px; object-fit: cover; flex-shrink: 0; border: 1px solid var(--border); }
        .req-cover-fallback { width: 42px; height: 42px; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: var(--surface-elevated); color: var(--text-tertiary); font-size: 16px; flex-shrink: 0; border: 1px solid var(--border); }
        .req-info { flex: 1; min-width: 0; }
        .req-title { font-size: 14px; font-weight: 600; }
        .req-artist { font-size: 12px; color: var(--text-secondary); margin-top: 1px; }
        .req-btn {
          padding: 8px 18px; border-radius: 8px; font-size: 12px; font-weight: 700;
          border: none; cursor: pointer; transition: all 0.2s ease; flex-shrink: 0;
          display: flex; align-items: center; gap: 5px;
        }
        .req-btn:active { transform: scale(0.93); }
        .req-btn.request { background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); color: #fff; box-shadow: var(--shadow-soft); }
        .req-btn.done { background: var(--surface-elevated); color: var(--success); border: 1px solid rgba(74,222,128,0.2); cursor: default; }
        .req-btn.cooldown { background: var(--surface-elevated); color: var(--text-tertiary); cursor: default; }
        .req-empty-state { text-align: center; padding: 30px; color: var(--text-tertiary); font-size: 14px; }

        .req-recent-list { display: flex; flex-direction: column; gap: 6px; }
        .req-recent-item {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 14px;
          background: var(--surface-card); border: 1px solid var(--border);
          border-radius: var(--radius-md); font-size: 13px;
        }
        .req-recent-avatar { width: 32px; height: 32px; border-radius: var(--radius-full); background: rgba(74,222,128,0.1); display: flex; align-items: center; justify-content: center; font-size: 13px; color: var(--success); flex-shrink: 0; }
        .req-recent-info { flex: 1; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
        .req-recent-song { color: var(--primary); font-weight: 600; }
        .req-recent-time { font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; }

        /* ===== ABOUT TAB (premium) ===== */
        .about-wrap { padding: 24px; text-align: center; }
        .about-logo-wrap {
          width: 88px; height: 88px; margin: 0 auto 18px;
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          border-radius: 24px;
          display: flex; align-items: center; justify-content: center;
          box-shadow: var(--shadow-soft), 0 0 60px rgba(232,168,56,0.1);
        }
        .about-logo-wrap i { font-size: 38px; color: #fff; }
        .about-name { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 6px; }
        .about-tagline { font-size: 14px; color: var(--text-secondary); max-width: 300px; margin: 0 auto 28px; line-height: 1.6; }

        .about-stream-box {
          display: flex; align-items: center; gap: 8px;
          padding: 12px 14px; background: var(--surface-card);
          border: 1px solid var(--border); border-radius: var(--radius-md);
          margin-bottom: 20px;
        }
        .about-stream-text { flex: 1; font-size: 12px; color: var(--text-secondary); font-family: monospace; word-break: break-all; }
        .about-copy-btn {
          width: 36px; height: 36px; border-radius: 8px; background: var(--surface-elevated);
          border: none; color: var(--text-secondary); font-size: 16px;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; transition: all 0.2s ease;
        }
        .about-copy-btn:active { background: var(--primary); color: #fff; }

        .about-social-row { display: flex; gap: 10px; }
        .about-social-btn {
          flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px;
          padding: 14px; border-radius: var(--radius-md); font-size: 14px; font-weight: 600;
          cursor: pointer; transition: all 0.2s ease;
          border: 1.5px solid var(--border); background: var(--surface-card); color: var(--text-primary);
        }
        .about-social-btn:active { background: var(--surface-elevated); transform: scale(0.97); }

        .about-actions-stack { display: flex; flex-direction: column; gap: 10px; }
        .about-action-btn {
          width: 100%; padding: 15px; border-radius: var(--radius-md);
          font-size: 15px; font-weight: 700; cursor: pointer;
          transition: all 0.2s ease;
          display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        .about-action-btn:active { transform: scale(0.97); }
        .about-action-btn.share { background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end)); color: #fff; border: none; box-shadow: var(--shadow-soft); }
        .about-action-btn.install { background: var(--surface-card); color: var(--text-primary); border: 1.5px solid var(--border); }
        .about-footer { margin-top: 28px; font-size: 12px; color: var(--text-tertiary); }
        .about-footer strong { color: var(--primary); }

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
        <div className="status-bar"></div>

        {/* ===== PREMIUM HEADER ===== */}
        <header className="header">
          <div className="header-logo"><i className="fas fa-church"></i></div>
          <div className="header-info">
            <div className="header-name">{stationName}</div>
            <div className="header-dj">
              {isLive ? (
                <><span className="live-dot"></span> Live{liveStreamerName ? ` with ${liveStreamerName}` : ""}</>
              ) : radioLoading ? "Connecting..." : "Offline"}
            </div>
          </div>
          <div className="header-right">
            <div className={`header-badge ${isLive ? "live" : "off"}`}>
              {isLive ? "On Air" : "Off Air"}
            </div>
            <div className="listener-count">
              <i className="fas fa-headphones"></i> {currentListeners}
            </div>
// YouTube live indicator removed
          </div>
        </header>

        {/* ===== PREMIUM TAB BAR ===== */}
        <nav className="radio-tabs">
          <button className={`radio-tab ${activeTab === "home" ? "active" : ""}`} onClick={() => setActiveTab("home")}>
            <i className="fas fa-house"></i>Home
          </button>
          <button className={`radio-tab ${activeTab === "schedule" ? "active" : ""}`} onClick={() => setActiveTab("schedule")}>
            <i className="fas fa-calendar-days"></i>Schedule
          </button>
          <button className={`radio-tab ${activeTab === "requests" ? "active" : ""}`} onClick={() => setActiveTab("requests")}>
            <i className="fas fa-hand"></i>Requests
          </button>
          <button className={`radio-tab ${activeTab === "about" ? "active" : ""}`} onClick={() => setActiveTab("about")}>
            <i className="fas fa-circle-info"></i>About
          </button>
        </nav>

        {/* ===== MAIN CONTENT ===== */}
        <div className="content-scroll">
          <div className="content-inner">

            {/* ===== TAB 1: HOME ===== */}
            {activeTab === "home" && (
              <div className="section-spacer">
                {/* Now Playing — premium hero card with volume controls */}
                <div className="np-glass">
                  <div className="np-row">
                    {np?.song?.albumArt ? (
                      <div className="np-art"><img src={np.song.albumArt} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} /></div>
                    ) : (
                      <div className="np-art-fallback"><i className="fas fa-radio"></i></div>
                    )}
                    <div className="np-body">
                      <div className="np-title">{np?.song?.title || "Not Playing"}</div>
                      <div className="np-artist">{np?.song?.artist || "Station is offline"}</div>
                      {np && np.duration > 0 && (
                        <div className="np-progress">
                          <div className="np-progress-bar">
                            <div className="np-progress-fill" style={{ width: `${Math.min(100, (np.elapsed / np.duration) * 100)}%` }}></div>
                          </div>
                          <div className="np-progress-time">
                            <span>{formatTime(np.elapsed)}</span>
                            <span>{formatTime(np.duration)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Controls row: play button + volume slider */}
                  <div className="np-controls-row">
                    <button
                      className={`np-play-btn${audio.isPlaying ? " playing" : ""}`}
                      onClick={() => audio.toggle(listenUrl, Number(getStationId()))}
                    >
                      <i className={`fas fa-${audio.isPlaying ? "pause" : "play"}`} style={{ marginLeft: audio.isPlaying ? 0 : 2 }}></i>
                    </button>
                    <div className="np-vol-wrap">
                      <i className={`fas fa-${audio.volume === 0 ? "volume-xmark" : audio.volume < 0.5 ? "volume-low" : "volume-high"}`}></i>
                      <input
                        type="range"
                        className="np-vol-slider"
                        min="0"
                        max="1"
                        step="0.05"
                        value={audio.volume}
                        onChange={(e) => audio.setVolume(parseFloat(e.target.value))}
                      />
                    </div>
                  </div>
                  {/* AzuraCast Embed Player */}
                  <div className="np-embed-wrap">
                    <iframe src="https://azuracast.histoview.co.ke/public/turningpoint_church/embed?theme=dark" style={{ width: "100%", minHeight: 150, height: 150, border: "none", display: "block", borderRadius: 12 }}></iframe>
                  </div>

                  {audio.isPlaying && (
                    <div className="np-bg-indicator">
                      <i className="fas fa-volume-high" style={{ color: "var(--primary)" }}></i>
                      Playing in background
                    </div>
                  )}
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
            )}

            {/* ===== TAB 2: SCHEDULE ===== */}
            {activeTab === "schedule" && (
              <div className="section-spacer">
                {/* Next Show Card */}
                {nextShow && (
                  <div className="sched-next">
                    <div className="sched-next-icon"><i className="fas fa-calendar"></i></div>
                    <div className="sched-next-info">
                      <div className="sched-next-label">Next Show</div>
                      <div className="sched-next-name">{nextShow.name}</div>
                    </div>
                    <div className="sched-next-time">{nextShowTime}</div>
                  </div>
                )}

                {/* Schedule By Day */}
                {scheduleByDay.length === 0 ? (
                  <div className="sched-empty-state">
                    <i className="fas fa-calendar-xmark"></i>
                    <h3>No Scheduled Broadcasts</h3>
                    <p>Check back for upcoming shows</p>
                  </div>
                ) : (
                  scheduleByDay.map((day, di) => (
                    <div className="sched-day-group" key={di}>
                      <div className={`sched-day-header${day.isToday ? " today" : ""}`}>
                        <span className="day-line"></span>
                        {day.isToday ? "Today" : day.dayName}
                        <span className="day-line"></span>
                      </div>
                      {day.items.map((item, ii) => (
                        <div className={`sched-item${nowStr >= item.time ? " active" : ""}`} key={ii}>
                          <span className="sched-time">{item.time}</span>
                          <div className={`sched-dot ${item.type}`}></div>
                          <div className="sched-info">
                            <div className="sched-name">{item.name}</div>
                            <div className="sched-host">Kingdom Seekers Church</div>
                          </div>
                          <span className={`sched-type-badge ${item.type}`}>{item.type}</span>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ===== TAB 3: REQUESTS ===== */}
            {activeTab === "requests" && (
              <div className="section-spacer">
                {/* Search */}
                <div className="req-search-wrap">
                  <i className="fas fa-search"></i>
                  <input type="text" placeholder="Search song or artist..." value={requestSearch} onChange={(e) => setRequestSearch(e.target.value)} />
                </div>

                {/* Cooldown */}
                {cooldownLeft > 0 && (
                  <div className="req-cooldown">
                    <i className="fas fa-hourglass-half req-cool-icon"></i>
                    Next request in <strong>{formatCooldown(cooldownLeft)}</strong>
                  </div>
                )}

                {/* Requestable Songs */}
                {filteredRequests.length === 0 ? (
                  <div className="req-empty-state">
                    <i className="fas fa-music" style={{ fontSize: 32, display: "block", marginBottom: 12, color: "var(--text-tertiary)", opacity: 0.5 }}></i>
                    {requestSearch ? `No songs found matching "${requestSearch}"` : "No songs available for request"}
                  </div>
                ) : (
                  <div className="req-list">
                    {filteredRequests.map((file) => {
                      const alreadyRequested = requestedSongs.has(file.id);
                      const onCooldown = lastRequestTime !== null && (currentTime - lastRequestTime) < 1800000 && !alreadyRequested;
                      const isLoading = requestLoading;
                      let btnClass = "request";
                      let btnText = "Request";
                      if (alreadyRequested) { btnClass = "done"; btnText = "Done!"; }
                      else if (onCooldown) { btnClass = "cooldown"; btnText = "Wait"; }
                      return (
                        <div className="req-card" key={file.id}>
                          {file.albumArt ? (
                            <img className="req-cover" src={file.albumArt} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          ) : (
                            <div className="req-cover-fallback"><i className="fas fa-music"></i></div>
                          )}
                          <div className="req-info">
                            <div className="req-title">{file.title}</div>
                            <div className="req-artist">{file.artist}</div>
                          </div>
                          <button className={`req-btn ${btnClass}`} onClick={() => !alreadyRequested && !onCooldown && !isLoading && handleRequest(file.id, file.title, file.artist)}>
                            {isLoading ? <><i className="fas fa-spinner fa-spin"></i></> : null}
                            {btnText}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Recent Requests from Firestore */}
                {requestedSongs.size > 0 && (
                  <div className="section-spacer-sm">
                    <div className="section-hdr">
                      <h3>Your Requests</h3>
                      <span>{requestedSongs.size} requested</span>
                    </div>
                    <div className="req-recent-list">
                      {Array.from(requestedSongs).slice(-10).reverse().map((id) => {
                        const file = stationFiles.find((f) => f.id === id);
                        return file ? (
                          <div className="req-recent-item" key={id}>
                            <div className="req-recent-avatar"><i className="fas fa-check"></i></div>
                            <div className="req-recent-info">
                              Requested <span className="req-recent-song">{file.title}</span>
                            </div>
                            <span className="req-recent-time">✓</span>
                          </div>
                        ) : null;
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ===== TAB 4: ABOUT ===== */}
            {activeTab === "about" && (
              <div className="about-wrap">
                <div className="about-logo-wrap"><i className="fas fa-church"></i></div>
                <div className="about-name">{stationName}</div>
                <p className="about-tagline">{churchConfig.tagline}</p>

                {/* Stream URL */}
                <div className="about-stream-box">
                  <span className="about-stream-text">{embedUrl}</span>
                  <button className="about-copy-btn" onClick={handleCopyStream}>
                    <i className="fas fa-copy"></i>
                  </button>
                </div>

                {/* Contact Info from churchConfig */}
                {(churchConfig.email || churchConfig.phone || churchConfig.address) && (
                  <div className="about-stream-box" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6, marginBottom: 16 }}>
                    {churchConfig.email && <span style={{ fontSize: 13, color: "var(--text-secondary)" }}><i className="fas fa-envelope" style={{ width: 18, color: "var(--primary)" }}></i> {churchConfig.email}</span>}
                    {churchConfig.phone && <span style={{ fontSize: 13, color: "var(--text-secondary)" }}><i className="fas fa-phone" style={{ width: 18, color: "var(--primary)" }}></i> {churchConfig.phone}</span>}
                    {churchConfig.address && <span style={{ fontSize: 13, color: "var(--text-secondary)" }}><i className="fas fa-location-dot" style={{ width: 18, color: "var(--primary)" }}></i> {churchConfig.address}</span>}
                  </div>
                )}

                {/* Social Links from churchConfig */}
                <div className="about-social-row">
                  {(churchConfig.social.facebook_url || true) && (
                    <button className="about-social-btn" onClick={async () => { if (churchConfig.social.facebook_url) { try { const { Browser } = await import("@capacitor/browser"); await Browser.open({ url: churchConfig.social.facebook_url }); } catch { window.open(churchConfig.social.facebook_url, "_blank"); } } }}>
                      <i className="fab fa-facebook" style={{ color: "#1877F2" }}></i>
                    </button>
                  )}
                  {/* YouTube social button removed */}
                  {(churchConfig.social.whatsapp_number || true) && (
                    <button className="about-social-btn" onClick={async () => { if (churchConfig.social.whatsapp_number) { try { const { Browser } = await import("@capacitor/browser"); await Browser.open({ url: `https://wa.me/${churchConfig.social.whatsapp_number.replace(/[^0-9]/g, "")}` }); } catch { window.open(`https://wa.me/${churchConfig.social.whatsapp_number.replace(/[^0-9]/g, "")}`, "_blank"); } } }}>
                      <i className="fab fa-whatsapp" style={{ color: "#25D366" }}></i>
                    </button>
                  )}
                  {(churchConfig.social.instagram_url || true) && (
                    <button className="about-social-btn" onClick={async () => { if (churchConfig.social.instagram_url) { try { const { Browser } = await import("@capacitor/browser"); await Browser.open({ url: churchConfig.social.instagram_url }); } catch { window.open(churchConfig.social.instagram_url, "_blank"); } } }}>
                      <i className="fab fa-instagram" style={{ color: "#E4405F" }}></i>
                    </button>
                  )}
                </div>

                <div className="about-actions-stack">
                  <button className="about-action-btn share" onClick={handleShare}>
                    <i className="fas fa-share-nodes"></i> Share Station
                  </button>
                  {/* Browse Videos button removed */}
                </div>

                <div className="about-footer">
                  Powered by <strong>Kingdom Seekers Church Nakuru</strong> · v1.0.0
                </div>
              </div>
            )}

          </div>
          <div style={{ height: "16px" }}></div>
        </div>

        {/* ===== APP BOTTOM NAV ===== */}
        <BottomNavBar activeTab="radio" />
      </div>
    </>
  );
}

