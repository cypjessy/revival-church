"use client";

import { useState, useEffect } from "react";

export function useDetectTablet(minWidth = 768) {
  const [isTablet, setIsTablet] = useState(false);

  useEffect(() => {
    const check = () => setIsTablet(window.innerWidth >= minWidth);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [minWidth]);

  return isTablet;
}
