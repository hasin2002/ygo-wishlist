"use client";

import { useEffect } from "react";

type AppInitProps = {
  loadGrabScript: boolean;
};

export function AppInit({ loadGrabScript }: AppInitProps) {
  useEffect(() => {
    try {
      if (window.localStorage.getItem("ygo-theme") === "dark") {
        document.documentElement.classList.add("dark-mode");
      }
    } catch {
      // Ignore storage access issues to avoid blocking app boot.
    }

    if (!loadGrabScript || typeof document === "undefined") {
      return;
    }

    const script = document.createElement("script");
    script.src = "//unpkg.com/react-grab/dist/index.global.js";
    script.crossOrigin = "anonymous";
    script.async = true;
    document.head.appendChild(script);

    return () => {
      script.remove();
    };
  }, [loadGrabScript]);

  return null;
}
