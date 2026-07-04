"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import ToastBridge from "@/components/dashboard/ToastBridge";
import BottomNavBar from "@/components/shared/BottomNavBar";
import { useAppStore } from "@/lib/useAppStore";
import { getMeeting, generateLiveKitToken } from "@/lib/meetings";
import type { Meeting } from "@/lib/meetings";
import { Room, RoomEvent } from "livekit-client";

export default function MemberListenPage() {
  const router = useRouter();
  const params = useParams();
  const meetingId = params?.id as string;
  const userDoc = useAppStore((s) => s.userDoc);
  const user = useAppStore((s) => s.user);

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState<string[]>([]);
  const [speakingParticipants, setSpeakingParticipants] = useState<Set<string>>(new Set());
  const [isMuted, setIsMuted] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [showInfo, setShowInfo] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMutedRef = useRef(true);

  const displayName = userDoc?.display_name || user?.displayName || user?.email?.split("@")[0] || "You";
  const identity = user?.uid || `member-${Date.now()}`;

  function showToast(title: string, message: string, type: string, duration: number) {
    window.dispatchEvent(new CustomEvent("show-toast", { detail: { title, message, type, duration } }));
  }

  // Load meeting and auto-connect
  useEffect(() => {
    if (!meetingId) return;
    getMeeting(meetingId)
      .then((m) => {
        if (m) {
          setMeeting(m);
          if (m.status !== "ended") {
            connectToRoom(m);
          } else {
            showToast("Ended", "This meeting has ended", "info", 3000);
            setLoading(false);
          }
        } else {
          showToast("Error", "Meeting not found", "error", 3000);
          setLoading(false);
        }
      })
      .catch((e) => {
        console.error("Failed to load meeting:", e);
        showToast("Error", "Could not load meeting", "error", 3000);
        setLoading(false);
      });
  }, [meetingId]);

  const connectToRoom = async (m: Meeting) => {
    if (!m.roomName || connecting) return;
    setConnecting(true);
    try {
      const { token, url } = await generateLiveKitToken(m.roomName, identity);

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      room.on(RoomEvent.ParticipantConnected, (p) => {
        setParticipants((prev) => [...prev.filter((n) => n !== p.identity), p.identity]);
      });

      room.on(RoomEvent.ParticipantDisconnected, (p) => {
        setParticipants((prev) => prev.filter((n) => n !== p.identity));
      });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const speakingNames = new Set<string>();
        for (const s of speakers) {
          if (s.identity !== identity) {
            speakingNames.add(s.identity);
          }
        }
        setSpeakingParticipants(speakingNames);
      });

      room.on(RoomEvent.Reconnecting, () => {
        // Abort reconnection — room is likely ended by host
        if (roomRef.current) {
          roomRef.current.disconnect();
        }
      });

      room.on(RoomEvent.Disconnected, async () => {
        setConnected(false);
        setParticipants([]);
        setSpeakingParticipants(new Set());
        roomRef.current = null;
        if (timerRef.current) clearInterval(timerRef.current);
        // Re-check meeting status from Firestore
        try {
          const freshMeeting = await getMeeting(meetingId);
          if (freshMeeting) setMeeting(freshMeeting);
        } catch {
          // ignore
        }
      });

      await room.connect(url, token);

      // Start audio context for remote track playback (best-effort for desktop)
      room.startAudio().catch(() => {});

      // On mobile/Android WebView, audio autoplay is blocked until a user gesture.
      // Set up a one-tap handler to resume audio context on first interaction.
      const startAudioOnce = () => {
        room.startAudio().catch(() => {});
        document.removeEventListener('click', startAudioOnce);
        document.removeEventListener('touchstart', startAudioOnce);
      };
      document.addEventListener('click', startAudioOnce, { once: true });
      document.addEventListener('touchstart', startAudioOnce, { once: true });

      // Join listen-only — don't create any mic track yet
      roomRef.current = room;
      setConnected(true);
      setConnecting(false);
      setLoading(false);
      setElapsed(0);

      const startedAt = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);

      const remoteNames = Array.from(room.remoteParticipants.values()).map((p) => p.identity);
      setParticipants(remoteNames);
      showToast("Connected", `You joined "${m.title}"`, "success", 3000);
    } catch (e) {
      console.error("Failed to connect:", e);
      showToast("Connection Failed", e instanceof Error ? e.message : "Could not connect", "error", 4000);
      setConnecting(false);
      setLoading(false);
    }
  };

  const leaveMeeting = () => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    if (timerRef.current) clearInterval(timerRef.current);
    router.push("/meetings");
  };

  const toggleMute = async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      if (isMutedRef.current) {
        // Currently muted — enable mic (creates + publishes track)
        await room.localParticipant.setMicrophoneEnabled(true);
      } else {
        // Currently unmuted — disable mic
        await room.localParticipant.setMicrophoneEnabled(false);
      }
      isMutedRef.current = !isMutedRef.current;
      setIsMuted(isMutedRef.current);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not access microphone";
      console.error("Toggle mute failed:", e);
      showToast("Mic Error", msg, "error", 4000);
    }
  };

  const formatElapsed = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Loading screen
  if (loading) {
    return (
      <div style={{
        height: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", background: "#0A0A0F", gap: 24, fontFamily: "Inter, sans-serif"
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: "50%",
          background: "linear-gradient(135deg, #3B82F6, #8B5CF6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 0 40px rgba(59,130,246,0.3)", animation: "pulseLoad 1.5s ease-in-out infinite"
        }}>
          <i className="fas fa-headphones" style={{ fontSize: 32, color: "#fff" }}></i>
        </div>
        <div style={{ color: "#E8A838", fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>
          {connecting ? "Connecting..." : "Loading..."}
        </div>
        <div style={{ width: 200, height: 3, background: "#1A1A1A", borderRadius: 2, overflow: "hidden" }}>
          <div style={{
            height: "100%", width: "40%", background: "linear-gradient(90deg, #3B82F6, #8B5CF6)",
            borderRadius: 2, animation: "slide 1.2s ease-in-out infinite"
          }}></div>
        </div>
        <style>{`
          @keyframes pulseLoad { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.05); opacity: 0.8; } }
          @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }
        `}</style>
      </div>
    );
  }

  // Meeting not found / ended
  if (!meeting || meeting.status === "ended") {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center", height: "100vh",
        background: "#0A0A0F", fontFamily: "Inter, sans-serif"
      }}>
        <div style={{ textAlign: "center", color: "#A0A0A0" }}>
          <i className="fas fa-circle-exclamation" style={{ fontSize: 48, marginBottom: 16, color: "#FF6B6B" }}></i>
          <h2 style={{ color: "#fff", margin: "0 0 8px" }}>
            {meeting?.status === "ended" ? "Meeting Ended" : "Not Found"}
          </h2>
          <p style={{ margin: "0 0 24px", fontSize: 14 }}>
            {meeting?.status === "ended"
              ? "This meeting has already ended."
              : "This meeting doesn't exist or has been removed."}
          </p>
          <button onClick={() => router.push("/meetings")}
            style={{
              padding: "12px 28px", borderRadius: 12, border: "none",
              background: "linear-gradient(135deg, #3B82F6, #2563EB)", color: "#fff",
              fontSize: 14, fontWeight: 700, cursor: "pointer"
            }}>
            <i className="fas fa-arrow-left" style={{ marginRight: 8 }}></i> Back to Meetings
          </button>
        </div>
      </div>
    );
  }

  const isAnyoneSpeaking = speakingParticipants.size > 0;
  const activeSpeaker = isAnyoneSpeaking ? Array.from(speakingParticipants)[0] : null;

  return (
    <>
      <style>{`
        :root {
          --primary: #E8A838;
          --primary-light: #F5C76B;
          --bg: #0A0A0F;
          --surface: rgba(255,255,255,0.04);
          --surface-card: rgba(255,255,255,0.06);
          --border: rgba(255,255,255,0.06);
          --text-primary: #FFFFFF;
          --text-secondary: rgba(255,255,255,0.6);
          --text-tertiary: rgba(255,255,255,0.35);
          --success: #4ADE80;
          --error: #FF6B6B;
          --info: #38BDF8;
          --gradient-start: #E8A838;
          --gradient-end: #D4762A;
          --gradient-blue: #3B82F6;
          --gradient-purple: #8B5CF6;
          --shadow-glow: 0 0 30px rgba(59,130,246,0.12);
        }

        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--text-primary); font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; }

        .listen-page {
          height: 100vh;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow: hidden;
        }

        /* ===== ANIMATED BACKGROUND ===== */
        .bg-canvas {
          position: fixed;
          inset: 0;
          z-index: 0;
          overflow: hidden;
          background:
            radial-gradient(ellipse at 30% 20%, rgba(59,130,246,0.05) 0%, transparent 60%),
            radial-gradient(ellipse at 70% 80%, rgba(139,92,246,0.04) 0%, transparent 50%),
            radial-gradient(ellipse at 50% 50%, rgba(232,168,56,0.03) 0%, transparent 50%);
        }

        .bg-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.25;
          animation: orbFloat 25s ease-in-out infinite;
        }

        .bg-orb:nth-child(1) {
          width: 350px; height: 350px;
          background: rgba(59,130,246,0.1);
          top: -15%; left: -10%;
          animation-delay: 0s;
        }

        .bg-orb:nth-child(2) {
          width: 280px; height: 280px;
          background: rgba(139,92,246,0.08);
          bottom: -10%; right: -8%;
          animation-delay: -8s;
        }

        .bg-orb:nth-child(3) {
          width: 200px; height: 200px;
          background: rgba(232,168,56,0.06);
          top: 30%; left: 60%;
          animation-delay: -16s;
        }

        @keyframes orbFloat {
          0%, 100% { transform: translate(0, 0) scale(1); }
          25% { transform: translate(40px, -30px) scale(1.1); }
          50% { transform: translate(-25px, 25px) scale(0.9); }
          75% { transform: translate(35px, -15px) scale(1.05); }
        }

        .listen-content {
          position: relative;
          z-index: 1;
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: env(safe-area-inset-top, 0px) 0 0;
        }

        /* ===== TOP BAR ===== */
        .top-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          flex-shrink: 0;
          background: rgba(10,10,15,0.8);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-bottom: 1px solid var(--border);
        }

        .top-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .back-btn {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border: none;
          background: var(--surface);
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .back-btn:active { transform: scale(0.9); }

        .listen-badge {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 5px 12px;
          border-radius: 100px;
          background: rgba(74,222,128,0.1);
          border: 1px solid rgba(74,222,128,0.2);
        }

        .listen-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--success);
          animation: livePulse 1.2s ease-in-out infinite;
        }

        .listen-text {
          font-size: 11px;
          font-weight: 700;
          color: var(--success);
          letter-spacing: 0.8px;
          text-transform: uppercase;
        }

        .top-timer {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-tertiary);
          font-variant-numeric: tabular-nums;
        }

        .top-timer i { font-size: 11px; }

        .top-info-btn {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--text-tertiary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .top-info-btn:active { transform: scale(0.9); }
        .top-info-btn.active { border-color: var(--primary); color: var(--primary); }

        @keyframes livePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.6); }
        }

        /* ===== MAIN AREA ===== */
        .main-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 20px;
          gap: 20px;
          overflow-y: auto;
        }

        /* Audio visualization ring */
        .audio-ring-wrap {
          position: relative;
          width: 160px;
          height: 160px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .audio-ring-base {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 2px solid rgba(255,255,255,0.05);
        }

        .audio-ring-pulse {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 2px solid rgba(59,130,246,0.15);
          animation: ringPulse 3s ease-in-out infinite;
        }

        .audio-ring-pulse:nth-child(2) {
          animation-delay: 1s;
        }

        .audio-ring-pulse:nth-child(3) {
          animation-delay: 2s;
        }

        @keyframes ringPulse {
          0% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.2); opacity: 0; }
          100% { transform: scale(1.3); opacity: 0; }
        }

        .audio-icon-wrap {
          width: 110px;
          height: 110px;
          border-radius: 50%;
          background: linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.15));
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          z-index: 1;
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255,255,255,0.06);
        }

        .audio-icon-wrap i {
          font-size: 44px;
          background: linear-gradient(135deg, #3B82F6, #8B5CF6);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        /* Visualizer bars */
        .visualizer {
          display: flex;
          align-items: center;
          gap: 4px;
          height: 40px;
          margin-top: 4px;
        }

        .visualizer-bar {
          width: 4px;
          border-radius: 3px;
          background: linear-gradient(to top, #3B82F6, #8B5CF6);
          animation: vizAnim 0.8s ease-in-out infinite;
        }

        .visualizer-bar:nth-child(1) { height: 20px; animation-delay: 0s; }
        .visualizer-bar:nth-child(2) { height: 30px; animation-delay: 0.1s; }
        .visualizer-bar:nth-child(3) { height: 14px; animation-delay: 0.2s; }
        .visualizer-bar:nth-child(4) { height: 36px; animation-delay: 0.15s; }
        .visualizer-bar:nth-child(5) { height: 24px; animation-delay: 0.25s; }
        .visualizer-bar:nth-child(6) { height: 32px; animation-delay: 0.05s; }
        .visualizer-bar:nth-child(7) { height: 18px; animation-delay: 0.3s; }
        .visualizer-bar:nth-child(8) { height: 28px; animation-delay: 0.12s; }

        @keyframes vizAnim {
          0%, 100% { transform: scaleY(0.4); opacity: 0.6; }
          50% { transform: scaleY(1); opacity: 1; }
        }

        /* Meeting info */
        .meeting-info {
          text-align: center;
        }

        .meeting-title {
          font-size: 22px;
          font-weight: 800;
          background: linear-gradient(135deg, #fff, rgba(255,255,255,0.8));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 6px;
          line-height: 1.3;
        }

        .meeting-desc {
          font-size: 13px;
          color: var(--text-secondary);
          max-width: 300px;
          line-height: 1.5;
        }

        /* Speaker card */
        .speaker-card {
          width: 100%;
          max-width: 340px;
          padding: 16px 20px;
          background: var(--surface-card);
          border: 1px solid var(--border);
          border-radius: 20px;
          backdrop-filter: blur(20px);
          display: flex;
          align-items: center;
          gap: 14px;
          transition: all 0.5s ease;
        }

        .speaker-card.speaking {
          border-color: rgba(74,222,128,0.2);
          box-shadow: 0 0 30px rgba(74,222,128,0.05);
        }

        .speaker-avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          font-weight: 700;
          color: #fff;
          flex-shrink: 0;
          transition: all 0.3s ease;
        }

        .speaker-avatar.speaking-ring {
          box-shadow: 0 0 0 2px var(--success), 0 0 24px rgba(74,222,128,0.15);
        }

        .speaker-info {
          flex: 1;
          min-width: 0;
        }

        .speaker-label {
          font-size: 10px;
          font-weight: 700;
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 3px;
        }

        .speaker-name {
          font-size: 15px;
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .speaker-name.speaking {
          color: var(--success);
        }

        .speaker-wave-wrap {
          display: flex;
          align-items: center;
          gap: 3px;
          height: 24px;
        }

        .speaker-wave {
          display: flex;
          align-items: center;
          gap: 2px;
          height: 24px;
        }

        .speaker-wave span {
          width: 3px;
          background: var(--success);
          border-radius: 3px;
          animation: waveAnim 0.6s ease-in-out infinite;
        }

        .speaker-wave span:nth-child(1) { height: 8px; animation-delay: 0s; }
        .speaker-wave span:nth-child(2) { height: 14px; animation-delay: 0.1s; }
        .speaker-wave span:nth-child(3) { height: 10px; animation-delay: 0.2s; }
        .speaker-wave span:nth-child(4) { height: 18px; animation-delay: 0.15s; }
        .speaker-wave span:nth-child(5) { height: 12px; animation-delay: 0.25s; }

        @keyframes waveAnim {
          0%, 100% { transform: scaleY(0.5); }
          50% { transform: scaleY(1); }
        }

        .listening-label {
          font-size: 12px;
          color: var(--text-tertiary);
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .listening-label i { font-size: 10px; }

        /* ===== BOTTOM CONTROLS ===== */
        .bottom-controls {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          flex-shrink: 0;
          background: rgba(10,10,15,0.85);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-top: 1px solid var(--border);
        }

        .bottom-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .bottom-right {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .ctrl-btn {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 17px;
          cursor: pointer;
          transition: all 0.2s ease;
          flex-shrink: 0;
        }

        .ctrl-btn:active { transform: scale(0.9); }

        .ctrl-btn.mute {
          background: var(--surface);
          color: var(--text-primary);
          border: 1px solid var(--border);
        }

        .ctrl-btn.mute:hover {
          background: rgba(255,255,255,0.08);
        }

        .ctrl-btn.muted {
          background: rgba(255,107,107,0.15);
          color: var(--error);
          border: 1px solid rgba(255,107,107,0.2);
        }

        .ctrl-btn.muted:hover {
          background: rgba(255,107,107,0.2);
        }

        .ctrl-btn.hangup {
          width: 52px;
          height: 52px;
          background: var(--error);
          color: #fff;
          box-shadow: 0 4px 20px rgba(255,107,107,0.25);
        }

        .ctrl-btn.hangup:active {
          box-shadow: 0 2px 10px rgba(255,107,107,0.3);
        }

        .participant-chip {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 100px;
          background: var(--surface);
          border: 1px solid var(--border);
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary);
        }

        .participant-chip i { font-size: 11px; color: var(--primary); }

        /* ===== INFO OVERLAY ===== */
        .info-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.8);
          backdrop-filter: blur(15px);
          -webkit-backdrop-filter: blur(15px);
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          animation: fadeIn 0.3s ease;
        }

        .info-card {
          background: #151520;
          border: 1px solid var(--border);
          border-radius: 28px;
          padding: 32px 28px;
          max-width: 380px;
          width: 100%;
          text-align: center;
          box-shadow: 0 20px 60px rgba(0,0,0,0.6);
        }

        .info-card-icon {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.15));
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 16px;
          border: 1px solid rgba(255,255,255,0.06);
        }

        .info-card-icon i { font-size: 24px; color: var(--info); }

        .info-card h3 {
          font-size: 20px;
          font-weight: 700;
          margin-bottom: 6px;
        }

        .info-card p {
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.6;
          margin-bottom: 20px;
        }

        .info-detail {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 0;
          border-bottom: 1px solid var(--border);
          font-size: 13px;
        }

        .info-detail:last-child {
          border-bottom: none;
        }

        .info-detail-label {
          color: var(--text-tertiary);
          font-weight: 500;
        }

        .info-detail-value {
          font-weight: 600;
        }

        .info-dismiss {
          width: 100%;
          margin-top: 20px;
          padding: 12px;
          border-radius: 14px;
          border: none;
          background: linear-gradient(135deg, #3B82F6, #2563EB);
          color: #fff;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .info-dismiss:active { transform: scale(0.97); }

        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }

        /* Responsive */
        @media (max-width: 480px) {
          .audio-ring-wrap { width: 140px; height: 140px; }
          .audio-icon-wrap { width: 96px; height: 96px; }
          .audio-icon-wrap i { font-size: 36px; }
          .meeting-title { font-size: 19px; }
          .top-bar { padding: 10px 14px; }
          .bottom-controls { padding: 14px 16px; }
        }
      `}</style>

      <ToastBridge />
      <div className="listen-page">
        <div className="bg-canvas">
          <div className="bg-orb"></div>
          <div className="bg-orb"></div>
          <div className="bg-orb"></div>
        </div>

        <div className="listen-content">
          {/* TOP BAR */}
          <div className="top-bar">
            <div className="top-left">
              <button className="back-btn" onClick={leaveMeeting} title="Leave">
                <i className="fas fa-chevron-left"></i>
              </button>
              <div className="listen-badge">
                <div className="listen-dot"></div>
                <span className="listen-text">Listening</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {connected && (
                <div className="top-timer">
                  <i className="fas fa-clock"></i>
                  {formatElapsed(elapsed)}
                </div>
              )}
              <button
                className={`top-info-btn ${showInfo ? "active" : ""}`}
                onClick={() => setShowInfo(!showInfo)}
                title="Meeting Info"
              >
                <i className="fas fa-info"></i>
              </button>
            </div>
          </div>

          {/* MAIN AREA */}
          <div className="main-area">
            {/* Audio visualization */}
            <div className="audio-ring-wrap">
              <div className="audio-ring-base"></div>
              <div className="audio-ring-pulse"></div>
              <div className="audio-ring-pulse"></div>
              <div className="audio-ring-pulse"></div>
              <div className="audio-icon-wrap">
                <i className="fas fa-headphones-simple"></i>
              </div>
            </div>

            {/* Visualizer bars */}
            <div className="visualizer">
              <div className="visualizer-bar"></div>
              <div className="visualizer-bar"></div>
              <div className="visualizer-bar"></div>
              <div className="visualizer-bar"></div>
              <div className="visualizer-bar"></div>
              <div className="visualizer-bar"></div>
              <div className="visualizer-bar"></div>
              <div className="visualizer-bar"></div>
            </div>

            {/* Meeting info */}
            <div className="meeting-info">
              <div className="meeting-title">{meeting.title}</div>
              {meeting.description && (
                <div className="meeting-desc">{meeting.description}</div>
              )}
            </div>

            {/* Speaker card */}
            {isAnyoneSpeaking ? (
              <div className="speaker-card speaking">
                <div className={`speaker-avatar speaking-ring`}
                  style={{ background: "linear-gradient(135deg, #3B82F6, #2563EB)" }}>
                  {activeSpeaker?.charAt(0).toUpperCase()}
                </div>
                <div className="speaker-info">
                  <div className="speaker-label">Speaking Now</div>
                  <div className="speaker-name speaking">{activeSpeaker}</div>
                </div>
                <div className="speaker-wave">
                  <span></span><span></span><span></span><span></span><span></span>
                </div>
              </div>
            ) : participants.length > 0 ? (
              <div className="speaker-card">
                <div className="speaker-avatar"
                  style={{ background: "linear-gradient(135deg, #6B7280, #4B5563)" }}>
                  <i className="fas fa-user" style={{ fontSize: 18, opacity: 0.6 }}></i>
                </div>
                <div className="speaker-info">
                  <div className="speaker-label">In the Room</div>
                  <div className="speaker-name">
                    {participants.length} participant{participants.length !== 1 ? "s" : ""}
                  </div>
                </div>
                <div className="listening-label">
                  <i className="fas fa-volume-low"></i>
                  <span>Listening</span>
                </div>
              </div>
            ) : (
              <div className="speaker-card">
                <div className="speaker-avatar"
                  style={{ background: "linear-gradient(135deg, #6B7280, #4B5563)" }}>
                  <i className="fas fa-hourglass-half" style={{ fontSize: 18, opacity: 0.6 }}></i>
                </div>
                <div className="speaker-info">
                  <div className="speaker-label">Status</div>
                  <div className="speaker-name">Waiting for speakers...</div>
                </div>
                <div className="listening-label">
                  <i className="fas fa-circle" style={{ color: "var(--success)", fontSize: 8 }}></i>
                  <span>Connected</span>
                </div>
              </div>
            )}
          </div>

          {/* BOTTOM CONTROLS */}
          <div className="bottom-controls">
            <div className="bottom-left">
              <div className="participant-chip">
                <i className="fas fa-headphones"></i>
                <span>{participants.length + 1}</span>
              </div>
            </div>
            <div className="bottom-right">
              <button
                className={`ctrl-btn ${isMuted ? "muted" : "mute"}`}
                onClick={toggleMute}
                title={isMuted ? "Unmute microphone" : "Mute microphone"}
              >
                <i className={`fas fa-${isMuted ? "microphone-slash" : "microphone"}`}></i>
              </button>
              <button
                className="ctrl-btn hangup"
                onClick={leaveMeeting}
                title="Leave Meeting"
              >
                <i className="fas fa-phone-slash"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* INFO OVERLAY */}
      {showInfo && (
        <div className="info-overlay" onClick={() => setShowInfo(false)}>
          <div className="info-card" onClick={(e) => e.stopPropagation()}>
            <div className="info-card-icon">
              <i className="fas fa-circle-info"></i>
            </div>
            <h3>{meeting.title}</h3>
            <p>{meeting.description || "No description"}</p>

            <div className="info-detail">
              <span className="info-detail-label">Status</span>
              <span className="info-detail-value" style={{ color: "var(--success)" }}>
                <i className="fas fa-circle" style={{ fontSize: 8, marginRight: 6 }}></i>
                Live
              </span>
            </div>
            <div className="info-detail">
              <span className="info-detail-label">Duration</span>
              <span className="info-detail-value">{formatElapsed(elapsed)}</span>
            </div>
            <div className="info-detail">
              <span className="info-detail-label">Participants</span>
              <span className="info-detail-value">{participants.length + 1}</span>
            </div>
            <div className="info-detail">
              <span className="info-detail-label">Your mic</span>
              <span className="info-detail-value" style={{ color: isMuted ? "var(--text-tertiary)" : "var(--success)" }}>
                {isMuted ? "Muted" : "Active"}
              </span>
            </div>

            <button className="info-dismiss" onClick={() => setShowInfo(false)}>
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
