"use client";

const STORAGE_KEY = "faithstream_errors";
const MAX_STORED = 20;

interface ErrorReport {
  message: string;
  stack?: string;
  timestamp: string;
  url?: string;
}

export function reportError(error: Error, context?: Record<string, unknown>): void {
  const report: ErrorReport = {
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
    url: typeof window !== "undefined" ? window.location.href : undefined,
  };

  console.error("[ErrorReporter]", report, context ?? "");

  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as ErrorReport[];
    stored.unshift(report);
    if (stored.length > MAX_STORED) stored.length = MAX_STORED;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // localStorage full or unavailable - silently ignore
  }
}

/** Retrieve recent errors (for debug UIs or sending to a server later). */
export function getStoredErrors(): ErrorReport[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}
