import {
  CheckCircle2,
  CircleAlert,
  Link2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { cookies } from "next/headers";
import { AppHeader } from "@/components/app-header";
import { EbayConnectionHandoff } from "@/components/ebay-connection-handoff";
import { EbayNotificationSetupCard } from "@/components/ebay-notification-setup-card";
import {
  ebayConnectHref,
  ebayConnectionPresentation,
  safeEbayReturnTo,
} from "@/lib/ebay-connection-state";
import { ebayOAuthStateCookieName } from "@/lib/ebay-oauth-route-state";
import { getEbayNotificationSubscriptionStatus } from "@/server/ebay-notification-service";
import {
  getEbayConnectionStatus,
  isEbayOAuthConfigured,
  parseEbayOAuthState,
} from "@/server/ebay-seller";
import { getCurrentSession } from "@/server/session";

const messages = {
  configuration: "The app is missing its eBay connection settings. Add the server environment variables shown below, then try again.",
  consent: "eBay could not verify this connection attempt. Start again from the Connect eBay button.",
  ebay: "eBay did not complete the connection. Check the seller account and try again.",
  cancelled: "eBay cancelled this connection attempt. Your stored connection was not changed.",
  local: "Paste the complete eBay success-page URL, including its state and code values.",
  temporary: "eBay is temporarily unavailable. Retry the completion with the same URL shortly; your stored connection was not changed.",
  security: "The disconnect request was rejected for safety. Open this page from the configured site address and try again.",
  unknown: "The connection could not be completed. Try again, and check the server logs if it persists.",
} as const;

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default async function EbayPage({
  searchParams,
}: {
  searchParams: Promise<{
    connected?: string;
    disconnected?: string;
    error?: keyof typeof messages;
    returnTo?: string;
  }>;
}) {
  const session = await getCurrentSession();
  if (!session) return null;

  const [params, connection, notifications, cookieStore] = await Promise.all([
    searchParams,
    getEbayConnectionStatus(session.user.id),
    getEbayNotificationSubscriptionStatus(session.user.id),
    cookies(),
  ]);
  const configured = isEbayOAuthConfigured();
  const localDevelopment = process.env.NODE_ENV !== "production";
  const error = params.error && messages[params.error] ? messages[params.error] : null;
  const returnTo = safeEbayReturnTo(params.returnTo);
  const pendingCookie = cookieStore.get(ebayOAuthStateCookieName)?.value;
  const pendingState = pendingCookie ? parseEbayOAuthState(pendingCookie) : null;
  const replacementPending = Boolean(
    pendingState
    && pendingState.ownerId === session.user.id
    && pendingState.purpose === "replacement",
  );
  const localCompletionPending = Boolean(pendingState && pendingState.ownerId === session.user.id);
  const presentation = ebayConnectionPresentation(connection?.health ?? null);
  const statusClasses = presentation.tone === "success"
    ? "bg-emerald-50 text-emerald-800"
    : presentation.tone === "warning"
      ? "bg-amber-50 text-amber-900"
      : "bg-zinc-100 text-zinc-600";
  const showLocalCompletion = localDevelopment && configured && (
    !connection || localCompletionPending || connection.health === "reconnect_required"
  );
  const connectHref = ebayConnectHref(returnTo);

  return (
    <main className="min-h-dvh bg-[#f6f4ef] px-4 py-7 text-zinc-950 sm:px-6 lg:pl-[calc(var(--app-nav-width)+2rem)] lg:pr-8 lg:pt-10">
      <div className="mx-auto max-w-4xl">
        <AppHeader eyebrow="Admin workspace" title="eBay selling" />

        <section className="mt-7 rounded-2xl border border-zinc-300 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="inline-flex items-center gap-2 text-sm font-bold text-zinc-700">
                <ShieldCheck className="size-4 text-[#8a1f2d]" /> Seller connection
              </p>
              <h2 className="mt-2 text-2xl font-black tracking-tight">{connection ? "Your eBay connection is stored" : "Connect your eBay seller account"}</h2>
              <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-zinc-600">
                Your normal Collection Hub sign-in remains separate. This connection only gives the signed-in administrator permission to manage listings for the eBay seller account you approve.
              </p>
            </div>
            <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold ${statusClasses}`}>{connection ? <CheckCircle2 className="size-4" /> : null}{presentation.label}</span>
          </div>

          {params.connected === "1" ? <p className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">The eBay connection was stored securely. Listing tools can now obtain renewable seller access when needed.</p> : null}
          {params.disconnected === "1" ? <p className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-700">The stored eBay connection has been removed from this app.</p> : null}
          {error ? <p className="mt-5 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950"><CircleAlert className="mt-0.5 size-4 shrink-0" />{error}</p> : null}

          {connection ? <div className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm"><p className="font-bold text-zinc-950">Connection details</p><dl className="mt-3 grid gap-3 sm:grid-cols-2"><div><dt className="text-zinc-500">Stored</dt><dd className="mt-1 font-semibold">{formatDate(connection.connectedAt)}</dd></div><div><dt className="text-zinc-500">Renew by</dt><dd className="mt-1 font-semibold">{formatDate(connection.refreshTokenExpiresAt)}</dd></div></dl><p className="mt-3 max-w-2xl font-medium leading-6 text-zinc-600">{presentation.message}</p></div> : null}

          <div className="mt-6 flex flex-wrap gap-3">
            {connection ? <>{localDevelopment ? <EbayConnectionHandoff className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-700 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d]" href={connectHref}><RefreshCw className="size-4" />{replacementPending ? "Start a fresh replacement" : "Replace eBay connection"}</EbayConnectionHandoff> : <a className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-700 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d]" href={connectHref}><RefreshCw className="size-4" />Replace eBay connection</a>}<form action="/api/ebay/disconnect" method="post"><button className="inline-flex min-h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-700 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d]" type="submit">Disconnect eBay</button></form></> : configured ? localDevelopment ? <EbayConnectionHandoff className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#8a1f2d] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#711826]" href={connectHref}><Link2 className="size-4" />Connect eBay</EbayConnectionHandoff> : <a className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#8a1f2d] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#711826]" href={connectHref}><Link2 className="size-4" />Connect eBay</a> : null}
          </div>
        </section>

        {!notifications.schemaReady ? <section className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-sm sm:p-7">
          <div className="flex gap-3">
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-800" />
            <div>
              <h2 className="text-xl font-black tracking-tight text-amber-950">Database update required</h2>
              <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-amber-950">The app code is ready, but the eBay notification tables have not been added to this database yet. Apply the checked-in schema update before enabling immediate listing updates.</p>
              <code className="mt-4 block w-fit rounded-lg bg-amber-950 px-3 py-2 text-sm font-bold text-amber-50">npm run db:push</code>
            </div>
          </div>
        </section> : connection ? <EbayNotificationSetupCard
          initialStatus={{
            coverage: notifications.coverage,
            enabled: notifications.enabled,
            subscriptions: notifications.subscriptions.map((subscription) => ({
              lastError: subscription.lastError,
              status: subscription.status,
              topic: subscription.topic,
            })),
          }}
          notificationReady={connection.notificationReady}
        /> : null}

        {showLocalCompletion ? <section className="mt-5 rounded-2xl border border-sky-300 bg-sky-50 p-5 text-sky-950 sm:p-7"><h2 className="text-lg font-black">{connection ? "Complete replacement connection" : "Finish the local connection"}</h2><p className="mt-2 max-w-2xl text-sm font-medium leading-6">{localCompletionPending ? "eBay opened in a separate tab. After it says “Authorization successfully completed,” copy the full URL from that tab and paste it below within ten minutes." : "Start the connection above first. After eBay says “Authorization successfully completed,” return here and paste the full URL within ten minutes."} The app verifies its signed state and one-time code before changing anything. {connection ? "Your existing encrypted credential remains in place unless this replacement succeeds." : ""}</p><p className="mt-2 max-w-2xl text-sm font-semibold leading-6">This updates the database configured for this local server, not the deployed Production database.</p><form action="/api/ebay/manual-callback" className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" key={localCompletionPending ? "pending-oauth" : "idle-oauth"} method="post"><label className="grid gap-1.5 text-sm font-bold" htmlFor="ebay-replacement-success-url">{connection ? "Complete replacement connection URL" : "eBay success-page URL"}<input autoFocus={localCompletionPending} className="h-11 min-w-0 rounded-lg border border-sky-300 bg-white px-3 font-medium outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" id="ebay-replacement-success-url" name="callbackUrl" placeholder="https://auth2.ebay.com/oauth2/ThirdPartyAuthSucessFailure?..." required type="url" /></label><button className="inline-flex min-h-11 items-center justify-center rounded-lg bg-sky-900 px-4 text-sm font-bold text-white hover:bg-sky-800" type="submit">{connection ? "Complete replacement" : "Complete connection"}</button></form></section> : null}

        {params.connected === "1" && returnTo ? <a className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-[#8a1f2d] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#711826]" href={returnTo}>Return to this Copy</a> : null}

        {!configured ? <section className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-5 sm:p-7"><h2 className="text-lg font-black">One-time server setup still needed</h2><p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-amber-950">Add these private values to the deployment environment. Do not add them to browser-visible variables and do not paste your manually generated token anywhere.</p><pre className="mt-4 overflow-x-auto rounded-lg bg-amber-950 px-4 py-3 text-xs font-semibold text-amber-50">{`EBAY_CLIENT_ID=…\nEBAY_CLIENT_SECRET=…\nEBAY_OAUTH_RU_NAME=…\nEBAY_OAUTH_LOCAL_RU_NAME=… # optional in development`}</pre><p className="mt-3 text-sm font-medium leading-6 text-amber-950">Use a production RuName whose Auth Accepted URL points to <code className="rounded bg-amber-100 px-1 py-0.5">https://your-site.example/api/ebay/callback</code>. A separate local RuName may retain eBay’s standard success page and uses the local completion form. The app encrypts the stored refresh token with the existing server-only <code className="rounded bg-amber-100 px-1 py-0.5">BETTER_AUTH_SECRET</code>.</p></section> : null}

        <section className="mt-5 rounded-2xl border border-zinc-300 bg-white p-5 sm:p-7"><h2 className="text-lg font-black">What happens next</h2><ol className="mt-3 grid gap-3 text-sm font-medium leading-6 text-zinc-700 sm:grid-cols-3"><li><span className="font-black text-[#8a1f2d]">1.</span> Connect eBay once and approve seller access.</li><li><span className="font-black text-[#8a1f2d]">2.</span> The app stores only an encrypted renewable credential.</li><li><span className="font-black text-[#8a1f2d]">3.</span> Listing drafts will use it only after an explicit publish review.</li></ol></section>
      </div>
    </main>
  );
}
