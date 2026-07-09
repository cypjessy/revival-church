"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api";

/** Type of action a play button performs */
export type ButtonActionType = "toggle-stream" | "api-call" | "navigate" | "shuffle";

/** Definition of a single play button */
export interface PlayButtonDef {
  label: string;
  playingLabel?: string;
  icon: string;
  playingIcon?: string;
  type: ButtonActionType;
  /** For "api-call" type — the API endpoint to call */
  endpoint?: string;
  /** For "api-call" type — HTTP method */
  method?: string;
  /** For "navigate" type — router path */
  path?: string;
}

/** Button definitions organized by page zone */
export interface ZoneButtons {
  [zone: string]: Record<string, PlayButtonDef>;
}

/** Full play controls configuration */
export interface PlayControlsConfig {
  streamUrl: string;
  stationId: string;
  buttons: {
    admin: ZoneButtons;
    member: ZoneButtons;
    radio: ZoneButtons;
    station: ZoneButtons;
  };
  endpoints: Record<string, string>;
}

const DEFAULT_CONFIG: PlayControlsConfig = {
  streamUrl: "https://azuracast.histoview.co.ke/listen/mountain_of_delivarance_church/radio.mp3",
  stationId: "1",
  buttons: {
    admin: {
      hero: {
        play: { label: "Listen Live", playingLabel: "Pause", icon: "fa-play", playingIcon: "fa-pause", type: "toggle-stream" },
        shuffle: { label: "Shuffle", icon: "fa-shuffle", type: "shuffle" },
        expand: { label: "Open Radio", icon: "fa-expand", type: "navigate", path: "/admin/radio" },
      },
      player: {
        miniPlay: { label: "Play", icon: "fa-play", playingIcon: "fa-stop", type: "toggle-stream" },
      },
    },
    member: {
      hero: {
        play: { label: "Listen Live", playingLabel: "Pause", icon: "fa-play", playingIcon: "fa-pause", type: "toggle-stream" },
        expand: { label: "Open Radio", icon: "fa-expand", type: "navigate", path: "/radio" },
      },
    },
    radio: {
      mainPlayer: {
        play: { label: "Play", playingLabel: "Pause", icon: "fa-play", playingIcon: "fa-pause", type: "toggle-stream" },
      },
    },
    station: {
      header: {
        play: { label: "Play", playingLabel: "Pause", icon: "fa-play", playingIcon: "fa-pause", type: "toggle-stream" },
      },
    },
  },
  endpoints: {},
};

/**
 * Hook to fetch play button configurations from the Vercel API.
 * Returns config with a convenient `getButtons(page, zone)` helper.
 * Falls back to DEFAULT_CONFIG if fetch fails or while loading.
 */
export function usePlayConfig() {
  const [config, setConfig] = useState<PlayControlsConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await apiFetch("/api/play-controls/config", { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as PlayControlsConfig;
      setConfig(data);
      setError(null);
    } catch (e) {
      console.warn("Failed to fetch play controls config, using defaults:", e);
      setError(e instanceof Error ? e.message : "Fetch failed");
      // Keep DEFAULT_CONFIG as fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  /** Get button definitions for a page and zone */
  const getButtons = useCallback(
    (page: keyof PlayControlsConfig["buttons"], zone: string): Record<string, PlayButtonDef> | null => {
      const pageButtons = config.buttons[page];
      if (!pageButtons) return null;
      const zoneButtons = (pageButtons as Record<string, Record<string, PlayButtonDef>>)[zone];
      return zoneButtons || null;
    },
    [config.buttons],
  );

  return { config, loading, error, getButtons, refetch: fetchConfig };
}
