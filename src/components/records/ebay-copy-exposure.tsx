"use client";

import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, X, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  CopyEbayExposureState,
  EbayOfferExposure,
} from "@/lib/records/types";
import { ebayExposurePresentation, ebayExposureSummary } from "@/components/records/ebay-copy-exposure-presentation";

export function ebayOffersDialogEventName(copyId: string) {
  return `open-ebay-offers-${copyId}`;
}

function offerLabel(offer: EbayOfferExposure) {
  if (offer.lastError || offer.listingState === "suspended" || offer.listingState === "unknown") return "Status needs attention";
  if (offer.saleState === "needs_review") return "Sale needs review";
  if (offer.saleState === "paid") return offer.saleRecordId ? "Paid · Sale recorded" : "Paid · review Sale record";
  if (offer.saleState === "pending") return "Payment pending";
  if (offer.listingState === "active") return "Live on eBay";
  if (offer.listingState === "ended") return "Offer ended";
  return "Status needs attention";
}

function OfferStatusIcon({ label }: { label: string }) {
  if (label === "Live on eBay" || label === "Paid · Sale recorded") return <CheckCircle2 aria-hidden="true" className="size-3.5 shrink-0" />;
  if (label === "Offer ended") return <XCircle aria-hidden="true" className="size-3.5 shrink-0" />;
  if (label === "Payment pending") return <Clock3 aria-hidden="true" className="size-3.5 shrink-0" />;
  return <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />;
}

function exposureToneClassName(tone: ReturnType<typeof ebayExposurePresentation>["tone"]) {
  switch (tone) {
    case "neutral": return "border-zinc-300 bg-zinc-100 text-zinc-800";
    case "positive": return "border-emerald-300 bg-emerald-50 text-emerald-950";
    case "info": return "border-sky-300 bg-sky-50 text-sky-950";
    case "warning": return "border-amber-300 bg-amber-50 text-amber-950";
    case "danger": return "border-rose-300 bg-rose-50 text-rose-950";
    default: {
      const exhaustive: never = tone;
      throw new Error(`Unsupported eBay exposure tone: ${exhaustive}`);
    }
  }
}

function ExposureIcon({ tone }: { tone: ReturnType<typeof ebayExposurePresentation>["tone"] }) {
  if (tone === "positive") return <CheckCircle2 aria-hidden="true" className="size-3.5 shrink-0" />;
  if (tone === "info") return <Clock3 aria-hidden="true" className="size-3.5 shrink-0" />;
  if (tone === "neutral") return <Clock3 aria-hidden="true" className="size-3.5 shrink-0" />;
  return <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />;
}

