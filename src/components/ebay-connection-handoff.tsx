"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { shouldRefreshEbaySettings } from "@/lib/ebay-connection-state";

/**
 * The local OAuth consent page opens separately. Refresh the settings RSC when
 * the owner comes back so its HttpOnly pending-state cookie can reveal and
 * focus the completion field without asking the owner to reload manually.
 */
export function EbayConnectionHandoff({
  children,
  className,
  href,
}: {
  children: ReactNode;
  className: string;
  href: string;
}) {
  const router = useRouter();
  const awaitingReturnRef = useRef(false);
  const leftForEbay = useRef(false);
  const [awaitingReturn, setAwaitingReturn] = useState(false);

  const refreshAfterReturn = useCallback((event: "focus" | "settled" | "visible") => {
    if (!shouldRefreshEbaySettings({
      awaitingReturn: awaitingReturnRef.current,
      event,
      leftForEbay: leftForEbay.current,
    })) {
      return;
    }
    router.refresh();
    if (event !== "settled") {
      awaitingReturnRef.current = false;
      setAwaitingReturn(false);
    }
  }, [router]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        leftForEbay.current = true;
        return;
      }
      refreshAfterReturn("visible");
    };
    const onFocus = () => refreshAfterReturn("focus");
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshAfterReturn]);

  return (
    <>
      <a
        className={className}
        href={href}
        onClick={() => {
          leftForEbay.current = false;
          awaitingReturnRef.current = true;
          setAwaitingReturn(true);
          window.setTimeout(() => refreshAfterReturn("settled"), 400);
        }}
        rel="noreferrer"
        target="_blank"
      >
        {children}
      </a>
      {awaitingReturn ? <p aria-live="polite" className="sr-only">eBay opened in a new tab. Return here to complete the connection.</p> : null}
    </>
  );
}
