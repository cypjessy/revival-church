"use client";

import { useEffect, useRef, useState } from "react";

export default function SplashScreen() {
  const splashRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<"enter" | "visible" | "exit">("enter");

  useEffect(() => {
    import("@capacitor/splash-screen").then(({ SplashScreen }) => {
      SplashScreen.hide().catch(() => {});
    }).catch(() => {});

    // Staggered entrance: logo fades in first
    const enterTimer = setTimeout(() => setPhase("visible"), 100);
    // Start exit after visible period
    const exitTimer = setTimeout(() => setPhase("exit"), 2000);
    // Actually hide the DOM element after exit animation completes
    const hideTimer = setTimeout(() => {
      splashRef.current?.classList.add("hidden");
    }, 2600);

    return () => {
      clearTimeout(enterTimer);
      clearTimeout(exitTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  return (
    <div className="splash-screen" ref={splashRef}>
      {/* Animated mesh gradient background */}
      <div className="splash-bg">
        <div className="splash-bg-orb splash-bg-orb-1"></div>
        <div className="splash-bg-orb splash-bg-orb-2"></div>
        <div className="splash-bg-orb splash-bg-orb-3"></div>
      </div>

      {/* Content */}
      <div className={`splash-content ${phase}`}>
        {/* Logo with ring animations */}
        <div className="splash-logo-wrap">
          <div className="splash-ring splash-ring-outer"></div>
          <div className="splash-ring splash-ring-inner"></div>
          <div className="splash-logo">
            <i className="fas fa-cross"></i>
          </div>
        </div>

        {/* Brand name */}
        <h1 className="splash-brand">CHRISTIAN REVIVAL CHURCH</h1>

        {/* Tagline */}
        <p className="splash-tagline">Your Church, Everywhere</p>

        {/* Loading bar */}
        <div className="splash-progress">
          <div className="splash-progress-bar"></div>
        </div>
      </div>

      {/* Bottom decorative element */}
      <div className="splash-bottom">
        <svg viewBox="0 0 480 80" preserveAspectRatio="none" className="splash-wave">
          <path d="M0,40 C80,20 160,60 240,40 C320,20 400,60 480,40 L480,80 L0,80 Z" fill="rgba(232,168,56,0.04)" />
          <path d="M0,55 C120,35 200,75 320,55 C400,40 450,65 480,55 L480,80 L0,80 Z" fill="rgba(232,168,56,0.025)" />
        </svg>
      </div>

      <style>{`
        .splash-screen {
          position: fixed;
          inset: 0;
          background: #0A0A0A;
          z-index: 10000;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          transition: opacity 0.5s ease, visibility 0.5s ease;
        }
        .splash-screen.hidden {
          opacity: 0;
          visibility: hidden;
        }

        /* ─── Animated Mesh Gradient Background ─── */
        .splash-bg {
          position: absolute;
          inset: 0;
          overflow: hidden;
        }
        .splash-bg-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.5;
          animation: splashOrbDrift 8s ease-in-out infinite alternate;
        }
        .splash-bg-orb-1 {
          width: 300px;
          height: 300px;
          background: rgba(232,168,56,0.15);
          top: -80px;
          right: -60px;
          animation-delay: 0s;
        }
        .splash-bg-orb-2 {
          width: 250px;
          height: 250px;
          background: rgba(212,118,42,0.1);
          bottom: -40px;
          left: -80px;
          animation-delay: -2.5s;
        }
        .splash-bg-orb-3 {
          width: 200px;
          height: 200px;
          background: rgba(232,168,56,0.08);
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          animation-delay: -5s;
        }
        @keyframes splashOrbDrift {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(30px, -20px) scale(1.15); }
        }
        .splash-bg-orb-3 {
          animation: splashOrbPulse 6s ease-in-out infinite alternate;
        }
        @keyframes splashOrbPulse {
          0% { transform: translate(-50%, -50%) scale(1); opacity: 0.3; }
          100% { transform: translate(-50%, -50%) scale(1.3); opacity: 0.5; }
        }

        /* ─── Content with staggered entrance ─── */
        .splash-content {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transform: translateY(20px);
          transition: opacity 0.6s cubic-bezier(0.22, 1, 0.36, 1),
                      transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .splash-content.visible {
          opacity: 1;
          transform: translateY(0);
        }
        .splash-content.exit {
          opacity: 0;
          transform: translateY(-10px) scale(0.96);
          transition: opacity 0.4s cubic-bezier(0.22, 1, 0.36, 1),
                      transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
        }

        /* ─── Logo with animated rings ─── */
        .splash-logo-wrap {
          position: relative;
          width: 100px;
          height: 100px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 28px;
        }
        .splash-ring {
          position: absolute;
          border-radius: 50%;
          border: 1.5px solid transparent;
        }
        .splash-ring-outer {
          width: 100px;
          height: 100px;
          border-top-color: rgba(232,168,56,0.3);
          border-right-color: rgba(232,168,56,0.1);
          border-bottom-color: transparent;
          border-left-color: rgba(232,168,56,0.15);
          animation: splashRingSpin 3s linear infinite;
        }
        .splash-ring-inner {
          width: 82px;
          height: 82px;
          border-top-color: rgba(232,168,56,0.2);
          border-right-color: rgba(212,118,42,0.1);
          border-bottom-color: transparent;
          border-left-color: rgba(232,168,56,0.1);
          animation: splashRingSpin 2.5s linear infinite reverse;
        }
        @keyframes splashRingSpin {
          to { transform: rotate(360deg); }
        }
        .splash-logo {
          width: 64px;
          height: 64px;
          background: linear-gradient(135deg, #E8A838, #D4762A);
          border-radius: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 8px 32px rgba(232,168,56,0.3),
                      0 0 60px rgba(232,168,56,0.15);
          position: relative;
          z-index: 1;
          animation: splashLogoFloat 3s ease-in-out infinite;
        }
        @keyframes splashLogoFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        .splash-logo i {
          font-size: 30px;
          color: #fff;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
        }

        /* ─── Brand ─── */
        .splash-brand {
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -0.5px;
          background: linear-gradient(135deg, #E8A838 0%, #F5C76B 50%, #D4762A 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 8px;
          text-shadow: none;
          animation: splashBrandFadeIn 0.8s cubic-bezier(0.22, 1, 0.36, 1) 0.15s both;
        }
        @keyframes splashBrandFadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* ─── Tagline ─── */
        .splash-tagline {
          font-size: 15px;
          color: rgba(255,255,255,0.4);
          font-weight: 400;
          letter-spacing: 2px;
          text-transform: uppercase;
          animation: splashTaglineFadeIn 0.8s cubic-bezier(0.22, 1, 0.36, 1) 0.3s both;
        }
        @keyframes splashTaglineFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* ─── Animated progress bar ─── */
        .splash-progress {
          margin-top: 48px;
          width: 160px;
          height: 3px;
          background: rgba(255,255,255,0.06);
          border-radius: 2px;
          overflow: hidden;
          animation: splashProgressFadeIn 0.6s cubic-bezier(0.22, 1, 0.36, 1) 0.45s both;
        }
        @keyframes splashProgressFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .splash-progress-bar {
          height: 100%;
          width: 40%;
          background: linear-gradient(90deg, #E8A838, #D4762A);
          border-radius: 2px;
          animation: splashProgressAnim 1.8s cubic-bezier(0.65, 0, 0.35, 1) infinite;
        }
        @keyframes splashProgressAnim {
          0% { transform: translateX(-100%); width: 30%; }
          50% { width: 60%; }
          100% { transform: translateX(300%); width: 30%; }
        }

        /* ─── Bottom wave ─── */
        .splash-bottom {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 80px;
          pointer-events: none;
        }
        .splash-wave {
          width: 100%;
          height: 100%;
        }
      `}</style>
    </div>
  );
}
