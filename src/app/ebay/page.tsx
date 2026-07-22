import { CheckCircle2, CircleAlert, Link2, ShieldCheck } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { getEbayConnectionStatus, isEbayOAuthConfigured } from "@/server/ebay-seller";
import { getCurrentSession } from "@/server/session";

const messages = {
  configuration: "The app is missing its eBay connection settings. Add the server environment variables shown below, then try again.",
  consent: "eBay could not verify this connection attempt. Start again from the Connect eBay button.",
  ebay: "eBay did not complete the connection. Check the seller account and try again.",
  local: "Paste the complete eBay success-page URL, including its state and code values.",
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
  searchParams: Promise<{ connected?: string; disconnected?: string; error?: keyof typeof messages }>;
}) {
  const session = await getCurrentSession();
  if (!session) return null;

  const [params, connection] = await Promise.all([
    searchParams,
    getEbayConnectionStatus(session.user.id),
  ]);
  const configured = isEbayOAuthConfigured();
  const localDevelopment = process.env.NODE_ENV !== "production";
  const error = params.error && messages[params.error] ? messages[params.error] : null;

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
              <h2 className="mt-2 text-2xl font-black tracking-tight">{connection ? "eBay is connected" : "Connect your eBay seller account"}</h2>
              <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-zinc-600">
                Your normal Collection Hub sign-in remains separate. This connection only gives the signed-in administrator permission to manage listings for the eBay seller account you approve.
              </p>
            </div>
            {connection ? <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-800"><CheckCircle2 className="size-4" />Connected</span> : <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1.5 text-sm font-bold text-zinc-600">Not connected</span>}
          </div>

          {params.connected === "1" ? <p className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">eBay is connected securely. The listing tools can now use renewable seller access.</p> : null}
          {params.disconnected === "1" ? <p className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-700">The stored eBay connection has been removed from this app.</p> : null}
          {error ? <p className="mt-5 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950"><CircleAlert className="mt-0.5 size-4 shrink-0" />{error}</p> : null}

          {connection ? <div className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm"><p className="font-bold text-zinc-950">Connection details</p><dl className="mt-3 grid gap-3 sm:grid-cols-2"><div><dt className="text-zinc-500">Connected</dt><dd className="mt-1 font-semibold">{formatDate(connection.connectedAt)}</dd></div><div><dt className="text-zinc-500">Reconnect by</dt><dd className="mt-1 font-semibold">{formatDate(connection.refreshTokenExpiresAt)}</dd></div></dl></div> : null}

          <div className="mt-6 flex flex-wrap gap-3">
            {connection ? <form action="/api/ebay/disconnect" method="post"><button className="inline-flex min-h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-700 transition hover:border-[#8a1f2d] hover:text-[#8a1f2d]" type="submit">Disconnect eBay</button></form> : configured ? <a className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#8a1f2d] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#711826]" href="/api/ebay/connect" rel={localDevelopment ? "noreferrer" : undefined} target={localDevelopment ? "_blank" : undefined}><Link2 className="size-4" />Connect eBay</a> : null}
          </div>
        </section>

        {localDevelopment && configured && !connection ? <section className="mt-5 rounded-2xl border border-sky-300 bg-sky-50 p-5 text-sky-950 sm:p-7"><h2 className="text-lg font-black">Finish the local connection</h2><p className="mt-2 max-w-2xl text-sm font-medium leading-6">eBay opens in a new tab. After it says “Authorization successfully completed,” copy the full URL from that tab and paste it below within five minutes. The app verifies the signed state and one-time code before saving anything.</p><form action="/api/ebay/manual-callback" className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" method="post"><label className="grid gap-1.5 text-sm font-bold">eBay success-page URL<input className="h-11 min-w-0 rounded-lg border border-sky-300 bg-white px-3 font-medium outline-none focus:border-[#8a1f2d] focus:ring-2 focus:ring-[#8a1f2d]/20" name="callbackUrl" placeholder="https://auth2.ebay.com/oauth2/ThirdPartyAuthSucessFailure?..." required type="url" /></label><button className="inline-flex min-h-11 items-center justify-center rounded-lg bg-sky-900 px-4 text-sm font-bold text-white hover:bg-sky-800" type="submit">Complete connection</button></form></section> : null}

        {!configured ? <section className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-5 sm:p-7"><h2 className="text-lg font-black">One-time server setup still needed</h2><p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-amber-950">Add these private values to the deployment environment. Do not add them to browser-visible variables and do not paste your manually generated token anywhere.</p><pre className="mt-4 overflow-x-auto rounded-lg bg-amber-950 px-4 py-3 text-xs font-semibold text-amber-50">{`EBAY_CLIENT_ID=…\nEBAY_CLIENT_SECRET=…\nEBAY_OAUTH_RU_NAME=…\nEBAY_OAUTH_LOCAL_RU_NAME=… # optional in development`}</pre><p className="mt-3 text-sm font-medium leading-6 text-amber-950">Use a production RuName whose Auth Accepted URL points to <code className="rounded bg-amber-100 px-1 py-0.5">https://your-site.example/api/ebay/callback</code>. A separate local RuName may retain eBay’s standard success page and uses the local completion form. The app encrypts the stored refresh token with the existing server-only <code className="rounded bg-amber-100 px-1 py-0.5">BETTER_AUTH_SECRET</code>.</p></section> : null}

        <section className="mt-5 rounded-2xl border border-zinc-300 bg-white p-5 sm:p-7"><h2 className="text-lg font-black">What happens next</h2><ol className="mt-3 grid gap-3 text-sm font-medium leading-6 text-zinc-700 sm:grid-cols-3"><li><span className="font-black text-[#8a1f2d]">1.</span> Connect eBay once and approve seller access.</li><li><span className="font-black text-[#8a1f2d]">2.</span> The app stores only an encrypted renewable credential.</li><li><span className="font-black text-[#8a1f2d]">3.</span> Listing drafts will use it only after an explicit publish review.</li></ol></section>
      </div>
    </main>
  );
}
