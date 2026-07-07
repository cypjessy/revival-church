"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Room, RoomEvent } from "livekit-client";

const REACTIONS = ["👍", "🙏", "❤️", "😄", "🎉", "👏"];

interface FloatingReaction {
  id: number;
  emoji: string;
  x: number;
}

interface Props {
  room: Room | null;
  identity: string;
}

let nextId = 0;

export default function ReactionsOverlay({ room, identity }: Props) {
  const [floating, setFloating] = useState<FloatingReaction[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const addFloating = useCallback((emoji: string) => {
    const id = nextId++;
    const x = 10 + Math.random() * 80;
    setFloating((prev) => [...prev.slice(-30), { id, emoji, x }]);
    setTimeout(() => {
      setFloating((prev) => prev.filter((r) => r.id !== id));
    }, 2800);
  }, []);

  const sendReaction = useCallback(
    (emoji: string) => {
      if (!room) return;
      const payload = new TextEncoder().encode(JSON.stringify({ type: "reaction", emoji, sender: identity }));
      room.localParticipant.publishData(payload, { reliable: true, topic: "reactions" }).catch(() => {});
      addFloating(emoji);
      setPickerOpen(false);
    },
    [room, identity, addFloating]
  );

  // Listen for incoming reactions
  useEffect(() => {
    if (!room) return;
    const handler = (payload: Uint8Array, _participant: any, _kind: any, topic: string | undefined, _encryption: any) => {
      if (topic !== "reactions") return;
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));
        if (data.type === "reaction" && data.sender !== identity) {
          addFloating(data.emoji);
        }
      } catch {}
    };
    room.on(RoomEvent.DataReceived, handler);
    return () => { room.off(RoomEvent.DataReceived, handler); };
  }, [room, identity, addFloating]);

  // Close picker on click outside
  useEffect(() => {
    if (!pickerOpen) return;
    const close = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [pickerOpen]);

  return (
    <>
      {/* Floating emojis */}
      {floating.map((r) => (
        <div
          key={r.id}
          className="reaction-float"
          style={{ left: `${r.x}%` }}
        >
          {r.emoji}
        </div>
      ))}

      {/* Reactions button + picker */}
      <div className="reactions-wrap" ref={pickerRef}>
        <button
          className="ctrl-btn reactions-btn"
          onClick={() => setPickerOpen(!pickerOpen)}
          title="Send reaction"
        >
          <i className="fas fa-face-smile"></i>
        </button>

        {pickerOpen && (
          <div className="reactions-picker">
            {REACTIONS.map((emoji) => (
              <button
                key={emoji}
                className="reaction-option"
                onClick={() => sendReaction(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .reaction-float {
          position: fixed;
          bottom: 120px;
          z-index: 9999;
          font-size: 36px;
          pointer-events: none;
          animation: reactionFloat 2.5s ease-out forwards;
        }

        @keyframes reactionFloat {
          0% {
            opacity: 1;
            transform: translateY(0) scale(0.5);
          }
          20% {
            opacity: 1;
            transform: translateY(-20px) scale(1.2) rotate(-5deg);
          }
          60% {
            opacity: 0.8;
            transform: translateY(-80px) scale(1) rotate(5deg);
          }
          100% {
            opacity: 0;
            transform: translateY(-160px) scale(0.8) rotate(0deg);
          }
        }

        .reactions-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }

        .reactions-btn {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 1px solid var(--border, rgba(255,255,255,0.06));
          background: var(--surface, rgba(255,255,255,0.04));
          color: var(--text-tertiary, rgba(255,255,255,0.35));
          font-size: 16px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          flex-shrink: 0;
        }

        .reactions-btn:active {
          transform: scale(0.9);
        }

        .reactions-picker {
          position: absolute;
          bottom: calc(100% + 8px);
          right: 0;
          display: flex;
          gap: 4px;
          padding: 8px 10px;
          background: #1A1A1A;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
          z-index: 10001;
          animation: pickerIn 0.2s ease;
        }

        @keyframes pickerIn {
          from { opacity: 0; transform: translateY(8px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .reaction-option {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          border: none;
          background: transparent;
          font-size: 20px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }

        .reaction-option:hover {
          background: rgba(255,255,255,0.08);
          transform: scale(1.2);
        }

        .reaction-option:active {
          transform: scale(1.3);
        }

        @media (max-width: 480px) {
          .reaction-float { font-size: 28px; bottom: 100px; }
          .reactions-btn { width: 40px; height: 40px; font-size: 14px; }
          .reactions-picker { gap: 2px; padding: 6px 8px; }
          .reaction-option { width: 34px; height: 34px; font-size: 17px; }
        }
      `}</style>
    </>
  );
}
