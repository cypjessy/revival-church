"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getNowPlaying, type NowPlayingData } from "./azuracast";

interface UseNowPlayingResult {
  data: NowPlayingData | null;
  isLive: boolean;
  listeners: number;
  nowPlaying: NowPlayingData["nowPlaying"];
  error: string | null;
  refetch: () => void;
}

export function useNowPlaying(stationId = ""): UseNowPlayingResult {
  const [data, setData] = useState<NowPlayingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const fetchNowPlaying = useCallback(async () => {
    try {
      const result = await getNowPlaying(stationId);
      if (!mountedRef.current) return;
      setData(result);
      setError(null);
    } catch {
      if (!mountedRef.current) return;
      setError("Failed to fetch now playing data");
    }
  }, [stationId]);

  useEffect(() => {
    mountedRef.current = true;
    setTimeout(() => fetchNowPlaying(), 0);
    intervalRef.current = setInterval(fetchNowPlaying, 5000);
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchNowPlaying]);

  return {
    data,
    isLive: data?.live?.isLive ?? false,
    listeners: data?.listeners?.current ?? 0,
    nowPlaying: data?.nowPlaying ?? null,
    error,
    refetch: fetchNowPlaying,
  };
}
