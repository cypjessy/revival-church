"use client";

import { createContext, useContext, useRef, useState, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import PlyrPlayer from "@/components/tv/PlyrPlayer";
import type { LiveStatus } from "@/lib/youtube";

/* ─── Types ──────────────────────────────────────────────────── */

export interface TvPlayerCallbacks {
  onEnded?: () => void;
  onTimeUpdate?: (time: number) => void;
}

interface TvPlayerContextValue {
  /** Register a DOM element for the player to render into (via portal). */
  registerTarget: (el: HTMLElement | null) => void;
  /** Start/resume playing a video. */
  play: (videoId: string, seek?: number) => void;
  /** Hide the player. */
  hide: () => void;
  /** Update callbacks (onEnded, onTimeUpdate) without calling play again. */
  setCallbacks: (cbs: TvPlayerCallbacks) => void;
  /** Whether the player is currently shown. */
  visible: boolean;
  /** The current video ID. */
  currentVideoId: string | null;
  /** Current live stream status (auto-detected from Firestore). */
  liveStatus: LiveStatus | null;
  /** True when a live stream is active. */
  isLive: boolean;
}

const TvPlayerContext = createContext<TvPlayerContextValue | null>(null);

export function useTvPlayer() {
  const ctx = useContext(TvPlayerContext);
  if (!ctx) throw new Error("useTvPlayer must be used within TvPlayerProvider");
  return ctx;
}

/* ─── Provider ───────────────────────────────────────────────── */

export function TvPlayerProvider({ children }: { children: React.ReactNode }) {
  const [videoId, setVideoId] = useState<string | null>(null);
  const [seek, setSeek] = useState<number | undefined>(undefined);
  const [visible, setVisible] = useState(false);
  const callbacksRef = useRef<TvPlayerCallbacks>({});

  // ─── Live stream status (listens to tv_live_status/main globally) ───
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "tv_live_status", "main"), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setLiveStatus({
          isLive: data.isLive || false,
          liveVideoId: data.liveVideoId || null,
          liveTitle: data.liveTitle || null,
          startedBy: data.startedBy || null,
          startedAt: data.startedAt?.toDate?.() || null,
        } as LiveStatus);
      } else {
        setLiveStatus(null);
      }
    });
    return () => unsub();
  }, []);

  // Portal target — the DOM element to render the player into
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  const registerTarget = useCallback((el: HTMLElement | null) => {
    setPortalTarget(el);
    // When a new target is registered and the player is already active,
    // restore the latest seek so PlyrPlayer resumes at the correct position
    if (el && videoId && latestSeekRef.current !== undefined) {
      setSeek(latestSeekRef.current);
    }
  }, [videoId]);

  const [playerKey, setPlayerKey] = useState(0);
  // Track the latest seek time so it's preserved when portal target changes between pages
  const latestSeekRef = useRef<number | undefined>(undefined);

  const play = useCallback((id: string, seekTime?: number) => {
    setVideoId((prev) => {
      // If switching to a different video, force a fresh Plyr instance
      if (prev !== id) setPlayerKey((k) => k + 1);
      return id;
    });
    setSeek(seekTime);
    if (seekTime !== undefined) latestSeekRef.current = seekTime;
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    setVisible(false);
  }, []);

  const setCallbacks = useCallback((cbs: TvPlayerCallbacks) => {
    callbacksRef.current = cbs;
  }, []);

  // Get border-radius from portal target for matching styling
  const [borderRadius, setBorderRadius] = useState("0");
  useEffect(() => {
    if (!portalTarget) return;
    const updateBorderRadius = () => {
      setBorderRadius(window.getComputedStyle(portalTarget).borderRadius);
    };
    updateBorderRadius();
    const observer = new ResizeObserver(updateBorderRadius);
    observer.observe(portalTarget);
    return () => observer.disconnect();
  }, [portalTarget]);

  // Stable context value
  const ctxValue = useMemo<TvPlayerContextValue>(() => ({
    registerTarget, play, hide, setCallbacks, visible, currentVideoId: videoId,
    liveStatus,
    isLive: liveStatus?.isLive ?? false,
  }), [registerTarget, play, hide, setCallbacks, visible, videoId, liveStatus]);

  return (
    <TvPlayerContext.Provider value={ctxValue}>
      {/* Portal — renders PlyrPlayer into the page's target element (natural document flow) */}
      {visible && videoId && portalTarget && createPortal(
        <div
          key={playerKey}
          style={{
            width: "100%",
            height: "100%",
            overflow: "hidden",
            borderRadius,
          }}
        >
          <PlyrPlayer
            videoId={videoId}
            initialSeek={seek}
            onEnded={() => callbacksRef.current.onEnded?.()}
            onTimeUpdate={(t) => {
              latestSeekRef.current = t;
              callbacksRef.current.onTimeUpdate?.(t);
            }}
          />
        </div>,
        portalTarget
      )}
      {children}
    </TvPlayerContext.Provider>
  );
}
