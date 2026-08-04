"use client";

import {
  BellRing,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { EbayConnectionHandoff } from "@/components/ebay-connection-handoff";
import {
  tradingNotificationHealthPresentation,
  type TradingNotificationHealth,
} from "@/lib/ebay-notification-health-presentation";

export type EbayNotificationStatus = TradingNotificationHealth;

type SetupResponse = {
  message?: string;
  notifications?: EbayNotificationStatus;
};

type Feedback = {
  message: string;
  tone: "success" | "error";
};

const authorizationSuccessDurationMs = 5_000;

function dateTime(value: Date | string | null) {
  if (!value) return "Not recorded yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function eventLabel(topic: string) {
  return topic.replaceAll(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
}

export function EbayNotificationSetupCard({
  authorizationFlow,
  initialStatus,
}: {
  authorizationFlow: {
    error: string | null;
    pending: boolean;
    succeeded: boolean;
  };
  initialStatus: EbayNotificationStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [checking, setChecking] = useState(false);
  const [completingAuthorization, setCompletingAuthorization] = useState(false);
  const [showAuthorizationSuccess, setShowAuthorizationSuccess] = useState(
    authorizationFlow.succeeded,
  );
  const presentation = tradingNotificationHealthPresentation(status.state);
  const authorizationActive = status.authorization.status === "active";

  useEffect(() => {
    if (!showAuthorizationSuccess) return;
    const timeout = window.setTimeout(() => {
      setShowAuthorizationSuccess(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("tradingAuthorized");
      window.history.replaceState(window.history.state, "", url);
    }, authorizationSuccessDurationMs);
    return () => window.clearTimeout(timeout);
  }, [showAuthorizationSuccess]);

  function completeTradingAuthorization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (completingAuthorization) return;
    const form = event.currentTarget;
    setCompletingAuthorization(true);
    window.requestAnimationFrame(() => form.submit());
  }

  async function checkNotificationSetup() {
    setChecking(true);
    setFeedback(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 60_000);

    try {
      const response = await fetch("/api/ebay/trading-notifications/setup", {
        headers: { Accept: "application/json" },
        method: "POST",
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as SetupResponse | null;
      if (payload?.notifications) setStatus(payload.notifications);
      if (!response.ok) {
        throw new Error(
          payload?.message
          || "Records could not verify Trading notification setup. Retry, or reconnect eBay if the problem continues.",
        );
      }
      setFeedback({
        message: payload?.message || "Trading notification setup was checked successfully.",
        tone: "success",
      });
    } catch (error) {
      setFeedback({
        message: error instanceof DOMException && error.name === "AbortError"
          ? "The check took longer than one minute. No success was confirmed; retry once, then check the server logs if it times out again."
          : error instanceof Error
            ? error.message
            : "Trading notification setup failed unexpectedly. Retry once, then check the server logs.",
        tone: "error",
      });
    } finally {
      window.clearTimeout(timeout);
      setChecking(false);
    }
  }

  return (
    <section className="mt-5 rounded-2xl border border-zinc-300 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-bold text-zinc-700">
            <BellRing className="size-4 text-[#8a1f2d]" />
            Automatic status updates
          </p>
          <h2 className="mt-2 text-xl font-black tracking-tight">{presentation.heading}</h2>
          <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-zinc-600">{presentation.description}</p>
        </div>
        <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold ${presentation.tone === "success" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
          {presentation.tone === "success" ? <CheckCircle2 className="size-4" /> : <CircleAlert className="size-4" />}
          {presentation.badge}
        </span>
      </div>

      {feedback ? <div aria-live={feedback.tone === "error" ? "assertive" : "polite"} className={`mt-5 flex gap-2 rounded-lg border px-4 py-3 text-sm font-semibold leading-6 ${feedback.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-950"}`} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.tone === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" />}<span>{feedback.message}</span></div> : null}

      <dl className="mt-5 grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm sm:grid-cols-2">
        <div><dt className="font-bold text-zinc-500">Last verified setup</dt><dd className="mt-1 font-semibold text-zinc-900">{dateTime(status.lastVerifiedAt)}</dd></div>
        <div><dt className="font-bold text-zinc-500">Last successful receipt</dt><dd className="mt-1 font-semibold text-zinc-900">{dateTime(status.lastNotificationAt)}</dd></div>
        <div><dt className="font-bold text-zinc-500">Trading authorization</dt><dd className="mt-1"><span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-black capitalize ${authorizationActive ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-950"}`}><span aria-hidden="true" className={`size-1.5 rounded-full ${authorizationActive ? "bg-emerald-600" : "bg-amber-600"}`} />{status.authorization.status}</span></dd></div>
        <div><dt className="font-bold text-zinc-500">Renew authorization by</dt><dd className="mt-1 font-semibold text-zinc-900">{dateTime(status.authorization.expiresAt)}</dd></div>
      </dl>

      {authorizationFlow.error || authorizationFlow.pending || showAuthorizationSuccess ? <div aria-live={authorizationFlow.error ? "assertive" : "polite"} className={`mt-4 rounded-lg border px-4 py-3 text-sm leading-6 ${authorizationFlow.error ? "border-amber-300 bg-amber-50 text-amber-950" : showAuthorizationSuccess ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-sky-300 bg-sky-50 text-sky-950"}`} role={authorizationFlow.error ? "alert" : "status"}>
        <p className="flex items-start gap-2 font-black">{authorizationFlow.error ? <CircleAlert className="mt-1 size-4 shrink-0" /> : <CheckCircle2 className="mt-1 size-4 shrink-0" />}{authorizationFlow.error ? "Trading authorization renewal needs attention" : showAuthorizationSuccess ? "Trading authorization renewed" : "Trading authorization renewal in progress"}</p>
        {authorizationFlow.error ? <p className="mt-1 font-semibold">{authorizationFlow.error}</p> : null}
        {showAuthorizationSuccess ? <p className="mt-1 font-semibold">The new authorization was stored securely and notification setup was verified.</p> : null}
        {authorizationFlow.pending ? <p className="mt-1 font-medium">Complete this only after eBay shows that authorization succeeded. Finish within five minutes and use the eBay tab already opened; if eBay did not confirm it, start again.</p> : null}
        {status.authorization.status === "active" && authorizationFlow.error ? <p className="mt-1 font-medium">Your existing authorization is still active and was not replaced.</p> : null}
        {authorizationFlow.pending ? <form action="/api/ebay/trading-auth/complete" aria-busy={completingAuthorization} className="mt-3" method="post" onSubmit={completeTradingAuthorization}><button className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#8a1f2d] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#711826] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a1f2d] disabled:cursor-wait disabled:opacity-70" disabled={completingAuthorization} type="submit">{completingAuthorization ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}{completingAuthorization ? "Checking eBay approval…" : "Complete after eBay approval"}</button></form> : null}
        {completingAuthorization ? <p aria-live="polite" className="mt-2 font-semibold" role="status">Checking eBay approval and notification setup. This can take up to a minute; your existing authorization stays active unless renewal succeeds.</p> : null}
      </div> : null}

      {status.lastError ? <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-950" role="alert"><CircleAlert aria-hidden="true" className="mr-1 inline size-4" />{status.lastError}</p> : null}

      {status.events.length ? <ul className="mt-5 grid gap-2 sm:grid-cols-2">{status.events.map((event) => <li className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm" key={event.topic}><div className="flex items-center justify-between gap-3"><span className="font-black capitalize">{eventLabel(event.topic)}</span><span className={`rounded-full px-2 py-1 text-xs font-black ${event.status === "enabled" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-950"}`}>{event.status.replaceAll("_", " ")}</span></div></li>)}</ul> : null}

      <div className="mt-5 flex flex-wrap gap-3">
        <button className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-800 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a1f2d] disabled:cursor-wait disabled:opacity-60" disabled={checking || completingAuthorization} onClick={() => void checkNotificationSetup()} type="button">{checking ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{checking ? "Checking Trading notification setup…" : status.configured ? "Recheck notification setup" : "Set up notifications"}</button>
        <EbayConnectionHandoff className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a1f2d] ${authorizationFlow.pending ? "border border-zinc-300 bg-white text-zinc-800 hover:border-[#8a1f2d] hover:text-[#8a1f2d]" : "bg-[#8a1f2d] text-white shadow-sm hover:bg-[#711826]"}`} href="/api/ebay/trading-auth/connect" refreshOnSettled={false}><RefreshCw className="size-4" />{authorizationFlow.pending ? "Start authorization again" : status.authorization.status === "missing" ? "Authorize Trading notifications" : "Renew Trading authorization"}</EbayConnectionHandoff>
      </div>
      {checking ? <p aria-live="polite" className="mt-2 text-sm font-medium text-zinc-600" role="status">Checking the Trading notification configuration and recent delivery health. This can take several seconds.</p> : null}

      <details className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
        <summary className="cursor-pointer font-bold text-zinc-900">What this check does</summary>
        <ol className="mt-3 grid gap-2 pl-5 leading-6"><li className="list-decimal">Reads the current Trading notification preferences and delivery status.</li><li className="list-decimal">Sets up or repairs only the Listing and checkout events Records owns.</li><li className="list-decimal">Verifies the resulting configuration and records useful delivery diagnostics.</li></ol>
        <p className="mt-3 font-medium">It does not create, revise, or end any card listing. Trading authorization renewal opens eBay so the seller can approve access; the app stores the resulting token encrypted.</p>
      </details>
    </section>
  );
}
