"use client";

import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, XCircle } from "lucide-react";
import type {
  CopyEbayExposureState,
  EbayOfferExposure,
} from "@/lib/records/types";
import { ebayExposurePresentation, ebayExposureSummary } from "@/components/records/ebay-copy-exposure-presentation";

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

  return (
    <section
      aria-labelledby={`ebay-exposure-${exposure.copyId}`}
      className="min-w-0 scroll-mt-4 rounded-lg border border-zinc-200 bg-white p-4"
      id={`ebay-exposure-panel-${exposure.copyId}`}
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Heading className="font-black" id={`ebay-exposure-${exposure.copyId}`}>eBay exposure</Heading>
          <p className="mt-1 break-words text-sm font-medium leading-5 text-zinc-600">{presentation.description}</p>
        </div>
        <span className={`inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-black ${exposureToneClassName(presentation.tone)}`}>
          <ExposureIcon tone={presentation.tone} />
          <span className="min-w-0 break-words">{presentation.label}</span>
        </span>
      </div>

      <p className="mt-3 text-sm font-bold text-zinc-800">{summary}</p>
      {exposure.offers.length ? (
        <details className="group mt-3 rounded-lg border border-zinc-200 bg-zinc-50">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-bold text-zinc-800 focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
            <span>Related eBay offers</span>
            <span className="text-xs font-semibold text-zinc-500">Show details</span>
          </summary>
          <div className="grid gap-2 border-t border-zinc-200 p-3" role="list">
            {exposure.offers.map((offer) => <div key={`${offer.listingId}:${offer.memberId ?? offer.copyId}`} role="listitem"><OfferRow offer={offer} /></div>)}
          </div>
        </details>
      ) : null}
    </section>
  );
}
