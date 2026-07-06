"use client";

import { useEffect, useRef } from "react";
import "plyr/dist/plyr.css";

type PlyrInstance = {
  currentTime: number;
  play: () => Promise<unknown> | void;
  muted: boolean;
  destroy: () => void;
  source?: unknown;
  on: (eventName: string, handler: () => void) => void;
};

type PlyrConstructor = new (container: HTMLElement, options: Record<string, unknown>) => PlyrInstance;

/**
 * Embedded YouTube / HTML5 player using core Plyr library.
 *
 * Key design: on video ID changes, the source is updated **in-place** via
 * `player.source` instead of destroying and recreating the entire player.
 * This avoids the black flash / black screen that occurred when the YouTube
 * iframe was torn down and rebuilt from scratch on every video transition.
 *
 * For HTML5 provider changes, the player IS destroyed and recreated (since
 * the underlying DOM element type changes: <div> vs <video>).
 */
export default function PlyrPlayer({
  videoId,
  provider = "youtube",
  onEnded,
  initialSeek,
  onTimeUpdate,
}: {
  videoId?: string;
  provider?: "youtube" | "html5";
  onEnded: () => void;
  initialSeek?: number;
  /** Called periodically during playback with the current time (seconds). */
  onTimeUpdate?: (time: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | HTMLVideoElement>(null);
  const plyrRef = useRef<PlyrInstance | null>(null);
  const onEndedRef = useRef(onEnded);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const initialSeekRef = useRef(initialSeek);

  // Latest videoId ref so the source-update effect always reads the current value
  const videoIdRef = useRef(videoId);

  const lastAppliedSeekRef = useRef<{ videoId: string | undefined; seek: number } | null>(null);
  // Once playback moves past the resume point, block backward re-seeks (Android loop fix).
  const maxPlaybackTimeRef = useRef(0);

  useEffect(() => {
    onEndedRef.current = onEnded;
    onTimeUpdateRef.current = onTimeUpdate;
    initialSeekRef.current = initialSeek;
    videoIdRef.current = videoId;
  }, [onEnded, onTimeUpdate, initialSeek, videoId]);

  const applySeek = (player: PlyrInstance | null | undefined, seek?: number) => {
    if (!player) return;
    if (typeof seek !== "number" || !Number.isFinite(seek) || seek <= 0.1) return;

    const currentVideoId = videoIdRef.current;
    const lastApplied = lastAppliedSeekRef.current;

    // Never rewind once the user has watched past this point on the current video.
    if (
      lastApplied?.videoId === currentVideoId &&
      maxPlaybackTimeRef.current > seek + 3 &&
      seek < maxPlaybackTimeRef.current - 3
    ) {
      return;
    }

    // Always apply seek if:
    // 1. It's a different video, OR
    // 2. The seek position has changed significantly (> 2 seconds difference)
    const isDifferentVideo = lastApplied?.videoId !== currentVideoId;
    const seekChanged = lastApplied && Math.abs(lastApplied.seek - seek) > 2;

    if (!isDifferentVideo && !seekChanged) return;

    try {
      console.log('[PlyrPlayer] Applying seek:', { videoId: currentVideoId, seek, reason: isDifferentVideo ? 'new-video' : 'seek-changed' });
      player.currentTime = seek;
    } catch (err) {
      console.error('[PlyrPlayer] Seek failed:', err);
    }

    lastAppliedSeekRef.current = { videoId: currentVideoId, seek };
  };

  // ─── Effect 1: Create Plyr on mount (or when provider changes). ───
  // Only re-runs when `provider` changes. Video transitions are handled
  // by Effect 2 below, which updates the source in-place on the instance.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !el.isConnected) return;

    // TypeScript guard — already checked above but helps with closure types
    const container: HTMLElement = el;

    // Destroy any previous instance (e.g. after provider switch)
    if (plyrRef.current) {
      try { plyrRef.current.destroy(); } catch {}
      plyrRef.current = null;
    }

    let destroyed = false;
    let unmuteTimeout: ReturnType<typeof setTimeout> | undefined;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;

    function createPlayer(module: unknown, retry = false) {
      if (destroyed || !container.isConnected) return;
      const moduleWithDefault = module as { default?: PlyrConstructor } | PlyrConstructor;
      const PlyrCtor = (moduleWithDefault as { default?: PlyrConstructor }).default || (moduleWithDefault as PlyrConstructor);

      try {
        const player = new PlyrCtor(container, {
          autoplay: true,
          muted: true,
          controls: ["play-large","play","progress","current-time","mute","volume","fullscreen"],
        });

        const endedHandler = () => onEndedRef.current();
        player.on("ended", endedHandler);

        const timeHandler = (() => {
          let last = -1;
          return () => {
            // Use player.currentTime directly instead of event detail
            const t = plyrRef.current?.currentTime;
            if (typeof t === "number") {
              if (t > maxPlaybackTimeRef.current) maxPlaybackTimeRef.current = t;
              if (Math.abs(t - last) >= 0.5) {
                last = t;
                onTimeUpdateRef.current?.(t);
              }
            }
          };
        })();
        player.on("timeupdate", timeHandler);

        // On ready: apply seek and unmute
        const readyHandler = () => {
          applySeek(player, initialSeekRef.current);

          try {
            const playPromise = player.play();
            if (playPromise && typeof playPromise.catch === "function") {
              playPromise.catch(() => {});
            }
          } catch {}

          unmuteTimeout = setTimeout(() => {
            try {
              player.muted = false;
              const playPromise = player.play();
              if (playPromise && typeof playPromise.catch === "function") {
                playPromise.catch(() => {});
              }
            } catch {}
          }, 1000);
        };
        player.on("ready", readyHandler);

        plyrRef.current = player;

        if (destroyed || !container.isConnected) {
          if (unmuteTimeout) clearTimeout(unmuteTimeout);
          try { player.destroy(); } catch {}
          plyrRef.current = null;
        }
      } catch {
        // Plyr failed to initialize — retry once
        if (!retry && !destroyed) {
          retryTimeout = setTimeout(() => createPlayer(module, true), 200);
        }
      }
    }

    import("plyr").then((PlyrModule) => {
      if (destroyed || !container.isConnected) return;
      createPlayer(PlyrModule, false);
    });

    return () => {
      destroyed = true;
      if (unmuteTimeout) clearTimeout(unmuteTimeout);
      if (retryTimeout) clearTimeout(retryTimeout);
      if (plyrRef.current) {
        try { plyrRef.current.destroy(); } catch {}
        plyrRef.current = null;
      }
    };
  }, [provider]); // Only re-run when provider type changes

  // ─── Effect 2: Update video source in-place when videoId changes. ───
  // This keeps the Plyr instance alive and avoids destroying/recreating
  // the YouTube iframe, which causes the black screen.
  useEffect(() => {
    maxPlaybackTimeRef.current = 0;
    lastAppliedSeekRef.current = null;
    if (!plyrRef.current || !videoId) return;

    if (provider === "youtube") {
      // Switch YouTube video in-place — no destroy needed
      try {
        plyrRef.current.source = {
          type: "video",
          sources: [
            {
              src: `https://www.youtube.com/watch?v=${videoId}`,
              provider: "youtube",
            },
          ],
        };

        // Apply seek after source change — use ref so it's always current
        const seek = initialSeekRef.current;
        if (typeof seek === "number" && seek > 0.1) {
          const seekTimer = setTimeout(() => {
            applySeek(plyrRef.current, seek);
          }, 500);
          return () => clearTimeout(seekTimer);
        }
      } catch {}
    }
  }, [videoId, provider]);

  // ─── Effect 3: Re-apply seek when initialSeek changes (e.g., app resume). ───
  // This handles the case where the same video is resumed with a new seek position
  useEffect(() => {
    if (!plyrRef.current || !videoId || typeof initialSeek !== "number" || initialSeek <= 0.1) return;
    
    // Small delay to ensure player is ready
    const seekTimer = setTimeout(() => {
      applySeek(plyrRef.current, initialSeek);
    }, 100);
    return () => clearTimeout(seekTimer);
  }, [initialSeek, videoId]);

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
