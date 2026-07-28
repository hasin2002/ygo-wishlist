"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  Search,
  Unplug,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useId } from "react";
import { isEbayListingDataReviewMessage } from "@/lib/records/ebay-listing-reconciliation-reason";

export type EbayPersistedListingState = "none" | "active" | "ended" | "suspended" | "unknown";
export type EbayPersistedSaleState = "none" | "pending" | "paid" | "cancelled" | "needs_review";
export type EbayCopyState = "available" | "sold" | "void";

type StatusPresentation = {
  badgeClassName: string;
  description: string;
  Icon: LucideIcon;
  label: string;
};

export type EbayListingStatusBadgeProps = {
  copyState: EbayCopyState;
  errorMessage?: string | null;
  listingState: EbayPersistedListingState;
  requiresReconnect?: boolean;
  saleRecorded?: boolean;
  saleRecordId?: string | null;
  saleState: EbayPersistedSaleState;
  syncing?: boolean;
};

export type EbayListingStatusPanelProps = EbayListingStatusBadgeProps & {
  ebayUrl?: string | null;
  endedAt?: string | null;
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  lastSyncedAt?: string | null;
  listedAt?: string | null;
  listingUpdatedAt?: string | null;
  onReconnect?: () => void;
  onRefresh?: () => void;
  onRelist?: () => void;
  onReview?: () => void;
  paidAt?: string | null;
  saleRecordedAt?: string | null;
  title?: string;
};

const actionClassName = "inline-flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-md px-3 text-center text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8a1f2d] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 sm:w-auto";
const secondaryActionClassName = `${actionClassName} border border-zinc-300 bg-white text-zinc-800 hover:border-zinc-500 hover:bg-zinc-50`;
const primaryActionClassName = `${actionClassName} bg-[#8a1f2d] text-white hover:bg-[#711826]`;

function assertNever(value: never): never {
  throw new Error(`Unsupported eBay lifecycle state: ${String(value)}`);
}

export function ebayListingStatusPresentation({
  copyState,
  errorMessage,
  listingState,
  requiresReconnect = false,
  saleRecorded = false,
  saleRecordId,
  saleState,
  syncing = false,
}: EbayListingStatusBadgeProps): StatusPresentation {
  if (requiresReconnect) {
    return {
      badgeClassName: "border-amber-300 bg-amber-50 text-amber-950",
      description: "Reconnect eBay to check or manage this listing.",
      Icon: Unplug,
      label: "Reconnect eBay",
    };
  }
  if (isEbayListingDataReviewMessage(errorMessage)) {
    return {
      badgeClassName: "border-amber-300 bg-amber-50 text-amber-950",
      description: "eBay shows sale activity, but the app cannot safely match it to one physical Copy yet.",
      Icon: AlertTriangle,
      label: "Sale data needs review",
    };
  }
  if (errorMessage) {
    return {
      badgeClassName: "border-rose-300 bg-rose-50 text-rose-950",
      description: "The saved listing status may be out of date. Try refreshing it.",
      Icon: AlertTriangle,
      label: "Status needs attention",
    };
  }
  if (syncing) {
    return {
      badgeClassName: "border-sky-300 bg-sky-50 text-sky-950",
      description: "Checking eBay for the latest listing and sale state.",
      Icon: RefreshCw,
      label: "Refreshing status",
    };
  }
  const hasRecordedSale = saleRecorded || Boolean(saleRecordId);
  switch (saleState) {
    case "needs_review":
      return {
        badgeClassName: "border-rose-300 bg-rose-50 text-rose-950",
        description: "The eBay sale needs review before this Copy's Records state can be trusted.",
        Icon: AlertTriangle,
        label: "Sale needs review",
      };
    case "paid":
      if (hasRecordedSale) {
        return {
          badgeClassName: "border-emerald-300 bg-emerald-50 text-emerald-950",
          description: "eBay payment is complete and the Sale record is linked.",
          Icon: CheckCircle2,
          label: "Paid · Sale recorded",
        };
      }
      return {
        badgeClassName: "border-amber-300 bg-amber-50 text-amber-950",
        description: "eBay says the order is paid, but no Sale record is confirmed. Review and record it.",
        Icon: AlertTriangle,
        label: "Paid — review Sale record",
      };
    case "pending":
      return {
        badgeClassName: "border-sky-300 bg-sky-50 text-sky-950",
        description: "An eBay sale is pending. Wait for payment before recording the Sale.",
        Icon: Clock3,
        label: "Sale pending",
      };
    case "cancelled":
    case "none":
      break;
    default:
      return assertNever(saleState);
  }

  switch (copyState) {
    case "void":
      return {
        badgeClassName: "border-zinc-300 bg-zinc-100 text-zinc-800",
        description: "This Copy is unavailable and cannot be listed.",
        Icon: XCircle,
        label: "Unavailable",
      };
    case "sold":
      return {
        badgeClassName: "border-emerald-300 bg-emerald-50 text-emerald-950",
        description: "This Copy is marked sold in Records.",
        Icon: CheckCircle2,
        label: "Sold in Records",
      };
    case "available":
      break;
    default:
      return assertNever(copyState);
  }

  switch (listingState) {
    case "active":
      return {
        badgeClassName: "border-emerald-300 bg-emerald-50 text-emerald-950",
        description: "The persisted eBay listing is active.",
        Icon: CheckCircle2,
        label: "Live on eBay",
      };
    case "ended":
      if (saleState === "cancelled") {
        return {
          badgeClassName: "border-amber-300 bg-amber-50 text-amber-950",
          description: "The listing ended without a completed sale. This Copy can be relisted after review.",
          Icon: RotateCcw,
          label: "Sale cancelled",
        };
      }
      return {
        badgeClassName: "border-amber-300 bg-amber-50 text-amber-950",
        description: "The previous eBay listing has ended.",
        Icon: Clock3,
        label: "Listing ended",
      };
    case "suspended":
      return {
        badgeClassName: "border-rose-300 bg-rose-50 text-rose-950",
        description: "eBay suspended this listing. Review its status before taking another selling action.",
        Icon: AlertTriangle,
        label: "Listing suspended",
      };
    case "unknown":
      return {
        badgeClassName: "border-amber-300 bg-amber-50 text-amber-950",
        description: "The saved eBay status cannot be trusted. Refresh or review it before listing again.",
        Icon: AlertTriangle,
        label: "Status unknown",
      };
    case "none":
      if (saleState === "cancelled") {
        return {
          badgeClassName: "border-zinc-300 bg-zinc-100 text-zinc-800",
          description: "The previous eBay sale was cancelled and no active listing is persisted.",
          Icon: XCircle,
          label: "Sale cancelled",
        };
      }
      return {
        badgeClassName: "border-zinc-300 bg-zinc-100 text-zinc-700",
        description: "No persisted eBay listing is linked to this Copy.",
        Icon: Clock3,
        label: "Not listed",
      };
    default:
      return assertNever(listingState);
  }
}

