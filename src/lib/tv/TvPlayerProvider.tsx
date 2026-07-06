"use client";

import { createContext, useContext, useRef, useState, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import PlyrPlayer from "@/components/tv/PlyrPlayer";

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
  const videoIdRef = useRef<string | null>(null);
  // Keep ref in sync with state so stable callbacks can read the latest videoId
  videoIdRef.current = videoId;

  // Portal target — the DOM element to render the player into
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  // Stable registerTarget — portal target only; never re-apply seek on navigation
  // (re-seeking from stale Firestore state caused Android resume loops).
  const registerTarget = useCallback((el: HTMLElement | null) => {
    setPortalTarget(el);
  }, []);

  const [playerKey, setPlayerKey] = useState(0);
  // Track the latest seek time so it's preserved when portal target changes between pages
  const latestSeekRef = useRef<number | undefined>(undefined);

  const play = useCallback((id: string, seekTime?: number) => {
    const isNewVideo = videoIdRef.current !== id;
    if (isNewVideo) {
      setPlayerKey((k) => k + 1);
      const s = seekTime ?? latestSeekRef.current;
      setSeek(s);
      if (s !== undefined) latestSeekRef.current = s;
    } else {
      // Same video already loaded — never rewind to a stale Firestore seek.
      // Only forward-seek if another device is meaningfully ahead (>5s).
      const live = latestSeekRef.current ?? 0;
      if (seekTime !== undefined && seekTime > live + 5) {
        setSeek(seekTime);
        latestSeekRef.current = seekTime;
      }
    }
    setVideoId(id);
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    setVisible(false);
    setVideoId(null);
    videoIdRef.current = null;
    setSeek(undefined);
    latestSeekRef.current = undefined;
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

  // Memoize the context value so it doesn't change on every render.
  // Only the functions are stable — state-derived values (visible, currentVideoId)
  // are included in the memo so consumers only re-render when they actually change.
  const ctx = useMemo<TvPlayerContextValue>(() => ({
    registerTarget,
    play,
    hide,
    setCallbacks,
    visible,
    currentVideoId: videoId,
  }), [registerTarget, play, hide, setCallbacks, visible, videoId]);

  return (
    <TvPlayerContext.Provider value={ctx}>
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
