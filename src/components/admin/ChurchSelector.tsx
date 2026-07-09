"use client";

import { useEffect, useRef } from "react";

export default function ChurchSelector() {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const pill = document.getElementById("churchPill");
    const handleClick = () => {
      window.dispatchEvent(
        new CustomEvent("show-toast", {
          detail: { title: "Switch Church", message: "Select a different church to manage...", type: "info", duration: 2500 },
        })
      );
    };
    pill?.addEventListener("click", handleClick);
    cleanupRef.current = () => pill?.removeEventListener("click", handleClick);
    return () => cleanupRef.current?.();
  }, []);

  return (
    <div className="church-selector">
      <div className="church-pill" id="churchPill">
        <i className="fas fa-church"></i>
        <span>MOUNTAIN OF DELIVERANCE CHURCH</span>
        <i className="fas fa-chevron-down"></i>
      </div>
    </div>
  );
}