function Timestamp({ label, value }: { label: string; value: string }) {
  const date = new Date(value);
  const valid = !Number.isNaN(date.getTime());
  return (
    <div className="min-w-0">
      <dt className="text-xs font-bold uppercase tracking-[0.1em] text-zinc-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-zinc-800">
        {valid ? (
          <time dateTime={value}>
            {new Intl.DateTimeFormat("en-GB", {
              dateStyle: "medium",
              timeZone: "Europe/London",
              timeStyle: "short",
            }).format(date)}
          </time>
        ) : "Not available"}
      </dd>
    </div>
  );
}

export function EbayListingStatusBadge(props: EbayListingStatusBadgeProps) {
  const presentation = ebayListingStatusPresentation(props);
  const { Icon } = presentation;
  return (
    <span
      aria-atomic="true"
      className={`inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-black ${presentation.badgeClassName}`}
      role="status"
    >
      <Icon
        aria-hidden="true"
        className={`size-3.5 shrink-0 ${props.syncing && !props.errorMessage && !props.requiresReconnect ? "motion-safe:animate-spin" : ""}`}
      />
      <span className="min-w-0 break-words">{presentation.label}</span>
    </span>
  );
}

export function EbayListingStatusPanel({
  copyState,
  ebayUrl,
  endedAt,
  errorMessage,
  headingLevel = 3,
  lastSyncedAt,
  listedAt,
  listingState,
  listingUpdatedAt,
  onReconnect,
  onRefresh,
  onRelist,
  onReview,
  paidAt,
  requiresReconnect = false,
  saleRecorded = false,
  saleRecordedAt,
  saleRecordId,
  saleState,
  syncing = false,
  title = "eBay listing",
}: EbayListingStatusPanelProps) {
  const headingId = useId();
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4" | "h5" | "h6";
  const presentation = ebayListingStatusPresentation({
    copyState,
    errorMessage,
    listingState,
    requiresReconnect,
    saleRecorded,
    saleRecordId,
    saleState,
    syncing,
  });
  const hasRecordedSale = saleRecorded || Boolean(saleRecordId);
  const dataReviewRequired = isEbayListingDataReviewMessage(errorMessage);
  const canRelist = copyState === "available"
    && listingState === "ended"
    && (saleState === "none" || saleState === "cancelled");
  const requiresReview = saleState === "needs_review"
    || (saleState === "paid" && !hasRecordedSale)
    || listingState === "suspended"
    || listingState === "unknown";
  const reviewLabel = saleState === "paid" && !hasRecordedSale
    ? "Review Sale record"
    : saleState !== "none" || copyState === "sold"
      ? "Review sale"
      : "Review listing";
  const canReview = listingState !== "none" || saleState !== "none" || copyState === "sold";
  const hasActions = Boolean(
    (requiresReconnect && onReconnect)
    || (!requiresReconnect && errorMessage && onRefresh)
    || (!requiresReconnect && !errorMessage && listingState === "active" && ebayUrl)
    || (!requiresReconnect && !errorMessage && canRelist && onRelist)
    || (onReview && canReview)
    || (!requiresReconnect && !errorMessage && onRefresh)
    || (!requiresReconnect && listingState !== "active" && ebayUrl),
  );
  const timestamps = [
    listedAt ? { label: "Listed", value: listedAt } : null,
    endedAt ? { label: "Ended", value: endedAt } : null,
    paidAt ? { label: "Paid", value: paidAt } : null,
    saleRecordedAt ? { label: "Sale recorded", value: saleRecordedAt } : null,
    listingUpdatedAt ? { label: "Status updated", value: listingUpdatedAt } : null,
    lastSyncedAt ? { label: "Last checked", value: lastSyncedAt } : null,
  ].filter((item): item is { label: string; value: string } => item !== null);

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-sm"
    >
      <div className="p-4 sm:p-5">
        <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:justify-between">
          <div className="min-w-0">
            <Heading className="text-lg font-black text-zinc-950" id={headingId}>{title}</Heading>
            <p className="mt-1 max-w-2xl break-words text-sm font-medium leading-6 text-zinc-600">
              {presentation.description}
            </p>
          </div>
          <EbayListingStatusBadge
            copyState={copyState}
            errorMessage={errorMessage}
            listingState={listingState}
            requiresReconnect={requiresReconnect}
            saleRecorded={saleRecorded}
            saleRecordId={saleRecordId}
            saleState={saleState}
            syncing={syncing}
          />
        </div>

        {errorMessage ? (
          <div className="mt-4 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-950" role="alert">
            <div className="flex items-start gap-2">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-rose-700" />
              <div className="min-w-0">
                <p className="font-black">eBay status could not be refreshed</p>
                <p className="mt-1 break-words font-medium leading-5">{errorMessage}</p>
                <p className="mt-1 font-medium leading-5">
                  {requiresReconnect
                    ? "Reconnect the seller account, then refresh the status."
                    : dataReviewRequired
                      ? "This is a data-safety check, not a connection problem. Do not record a Sale until the exact Copy link has been repaired or reviewed."
                    : "Check the connection and try refreshing the status."}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {timestamps.length ? (
          <dl className="mt-4 grid min-w-0 grid-cols-1 gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 sm:grid-cols-2">
            {timestamps.map((timestamp) => (
              <Timestamp key={timestamp.label} label={timestamp.label} value={timestamp.value} />
            ))}
          </dl>
        ) : null}
      </div>

      {hasActions ? <div className="grid grid-cols-1 gap-2 border-t border-zinc-200 bg-zinc-50 p-4 sm:flex sm:flex-wrap sm:items-center">
        {requiresReconnect && onReconnect ? (
          <button className={primaryActionClassName} disabled={syncing} onClick={onReconnect} type="button">
            <Unplug aria-hidden="true" className="size-4 shrink-0" />
            Reconnect eBay
          </button>
        ) : null}
        {!requiresReconnect && errorMessage && onRefresh ? (
          <button className={primaryActionClassName} disabled={syncing} onClick={onRefresh} type="button">
            <RefreshCw aria-hidden="true" className={`size-4 shrink-0 ${syncing ? "motion-safe:animate-spin" : ""}`} />
            {syncing ? "Refreshing…" : "Try again"}
          </button>
        ) : null}
        {!requiresReconnect && !errorMessage && listingState === "active" && ebayUrl ? (
          <a className={requiresReview ? secondaryActionClassName : primaryActionClassName} href={ebayUrl} rel="noreferrer" target="_blank">
            <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
            Open on eBay
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
        {!requiresReconnect && !errorMessage && canRelist && onRelist ? (
          <button className={primaryActionClassName} disabled={syncing} onClick={onRelist} type="button">
            <RotateCcw aria-hidden="true" className="size-4 shrink-0" />
            Relist on eBay
          </button>
        ) : null}
        {onReview && canReview ? (
          <button className={requiresReview && !requiresReconnect && (!errorMessage || dataReviewRequired) ? primaryActionClassName : secondaryActionClassName} disabled={syncing} onClick={onReview} type="button">
            <Search aria-hidden="true" className="size-4 shrink-0" />
            {reviewLabel}
          </button>
        ) : null}
        {!requiresReconnect && !errorMessage && onRefresh ? (
          <button className={secondaryActionClassName} disabled={syncing} onClick={onRefresh} type="button">
            <RefreshCw aria-hidden="true" className={`size-4 shrink-0 ${syncing ? "motion-safe:animate-spin" : ""}`} />
            {syncing ? "Refreshing…" : "Refresh status"}
          </button>
        ) : null}
        {!requiresReconnect && listingState !== "active" && ebayUrl ? (
          <a className={secondaryActionClassName} href={ebayUrl} rel="noreferrer" target="_blank">
            <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
            Open previous listing
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
      </div> : null}
    </section>
  );
}
