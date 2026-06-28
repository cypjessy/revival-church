"use client";

import { createContext, useContext, useRef, useState, useCallback, useEffect, type ReactNode } from "react";

// Lazy-loaded Capacitor Music Controls plugin.
// On web (Vercel) this gracefully degrades; on native Android/iOS it
// provides a persistent notification with playback controls and a
// foreground service that keeps audio alive in the background.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mcPlugin: any = null;
let mcPromise: Promise<boolean> | null = null;

async function loadMusicControls(): Promise<boolean> {
  if (!mcPromise) {
    mcPromise = (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return false;
      } catch {
        return false;
      }
      try {
        mcPlugin = await import("capacitor-music-controls-plugin");
        return true;
      } catch {
        return false;
      }
    })();
  }
  return mcPromise;
}

function getMC() {
  return mcPlugin?.CapacitorMusicControls ?? null;
}

// ============================================================
// NOTIFICATION HELPERS
// ============================================================

async function createNotification(title: string, artist: string, albumArt?: string) {
  const mc = getMC();
  if (!mc) return;
  try {
    await mc.destroy();
  } catch { /* no-op */ }
  try {
    await mc.create({
      track: title || "Kingdom Seekers Radio",
      artist: artist || "Kingdom Seekers Church Nakuru",
      album: "Radio Stream",
      cover: albumArt || "",
      hasPrev: false,
      hasNext: false,
      hasClose: true,
      hasSkipForward: false,
      hasSkipBackward: false,
      duration: -1,
      elapsed: 0,
      isPlaying: true,
      dismissable: false,
      ticker: title ? `Now playing: ${title}` : "Kingdom Seekers Radio",
    });
  } catch {
    // Plugin not available
  }
}

async function updatePlaying(isPlaying: boolean) {
  const mc = getMC();
  if (!mc) return;
  try {
    await mc.updateIsPlaying({ isPlaying });
  } catch {
    // Plugin not available
  }
}

async function destroyNotification() {
  const mc = getMC();
  if (!mc) return;
  try {
    await mc.destroy();
  } catch {
    // Plugin not available
  }
}

// ============================================================
// GLOBAL AUDIO PROVIDER
// ============================================================
// Lives at the layout level so the <audio> element persists
// across page navigations — radio keeps playing when users
// switch between dashboard, radio, watch, etc.
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
  /** Update the now-playing metadata shown in the Android notification */
  updateMediaSession: (title: string, artist: string, albumArt?: string) => void;
  /** Register callback for next/previous station (from Android notification buttons) */
  setNextStationCallback: (cb: (() => void) | null) => void;
  setPrevStationCallback: (cb: (() => void) | null) => void;
}

const AudioCtx = createContext<AudioContextType | null>(null);

