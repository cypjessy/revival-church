"use client";

import { createContext, useContext, useRef, useState, useCallback, useEffect, type ReactNode } from "react";

// Lazy-loaded Capacitor Music Controls plugin.
// On web (Vercel) this gracefully degrades; on native Android/iOS it
// provides a persistent notification with playback controls and a
// foreground service that keeps audio alive in the background.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mcPlugin: any = null;
let mcPromise: Promise<boolean> | null = null;

// Lazy-loaded Capacitor Media Session plugin for better native integration
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mediaSessionPlugin: any = null;
let mediaSessionPromise: Promise<boolean> | null = null;

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

async function loadMediaSession(): Promise<boolean> {
  if (!mediaSessionPromise) {
    mediaSessionPromise = (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return false;
      } catch {
        return false;
      }
      try {
        const mod = await import("@jofr/capacitor-media-session");
        // The plugin exports MediaSession as a named export
        mediaSessionPlugin = mod.MediaSession || mod.default;
        return true;
      } catch (err) {
        console.error('[MediaSession] Failed to load:', err);
        return false;
      }
    })();
  }
  return mediaSessionPromise;
}

function getMC() {
  return mcPlugin?.CapacitorMusicControls ?? null;
}

function getMediaSession() {
  return mediaSessionPlugin ?? null;
}

// ============================================================
// NOTIFICATION HELPERS
// ============================================================

/**
 * Safely create or update the Android media notification.
 * Wrapped entirely in try/catch because native plugin crashes can kill the app.
 */