function OfferRow({ offer }: { offer: EbayOfferExposure }) {
  const label = offerLabel(offer);
  return (
    <article className="grid min-w-0 gap-3 rounded-lg border border-zinc-200 bg-white p-3">
      <div className="min-w-0">
        <p className="break-words text-sm font-black text-zinc-950">{offer.title}</p>
        <p className="mt-1 break-words text-xs font-semibold leading-5 text-zinc-600">
          {offer.kind === "individual" ? "Individual Copy" : offer.kind === "quantity" ? "Quantity offer" : "Multi-Copy lot"}
          {offer.itemId ? ` · eBay item ${offer.itemId}` : ""}
        </p>
        {offer.listingEndedAt ? <p className="mt-1 text-xs font-medium text-zinc-500">Ended <time dateTime={offer.listingEndedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/London" }).format(new Date(offer.listingEndedAt))}</time></p> : null}
        {offer.lastError ? <p className="mt-2 break-words text-xs font-medium leading-5 text-amber-950">{offer.lastError}</p> : null}
      </div>
      <div className="flex min-w-0 flex-col items-start gap-2">
        <span className="inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border border-zinc-300 bg-zinc-50 px-2.5 py-1 text-xs font-black text-zinc-800">
          <OfferStatusIcon label={label} />
          <span className="min-w-0 break-words">{label}</span>
        </span>
        <a className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-800 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d] focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" href={offer.listingUrl} rel="noreferrer" target="_blank">
          <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
          Open offer
          <span className="sr-only"> {offer.title} on eBay (opens in a new tab)</span>
        </a>
      </div>
    </article>
  );
}

export function EbayCopyExposure({
  exposure,
  headingLevel = 5,
}: {
  exposure: CopyEbayExposureState;
  headingLevel?: 3 | 4 | 5 | 6;
}) {
  const Heading = `h${headingLevel}` as "h3" | "h4" | "h5" | "h6";
  const presentation = ebayExposurePresentation(exposure.aggregateState, exposure.liveOfferCount);
  const summary = ebayExposureSummary(exposure);
  const [offersOpen, setOffersOpen] = useState(false);
  const offersButtonRef = useRef<HTMLButtonElement>(null);
  const dialogId = `ebay-offers-dialog-${exposure.copyId}`;
  const dialogTitleId = `${dialogId}-title`;
  const dialogDescriptionId = `${dialogId}-description`;

  function closeOffers() {
    setOffersOpen(false);
    window.requestAnimationFrame(() => offersButtonRef.current?.focus());
  }

  useEffect(() => {
    const openOffers = () => setOffersOpen(true);
    window.addEventListener(ebayOffersDialogEventName(exposure.copyId), openOffers);
    return () => {
      window.removeEventListener(ebayOffersDialogEventName(exposure.copyId), openOffers);
    };
  }, [exposure.copyId]);

  useEffect(() => {
    if (!offersOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeOffers();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [offersOpen]);

  return (
    <section
      aria-labelledby={`ebay-exposure-${exposure.copyId}`}
      className="min-w-0 scroll-mt-4"
      id={`ebay-exposure-panel-${exposure.copyId}`}
    >
      <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Heading className="text-sm font-black" id={`ebay-exposure-${exposure.copyId}`}>eBay listings</Heading>
          <p className="mt-0.5 text-sm font-semibold text-zinc-700">{summary}</p>
        </div>
        <span className={`inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-black ${exposureToneClassName(presentation.tone)}`}>
          <ExposureIcon tone={presentation.tone} />
          <span className="min-w-0 break-words">{presentation.label}</span>
        </span>
      </div>

      {exposure.offers.length ? (
        <button aria-controls={dialogId} aria-expanded={offersOpen} aria-haspopup="dialog" className="mt-2 inline-flex min-h-11 items-center rounded-md px-3 text-sm font-bold text-[#8a1f2d] transition hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-inset" onClick={() => setOffersOpen(true)} ref={offersButtonRef} type="button">View {exposure.offers.length} related eBay {exposure.offers.length === 1 ? "offer" : "offers"}</button>
      ) : null}

      {offersOpen ? (
        <div aria-describedby={dialogDescriptionId} aria-labelledby={dialogTitleId} aria-modal="true" className="fixed inset-0 z-[60] flex items-end bg-zinc-950/50 px-0 pt-10 backdrop-blur-sm sm:items-center sm:justify-center sm:px-4 sm:py-6" onMouseDown={(event) => { if (event.target === event.currentTarget) closeOffers(); }} role="dialog">
          <section className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-xl border border-zinc-300 bg-white shadow-xl sm:rounded-xl" id={dialogId}>
            <header className="flex items-start justify-between gap-4 border-b border-zinc-200 p-4">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#8a1f2d]">eBay listings</p>
                <h2 className="mt-1 text-xl font-black" id={dialogTitleId}>Related eBay offers</h2>
                <p className="mt-1 text-sm font-semibold text-zinc-700">{summary}</p>
              </div>
              <button aria-label="Close related eBay offers" autoFocus className="grid min-h-11 min-w-11 place-items-center rounded-md border border-zinc-300 text-zinc-600 transition hover:border-zinc-950 hover:text-zinc-950 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2" onClick={closeOffers} type="button"><X aria-hidden="true" className="size-4" /></button>
            </header>
            <div className="grid gap-3 overflow-auto p-4">
              <p className="break-words text-sm font-medium leading-5 text-zinc-600" id={dialogDescriptionId}>{presentation.description}</p>
              <div className="grid gap-2" role="list">
                {exposure.offers.map((offer) => <div key={`${offer.listingId}:${offer.memberId ?? offer.copyId}`} role="listitem"><OfferRow offer={offer} /></div>)}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
