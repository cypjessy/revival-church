"use client";

let _supported: boolean | null = null;

/**
 * Check if Picture-in-Picture mode is supported on this device.
 * Only works on Android 8.0+ with the FEATURE_PICTURE_IN_PICTURE capability.
 */
export async function isPiPSupported(): Promise<boolean> {
  if (_supported !== null) return _supported;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cap = (window as Record<string, any>).Capacitor;
    if (cap?.plugins?.PiP?.isSupported) {
      const result = await cap.plugins.PiP.isSupported();
      _supported = result?.supported === true;
    } else {
      _supported = false;
    }
  } catch {
    _supported = false;
  }
  return _supported;
}

/**
 * Enter Picture-in-Picture mode manually.
 * @param aspectW - Width ratio (default 16)
 * @param aspectH - Height ratio (default 9)
 */
export async function enterPiP(aspectW = 16, aspectH = 9): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cap = (window as Record<string, any>).Capacitor;
    if (cap?.plugins?.PiP?.enter) {
      await cap.plugins.PiP.enter({ aspectW, aspectH });
    }
  } catch {
    // Not available — silently fail
  }
}

/**
 * Listen for PiP mode changes dispatched from native Android code.
 * @param callback - Called with isInPip boolean when PiP state changes
 * @returns Cleanup function to remove the listener
 */
export function onPiPModeChange(callback: (isInPip: boolean) => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail && typeof detail.isInPip === "boolean") {
      callback(detail.isInPip);
    }
  };
  window.addEventListener("pip-mode-changed", handler);
  return () => window.removeEventListener("pip-mode-changed", handler);
}