async function createNotification(title: string, artist: string, albumArt?: string) {
  try {
    const mc = getMC();
    if (!mc) return;
    try {
      await mc.destroy();
    } catch { /* no existing notification to destroy */ }
    try {
      await mc.create({
        track: title || "MOUNTAIN OF DELIVERANCE CHURCH Radio",
        artist: artist || "MOUNTAIN OF DELIVERANCE CHURCH",
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
        ticker: title ? `Now playing: ${title}` : "MOUNTAIN OF DELIVERANCE CHURCH Radio",
      });
    } catch {
      // Plugin not available or create failed
    }
  } catch {
    // Native plugin crash — silently ignore to prevent app crash
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
  
  // Also update native Media Session
  try {
    const ms = getMediaSession();
    if (ms && typeof ms.setPlaybackState === 'function') {
      await ms.setPlaybackState({
        isPlaying,
        position: 0, // Live stream - no position tracking
      });
    }
  } catch (msErr) {
    console.error('[MediaSession] Failed to update playback state:', msErr);
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
  const mediaTitleRef = useRef("MOUNTAIN OF DELIVERANCE CHURCH Radio");
  const mediaArtistRef = useRef("MOUNTAIN OF DELIVERANCE CHURCH");
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
    try {
      switch (message) {
        case "music-controls-play": {
          const url = currentStreamUrlRef.current;
          if (url) {
            const audio = audioRef.current;
            if (audio) {
              try {
                const cacheBust = url.includes("?") ? `&_=${Date.now()}` : `?_=${Date.now()}`;
                audio.src = url + cacheBust;
                audio.load();
                audio.play().catch((err) => {
                  console.error('[Audio] Controls play failed:', err);
                  setTimeout(() => {
                    audio.play().catch((err2) => {
                      console.error('[Audio] Controls retry failed:', err2);
                    });
                  }, 300);
                });
              } catch (playErr) {
                console.error('[Audio] Controls play exception:', playErr);
              }
            }
            setIsPlaying(true);
          }
          break;
        }
        case "music-controls-pause":
          try {
            audioRef.current?.pause();
          } catch (err) {
            console.error('[Audio] Controls pause exception:', err);
          }
          setIsPlaying(false);
          break;
        case "music-controls-destroy":
          // Stop button pressed — stop audio and remove notification
          {
            const audio = audioRef.current;
            if (audio) {
              try {
                audio.pause();
                audio.removeAttribute("src");
                audio.load();
              } catch (err) {
                console.error('[Audio] Controls destroy exception:', err);
              }
            }
            setIsPlaying(false);
            setCurrentStreamUrl(null);
            setCurrentStationId(null);
          }
          break;
        case "music-controls-media-button":
          // Headphone button single press — toggle play/pause
          try {
            if (isPlayingRef.current) {
              audioRef.current?.pause();
              setIsPlaying(false);
            } else {
              const url = currentStreamUrlRef.current;
              if (url) {
                const audio = audioRef.current;
                if (audio) {
                  try {
                    const cacheBust = url.includes("?") ? `&_=${Date.now()}` : `?_=${Date.now()}`;
                    audio.src = url + cacheBust;
                    audio.load();
                    audio.play().catch((err) => {
                      console.error('[Audio] Media button play failed:', err);
                    });
                  } catch (playErr) {
                    console.error('[Audio] Media button play exception:', playErr);
                  }
                }
                setIsPlaying(true);
              }
            }
          } catch (err) {
            console.error('[Audio] Media button exception:', err);
          }
          break;
      }
    } catch (err) {
      console.error('[Audio] Controls action exception:', err);
    }
  }, []);

  // Set up notification control event listeners once on mount
  useEffect(() => {
    loadMusicControls().then(() => {
      try {
        const mc = getMC();
        if (!mc) return;
        // iOS uses the plugin's addListener
        const p = mc.addListener("controlsNotification", (info: { message: string }) => {
          handleControlsAction(info.message);
        });
        if (p && typeof p.catch === "function") {
          p.catch(() => { /* listener registration failed — controls will not work */ });
        }
      } catch {
        // Plugin not available
      }
    }).catch(() => {
      // Plugin not available
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
    try {
      mediaTitleRef.current = title;
      mediaArtistRef.current = artist;
      mediaArtRef.current = albumArt;

      // If currently playing, update the notification with the new metadata
      if (isPlayingRef.current) {
        await createNotification(title, artist, albumArt);
        
        // Also update native Media Session API for better Android integration
        try {
          await loadMediaSession();
          const ms = getMediaSession();
          if (ms && typeof ms.setMetadata === 'function') {
            await ms.setMetadata({
              title: title || 'MOUNTAIN OF DELIVERANCE CHURCH Radio',
              artist: artist || 'MOUNTAIN OF DELIVERANCE CHURCH',
              album: 'Radio Stream',
              artwork: albumArt ? [{ src: albumArt, sizes: '512x512', type: 'image/jpeg' }] : [],
              duration: -1, // Live stream
              isLive: true,
            });
          }
        } catch (msErr) {
          console.error('[MediaSession] Failed to set metadata:', msErr);
        }
      }
    } catch {
      // Media session update is optional — ignore failures
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
    try {
      const audio = new Audio();
      audio.style.display = "none";
      audio.preload = "none";
      
      // Android-specific: Set crossOrigin to handle CORS issues
      audio.crossOrigin = "anonymous";
      
      // Android-specific: Prevent autoplay restrictions
      audio.setAttribute("playsinline", "true");
      audio.setAttribute("webkit-playsinline", "true");

      const onPlay = () => {
        setIsPlaying(true);
      };
      const onPause = () => {
        setIsPlaying(false);
        updatePlaying(false);
      };
      const onEnded = () => {
        setIsPlaying(false);
        updatePlaying(false);
      };
      const onError = (e: Event) => {
        // Log error details for debugging
        const audioEl = e.target as HTMLAudioElement;
        console.error('[Audio] Stream error:', {
          errorCode: audioEl.error?.code,
          errorMessage: audioEl.error?.message,
          src: audioEl.src,
          networkState: audioEl.networkState,
          readyState: audioEl.readyState,
        });
        // Don't update state on error - stream might reconnect
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
          console.error('[Audio] Cleanup exception:', cleanupErr);
        }
        audioRef.current = null;
        destroyNotification();
      };
    } catch (err) {
      console.error('[Audio] Failed to create audio element:', err);
    }
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
          console.error('[Audio] Play failed:', err);
          setTimeout(() => {
            audio.play().catch((err2) => {
              console.error('[Audio] Retry play failed:', err2);
            });
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
  }, []);

  const toggle = useCallback((url: string, stationId?: number) => {
    const audio = audioRef.current;
    if (!audio || !url) return;

    try {
      if (audio.src && audio.src !== "" && !audio.paused) {
        // Currently playing — pause
        audio.pause();
      } else {
        // Force a fresh stream connection with cache busting.
        const cacheBust = url.includes("?") ? `&_=${Date.now()}` : `?_=${Date.now()}`;
        audio.src = url + cacheBust;
        audio.load();

        const attemptPlay = () => {
          try {
            const p = audio.play();
            if (p !== undefined) {
              p.catch((err) => {
                console.error('[Audio] Toggle play failed:', err);
                setTimeout(() => {
                  audio.play().catch((err2) => {
                    console.error('[Audio] Toggle retry failed:', err2);
                  });
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
