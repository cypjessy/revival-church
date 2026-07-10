"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import ToastBridge from "@/components/dashboard/ToastBridge";
import ReactionsOverlay from "@/components/meetings/ReactionsOverlay";
import { useAppStore } from "@/lib/useAppStore";
import PremiumTopBar from "@/components/shared/PremiumTopBar";
import { getMeeting, updateMeeting, generateLiveKitToken, muteParticipant, unmuteParticipant, updateParticipantMetadata, getAgenda, toggleAgendaItem, getMinutes, saveMinutes, getActionItems, createActionItem, completeActionItem, getAttendance } from "@/lib/meetings";
import type { Meeting, AgendaItem, ActionItem } from "@/lib/meetings";
import { Room, RoomEvent, Track } from "livekit-client";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

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
  const [mutedParticipants, setMutedParticipants] = useState<Set<string>>(new Set());
  const [participantMetadata, setParticipantMetadata] = useState<Map<string, any>>(new Map());
  const [handRaisedParticipants, setHandRaisedParticipants] = useState<Set<string>>(new Set());
  const [handRaiseQueue, setHandRaiseQueue] = useState<Map<string, number>>(new Map()); // identity → raisedAt
  const [timeLimit, setTimeLimit] = useState(180); // seconds per speaker
  const [speakingTimer, setSpeakingTimer] = useState<{ identity: string; remaining: number; limit: number } | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([]);
  const [showAgenda, setShowAgenda] = useState(false);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [showActions, setShowActions] = useState(false);
  const [minutesContent, setMinutesContent] = useState("");
  const [showMinutes, setShowMinutes] = useState(false);
  const [minutesLastSaved, setMinutesLastSaved] = useState<string | null>(null);
  const [newActionTitle, setNewActionTitle] = useState("");
  const [newActionAssignee, setNewActionAssignee] = useState("");
  const [newActionPriority, setNewActionPriority] = useState<"low" | "medium" | "high">("medium");
  const minutesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roomRef = useRef<Room | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speakingTimerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
          // Load agenda
          if (m.id) {
            getAgenda(m.id).then(setAgendaItems).catch(() => {});
          }
          // Load minutes
          if (m.id) {
            getMinutes(m.id).then((mins) => {
              if (mins) setMinutesContent(mins.content);
            }).catch(() => {});
          }
          // Load action items
          if (m.id) {
            getActionItems(m.id).then(setActionItems).catch(() => {});
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
        lookupParticipantName(p.identity);
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
          // If they managed to re-publish, they're no longer admin-muted
          setMutedParticipants((prev) => { const n = new Set(prev); n.delete(p.identity); return n; });
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

      // Track participant metadata changes (hand raise, etc.)
      room.on(RoomEvent.ParticipantMetadataChanged, (metadata: string | undefined, participant) => {
        if (participant.identity === identity) return;
        let data: any = {};
        try { data = metadata ? JSON.parse(metadata) : {}; } catch { data = {}; }
        setParticipantMetadata((prev) => {
          const next = new Map(prev);
          next.set(participant.identity, data);
          return next;
        });
        if (data.handRaised) {
          setHandRaisedParticipants((prev) => new Set(prev).add(participant.identity));
          // Add to queue with timestamp (only if not already queued)
          setHandRaiseQueue((prev) => {
            if (prev.has(participant.identity)) return prev;
            const next = new Map(prev);
            next.set(participant.identity, Date.now());
            return next;
          });
        } else {
          setHandRaisedParticipants((prev) => {
            const n = new Set(prev);
            n.delete(participant.identity);
            return n;
          });
          setHandRaiseQueue((prev) => {
            const n = new Map(prev);
            n.delete(participant.identity);
            return n;
          });
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        setConnected(false);
        setParticipants([]);
        setSpeakingParticipants(new Set());
        setAudioParticipants(new Map());
        setMutedParticipants(new Set());
        setHandRaisedParticipants(new Set());
        setHandRaiseQueue(new Map());
        setParticipantMetadata(new Map());
        setParticipantNames(new Map());
        lookupInProgressRef.current = new Set();
        setSpeakingTimer(null);
        if (speakingTimerIntervalRef.current) clearInterval(speakingTimerIntervalRef.current);
        speakingTimerIntervalRef.current = null;
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

      // Lookup real names for existing participants
      for (const [, p] of room.remoteParticipants) {
        lookupParticipantName(p.identity);
      }

      // Scan existing participants for audio tracks and metadata
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
        // Check existing metadata for hand raise
        if (p.metadata) {
          try {
            const data = JSON.parse(p.metadata);
            if (data.handRaised) {
              setHandRaisedParticipants((prev) => new Set(prev).add(p.identity));
              setHandRaiseQueue((prev) => {
                if (prev.has(p.identity)) return prev;
                const n = new Map(prev);
                n.set(p.identity, 0); // timestamp 0 = before admin joined
                return n;
              });
            }
          } catch {}
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
      setMutedParticipants((prev) => new Set(prev).add(pIdentity));
      showToast("Muted", `${getDisplayName(pIdentity)} microphone closed`, "info", 2500);
    } catch (e) {
      showToast("Error", e instanceof Error ? e.message : "Failed to mute", "error", 3000);
    } finally {
      setMuteloading((prev) => { const n = new Set(prev); n.delete(pIdentity); return n; });
    }
  };

  const handleUnmuteParticipant = async (pIdentity: string) => {
    const roomName = meetingRef.current?.roomName;
    if (!roomName) return;
    setMuteloading((prev) => new Set(prev).add(pIdentity));
    try {
      await unmuteParticipant(roomName, pIdentity);
      setMutedParticipants((prev) => { const n = new Set(prev); n.delete(pIdentity); return n; });
      showToast("Unmuted", `${getDisplayName(pIdentity)} can now speak`, "success", 2500);
    } catch (e) {
      showToast("Error", e instanceof Error ? e.message : "Failed to unmute", "error", 3000);
    } finally {
      setMuteloading((prev) => { const n = new Set(prev); n.delete(pIdentity); return n; });
    }
  };

  const handleAllowHandRaise = async (pIdentity: string) => {
    const roomName = meetingRef.current?.roomName;
    if (!roomName) return;
    setMuteloading((prev) => new Set(prev).add(pIdentity));
    try {
      await unmuteParticipant(roomName, pIdentity);
      await updateParticipantMetadata(roomName, pIdentity, {});
      showToast("Approved", `${getDisplayName(pIdentity)} can now speak`, "success", 2500);
    } catch (e) {
      showToast("Error", e instanceof Error ? e.message : "Failed to approve", "error", 3000);
    } finally {
      setMuteloading((prev) => { const n = new Set(prev); n.delete(pIdentity); return n; });
    }
  };

  const handleDismissHandRaise = async (pIdentity: string) => {
    const roomName = meetingRef.current?.roomName;
    if (!roomName) return;
    try {
      await updateParticipantMetadata(roomName, pIdentity, {});
      showToast("Dismissed", `${getDisplayName(pIdentity)} hand raise dismissed`, "info", 2500);
    } catch (e) {
      showToast("Error", e instanceof Error ? e.message : "Failed to dismiss", "error", 3000);
    }
  };

  const handleApproveNext = async () => {
    const sorted = Array.from(handRaiseQueue.entries()).sort((a, b) => a[1] - b[1]);
    const next = sorted[0];
    if (!next) return;
    await handleAllowHandRaise(next[0]);
    startSpeakingTimer(next[0]);
  };

  const handleClearQueue = async () => {
    const all = Array.from(handRaiseQueue.keys());
    if (all.length === 0) return;
    // Dismiss all in parallel
    const roomName = meetingRef.current?.roomName;
    if (!roomName) return;
    await Promise.all(all.map((id) => updateParticipantMetadata(roomName, id, {})));
    showToast("Cleared", "All hand raises dismissed", "info", 2500);
  };

  const sendTimerMessage = (type: string, data: any = {}) => {
    const room = roomRef.current;
    if (!room) return;
    const payload = new TextEncoder().encode(JSON.stringify({ type: "timer", ...data }));
    room.localParticipant.publishData(payload, { reliable: true, topic: "timer" }).catch(() => {});
  };

  const startSpeakingTimer = (identity: string) => {
    // Clear any existing timer
    if (speakingTimerIntervalRef.current) clearInterval(speakingTimerIntervalRef.current);

    setSpeakingTimer({ identity, remaining: timeLimit, limit: timeLimit });
    sendTimerMessage("timer-start", { identity, duration: timeLimit * 1000 });

    speakingTimerIntervalRef.current = setInterval(() => {
      setSpeakingTimer((prev) => {
        if (!prev || prev.remaining <= 1) {
          // Time's up — auto-mute
          if (prev) {
            muteParticipant(meetingRef.current?.roomName || "", prev.identity).catch(() => {});
            sendTimerMessage("timer-end");
          }
          if (speakingTimerIntervalRef.current) clearInterval(speakingTimerIntervalRef.current);
          speakingTimerIntervalRef.current = null;
          return null;
        }
        return { ...prev, remaining: prev.remaining - 1 };
      });
    }, 1000);
  };

  const handleExtendTimer = () => {
    setSpeakingTimer((prev) => {
      if (!prev) return null;
      const additional = 60;
      sendTimerMessage("timer-extend", { additional: additional * 1000 });
      return { ...prev, remaining: prev.remaining + additional, limit: prev.limit + additional };
    });
  };

  const handleCutOffTimer = async () => {
    if (speakingTimerIntervalRef.current) {
      clearInterval(speakingTimerIntervalRef.current);
      speakingTimerIntervalRef.current = null;
    }
    const current = speakingTimer;
    if (current) {
      await muteParticipant(meetingRef.current?.roomName || "", current.identity).catch(() => {});
      sendTimerMessage("timer-end");
      setSpeakingTimer(null);
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

  const [exporting, setExporting] = useState(false);
  const [participantNames, setParticipantNames] = useState<Map<string, string>>(new Map());
  const lookupInProgressRef = useRef<Set<string>>(new Set());

  const getDisplayName = (identity: string) => participantNames.get(identity) || identity;

  const lookupParticipantName = async (identity: string) => {
    if (lookupInProgressRef.current.has(identity)) return;
    if (identity.startsWith("member-")) return;
    lookupInProgressRef.current.add(identity);
    try {
      const userSnap = await getDoc(doc(db, "users", identity));
      if (userSnap.exists()) {
        const name = userSnap.data().display_name || identity;
        setParticipantNames((prev) => new Map(prev).set(identity, name));
      }
    } catch {
      // Silently fail, fall back to identity
    }
  };

  const handleExportPDF = async () => {
    if (!meeting) return;
    setExporting(true);
    try {
      const { jsPDF } = await import("jspdf");
      await import("jspdf-autotable");
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const pageW = 190;
      let y = 20;

      // Helper
      const addLine = (text: string, size = 11, style = "normal", indent = 0) => {
        doc.setFontSize(size);
        doc.setFont("helvetica", style);
        doc.text(text, 10 + indent, y);
        y += size * 0.45;
      };

      // Header
      doc.setFontSize(22);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(232, 168, 56);
      doc.text("Meeting Report", 10, y);
      y += 10;
      doc.setFontSize(14);
      doc.setTextColor(255, 255, 255);
      doc.text(meeting.title, 10, y);
      y += 8;
      doc.setFontSize(10);
      doc.setTextColor(180, 180, 180);
      doc.text(`Date: ${meeting.date}  |  ${meeting.startTime} - ${meeting.endTime}`, 10, y);
      y += 6;
      if (meeting.description) {
        doc.text(`Description: ${meeting.description}`, 10, y);
        y += 6;
      }
      y += 4;

      // Participants
      doc.setFontSize(12);
      doc.setTextColor(232, 168, 56);
      doc.setFont("helvetica", "bold");
      doc.text(`Participants (${participants.length + 1})`, 10, y);
      y += 7;
      doc.setFontSize(9);
      doc.setTextColor(200, 200, 200);
      doc.setFont("helvetica", "normal");
      doc.text(`Host: ${userDoc?.display_name || "Admin"}`, 10, y);
      y += 5;
      participants.forEach((p) => {
        doc.text(`  ${getDisplayName(p)}`, 10, y);
        y += 4.5;
      });
      y += 4;

      // Attendance
      let attendance: any[] = [];
      try {
        attendance = await getAttendance(meetingId);
      } catch {}
      if (attendance.length > 0) {
        doc.setFontSize(12);
        doc.setTextColor(232, 168, 56);
        doc.setFont("helvetica", "bold");
        doc.text("Attendance", 10, y);
        y += 7;
        (doc as any).autoTable({
          startY: y,
          margin: { left: 10 },
          tableWidth: pageW,
          styles: { fontSize: 9, textColor: [200, 200, 200], fillColor: [20, 20, 25] },
          headStyles: { fillColor: [232, 168, 56], textColor: [10, 10, 15], fontStyle: "bold" },
          alternateRowStyles: { fillColor: [25, 25, 30] },
          columns: ["#", "Name", "Joined"],
          body: attendance.map((a, i) => [
            i + 1,
            a.userName || a.userId,
            a.joinedAt?.toDate?.()?.toLocaleString() || a.joinedAt || "-",
          ]),
        });
        y = (doc as any).lastAutoTable.finalY + 8;
      }

      // Minutes
      if (minutesContent.trim()) {
        doc.setFontSize(12);
        doc.setTextColor(232, 168, 56);
        doc.setFont("helvetica", "bold");
        doc.text("Minutes", 10, y);
        y += 7;
        const lines = doc.splitTextToSize(minutesContent, pageW);
        doc.setFontSize(9);
        doc.setTextColor(200, 200, 200);
        doc.setFont("helvetica", "normal");
        for (const line of lines) {
          if (y > 270) { doc.addPage(); y = 20; }
          doc.text(line, 10, y);
          y += 5;
        }
        y += 4;
      }

      // Action Items
      if (actionItems.length > 0) {
        doc.setFontSize(12);
        doc.setTextColor(232, 168, 56);
        doc.setFont("helvetica", "bold");
        doc.text("Action Items", 10, y);
        y += 7;
        (doc as any).autoTable({
          startY: y,
          margin: { left: 10 },
          tableWidth: pageW,
          styles: { fontSize: 9, textColor: [200, 200, 200], fillColor: [20, 20, 25] },
          headStyles: { fillColor: [232, 168, 56], textColor: [10, 10, 15], fontStyle: "bold" },
          alternateRowStyles: { fillColor: [25, 25, 30] },
          columns: ["#", "Title", "Assignee", "Priority", "Status"],
          body: actionItems.map((a, i) => [
            i + 1,
            a.title,
            a.assigneeName || "-",
            a.priority,
            a.status,
          ]),
        });
      }

      doc.save(`meeting-${meeting.title.replace(/\s+/g, "-").toLowerCase()}.pdf`);
      showToast("Exported", "PDF downloaded successfully", "success", 3000);
    } catch (e) {
      console.error("Export failed:", e);
      showToast("Error", "Failed to generate PDF", "error", 3000);
    } finally {
      setExporting(false);
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

  // Log attendance join when connected
  useEffect(() => {
    if (connected && meetingId && user?.uid) {
      import("@/lib/meetings").then(({ logAttendanceJoin }) => {
        logAttendanceJoin(meetingId, user.uid!, identity).catch(() => {});
      }).catch(() => {});
    }
  }, [connected]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        // Log attendance leave
        if (meetingId && user?.uid) {
          import("@/lib/meetings").then(({ logAttendanceLeave }) => {
            logAttendanceLeave(meetingId, user.uid!).catch(() => {});
          }).catch(() => {});
        }
        roomRef.current.disconnect();
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [meetingId, user?.uid]);

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
          width: 42px;
          height: 42px;
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

        .participant-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }

        .action-btn {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .action-btn:active { transform: scale(0.9); }
        .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .action-btn.mute {
          background: rgba(255,107,107,0.15);
          color: var(--error);
        }

        .action-btn.unmute {
          background: rgba(74,222,128,0.15);
          color: var(--success);
        }

        .action-btn.allow {
          background: rgba(74,222,128,0.15);
          color: var(--success);
          box-shadow: 0 0 12px rgba(74,222,128,0.15);
        }

        .action-btn.dismiss {
          background: rgba(255,255,255,0.06);
          color: var(--text-tertiary);
        }

        .action-btn.dismiss:hover {
          background: rgba(255,255,255,0.1);
        }

        .participant-card.hand-raised {
          border-color: rgba(245,158,11,0.25);
          background: rgba(245,158,11,0.03);
          box-shadow: 0 0 20px rgba(245,158,11,0.05);
        }

        .participant-card.muted-by-admin {
          border-color: rgba(255,165,0,0.15);
          background: rgba(255,165,0,0.02);
        }

        /* ===== SPEAKING QUEUE ===== */
        .queue-panel {
          width: 100%;
          max-width: 400px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          overflow: hidden;
          backdrop-filter: blur(10px);
          animation: fadeIn 0.3s ease;
        }

        .queue-panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          border-bottom: 1px solid var(--border);
        }

        .queue-panel-title {
          font-size: 11px;
          font-weight: 700;
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.8px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .queue-panel-title i {
          font-size: 11px;
          color: var(--primary);
        }

        .queue-panel-count {
          font-size: 11px;
          font-weight: 600;
          color: var(--primary);
          background: rgba(232,168,56,0.1);
          padding: 2px 8px;
          border-radius: 6px;
        }

        .queue-actions {
          display: flex;
          gap: 6px;
          padding: 8px 10px;
          border-bottom: 1px solid var(--border);
        }

        .queue-btn {
          flex: 1;
          padding: 7px 10px;
          border-radius: 8px;
          border: none;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
        }

        .queue-btn:active { transform: scale(0.96); }
        .queue-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .queue-btn.approve-all {
          background: rgba(74,222,128,0.12);
          color: var(--success);
        }

        .queue-btn.clear {
          background: rgba(255,255,255,0.04);
          color: var(--text-tertiary);
          border: 1px solid var(--border);
        }

        .queue-list {
          display: flex;
          flex-direction: column;
          max-height: 200px;
          overflow-y: auto;
        }

        .queue-list::-webkit-scrollbar { width: 4px; }
        .queue-list::-webkit-scrollbar-track { background: transparent; }
        .queue-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }

        .queue-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 14px;
          border-bottom: 1px solid var(--border);
          transition: all 0.2s ease;
        }

        .queue-item:last-child { border-bottom: none; }
        .queue-item-next {
          background: rgba(74,222,128,0.03);
        }

        .queue-pos {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: var(--surface);
          border: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 700;
          color: var(--text-tertiary);
          flex-shrink: 0;
        }

        .queue-item-next .queue-pos {
          border-color: rgba(74,222,128,0.3);
          color: var(--success);
          background: rgba(74,222,128,0.06);
        }

        .queue-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: linear-gradient(135deg, #6B7280, #4B5563);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 700;
          color: #fff;
          flex-shrink: 0;
        }

        .queue-name {
          flex: 1;
          font-size: 13px;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .queue-dismiss {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          border: none;
          background: transparent;
          color: var(--text-tertiary);
          font-size: 13px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          flex-shrink: 0;
        }

        .queue-dismiss:hover {
          background: rgba(255,255,255,0.08);
          color: var(--text-primary);
        }

        /* ===== SPEAKING TIMER ===== */
        .timer-panel {
          width: 100%;
          max-width: 400px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          overflow: hidden;
          backdrop-filter: blur(10px);
          animation: fadeIn 0.3s ease;
        }

        .timer-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          border-bottom: 1px solid var(--border);
        }

        .timer-title {
          font-size: 11px;
          font-weight: 700;
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.8px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .timer-title i {
          font-size: 11px;
          color: var(--success);
        }

        .timer-speaker {
          margin-left: auto;
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .timer-body {
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          align-items: center;
        }

        .timer-progress-wrap {
          width: 100%;
          height: 6px;
          background: rgba(255,255,255,0.06);
          border-radius: 4px;
          overflow: hidden;
        }

        .timer-progress-bar {
          height: 100%;
          border-radius: 4px;
          transition: width 1s linear, background 0.5s ease;
        }

        .timer-digits {
          font-size: 32px;
          font-weight: 800;
          font-variant-numeric: tabular-nums;
          letter-spacing: 2px;
          color: var(--text-primary);
        }

        .timer-actions {
          display: flex;
          gap: 8px;
          padding: 8px 14px 12px;
        }

        .timer-btn {
          flex: 1;
          padding: 8px;
          border-radius: 8px;
          border: none;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
        }

        .timer-btn:active { transform: scale(0.96); }

        .timer-btn.extend {
          background: rgba(56,189,248,0.12);
          color: var(--info);
        }

        .timer-btn.cutoff {
          background: rgba(255,107,107,0.12);
          color: var(--error);
        }

        .role-chip {
          font-size: 9px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 6px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-left: 8px;
        }

        .host-chip {
          color: var(--primary);
          background: rgba(232,168,56,0.1);
        }

        .status-icon {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          flex-shrink: 0;
        }

        .status-icon.muted {
          background: rgba(255,255,255,0.06);
          color: var(--text-tertiary);
        }

        .participant-avatar.hand-raised-ring {
          box-shadow: 0 0 0 2px #F59E0B, 0 0 20px rgba(245,158,11,0.2);
        }

        .avatar-badge {
          position: absolute;
          bottom: -2px;
          right: -2px;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #F59E0B;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 9px;
          color: #fff;
          box-shadow: 0 2px 8px rgba(245,158,11,0.4);
          border: 2px solid var(--bg);
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
          justify-content: space-between;
          gap: 16px;
          padding: 16px 24px;
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

        /* Agenda Panel */
        .agenda-panel {
          width: 100%;
          max-width: 400px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          overflow: hidden;
          backdrop-filter: blur(10px);
        }

        .agenda-panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          border-bottom: 1px solid var(--border);
        }

        .agenda-panel-title {
          font-size: 11px;
          font-weight: 700;
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.8px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .agenda-panel-title i {
          font-size: 11px;
          color: var(--primary);
        }

        .agenda-panel-count {
          font-size: 11px;
          font-weight: 600;
          color: var(--primary);
          background: rgba(232,168,56,0.1);
          padding: 2px 8px;
          border-radius: 6px;
        }

        .agenda-panel-list {
          display: flex;
          flex-direction: column;
        }

        .agenda-tracker-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          border-bottom: 1px solid var(--border);
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .agenda-tracker-item:last-child {
          border-bottom: none;
        }

        .agenda-tracker-item:active {
          background: var(--surface-hover);
        }

        .agenda-tracker-item.done {
          opacity: 0.5;
        }

        .agenda-tracker-check {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          border: 2px solid var(--text-tertiary);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: all 0.2s ease;
          font-size: 10px;
        }

        .agenda-tracker-check.checked {
          background: var(--success);
          border-color: var(--success);
          color: #fff;
        }

        .agenda-tracker-info {
          flex: 1;
          min-width: 0;
        }

        .agenda-tracker-title {
          font-size: 13px;
          font-weight: 600;
        }

        .agenda-tracker-item.done .agenda-tracker-title {
          text-decoration: line-through;
        }

        .agenda-tracker-meta {
          display: flex;
          gap: 8px;
          margin-top: 2px;
          font-size: 11px;
          color: var(--text-tertiary);
        }

        .agenda-tracker-meta i {
          font-size: 10px;
          margin-right: 3px;
          color: var(--primary);
        }

        /* Responsive */
        @media (max-width: 480px) {
          .top-bar { padding: 12px 16px; }
          .main-area { padding: 16px; }
          .bottom-controls { padding: 12px 16px; gap: 8px; }
          .meeting-greeting h1 { font-size: 20px; }
        }
      `}</style>

      <ToastBridge />
      <div className="host-page">
        <PremiumTopBar minimal />
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
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {agendaItems.length > 0 && (
                <button
                  onClick={() => setShowAgenda(!showAgenda)}
                  style={{
                    width: 36, height: 36, borderRadius: "50%", border: showAgenda ? "1px solid rgba(232,168,56,0.3)" : "1px solid var(--border)",
                    background: showAgenda ? "rgba(232,168,56,0.1)" : "var(--surface)",
                    color: showAgenda ? "var(--primary)" : "var(--text-secondary)",
                    fontSize: 13, cursor: "pointer", display: "flex",
                    alignItems: "center", justifyContent: "center",
                    transition: "all 0.2s ease",
                  }}
                  title="Meeting Agenda"
                >
                  <i className="fas fa-list-check"></i>
                </button>
              )}
              <button
                onClick={() => setShowActions(!showActions)}
                style={{
                  width: 36, height: 36, borderRadius: "50%",
                  border: showActions ? "1px solid rgba(74,222,128,0.3)" : "1px solid var(--border)",
                  background: showActions ? "rgba(74,222,128,0.1)" : "var(--surface)",
                  color: showActions ? "var(--success)" : "var(--text-secondary)",
                  fontSize: 13, cursor: "pointer", display: "flex",
                  alignItems: "center", justifyContent: "center",
                  transition: "all 0.2s ease", position: "relative",
                }}
                title="Action Items"
              >
                <i className="fas fa-check-double"></i>
                {actionItems.filter((a) => a.status !== "completed").length > 0 && (
                  <span style={{
                    position: "absolute", top: -3, right: -3,
                    width: 16, height: 16, borderRadius: "50%",
                    background: "var(--error)",
                    fontSize: 9, fontWeight: 700, color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {actionItems.filter((a) => a.status !== "completed").length}
                  </span>
                )}
              </button>
              <button
                onClick={handleExportPDF}
                disabled={exporting}
                style={{
                  width: 36, height: 36, borderRadius: "50%", border: "1px solid var(--border)",
                  background: "var(--surface)", color: "var(--text-secondary)", fontSize: 13,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.2s ease",
                }}
                title="Export PDF"
              >
                {exporting ? (
                  <i className="fas fa-spinner fa-spin"></i>
                ) : (
                  <i className="fas fa-download"></i>
                )}
              </button>
              <button className="top-end-btn" onClick={endCall}>
                <i className="fas fa-phone-slash"></i> End
              </button>
            </div>
          </div>

          {/* MAIN AREA */}
          <div className="main-area">
            <div className="meeting-greeting">
              <h1>{meeting.title}</h1>
              <p>{meeting.description || "Broadcasting live to members"}</p>
            </div>

            {/* SPEAKING QUEUE */}
            {handRaiseQueue.size > 0 && (
              <div className="queue-panel">
                <div className="queue-panel-header">
                  <span className="queue-panel-title">
                    <i className="fas fa-hand"></i> Speaking Queue
                  </span>
                  <span className="queue-panel-count">{handRaiseQueue.size}</span>
                </div>
                <div className="queue-actions">
                  <button className="queue-btn approve-all" onClick={handleApproveNext}
                    disabled={muteloading.size > 0}>
                    {muteloading.size > 0 ? (
                      <i className="fas fa-spinner fa-spin"></i>
                    ) : (
                      <><i className="fas fa-check"></i> Approve Next</>
                    )}
                  </button>
                  <button className="queue-btn clear" onClick={handleClearQueue}>
                    <i className="fas fa-xmark"></i> Clear All
                  </button>
                </div>
                <div className="queue-list">
                  {Array.from(handRaiseQueue.entries())
                    .sort((a, b) => a[1] - b[1])
                    .map(([identity, ts], idx) => (
                      <div key={identity} className={`queue-item ${idx === 0 ? "queue-item-next" : ""}`}>
                        <div className="queue-pos">{idx + 1}</div>
                        <div className="queue-avatar">{getDisplayName(identity).charAt(0).toUpperCase()}</div>
                        <div className="queue-name">{getDisplayName(identity)}</div>
                        <button className="queue-dismiss" onClick={() => handleDismissHandRaise(identity)}
                          title="Remove from queue">
                          <i className="fas fa-xmark"></i>
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* SPEAKING TIMER */}
            {speakingTimer && (
              <div className="timer-panel">
                <div className="timer-header">
                  <span className="timer-title"><i className="fas fa-hourglass-half"></i> Speaking</span>
                  <span className="timer-speaker">{getDisplayName(speakingTimer.identity)}</span>
                </div>
                <div className="timer-body">
                  <div className="timer-progress-wrap">
                    <div className="timer-progress-bar" style={{
                      width: `${(speakingTimer.remaining / speakingTimer.limit) * 100}%`,
                      background: speakingTimer.remaining <= 30
                        ? "linear-gradient(90deg, #FF6B6B, #EE4444)"
                        : speakingTimer.remaining <= 60
                          ? "linear-gradient(90deg, #F59E0B, #D97706)"
                          : "linear-gradient(90deg, var(--gradient-start), var(--gradient-end))",
                    }}></div>
                  </div>
                  <div className="timer-digits">
                    {String(Math.floor(speakingTimer.remaining / 60)).padStart(2, "0")}:
                    {String(speakingTimer.remaining % 60).padStart(2, "0")}
                  </div>
                </div>
                <div className="timer-actions">
                  <button className="timer-btn extend" onClick={handleExtendTimer}>
                    <i className="fas fa-plus"></i> +60s
                  </button>
                  <button className="timer-btn cutoff" onClick={handleCutOffTimer}>
                    <i className="fas fa-stop"></i> Cut Off
                  </button>
                </div>
              </div>
            )}

            {/* AGENDA PANEL */}
            {showAgenda && agendaItems.length > 0 && (
              <div className="agenda-panel">
                <div className="agenda-panel-header">
                  <span className="agenda-panel-title"><i className="fas fa-list-check"></i> Agenda</span>
                  <span className="agenda-panel-count">{agendaItems.filter((a) => a.isCompleted).length}/{agendaItems.length}</span>
                </div>
                <div className="agenda-panel-list">
                  {agendaItems.map((item) => (
                    <div
                      key={item.id}
                      className={`agenda-tracker-item ${item.isCompleted ? "done" : ""}`}
                      onClick={async () => {
                        if (!item.id) return;
                        await toggleAgendaItem(meetingId, item.id);
                        setAgendaItems((prev) =>
                          prev.map((a) => a.id === item.id ? { ...a, isCompleted: !a.isCompleted } : a)
                        );
                      }}
                    >
                      <div className={`agenda-tracker-check ${item.isCompleted ? "checked" : ""}`}>
                        {item.isCompleted ? <i className="fas fa-check"></i> : null}
                      </div>
                      <div className="agenda-tracker-info">
                        <div className="agenda-tracker-title">{item.title}</div>
                        <div className="agenda-tracker-meta">
                          <span><i className="fas fa-clock"></i> {item.duration}m</span>
                          {item.assigneeName && <span><i className="fas fa-user"></i> {item.assigneeName}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ACTION ITEMS PANEL */}
            {showActions && (
              <div className="agenda-panel">
                <div className="agenda-panel-header">
                  <span className="agenda-panel-title"><i className="fas fa-check-double"></i> Action Items</span>
                  <span className="agenda-panel-count">
                    {actionItems.filter((a) => a.status !== "completed").length} open
                  </span>
                </div>
                <div className="agenda-panel-list">
                  {/* New action item form inline */}
                  <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="text"
                        value={newActionTitle}
                        onChange={(e) => setNewActionTitle(e.target.value)}
                        placeholder="Add action item..."
                        onKeyDown={async (e) => {
                          if (e.key === "Enter" && newActionTitle.trim()) {
                            await createActionItem(meetingId, {
                              title: newActionTitle.trim(),
                              assigneeName: newActionAssignee.trim() || undefined,
                              priority: newActionPriority,
                              status: "open",
                              createdBy: userDoc?.uid || identity,
                              createdByName: userDoc?.display_name || identity,
                            });
                            const updated = await getActionItems(meetingId);
                            setActionItems(updated);
                            setNewActionTitle("");
                            setNewActionAssignee("");
                          }
                        }}
                        style={{
                          flex: 1, padding: "8px 10px", background: "rgba(255,255,255,0.06)",
                          border: "1px solid var(--border)", borderRadius: 8,
                          color: "#fff", fontSize: 13, outline: "none",
                        }}
                      />
                      <select
                        value={newActionPriority}
                        onChange={(e) => setNewActionPriority(e.target.value as any)}
                        style={{
                          padding: "8px 6px", background: "rgba(255,255,255,0.06)",
                          border: "1px solid var(--border)", borderRadius: 8,
                          color: "var(--text-secondary)", fontSize: 11, fontWeight: 600,
                          outline: "none", cursor: "pointer",
                        }}
                      >
                        <option value="low">Low</option>
                        <option value="medium">Med</option>
                        <option value="high">High</option>
                      </select>
                      <button
                        onClick={async () => {
                          if (!newActionTitle.trim()) return;
                          await createActionItem(meetingId, {
                            title: newActionTitle.trim(),
                            assigneeName: newActionAssignee.trim() || undefined,
                            priority: newActionPriority,
                            status: "open",
                            createdBy: userDoc?.uid || identity,
                            createdByName: userDoc?.display_name || identity,
                          });
                          const updated = await getActionItems(meetingId);
                          setActionItems(updated);
                          setNewActionTitle("");
                          setNewActionAssignee("");
                        }}
                        disabled={!newActionTitle.trim()}
                        style={{
                          padding: "8px 12px", borderRadius: 8, border: "none",
                          background: "linear-gradient(135deg, var(--gradient-blue), #2563EB)",
                          color: "#fff", fontSize: 13, fontWeight: 600,
                          cursor: "pointer", opacity: !newActionTitle.trim() ? 0.5 : 1,
                        }}
                      >
                        <i className="fas fa-plus"></i>
                      </button>
                    </div>
                    <input
                      type="text"
                      value={newActionAssignee}
                      onChange={(e) => setNewActionAssignee(e.target.value)}
                      placeholder="Assignee (optional)"
                      style={{
                        width: "100%", marginTop: 6, padding: "6px 10px",
                        background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)",
                        borderRadius: 8, color: "var(--text-secondary)", fontSize: 12,
                        outline: "none",
                      }}
                    />
                  </div>
                  {actionItems.length === 0 ? (
                    <div style={{ padding: "20px", textAlign: "center", color: "var(--text-tertiary)", fontSize: 12 }}>
                      No action items yet
                    </div>
                  ) : (
                    actionItems.map((item) => (
                      <div
                        key={item.id}
                        onClick={async () => {
                          if (!item.id) return;
                          await completeActionItem(meetingId, item.id);
                          setActionItems((prev) =>
                            prev.map((a) => a.id === item.id ? { ...a, status: "completed" as const } : a)
                          );
                        }}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "10px 14px", borderBottom: "1px solid var(--border)",
                          cursor: "pointer", transition: "all 0.2s ease",
                          opacity: item.status === "completed" ? 0.5 : 1,
                        }}
                      >
                        <div style={{
                          width: 22, height: 22, borderRadius: "50%",
                          border: `2px solid ${item.status === "completed" ? "var(--success)" : "var(--text-tertiary)"}`,
                          background: item.status === "completed" ? "var(--success)" : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexShrink: 0, fontSize: 10, color: "#fff",
                        }}>
                          {item.status === "completed" && <i className="fas fa-check"></i>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: 13, fontWeight: 600,
                            textDecoration: item.status === "completed" ? "line-through" : "none",
                          }}>
                            {item.title}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2, display: "flex", gap: 6 }}>
                            {item.assigneeName && (
                              <span><i className="fas fa-user"></i> {item.assigneeName}</span>
                            )}
                            <span style={{
                              padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700,
                              background: item.priority === "high" ? "rgba(255,107,107,0.15)"
                                : item.priority === "medium" ? "rgba(232,168,56,0.12)"
                                : "rgba(255,255,255,0.06)",
                              color: item.priority === "high" ? "#FF6B6B"
                                : item.priority === "medium" ? "var(--primary)"
                                : "var(--text-tertiary)",
                            }}>
                              {item.priority}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            <div className="participants-section">
              <div className="participants-header">
                <span className="participants-title">In the room</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {handRaiseQueue.size > 0 && (
                    <button onClick={handleClearQueue}
                      style={{
                        padding: "4px 10px", borderRadius: 6, border: "none",
                        background: "rgba(232,168,56,0.12)", color: "var(--primary)",
                        fontSize: 11, fontWeight: 600, cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 4,
                      }}>
                      <i className="fas fa-hand" style={{ fontSize: 10 }}></i>
                      Lower All ({handRaiseQueue.size})
                    </button>
                  )}
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
                <div className={`participant-card host-card ${micEnabled ? "speaking" : ""}`}>
                  <div className={`participant-avatar ${micEnabled ? "speaking-ring" : ""}`}
                    style={{ background: "linear-gradient(135deg, var(--gradient-start), var(--gradient-end))" }}>
                    {identity.charAt(0).toUpperCase()}
                  </div>
                  <div className="participant-info">
                    <div className="participant-name">
                      {userDoc?.display_name || "Admin"}
                      <span className="role-chip host-chip">Host</span>
                    </div>
                    <div className="participant-role">{micEnabled ? "Speaking" : "Mic off"}</div>
                  </div>
                  <div className="participant-actions">
                    {micEnabled ? (
                      <div className="speaking-wave">
                        <span></span><span></span><span></span><span></span>
                      </div>
                    ) : (
                      <div className="status-icon muted" title="Click mic button to speak">
                        <i className="fas fa-microphone-slash"></i>
                      </div>
                    )}
                  </div>
                </div>

                {/* Remote participants */}
                {participants.length === 0 ? (
                  <div className="empty-participants">
                    <i className="fas fa-users"></i>
                    <h3>Waiting for Members</h3>
                    <p>Share this meeting so others can join and listen.</p>
                  </div>
                ) : (
                  participants.map((p) => {
                    const isHandRaised = handRaisedParticipants.has(p);
                    const isSpeaking = speakingParticipants.has(p);
                    const hasAudio = audioParticipants.has(p);
                    const isMutedAdmin = mutedParticipants.has(p);
                    const isLoading = muteloading.has(p);

                    let avatarBg = "linear-gradient(135deg, #6B7280, #4B5563)";
                    let statusText = "Listen-only";
                    if (isHandRaised) { avatarBg = "linear-gradient(135deg, #F59E0B, #D97706)"; statusText = "Wants to speak"; }
                    if (isSpeaking) { avatarBg = "linear-gradient(135deg, #4ADE80, #22C55E)"; statusText = "Speaking"; }
                    if (!isSpeaking && hasAudio && !isHandRaised) { statusText = "Unmuted"; }
                    if (isMutedAdmin && !isHandRaised) { statusText = "Muted by host"; }

                    return (
                      <div key={p} className={`participant-card ${isSpeaking ? "speaking" : ""} ${isHandRaised ? "hand-raised" : ""} ${isMutedAdmin ? "muted-by-admin" : ""}`}>
                        <div className={`participant-avatar ${isSpeaking ? "speaking-ring" : ""} ${isHandRaised ? "hand-raised-ring" : ""}`}
                          style={{ background: avatarBg }}>
                          {getDisplayName(p).charAt(0).toUpperCase()}
                          {isHandRaised && !isSpeaking && (
                            <div className="avatar-badge">
                              <i className="fas fa-hand"></i>
                            </div>
                          )}
                        </div>
                        <div className="participant-info">
                          <div className="participant-name">{getDisplayName(p)}</div>
                          <div className="participant-role">{statusText}</div>
                        </div>
                        <div className="participant-actions">
                          {isSpeaking ? (
                            <div className="speaking-wave">
                              <span></span><span></span><span></span><span></span>
                            </div>
                          ) : isHandRaised ? (
                            <>
                              <button className="action-btn allow" onClick={() => handleAllowHandRaise(p)} disabled={isLoading} title="Allow to speak">
                                {isLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-check"></i>}
                              </button>
                              <button className="action-btn dismiss" onClick={() => handleDismissHandRaise(p)} title="Dismiss">
                                <i className="fas fa-xmark"></i>
                              </button>
                            </>
                          ) : hasAudio ? (
                            <button className="action-btn mute" onClick={() => handleMuteParticipant(p)} disabled={isLoading} title="Close microphone">
                              {isLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-microphone"></i>}
                            </button>
                          ) : isMutedAdmin ? (
                            <button className="action-btn unmute" onClick={() => handleUnmuteParticipant(p)} disabled={isLoading} title="Restore microphone">
                              {isLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-microphone-slash"></i>}
                            </button>
                          ) : (
                            <div className="status-icon muted" title="No audio">
                              <i className="fas fa-microphone-slash"></i>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
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
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <ReactionsOverlay room={roomRef.current} identity={identity} />
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
