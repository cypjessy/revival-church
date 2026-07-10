"use client";

import { createContext, useContext, useRef, useState, useCallback, useEffect, type ReactNode } from "react";

// ============================================================
// GLOBAL AUDIO PROVIDER
// ============================================================
// Lives at the layout level so the <audio> element persists
// across page navigations — radio keeps playing when users
// switch between dashboard, radio, watch, etc.
//
// Android background playback:
// Uses the standard navigator.mediaSession API (supported in
// modern Android WebViews). This creates a system media
// notification and keeps audio alive in the background on
// Android 12+ via the OS-managed media session service.
// No native plugins needed — no crashes, no conflicts.
// ============================================================

interface AudioContextType {
  isPlaying: boolean;
  currentStreamUrl: string | null;
  currentStationId: number | null;
  volume: number;
  play: (url: string, stationId?: number) => void;
  pause: () => void;
  stop: () => void;
  toggle: (url: string, stationId?: number) => void;
  setVolume: (v: number) => void;
  updateMediaSession: (title: string, artist: string, albumArt?: string) => void;
}

const AudioCtx = createContext<AudioContextType | null>(null);

export function AudioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStreamUrl, setCurrentStreamUrl] = useState<string | null>(null);
  const [currentStationId, setCurrentStationId] = useState<number | null>(null);
  const [volume, setVolumeState] = useState(0.8);

  // ─── navigator.mediaSession — standard web API ───
  // Supported in modern Android WebView (Chrome 73+).
  // Sets system media notification and integrates with
  // Android's media session service for background playback.

  const updateMediaSession = useCallback((title: string, artist: string, albumArt?: string) => {
    try {
      if (!("mediaSession" in navigator)) return;

      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || "MOUNTAIN OF DELIVERANCE CHURCH Radio",
        artist: artist || "MOUNTAIN OF DELIVERANCE CHURCH",
        album: "Radio Stream",
        artwork: albumArt
          ? [
              { src: albumArt, sizes: "256x256", type: "image/jpeg" },
              { src: albumArt, sizes: "512x512", type: "image/jpeg" },
            ]
          : [],
      });

      navigator.mediaSession.playbackState = "playing";
    } catch (err) {
      // MediaSession may not be fully available in all WebViews
      console.warn("[Audio] MediaSession update failed:", err);
    }
  }, []);

  // Register media session action handlers once
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    try {
      const handlePlay = () => {
        // User tapped play on the notification — resume last stream
        const audio = audioRef.current;
        if (audio && audio.src) {
          audio.play().catch(() => {});
        }
      };

      const handlePause = () => {
        const audio = audioRef.current;
        if (audio) audio.pause();
      };

      navigator.mediaSession.setActionHandler("play", handlePlay);
      navigator.mediaSession.setActionHandler("pause", handlePause);
      // Radio doesn't have next/prev track, but we register noop handlers
      // to prevent the notification from showing those buttons
      navigator.mediaSession.setActionHandler("nexttrack", () => {});
      navigator.mediaSession.setActionHandler("previoustrack", () => {});
      navigator.mediaSession.setActionHandler("seekforward", () => {});
      navigator.mediaSession.setActionHandler("seekbackward", () => {});
    } catch (err) {
      console.warn("[Audio] MediaSession action handlers failed:", err);
    }
  }, []);

  // ─── HTML5 Audio Element ───
  useEffect(() => {
    try {
      const audio = new Audio();
      audio.style.display = "none";
      audio.preload = "none";
      audio.crossOrigin = "anonymous";
      audio.setAttribute("playsinline", "true");
      audio.setAttribute("webkit-playsinline", "true");

      const onPlay = () => {
        setIsPlaying(true);
        try {
          if ("mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "playing";
          }
        } catch {}
      };
      const onPause = () => {
        setIsPlaying(false);
        try {
          if ("mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "paused";
          }
        } catch {}
      };
      const onEnded = () => {
        setIsPlaying(false);
        try {
          if ("mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "paused";
          }
        } catch {}
      };
      const onError = (e: Event) => {
        const audioEl = e.target as HTMLAudioElement;
        console.warn('[Audio] Stream error:', {
          errorCode: audioEl.error?.code,
          src: audioEl.src,
        });
      };

      audio.addEventListener("play", onPlay);
      audio.addEventListener("pause", onPause);
      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", onError);

      document.body.appendChild(audio);
      audioRef.current = audio;

      return () => {
        try {
          audio.removeEventListener("play", onPlay);
          audio.removeEventListener("pause", onPause);
          audio.removeEventListener("ended", onEnded);
          audio.removeEventListener("error", onError);
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
          audio.remove();
        } catch (cleanupErr) {
          console.warn('[Audio] Cleanup exception:', cleanupErr);
        }
        audioRef.current = null;
      };
    } catch (err) {
      console.error('[Audio] Failed to create audio element:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const play = useCallback((url: string, stationId?: number) => {
    const audio = audioRef.current;
    if (!audio || !url) return;
    try {
      const cacheBust = url.includes("?") ? `&_=${Date.now()}` : `?_=${Date.now()}`;
      audio.src = url + cacheBust;
      audio.load();
      const p = audio.play();
      if (p !== undefined) {
        p.catch((err) => {
          console.warn('[Audio] Play failed:', err);
          setTimeout(() => {
            audio.play().catch(() => {});
          }, 300);
        });
      }
      setCurrentStreamUrl(url);
      setCurrentStationId(stationId ?? null);
    } catch (err) {
      console.error('[Audio] Play exception:', err);
    }
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setIsPlaying(false);
    setCurrentStreamUrl(null);
    setCurrentStationId(null);
    try {
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "paused";
        navigator.mediaSession.metadata = null;
      }
    } catch {}
  }, []);

  const toggle = useCallback((url: string, stationId?: number) => {
    const audio = audioRef.current;
    if (!audio || !url) return;
    try {
      if (audio.src && audio.src !== "" && !audio.paused) {
        audio.pause();
      } else {
        const cacheBust = url.includes("?") ? `&_=${Date.now()}` : `?_=${Date.now()}`;
        audio.src = url + cacheBust;
        audio.load();
        const attemptPlay = () => {
          try {
            const p = audio.play();
            if (p !== undefined) {
              p.catch((err) => {
                console.warn('[Audio] Toggle play failed:', err);
                setTimeout(() => {
                  audio.play().catch(() => {});
                }, 300);
              });
            }
          } catch (playErr) {
            console.error('[Audio] Toggle play exception:', playErr);
          }
        };
        attemptPlay();
        setCurrentStreamUrl(url);
        setCurrentStationId(stationId ?? null);
      }
    } catch (err) {
      console.error('[Audio] Toggle exception:', err);
    }
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, []);

  return (
    <AudioCtx.Provider value={{
      isPlaying, currentStreamUrl, currentStationId, volume,
      play, pause, stop, toggle, setVolume,
      updateMediaSession,
    }}>
      {children}
    </AudioCtx.Provider>
  );
}

export function useAudio(): AudioContextType {
  const ctx = useContext(AudioCtx);
  if (!ctx) throw new Error("useAudio must be used within AudioProvider");
  return ctx;
}
