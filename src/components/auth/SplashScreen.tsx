"use client";

import { useEffect, useRef } from "react";

export default function SplashScreen() {
  const splashRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    import("@capacitor/splash-screen").then(({ SplashScreen }) => {
      SplashScreen.hide().catch(() => {});
    }).catch(() => {});

    const timer = setTimeout(() => {
      splashRef.current?.classList.add("hidden");
    }, 2200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="splash-screen" ref={splashRef}>
      <div className="splash-logo">
        <i className="fas fa-cross"></i>
      </div>
      <div className="splash-brand">Kingdom Seekers Church Nakuru</div>
      <div className="splash-tagline">Your Church, Everywhere</div>
      <div className="splash-loader"></div>
    </div>
  );
}
