# YGO Wishlist

A Next.js wishlist app backed by Postgres via Drizzle.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Collection architecture

Library is the card catalogue: it reads and edits Wishlist Targets through the
`library` API. `Owned` and `Wishlist` are computed from the desired target
quantity and available physical Copies; no Library action can toggle ownership.

Records is the operational source of truth. A Purchase, Pack Opening, Sale, or
other Record change creates, sells, voids, or restores exact Copy IDs together
with their history. Use Records → Purchase when a card selected in the Wheel is
acquired; the target is prefilled, but the Record still captures the real date,
source, amount, and printing details.

The legacy `cards` table remains intact solely as migration input. The only
temporary access is the authenticated, read-only `legacyCards` adapter that
seeds the resettable Records preview while legacy rows remain. It has deprecation
logging and must be removed after those rows are migrated; it must never regain
a writer. A rollback may restore a read-only Library naming adapter, never a
direct ownership/status write.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

This app cannot use the old local SQLite `data/wishlist.sqlite` database on Vercel. Vercel runs the app from a read-only deployment directory, so production needs Postgres.

Required Vercel environment variables:

```bash
DATABASE_URL=postgres://...
EBAY_CLIENT_ID=...
EBAY_CLIENT_SECRET=...
EBAY_MARKETPLACE_ID=EBAY_GB
# Required only for the eBay seller connection/listing workflow.
# This is the Production OAuth-enabled RuName (not the callback URL itself).
EBAY_OAUTH_RU_NAME=...
# Optional development RuName whose accepted URL is eBay's standard success page.
EBAY_OAUTH_LOCAL_RU_NAME=...
# Optional when the production domain is not ygo-wishlist.vercel.app.
EBAY_NOTIFICATION_ENDPOINT_URL=https://your-production-domain/api/ebay/notifications
# Optional if eBay has no alert email configured and the admin uses a placeholder email.
EBAY_NOTIFICATION_ALERT_EMAIL=you@example.com
CRON_SECRET=<a long random value>
BETTER_AUTH_SECRET=<a new random secret>
```

eBay cannot verify a notification destination on `localhost`. To exercise
notification setup locally, start the approved tunnel with `ngrok http 3000`,
then add its exact webhook URL to `.env.local`:

```bash
EBAY_NOTIFICATION_ENDPOINT_URL=https://armless-backslid-surrogate.ngrok-free.dev/api/ebay/notifications
```

Restart the development server after changing `.env.local`, verify the tunnel
is forwarding to port 3000, and then retry notification setup. Keep the tunnel
running while testing notification delivery. Deployed environments should use
the stable production webhook URL instead of the ngrok URL.

Authentication hosts are defined in `src/lib/auth-hosts.ts`. The application accepts the approved local, tunnel, and deployed hosts through Better Auth's dynamic base-URL configuration; `BETTER_AUTH_URL` is not required.

## eBay seller connection

The existing Collection Hub username/password sign-in remains independent from
eBay. Only an administrator can open `/ebay`, connect a seller account, or
create a listing from a physical Copy in Records → Inventory.

To enable the connection:

1. In the eBay developer portal, create a **Production OAuth-enabled RuName**.
   Its Accept URL must be `https://<your-production-domain>/api/ebay/callback`.
   For local HTTP testing, create a second RuName that uses eBay's standard
   success page and set it as `EBAY_OAUTH_LOCAL_RU_NAME`. After consent, paste
   that page's full URL into the development-only completion form. To replace
   a local connection, select **Replace eBay connection** first, then return
   to the focused **Complete replacement connection URL** field. The form says
   which local database it updates; a cancelled, expired, malformed, or
   temporarily unavailable attempt leaves the existing encrypted credential in
   place. Production continues to use its normal callback and does not use the
   local paste form.
2. Add its RuName value to `EBAY_OAUTH_RU_NAME`, alongside the existing
   `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET`, in the production environment.
3. Preview the eBay composite-key repair with
   `npm run db:repair:ebay-composition:dry-run`, then apply the schema using
   `npm run db:push` only when you are ready to make the database change.
   Deploy after the schema command succeeds.
4. Sign into the site as an administrator, open `/ebay`, and select **Connect
   eBay**. eBay requests listing access plus read-only order and notification
   permissions. Then open a physical Copy in Records → Inventory and select
   **Sell on eBay**.

