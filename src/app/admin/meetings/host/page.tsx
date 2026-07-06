"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import ToastBridge from "@/components/dashboard/ToastBridge";
import { useAppStore } from "@/lib/useAppStore";
import { getMeeting, updateMeeting, generateLiveKitToken, muteParticipant } from "@/lib/meetings";
import type { Meeting } from "@/lib/meetings";
import { Room, RoomEvent, Track } from "livekit-client";

export default function AdminMeetingHostPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const meetingId = searchParams?.get("id") || "";
  const userDoc = useAppStore((s) => s.userDoc);
  const user = useAppStore((s) => s.user);

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState<string[]>([]);
  const [speakingParticipants, setSpeakingParticipants] = useState<Set<string>>(new Set());
  const [elapsed, setElapsed] = useState(0);
  const [audioParticipants, setAudioParticipants] = useState<Map<string, string[]>>(new Map()); // identity → trackSid[]
  const [muteloading, setMuteloading] = useState<Set<string>>(new Set());
  const [micEnabled, setMicEnabled] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const meetingRef = useRef<Meeting | null>(null);

  const identity = userDoc?.uid || user?.uid || `admin-${Date.now()}`;

  function showToast(title: string, message: string, type: string, duration: number) {
    window.dispatchEvent(new CustomEvent("show-toast", { detail: { title, message, type, duration } }));
  }

  // Load meeting
  useEffect(() => {
    if (!meetingId) return;
    getMeeting(meetingId)
      .then((m) => {
        if (m) {
          setMeeting(m);
          // Auto-connect if not ended
          if (m.status !== "ended") {
            connectToRoom(m);
          } else {
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
      });

      room.on(RoomEvent.ParticipantConnected, (p) => {
        setParticipants((prev) => [...prev.filter((n) => n !== p.identity), p.identity]);
      });

      room.on(RoomEvent.ParticipantDisconnected, (p) => {
        setParticipants((prev) => prev.filter((n) => n !== p.identity));
        setAudioParticipants((prev) => { const next = new Map(prev); next.delete(p.identity); return next; });
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

      room.on(RoomEvent.TrackPublished, (trackPub, p) => {
        if (trackPub.kind === Track.Kind.Audio && p.identity !== identity) {
          setAudioParticipants((prev) => {
            const next = new Map(prev);
            const tids = next.get(p.identity) || [];
            if (!tids.includes(trackPub.trackSid)) {
              next.set(p.identity, [...tids, trackPub.trackSid]);
            }
            return next;
          });
        }
      });

      // CRITICAL: Attach remote audio tracks to <audio> elements so sound plays
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const audioEl = track.attach();
          audioEl.style.display = 'none';
          document.body.appendChild(audioEl);
        }
      });

      room.on(RoomEvent.TrackUnpublished, (trackPub, p) => {
        if (trackPub.kind === Track.Kind.Audio && p.identity !== identity) {
          setAudioParticipants((prev) => {
            const next = new Map(prev);
            const tids = (next.get(p.identity) || []).filter((s) => s !== trackPub.trackSid);
            if (tids.length > 0) {
              next.set(p.identity, tids);
            } else {
              next.delete(p.identity);
            }
            return next;
          });
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        setConnected(false);
        setParticipants([]);
        setSpeakingParticipants(new Set());
        setAudioParticipants(new Map());
        roomRef.current = null;
        setMicEnabled(false);
        if (timerRef.current) clearInterval(timerRef.current);
      });

      await room.connect(url, token);

      // Best-effort mic enable — primes the permission system on Android.
      // If blocked (no user gesture), user can tap the mic button later.
      room.localParticipant.setMicrophoneEnabled(true).catch(() => {});

      // Audio is not enabled yet — user must tap "Start Speaking" button.
      // This ensures startAudio() and setMicrophoneEnabled() are called with
      // a proper user gesture on Android WebView.

      setMicEnabled(false);

      // Scan existing participants for audio tracks
      for (const [, p] of room.remoteParticipants) {
        const audioTracks: string[] = [];
        for (const [, pub] of p.trackPublications) {
          if (pub.kind === Track.Kind.Audio && pub.trackSid) {
            audioTracks.push(pub.trackSid);
          }
        }
        if (audioTracks.length > 0) {
          setAudioParticipants((prev) => {
            const next = new Map(prev);
            next.set(p.identity, audioTracks);
            return next;
          });
        }
      }

      // Don't auto-enable mic — on Android WebView getUserMedia requires a user gesture.
      // Admin taps the mic button to enable speaking (user gesture triggers mic permission).
      roomRef.current = room;
      meetingRef.current = m;
      setConnected(true);
      setConnecting(false);
      setLoading(false);
      setElapsed(0);

      // Start elapsed timer
      const startedAt = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);

      // Initial participants
      const remoteNames = Array.from(room.remoteParticipants.values()).map((p) => p.identity);
      setParticipants(remoteNames);
      showToast("Live", `You're now hosting "${m.title}"`, "success", 3000);
    } catch (e) {
      console.error("Failed to connect:", e);
      showToast("Connection Failed", e instanceof Error ? e.message : "Could not connect", "error", 4000);
      setConnecting(false);
      setLoading(false);
    }
  };

  const handleMuteParticipant = async (pIdentity: string) => {
    const roomName = meetingRef.current?.roomName;
    if (!roomName) return;
    setMuteloading((prev) => new Set(prev).add(pIdentity));
    try {
      await muteParticipant(roomName, pIdentity);
      setAudioParticipants((prev) => { const n = new Map(prev); n.delete(pIdentity); return n; });
      showToast("Muted", `${pIdentity} microphone closed`, "info", 2500);
    } catch (e) {
      showToast("Error", e instanceof Error ? e.message : "Failed to mute", "error", 3000);
    } finally {
      setMuteloading((prev) => { const n = new Set(prev); n.delete(pIdentity); return n; });
    }
  };

  const handleMuteAll = async () => {
    const roomName = meetingRef.current?.roomName;
    if (!roomName || audioParticipants.size === 0) return;
    const all = Array.from(audioParticipants.keys());
    setMuteloading((prev) => new Set([...prev, ...all]));
    try {
      await Promise.all(all.map((id) => muteParticipant(roomName, id)));
      setAudioParticipants(new Map());
      showToast("Muted All", "All microphones closed", "success", 2500);
    } catch (e) {
      showToast("Error", e instanceof Error ? e.message : "Failed to mute all", "error", 3000);
    } finally {
      setMuteloading(new Set());
    }
  };

  const handleStartSpeaking = async () => {
    const room = roomRef.current;
    if (!room) return;
    // Enable audio output (resume AudioContext with user gesture)
    room.startAudio().catch(() => {});
    // Enable microphone input
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
      setMicEnabled(true);
    } catch (e) {
      console.error("Mic enable failed on start:", e);
      // Mic might still work if the user taps the mic button later
    }
    setAudioEnabled(true);
  };

  const toggleMic = async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      if (micEnabled) {
        await room.localParticipant.setMicrophoneEnabled(false);
        setMicEnabled(false);
      } else {
        await room.localParticipant.setMicrophoneEnabled(true);
        setMicEnabled(true);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not access microphone";
      console.error("Toggle mic failed:", e);
      showToast("Mic Error", msg, "error", 4000);
    }
  };

  const endCall = async () => {
    // Update Firestore status to ended
    try {
      await updateMeeting(meetingId, { status: "ended" });
    } catch (e) {
      console.error("Failed to update meeting status:", e);
    }
    // Disconnect from LiveKit
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    if (timerRef.current) clearInterval(timerRef.current);
    router.push("/admin/meetings");
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
              background: "linear-gradient(135deg, #E8A838, #D4762A)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 40px rgba(232,168,56,0.3)", animation: "pulseLoad 1.5s ease-in-out infinite"
            }}>
              <i className="fas fa-broadcast-tower" style={{ fontSize: 32, color: "#fff" }}></i>
            </div>
            <div style={{ color: "#E8A838", fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>
              {connecting ? "Connecting..." : "Loading..."}
            </div>
            <div style={{
              width: 200, height: 3, background: "#1A1A1A", borderRadius: 2, overflow: "hidden"
            }}>
              <div style={{
                height: "100%", width: "40%", background: "linear-gradient(90deg, #E8A838, #D4762A)",
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

  if (!meeting) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0A0A0F", fontFamily: "Inter, sans-serif" }}>
          <div style={{ textAlign: "center", color: "#A0A0A0" }}>
            <i className="fas fa-exclamation-circle" style={{ fontSize: 48, marginBottom: 16, color: "#FF6B6B" }}></i>
            <h2 style={{ color: "#fff", margin: "0 0 8px" }}>Meeting Not Found</h2>
            <p style={{ margin: "0 0 24px" }}>This meeting doesn't exist or has been removed.</p>
            <button onClick={() => router.push("/admin/meetings")}
              style={{
                padding: "12px 24px", borderRadius: 12, border: "none",
                background: "linear-gradient(135deg, #3B82F6, #2563EB)", color: "#fff",
                fontSize: 14, fontWeight: 700, cursor: "pointer"
              }}>Back to Meetings</button>
          </div>
          </div>
    );
  }

  return (
    <>
      <style>{`
        :root {
          --primary: #E8A838;
          --primary-light: #F5C76B;
          --primary-dark: #C48A2A;
          --bg: #0A0A0F;
          --surface: rgba(255,255,255,0.04);
          --surface-hover: rgba(255,255,255,0.08);
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
          --shadow-glow: 0 0 30px rgba(232,168,56,0.15);
        }

        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--text-primary); font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; }

        .host-page {
          height: 100vh;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow: hidden;
        }

        /* Animated background */
        .bg-canvas {
          position: fixed;
          inset: 0;
          z-index: 0;
          overflow: hidden;
          background: radial-gradient(ellipse at 20% 50%, rgba(232,168,56,0.06) 0%, transparent 60%),
                      radial-gradient(ellipse at 80% 20%, rgba(139,92,246,0.04) 0%, transparent 50%),
                      radial-gradient(ellipse at 50% 80%, rgba(59,130,246,0.04) 0%, transparent 50%);
        }

        .bg-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.3;
          animation: orbFloat 20s ease-in-out infinite;
        }

        .bg-orb:nth-child(1) {
          width: 400px; height: 400px;
          background: rgba(232,168,56,0.12);
          top: -10%; left: -10%;
          animation-delay: 0s;
        }

        .bg-orb:nth-child(2) {
          width: 300px; height: 300px;
          background: rgba(139,92,246,0.08);
          bottom: -5%; right: -5%;
          animation-delay: -7s;
        }

        .bg-orb:nth-child(3) {
          width: 250px; height: 250px;
          background: rgba(59,130,246,0.06);
          top: 40%; right: 20%;
          animation-delay: -14s;
        }

        @keyframes orbFloat {
          0%, 100% { transform: translate(0, 0) scale(1); }
          25% { transform: translate(30px, -40px) scale(1.1); }
          50% { transform: translate(-20px, 20px) scale(0.9); }
          75% { transform: translate(40px, -10px) scale(1.05); }
        }

        .host-content {
          position: relative;
          z-index: 1;
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: env(safe-area-inset-top, 0px) 0 0;
        }

        /* TOP BAR */
        .top-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          flex-shrink: 0;
          background: rgba(10,10,15,0.8);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-bottom: 1px solid var(--border);
        }

        .top-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .top-live-badge {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 14px;
          border-radius: 100px;
          background: rgba(74,222,128,0.1);
          border: 1px solid rgba(74,222,128,0.2);
        }

        .top-live-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--success);
          animation: livePulse 1.2s ease-in-out infinite;
        }

        .top-live-text {
          font-size: 12px;
          font-weight: 700;
          color: var(--success);
          letter-spacing: 1px;
          text-transform: uppercase;
        }

        .top-timer {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
          font-variant-numeric: tabular-nums;
        }

        .top-timer i {
          font-size: 12px;
          color: var(--primary);
        }

        .top-end-btn {
          padding: 8px 20px;
          border-radius: 100px;
          border: none;
          background: var(--error);
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 6px;
          box-shadow: 0 4px 16px rgba(255,107,107,0.25);
        }

        .top-end-btn:active {
          transform: scale(0.95);
        }

        .top-end-btn i {
          font-size: 12px;
        }

        @keyframes livePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.5); }
        }

        /* MAIN AREA */
        .main-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 24px;
          gap: 24px;
          overflow-y: auto;
        }

        .meeting-greeting {
          text-align: center;
        }

        .meeting-greeting h1 {
          font-size: 24px;
          font-weight: 800;
          background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 6px;
        }

        .meeting-greeting p {
          font-size: 14px;
          color: var(--text-secondary);
        }

        /* PARTICIPANTS */
        .participants-section {
          width: 100%;
          max-width: 400px;
        }

        .participants-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
          padding: 0 4px;
        }

        .participants-title {
          font-size: 12px;
          font-weight: 700;
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .participants-count {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          background: var(--surface);
          padding: 2px 10px;
          border-radius: 100px;
          border: 1px solid var(--border);
        }

        .participants-grid {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .participant-card {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
        }

        .participant-card.speaking {
          border-color: rgba(74,222,128,0.3);
          background: rgba(74,222,128,0.04);
          box-shadow: 0 0 20px rgba(74,222,128,0.06);
        }

        .participant-avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--gradient-blue), #2563EB);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 15px;
          font-weight: 700;
          color: #fff;
          flex-shrink: 0;
          position: relative;
        }

        .participant-avatar.speaking-ring {
          box-shadow: 0 0 0 2px var(--success), 0 0 20px rgba(74,222,128,0.2);
        }

        .participant-info {
          flex: 1;
          min-width: 0;
        }

        .participant-name {
          font-size: 14px;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .participant-role {
          font-size: 11px;
          color: var(--text-tertiary);
          margin-top: 2px;
        }

        .participant-status {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .speaking-wave {
          display: flex;
          align-items: center;
          gap: 2px;
          height: 20px;
        }

        .speaking-wave span {
          width: 3px;
          background: var(--success);
          border-radius: 2px;
          animation: waveAnim 0.6s ease-in-out infinite;
        }

        .speaking-wave span:nth-child(1) { height: 8px; animation-delay: 0s; }
        .speaking-wave span:nth-child(2) { height: 14px; animation-delay: 0.1s; }
        .speaking-wave span:nth-child(3) { height: 10px; animation-delay: 0.2s; }
        .speaking-wave span:nth-child(4) { height: 16px; animation-delay: 0.15s; }

        @keyframes waveAnim {
          0%, 100% { transform: scaleY(0.5); }
          50% { transform: scaleY(1); }
        }

        .muted-icon {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: rgba(255,255,255,0.06);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          color: var(--text-tertiary);
          flex-shrink: 0;
        }

        .you-chip {
          font-size: 10px;
          font-weight: 700;
          color: var(--primary);
          background: rgba(232,168,56,0.1);
          padding: 2px 8px;
          border-radius: 6px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        /* EMPTY STATE */
        .empty-participants {
          text-align: center;
          padding: 40px 20px;
          background: var(--surface);
          border: 1px dashed var(--border);
          border-radius: 20px;
          backdrop-filter: blur(10px);
        }

        .empty-participants i {
          font-size: 36px;
          color: var(--text-tertiary);
          opacity: 0.3;
          margin-bottom: 12px;
        }

        .empty-participants h3 {
          font-size: 16px;
          font-weight: 700;
          margin-bottom: 4px;
        }

        .empty-participants p {
          font-size: 13px;
          color: var(--text-secondary);
          max-width: 260px;
          margin: 0 auto;
          line-height: 1.5;
        }

        /* BOTTOM CONTROLS */
        .bottom-controls {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          padding: 20px;
          flex-shrink: 0;
          background: rgba(10,10,15,0.8);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-top: 1px solid var(--border);
        }

        .ctrl-btn {
          width: 52px;
          height: 52px;
          border-radius: 50%;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .ctrl-btn:active {
          transform: scale(0.9);
        }

        .ctrl-btn.mic-on {
          background: rgba(74,222,128,0.15);
          color: var(--success);
          border: 1px solid rgba(74,222,128,0.2);
        }

        .ctrl-btn.mic-off {
          background: rgba(255,107,107,0.15);
          color: var(--error);
          border: 1px solid rgba(255,107,107,0.2);
        }

        .ctrl-btn.end-call {
          width: 56px;
          height: 56px;
          background: var(--error);
          color: #fff;
          box-shadow: 0 4px 20px rgba(255,107,107,0.3);
        }

        .ctrl-btn.end-call:hover {
          box-shadow: 0 4px 30px rgba(255,107,107,0.4);
        }

        .ctrl-btn.info-btn {
          background: var(--surface);
          color: var(--text-secondary);
          border: 1px solid var(--border);
        }

        .ctrl-btn.info-btn:hover {
          background: var(--surface-hover);
          color: var(--text-primary);
        }

        .meeting-stats {
          display: flex;
          gap: 20px;
          align-items: center;
        }

        .stat-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--text-tertiary);
        }

        .stat-item i {
          font-size: 12px;
          color: var(--primary);
        }

        /* Share Modal */
        .share-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.85);
          backdrop-filter: blur(10px);
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }

        .share-card {
          background: #1A1A1A;
          border: 1px solid var(--border);
          border-radius: 24px;
          padding: 28px;
          max-width: 340px;
          width: 100%;
          text-align: center;
          animation: fadeIn 0.3s ease;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }

        .share-card h3 {
          font-size: 20px;
          font-weight: 700;
          margin-bottom: 8px;
        }

        .share-card p {
          font-size: 14px;
          color: var(--text-secondary);
          margin-bottom: 20px;
          line-height: 1.5;
        }

        .share-code {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 14px;
          font-size: 22px;
          font-weight: 800;
          font-family: monospace;
          letter-spacing: 4px;
          color: var(--primary);
          margin-bottom: 20px;
        }

        .share-dismiss {
          padding: 12px 28px;
          border-radius: 12px;
          border: none;
          background: var(--surface);
          color: var(--text-secondary);
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .share-dismiss:active {
          transform: scale(0.95);
        }

        /* Responsive */
        @media (max-width: 480px) {
          .top-bar { padding: 12px 16px; }
          .main-area { padding: 16px; }
          .bottom-controls { padding: 16px; gap: 12px; }
          .meeting-greeting h1 { font-size: 20px; }
        }
      `}</style>

      <ToastBridge />
      <div className="host-page">
        <div className="bg-canvas">
          <div className="bg-orb"></div>
          <div className="bg-orb"></div>
          <div className="bg-orb"></div>
        </div>

        {connected && !audioEnabled ? (
          <div style={{
            position: "relative", zIndex: 1, flex: 1, display: "flex",
            flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: 40, textAlign: "center", gap: 24
          }}>
            <div style={{
              width: 100, height: 100, borderRadius: "50%",
              background: "linear-gradient(135deg, var(--gradient-start), var(--gradient-end))",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 50px rgba(232,168,56,0.3)",
              animation: "pulseLoad 1.5s ease-in-out infinite"
            }}>
              <i className="fas fa-microphone" style={{ fontSize: 40, color: "#fff" }}></i>
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{meeting?.title}</h1>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5, maxWidth: 300 }}>
              Tap the button below to enable your microphone and start speaking
            </p>
            <button
              onClick={handleStartSpeaking}
              style={{
                padding: "16px 48px", borderRadius: 100, border: "none",
                background: "linear-gradient(135deg, var(--gradient-start), var(--gradient-end))",
                color: "#fff", fontSize: 17, fontWeight: 800, cursor: "pointer",
                boxShadow: "0 8px 32px rgba(232,168,56,0.35)",
                display: "flex", alignItems: "center", gap: 10,
                transition: "all 0.2s ease"
              }}
            >
              <i className="fas fa-broadcast-tower"></i>
              Start Speaking
            </button>
            <p style={{ fontSize: 12, color: "var(--text-tertiary)", margin: 0 }}>
              You'll be able to hear and speak in the meeting
            </p>
          </div>
        ) : (
        <div className="host-content">
          {/* TOP BAR */}
          <div className="top-bar">
            <div className="top-left">
              <div className="top-live-badge">
                <div className="top-live-dot"></div>
                <span className="top-live-text">Live</span>
              </div>
              {connected && (
                <div className="top-timer">
                  <i className="fas fa-clock"></i>
                  {formatElapsed(elapsed)}
                </div>
              )}
            </div>
            <button className="top-end-btn" onClick={endCall}>
              <i className="fas fa-phone-slash"></i> End
            </button>
          </div>

          {/* MAIN AREA */}
          <div className="main-area">
            <div className="meeting-greeting">
              <h1>{meeting.title}</h1>
              <p>{meeting.description || "Broadcasting live to members"}</p>
            </div>

            <div className="participants-section">
              <div className="participants-header">
                <span className="participants-title">In the room</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {audioParticipants.size > 0 && (
                    <button onClick={handleMuteAll} disabled={muteloading.size > 0}
                      style={{
                        padding: "4px 10px", borderRadius: 6, border: "none",
                        background: "rgba(255,107,107,0.15)", color: "#FF6B6B",
                        fontSize: 11, fontWeight: 600, cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 4,
                      }}>
                      {muteloading.size > 0 ? (
                        <i className="fas fa-spinner fa-spin" style={{ fontSize: 10 }}></i>
                      ) : (
                        <i className="fas fa-microphone-slash" style={{ fontSize: 10 }}></i>
                      )}
                      Mute All ({audioParticipants.size})
                    </button>
                  )}
                  <span className="participants-count">
                    <i className="fas fa-user" style={{ marginRight: 4, fontSize: 10 }}></i>
                    {participants.length + 1}
                  </span>
                </div>
              </div>

              <div className="participants-grid">
                {/* Host (admin) */}
                <div className={`participant-card ${micEnabled ? "speaking" : ""}`}>
                  <div className={`participant-avatar ${micEnabled ? "speaking-ring" : ""}`}>
                    {identity.charAt(0).toUpperCase()}
                  </div>
                  <div className="participant-info">
                    <div className="participant-name">
                      {userDoc?.display_name || "Admin"}
                      <span className="you-chip" style={{ marginLeft: 8 }}>Host</span>
                    </div>
                    <div className="participant-role">{micEnabled ? "Speaking" : "Mic off"}</div>
                  </div>
                  {micEnabled ? (
                    <div className="speaking-wave">
                      <span></span><span></span><span></span><span></span>
                    </div>
                  ) : (
                    <div className="muted-icon" title="Click microphone button to speak">
                      <i className="fas fa-microphone-slash"></i>
                    </div>
                  )}
                </div>

                {/* Remote participants */}
                {participants.length === 0 ? (
                  <div className="empty-participants">
                    <i className="fas fa-users"></i>
                    <h3>Waiting for Members</h3>
                    <p>Share this meeting so others can join and listen.</p>
                  </div>
                ) : (
                  participants.map((p) => (
                    <div key={p} className={`participant-card ${speakingParticipants.has(p) ? "speaking" : ""}`}>
                      <div className={`participant-avatar ${speakingParticipants.has(p) ? "speaking-ring" : ""}`}>
                        {p.charAt(0).toUpperCase()}
                      </div>
                      <div className="participant-info">
                        <div className="participant-name">{p}</div>
                        <div className="participant-role">
                          {speakingParticipants.has(p) ? "Speaking" : audioParticipants.has(p) ? "Unmuted" : "Listen-only"}
                        </div>
                      </div>
                      <div className="participant-status">
                        {speakingParticipants.has(p) ? (
                          <div className="speaking-wave">
                            <span></span><span></span><span></span><span></span>
                          </div>
                        ) : audioParticipants.has(p) ? (
                          <button
                            onClick={() => handleMuteParticipant(p)}
                            disabled={muteloading.has(p)}
                            style={{
                              width: 32, height: 32, borderRadius: "50%", border: "none",
                              background: "rgba(255,107,107,0.15)", color: "#FF6B6B",
                              fontSize: 12, cursor: "pointer", display: "flex",
                              alignItems: "center", justifyContent: "center",
                            }}
                            title="Close microphone"
                          >
                            {muteloading.has(p) ? (
                              <i className="fas fa-spinner fa-spin"></i>
                            ) : (
                              <i className="fas fa-microphone"></i>
                            )}
                          </button>
                        ) : (
                          <div className="muted-icon" title="Muted">
                            <i className="fas fa-microphone-slash"></i>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* BOTTOM CONTROLS */}
          <div className="bottom-controls">
            <div className="meeting-stats">
              <div className="stat-item">
                <i className="fas fa-headphones"></i>
                <span>{participants.length + 1} listening</span>
              </div>
              <div className="stat-item">
                <i className="fas fa-clock"></i>
                <span>{formatElapsed(elapsed)}</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                className={`ctrl-btn ${micEnabled ? "mic-on" : "mic-off"}`}
                onClick={toggleMic}
                title={micEnabled ? "Mute microphone" : "Unmute microphone"}
              >
                <i className={`fas fa-${micEnabled ? "microphone" : "microphone-slash"}`}></i>
              </button>
              {audioParticipants.size > 0 && (
                <button onClick={handleMuteAll} disabled={muteloading.size > 0}
                  style={{
                    width: 52, height: 52, borderRadius: "50%", border: "none",
                    background: "rgba(255,107,107,0.12)", color: "#FF6B6B",
                    fontSize: 18, cursor: "pointer", display: "flex",
                    alignItems: "center", justifyContent: "center",
                    transition: "all 0.2s ease",
                  }}
                  title="Close all microphones"
                >
                  {muteloading.size > 0 ? (
                    <i className="fas fa-spinner fa-spin"></i>
                  ) : (
                    <i className="fas fa-microphone-slash"></i>
                  )}
                </button>
              )}
              <button className="ctrl-btn end-call" onClick={endCall} title="End Meeting">
                <i className="fas fa-phone-slash"></i>
              </button>
            </div>
          </div>
          </div>
        )}
      </div>
    </>
  );
}
