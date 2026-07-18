"use client";

import { useEffect, useState } from "react";

// Client data requests need the browser's cookies. Keeping the first render in
// the same loading state on server and browser prevents a hydration mismatch.
export function useClientReady() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  return ready;
}
