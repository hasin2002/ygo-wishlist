"use client";

import { useEffect, useRef } from "react";

export const ebayListingFreshnessIntervalMs = 60_000;

type FreshnessSchedulerOptions = {
  checkMarker: () => Promise<string | null | undefined>;
  clearTimer: (timer: number) => void;
  isVisible: () => boolean;
  onMarkerChange: () => void;
  setTimer: (callback: () => void, delay: number) => number;
};

/** One visible-screen timer for the lightweight local lifecycle marker. */
export class EbayListingFreshnessScheduler {
  private baseline: string | null | undefined;
  private checking = false;
  private readonly options: FreshnessSchedulerOptions;
  private running = false;
  private timer: number | null = null;

  constructor(options: FreshnessSchedulerOptions) {
    this.options = options;
  }

  setBaseline(marker: string | null | undefined) {
    if (marker !== undefined) this.baseline = marker;
  }

  start() {
    this.running = true;
    this.schedule();
  }

  stop() {
    this.running = false;
    this.pause();
  }

  pause() {
    if (this.timer) this.options.clearTimer(this.timer);
    this.timer = null;
  }

  resume() {
    if (!this.running || !this.options.isVisible()) return;
    this.pause();
    void this.check();
  }

  private schedule() {
    if (!this.running || !this.options.isVisible() || this.timer) return;
    this.timer = this.options.setTimer(() => {
      this.timer = null;
      void this.check();
    }, ebayListingFreshnessIntervalMs);
  }

  private async check() {
    if (!this.running || !this.options.isVisible() || this.checking) return;
    this.checking = true;
    try {
      const marker = await this.options.checkMarker();
      if (marker !== undefined) {
        if (this.baseline === undefined) this.baseline = marker;
        else if (marker !== this.baseline) {
          this.baseline = marker;
          this.options.onMarkerChange();
        }
      }
    } catch {
      // A transient marker request must not become an unhandled rejection or
      // stop the next scheduled check. Keep the last confirmed baseline.
    } finally {
      this.checking = false;
      this.schedule();
    }
  }
}

export function hasNonTerminalEbayListing(listing: {
  lastError: string | null;
  listingState: string;
  saleState: string;
}) {
  return listing.listingState === "active"
    || listing.saleState === "pending"
    || Boolean(listing.lastError)
    || listing.listingState === "unknown"
    || listing.listingState === "suspended"
    || listing.saleState === "needs_review";
}

export function useEbayListingFreshness({
  enabled,
  marker,
  onMarkerChange,
  refetchMarker,
}: {
  enabled: boolean;
  marker: string | null | undefined;
  onMarkerChange: () => void;
  refetchMarker: () => Promise<string | null | undefined>;
}) {
  const onMarkerChangeRef = useRef(onMarkerChange);
  const refetchMarkerRef = useRef(refetchMarker);
  const schedulerRef = useRef<EbayListingFreshnessScheduler | null>(null);

  useEffect(() => {
    onMarkerChangeRef.current = onMarkerChange;
  }, [onMarkerChange]);

  useEffect(() => {
    refetchMarkerRef.current = refetchMarker;
  }, [refetchMarker]);

  useEffect(() => {
    schedulerRef.current?.setBaseline(marker);
  }, [marker]);

  useEffect(() => {
    if (!enabled) return;
    const scheduler = new EbayListingFreshnessScheduler({
      checkMarker: () => refetchMarkerRef.current(),
      clearTimer: (timer) => window.clearTimeout(timer),
      isVisible: () => document.visibilityState === "visible",
      onMarkerChange: () => onMarkerChangeRef.current(),
      setTimer: (callback, delay) => window.setTimeout(callback, delay),
    });
    schedulerRef.current = scheduler;

    let lastRegainAt = 0;
    const checkOnVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        scheduler.pause();
        return;
      }
      const now = Date.now();
      // Browsers commonly emit visibilitychange and focus together.
      if (now - lastRegainAt < 1_000) return;
      lastRegainAt = now;
      scheduler.resume();
    };

    const checkOnFocus = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRegainAt < 1_000) return;
      lastRegainAt = now;
      scheduler.resume();
    };

    scheduler.start();
    document.addEventListener("visibilitychange", checkOnVisibilityChange);
    window.addEventListener("focus", checkOnFocus);
    return () => {
      document.removeEventListener("visibilitychange", checkOnVisibilityChange);
      window.removeEventListener("focus", checkOnFocus);
      scheduler.stop();
      schedulerRef.current = null;
    };
  }, [enabled]);
}