export function AudioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStreamUrl, setCurrentStreamUrl] = useState<string | null>(null);
  const [currentStationId, setCurrentStationId] = useState<number | null>(null);
  const [volume, setVolumeState] = useState(0.8);

  // Media session metadata (pushed by consuming components)
  const mediaTitleRef = useRef("Kingdom Seekers Radio");
  const mediaArtistRef = useRef("Kingdom Seekers Church Nakuru");
  const mediaArtRef = useRef<string | undefined>(undefined);

  // Next/prev station callbacks (set by consuming components).
  const nextCbRef = useRef<(() => void) | null>(null);
  const prevCbRef = useRef<(() => void) | null>(null);

  // Refs that always hold the latest value for use in event handlers
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const currentStreamUrlRef = useRef(currentStreamUrl);
  currentStreamUrlRef.current = currentStreamUrl;
  const currentStationIdRef = useRef(currentStationId);
  currentStationIdRef.current = currentStationId;

  // Handle notification control events (play, pause, stop, headphone button)
  const handleControlsAction = useCallback((message: string) => {
    switch (message) {
      case "music-controls-play": {
        const url = currentStreamUrlRef.current;
        if (url) {
          const audio = audioRef.current;
          if (audio) {
            const cacheBust = url.includes("?") ? `&_=${Date.now()}` : `?_=${Date.now()}`;
            audio.src = url + cacheBust;
            audio.load();
            audio.play().catch(() => {
              setTimeout(() => {
                audio.play().catch(() => {});
              }, 300);
            });
          }
          // Create notification immediately (before buffering completes)
          createNotification(mediaTitleRef.current, mediaArtistRef.current, mediaArtRef.current);
          setIsPlaying(true);
        }
        break;
      }
      case "music-controls-pause":
        audioRef.current?.pause();
        setIsPlaying(false);
        break;
      case "music-controls-destroy":
        // Stop button pressed — stop audio and remove notification
        {
          const audio = audioRef.current;
          if (audio) {
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
          }
          setIsPlaying(false);
          setCurrentStreamUrl(null);
          setCurrentStationId(null);
        }
        break;
      case "music-controls-media-button":
        // Headphone button single press — toggle play/pause
        if (isPlayingRef.current) {
          audioRef.current?.pause();
          setIsPlaying(false);
        } else {
          const url = currentStreamUrlRef.current;
          if (url) {
            const audio = audioRef.current;
            if (audio) {
              const cacheBust = url.includes("?") ? `&_=${Date.now()}` : `?_=${Date.now()}`;
              audio.src = url + cacheBust;
              audio.load();
              audio.play().catch(() => {});
            }
            // Create notification immediately (before buffering completes)
            createNotification(mediaTitleRef.current, mediaArtistRef.current, mediaArtRef.current);
            setIsPlaying(true);
          }
        }
        break;
    }
  }, []);

  // Set up notification control event listeners once on mount
  useEffect(() => {
    loadMusicControls().then(() => {
      const mc = getMC();
      if (!mc) return;
      // iOS uses the plugin's addListener
      mc.addListener("controlsNotification", (info: { message: string }) => {
        handleControlsAction(info.message);
      });
    });

    // Android uses a document-level event (workaround for Capacitor bug)
    const androidHandler = (e: Event) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (e as any).message;
      if (msg) {
        handleControlsAction(msg);
      }
    };
    document.addEventListener("controlsNotification", androidHandler);

    return () => {
      document.removeEventListener("controlsNotification", androidHandler);
    };
  }, [handleControlsAction]);

  const updateMediaSession = useCallback(async (title: string, artist: string, albumArt?: string) => {
    mediaTitleRef.current = title;
    mediaArtistRef.current = artist;
    mediaArtRef.current = albumArt;

    // If currently playing, update the notification with the new metadata
    if (isPlayingRef.current) {
      await createNotification(title, artist, albumArt);
    }
  }, []);

  const setNextStationCallback = useCallback((cb: (() => void) | null) => {
    nextCbRef.current = cb;
  }, []);

  const setPrevStationCallback = useCallback((cb: (() => void) | null) => {
    prevCbRef.current = cb;
  }, []);

  // Create a persistent <audio> element outside the React tree
  // so it survives any re-renders or hydration mismatches.
  useEffect(() => {
    const audio = new Audio();
    audio.style.display = "none";
    audio.preload = "none";

    const onPlay = () => {
      setIsPlaying(true);
      // Safety net: ensure notification exists if the audio play() event
      // fires without going through our explicit createNotification paths
      createNotification(mediaTitleRef.current, mediaArtistRef.current, mediaArtRef.current);
    };
    const onPause = () => {
      setIsPlaying(false);
      updatePlaying(false);
    };
    const onEnded = () => {
      setIsPlaying(false);
      updatePlaying(false);
    };
    const onError = () => {
      // Stream might just be connecting — don't update state
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    document.body.appendChild(audio);
    audioRef.current = audio;

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.remove();
      audioRef.current = null;
      destroyNotification();
    };
  }, []);

  const play = useCallback((url: string, stationId?: number) => {
    const audio = audioRef.current;
    if (!audio || !url) return;

    // Create notification immediately (before buffering) so the user
    // sees controls as soon as they tap Play
    createNotification(mediaTitleRef.current, mediaArtistRef.current, mediaArtRef.current);

    const cacheBust = url.includes("?") ? `&_=${Date.now()}` : `?_=${Date.now()}`;
    audio.src = url + cacheBust;
    audio.load();
    const p = audio.play();
    if (p !== undefined) {
      p.catch(() => {
        setTimeout(() => {
          audio.play().catch(() => {});
        }, 300);
      });
    }
    setCurrentStreamUrl(url);
    setCurrentStationId(stationId ?? null);
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
    destroyNotification();
  }, []);

  const toggle = useCallback((url: string, stationId?: number) => {
    const audio = audioRef.current;
    if (!audio || !url) return;

    if (audio.src && audio.src !== "" && !audio.paused) {
      // Currently playing — pause
      audio.pause();
    } else {
      // Create notification immediately (before buffering)
      createNotification(mediaTitleRef.current, mediaArtistRef.current, mediaArtRef.current);

      // Force a fresh stream connection with cache busting.
      const cacheBust = url.includes("?") ? `&_=${Date.now()}` : `?_=${Date.now()}`;
      audio.src = url + cacheBust;
      audio.load();

      const attemptPlay = () => {
        const p = audio.play();
        if (p !== undefined) {
          p.catch(() => {
            setTimeout(() => {
              audio.play().catch(() => {});
            }, 300);
          });
        }
      };
      attemptPlay();

      setCurrentStreamUrl(url);
      setCurrentStationId(stationId ?? null);
    }
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
  }, []);

  // Sync initial volume when audio element is created
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
      setNextStationCallback, setPrevStationCallback,
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
