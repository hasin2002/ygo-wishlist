"use client";

import { X } from "lucide-react";
import { useRef, useState, type MouseEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { HolographicCardCanvas } from "@/components/holographic-card-canvas";
import { useViewportOverlay } from "@/components/use-viewport-overlay";

export function CardImagePreviewDialog({
  imageUrl,
  name,
  onClose,
  rarity,
  triggerRef,
}: {
  imageUrl: string;
  name: string;
  onClose: () => void;
  rarity: string | null;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const dialogRef = useViewportOverlay<HTMLElement>({
    initialFocusRef: closeButtonRef,
    isOpen: true,
    onClose,
    triggerRef,
  });

  function updateTilt(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    setTilt({
      x: Number((-y * 10).toFixed(2)),
      y: Number((x * 12).toFixed(2)),
    });
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-label={`Larger image of ${name}`}
      aria-modal="true"
      className="fixed inset-0 z-[70] grid place-items-center bg-zinc-950/80 px-4 py-6 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <section className="relative max-h-full max-w-full" ref={dialogRef} tabIndex={-1}>
        <button
          aria-label={`Close larger image of ${name}`}
          className="absolute right-0 top-0 z-10 grid size-11 translate-x-2 -translate-y-2 place-items-center rounded-full border border-white/25 bg-zinc-950/85 text-white shadow-lg transition hover:border-white hover:bg-zinc-900 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          onClick={onClose}
          ref={closeButtonRef}
          type="button"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
        <div
          className="w-[min(82vw,420px,56dvh)] max-w-full"
          onMouseLeave={() => setTilt({ x: 0, y: 0 })}
          onMouseMove={updateTilt}
          style={{ perspective: "1200px" }}
        >
          <div
            className="rounded-xl bg-zinc-950/80 p-2 shadow-2xl transition-transform duration-150"
            style={{
              transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
              transformStyle: "preserve-3d",
            }}
          >
            <HolographicCardCanvas
              alt={name}
              className="aspect-[59/86] overflow-hidden rounded-lg border border-white/15 bg-zinc-900"
              imageUrl={imageUrl}
              rarity={rarity}
              tilt={tilt}
            />
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