The app never stores the short-lived access token. It encrypts the eBay refresh
token in the database using the existing server-only `BETTER_AUTH_SECRET` and
obtains access tokens on demand. Do not paste a manually generated eBay token
into environment files or source code.

Existing seller connections must be reconnected once after this change so the
stored grant includes the additional read-only scopes. The existing client ID,
client secret, and RuName remain valid. The current production keyset supports
an immediate `ORDER_CONFIRMATION` subscription. eBay advertises `LISTING`, but
does not assign this keyset its required `sell.listing.read` consent scope, so
the UI reports partial notification coverage instead of breaking connection.
Listings are still reconciled when the user interacts with a Copy and by the
daily safety-net job. Every delivered callback is validated against eBay's
public key before it is persisted or processed.

Before deploying, create/update the tables:

```bash
npm run db:repair:ebay-composition:dry-run
npm run db:push
```

`db:push` prepares the six composite keys used by the eBay foreign keys before
Drizzle applies the remaining schema. It safely handles an empty database, the
partial state left by PostgreSQL error `42830`, and an already-complete schema.
The preparation runs in a transaction and stops without deleting data if an
existing index has an unexpected definition or the required uniqueness cannot
be established.

Keep schema mutation separate from the Vercel frontend build. The Vercel Build
Command should run `npm run build`, not `npm run db:push`; run the schema command
as a controlled release step with the intended production `DATABASE_URL`.

### Production release workflow

Production releases from `main` are controlled by
`.github/workflows/production-release.yml`: it queues releases, applies Drizzle
migrations first, then deploys the same revision to Vercel. Vercel's Git
integration is disabled for `main` in `vercel.json` so it cannot deploy a new
revision before its database migration. Preview branches remain on Vercel's
normal Git deployment flow.

The workflow's first merge is the transition to this release process: it does
not introduce a new application schema dependency, and the committed
`vercel.json` disables later automatic Git deployments from `main`. Before that
merge, configure the protected GitHub `production` environment with:

- `PRODUCTION_DATABASE_URL` secret — obtain or rotate this at the database
  provider; Vercel Sensitive variables cannot be read back out for GitHub.
- `VERCEL_TOKEN` secret — a Vercel token limited to deployment access for this
  project.
- `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` variables — the Vercel team and
  project IDs used by the CLI in CI.

Do not add these as repository-wide values, print them in logs, or use this
workflow for preview/local migrations. A migration failure intentionally blocks
the deployment. If a deployment fails after a successful migration, restore the
last healthy Vercel deployment and ship a forward corrective migration rather
than rolling the database back blindly.

## Scheduled eBay reconciliation

Production checks unresolved eBay listings and retries failed notification work
every day at 02:15 UTC through Vercel Cron. This is a safety net for missed or
delayed eBay notifications; user selling and Sale-record actions also reconcile
on demand. Add a `CRON_SECRET` environment variable in the Vercel project
settings and use a long random value. Vercel sends it to the scheduled route
automatically, and the route rejects requests without it.

The schedule is configured in `vercel.json`. Vercel Cron runs only on production
deployments and uses UTC.

The former daily price-refresh cron and its private endpoint were removed. The
manual pricing actions remain available and continue to use their existing
pricing tables.

If migrating existing local SQLite data, run:

```bash
npm run db:migrate:postgres
```

## Authentication setup

The tracker and binder stay public and read-only. Wheel, spend, chase assignment,
and every edit require a username and password.

After the database schema is updated, create the first account and assign the
existing collection to it:

```bash
npm run auth:create-user -- --username your-name --name "Your name" --admin --public --claim-existing
```

The command asks for the password privately. Use `--email you@example.com` if
you want to keep a real email on the account; otherwise it creates a private
placeholder email because the authentication library requires one internally.

To add a separate private collection later, run the command again without
`--admin --public --claim-existing`. New accounts have the `user` role by
default and can only manage their own collection.

To promote an existing account to administrator from the command line:

```bash
npm run auth:set-role -- --username account-name --role admin
```

Use `--role user` to remove administrator access. The command refuses to demote
the last administrator so the site cannot be left without one.
