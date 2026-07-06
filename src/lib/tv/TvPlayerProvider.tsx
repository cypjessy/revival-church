"use client";

import { createContext, useContext, useRef, useState, useCallback, useEffect } from "react";
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

  // Portal target — the DOM element to render the player into
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  const registerTarget = useCallback((el: HTMLElement | null) => {
    setPortalTarget(el);
  }, []);

  const [playerKey, setPlayerKey] = useState(0);

  const play = useCallback((id: string, seekTime?: number) => {
    setVideoId((prev) => {
      // If switching to a different video, force a fresh Plyr instance
      if (prev !== id) setPlayerKey((k) => k + 1);
      return id;
    });
    setSeek(seekTime);
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

  return (
    <TvPlayerContext.Provider
      value={{ registerTarget, play, hide, setCallbacks, visible, currentVideoId: videoId }}
    >
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
            onTimeUpdate={(t) => callbacksRef.current.onTimeUpdate?.(t)}
          />
        </div>,
        portalTarget
      )}
      {children}
    </TvPlayerContext.Provider>
  );
}
