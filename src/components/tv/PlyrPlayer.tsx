"use client";

import { useEffect, useRef } from "react";
import "plyr/dist/plyr.css";

/**
 * Embedded YouTube player using core Plyr library.
 * Automatically plays and fires onEnded when the video finishes.
 * If initialSeek is provided, seeks to that position (seconds) before playback starts
 * by using muted autoplay + seek on ready + delayed unmute.
 */
export default function PlyrPlayer({
  videoId,
  sourceUrl,
  provider = "youtube",
  onEnded,
  initialSeek,
  onTimeUpdate,
}: {
  videoId?: string;
  sourceUrl?: string;
  provider?: "youtube" | "html5";
  onEnded: () => void;
  initialSeek?: number;
  /** Called periodically during playback with the current time (seconds). */
  onTimeUpdate?: (time: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | HTMLVideoElement>(null);
  const plyrRef = useRef<any>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;
  // Ref for initialSeek so the ready handler always reads the latest value
  // without needing initialSeek in the effect deps (which would remount the player).
  const initialSeekRef = useRef(initialSeek);
  initialSeekRef.current = initialSeek;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !el.isConnected) return;

    // Clean up old instance — wrap in try-catch to handle race conditions
    // where React may have manipulated the DOM before this runs.
    if (plyrRef.current) {
      try { plyrRef.current.destroy(); } catch {}
      plyrRef.current = null;
    }

    let destroyed = false;
    let unmuteTimeout: ReturnType<typeof setTimeout> | undefined;

    import("plyr").then((PlyrModule) => {
      if (destroyed || !el.isConnected) return;
      const PlyrCtor = PlyrModule.default || PlyrModule;

      const player = new PlyrCtor(el, {
        autoplay: true,
        muted: true,
        controls: ["play-large","play","progress","current-time","mute","volume","fullscreen"],
      });

      const endedHandler = () => onEndedRef.current();
      player.on("ended", endedHandler);

      const timeHandler = (() => {
        let last = -1;
        return (e: CustomEvent) => {
          const t = e.detail?.plyr?.currentTime;
          if (typeof t === "number" && Math.abs(t - last) >= 0.5) {
            last = t;
            onTimeUpdateRef.current?.(t);
          }
        };
      })();
      player.on("timeupdate", timeHandler);

      if (provider === "html5" && sourceUrl) {
        try {
          player.source = {
            type: "video",
            title: "Video",
            sources: [{ src: sourceUrl, type: "video/mp4" }],
          };
        } catch {}
      }

      // Only seek on 'ready' — YouTube iframe must be fully initialized
      // before seeking is reliable. No seekedRef blocking, no retry timers.
      player.on("ready", () => {
        const seek = initialSeekRef.current;
        if (seek !== undefined && seek > 0.1) {
          try {
            player.currentTime = seek;
          } catch {}
        }

        try {
          const playPromise = player.play();
          if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch(() => {});
          }
        } catch {}

        unmuteTimeout = setTimeout(() => {
          try {
            (player as any).muted = false;
            const playPromise = player.play();
            if (playPromise && typeof playPromise.catch === "function") {
              playPromise.catch(() => {});
            }
          } catch {}
        }, 1000);
      });

      plyrRef.current = player;

      if (destroyed || !el.isConnected) {
        if (unmuteTimeout) clearTimeout(unmuteTimeout);
        try { player.destroy(); } catch {}
        plyrRef.current = null;
      }
    });

    return () => {
      destroyed = true;
      if (unmuteTimeout) clearTimeout(unmuteTimeout);
      if (plyrRef.current) {
        try { plyrRef.current.destroy(); } catch {}
        plyrRef.current = null;
      }
    };
  }, [videoId, sourceUrl, provider]);

  return provider === "html5" ? (
    <video
      ref={containerRef as React.RefObject<HTMLVideoElement>}
      className="plyr"
      style={{ width: "100%", height: "100%" }}
      playsInline
      controls
    />
  ) : (
    <div
      ref={containerRef as React.RefObject<HTMLDivElement>}
      data-plyr-provider="youtube"
      data-plyr-embed-id={videoId}
      className="plyr"
      style={{ width: "100%", height: "100%" }}
    />
  );
}
