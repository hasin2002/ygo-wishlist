"use client";

import {
  BellRing,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";

type NotificationTopicStatus = {
  lastError: string | null;
  status: string;
  topic: string;
};

export type EbayNotificationStatus = {
  coverage: "full" | "partial" | "none";
  enabled: boolean;
  subscriptions: NotificationTopicStatus[];
};

type SetupResponse = {
  message?: string;
  notifications?: EbayNotificationStatus;
};

type Feedback = {
  message: string;
  tone: "success" | "error";
};

function statusHeading(status: EbayNotificationStatus, notificationReady: boolean) {
  if (status.coverage === "full") return "eBay notifications are active";
  if (status.coverage === "partial") return "Order notifications are active";
  return notificationReady
    ? "Notification setup needs attention"
    : "Reconnect once to enable notifications";
}

function statusBadge(status: EbayNotificationStatus) {
  if (status.coverage === "full") return "Active";
  if (status.coverage === "partial") return "Partial coverage";
  return "Action needed";
}

export function EbayNotificationSetupCard({
  initialStatus,
  notificationReady,
}: {
  initialStatus: EbayNotificationStatus;
  notificationReady: boolean;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [checking, setChecking] = useState(false);

  async function checkNotificationSetup() {
    setChecking(true);
    setFeedback(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 60_000);

    try {
      const response = await fetch("/api/ebay/notifications/setup", {
        headers: { Accept: "application/json" },
        method: "POST",
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as SetupResponse | null;
      if (payload?.notifications) setStatus(payload.notifications);
      if (!response.ok) {
        throw new Error(
          payload?.message
          || "eBay did not complete notification setup. Retry, or reconnect eBay if the problem continues.",
        );
      }
      setFeedback({
        message: payload?.message || "Notification setup completed successfully.",
        tone: "success",
      });
    } catch (error) {
      setFeedback({
        message: error instanceof DOMException && error.name === "AbortError"
          ? "The check took longer than one minute. No success was confirmed; retry once, then check the server logs if it times out again."
          : error instanceof Error
            ? error.message
            : "Notification setup failed unexpectedly. Retry once, then check the server logs.",
        tone: "error",
      });
    } finally {
      window.clearTimeout(timeout);
      setChecking(false);
    }
  }

  const badge = statusBadge(status);
  const fullyActive = status.coverage === "full";

  return (
    <section className="mt-5 rounded-2xl border border-zinc-300 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-bold text-zinc-700">
            <BellRing className="size-4 text-[#8a1f2d]" />
            Immediate status updates
          </p>
          <h2 className="mt-2 text-xl font-black tracking-tight">
            {statusHeading(status, notificationReady)}
          </h2>
          <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-zinc-600">
            eBay can notify Records when a listing ends or an order changes. Records verifies the authoritative eBay state before allowing another sale or relist.
          </p>
        </div>
        <span
          className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold ${
            fullyActive
              ? "bg-emerald-50 text-emerald-800"
              : "bg-amber-50 text-amber-900"
          }`}
        >
          {fullyActive
            ? <CheckCircle2 className="size-4" />
            : <CircleAlert className="size-4" />}
          {badge}
        </span>
      </div>

      {feedback ? (
        <div
          aria-live={feedback.tone === "error" ? "assertive" : "polite"}
          className={`mt-5 flex gap-2 rounded-lg border px-4 py-3 text-sm font-semibold leading-6 ${
            feedback.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-amber-300 bg-amber-50 text-amber-950"
          }`}
          role={feedback.tone === "error" ? "alert" : "status"}
        >
          {feedback.tone === "success"
            ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            : <CircleAlert className="mt-0.5 size-4 shrink-0" />}
          <span>{feedback.message}</span>
        </div>
      ) : null}

      {status.subscriptions.length ? (
        <ul className="mt-5 grid gap-2 sm:grid-cols-2">
          {status.subscriptions.map((subscription) => (
            <li
              className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm"
              key={subscription.topic}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-black">
                  {subscription.topic === "LISTING"
                    ? "Listing changes"
                    : "Orders and payment"}
                </span>
                <span
                  className={`rounded-full px-2 py-1 text-xs font-black ${
                    subscription.status === "enabled"
                      ? "bg-emerald-100 text-emerald-900"
                      : subscription.status === "unsupported"
                        ? "bg-zinc-200 text-zinc-700"
                        : "bg-amber-100 text-amber-950"
                  }`}
                >
                  {subscription.status.replaceAll("_", " ")}
                </span>
              </div>
              {subscription.lastError ? (
                <p className="mt-2 font-medium leading-5 text-amber-900">
                  {subscription.lastError}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {!notificationReady ? (
        <p className="mt-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-950">
          Your existing seller connection predates the notification permissions. Use “Reconnect eBay” above and approve access once, then return here.
        </p>
      ) : (
        <div className="mt-5">
          <button
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-800 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a1f2d] disabled:cursor-wait disabled:opacity-60"
            disabled={checking}
            onClick={() => void checkNotificationSetup()}
            type="button"
          >
            {checking
              ? <LoaderCircle className="size-4 animate-spin" />
              : <RefreshCw className="size-4" />}
            {checking
              ? "Checking notification setup…"
              : status.enabled
                ? "Recheck notification setup"
                : "Retry notification setup"}
          </button>
          {checking ? (
            <p aria-live="polite" className="mt-2 text-sm font-medium text-zinc-600" role="status">
              Checking your seller permission, webhook destination, and supported eBay subscriptions. This can take several seconds.
            </p>
          ) : null}
        </div>
      )}

      <details className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
        <summary className="cursor-pointer font-bold text-zinc-900">
          What this check does
        </summary>
        <ol className="mt-3 grid gap-2 pl-5 leading-6">
          <li className="list-decimal">Renews and verifies the connected seller permission.</li>
          <li className="list-decimal">Checks the public notification endpoint and eBay alert configuration.</li>
          <li className="list-decimal">Creates or repairs each notification subscription your eBay keyset supports.</li>
          <li className="list-decimal">Asks eBay to send a test notification before enabling a repaired subscription.</li>
          <li className="list-decimal">Stores the resulting status so this card and the daily reconciliation job use the same state.</li>
        </ol>
        <p className="mt-3 font-medium">
          It does not create, revise, or end any card listing.
        </p>
      </details>
    </section>
  );
}
