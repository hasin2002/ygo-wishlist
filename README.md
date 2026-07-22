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
BETTER_AUTH_SECRET=<a new random secret>
BETTER_AUTH_URL=https://your-site.example
```

## eBay seller connection

The existing Collection Hub username/password sign-in remains independent from
eBay. Only an administrator can open `/ebay`, connect a seller account, or
create a listing from a physical Copy in Records → Inventory.

To enable the connection:

1. In the eBay developer portal, create a **Production OAuth-enabled RuName**.
   Its Accept URL must be `https://<your-production-domain>/api/ebay/callback`.
   For local HTTP testing, create a second RuName that uses eBay's standard
   success page and set it as `EBAY_OAUTH_LOCAL_RU_NAME`. After consent, paste
   that page's full URL into the development-only completion form.
2. Add its RuName value to `EBAY_OAUTH_RU_NAME`, alongside the existing
   `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET`, in the production environment.
3. Apply the new schema using `npm run db:push` only when you are ready to make
   the database change, then deploy.
4. Sign into the site as an administrator, open `/ebay`, and select **Connect
   eBay**. eBay will request the `sell.inventory` permission. Then open a
   physical Copy in Records → Inventory and select **Sell on eBay**.

The app never stores the short-lived access token. It encrypts the eBay refresh
token in the database using the existing server-only `BETTER_AUTH_SECRET` and
obtains access tokens on demand. Do not paste a manually generated eBay token
into environment files or source code.

Before deploying a fresh database, create/update the tables:

```bash
npm run db:push
```

## Scheduled price refresh

Production refreshes the public Library collection every day at 23:45 UTC through
Vercel Cron. Before the first production deployment, add a `CRON_SECRET`
environment variable in the Vercel project settings. Use a long random value;
Vercel sends it to the scheduled route automatically, and the route rejects
requests without it.

The schedule is configured in `vercel.json`. Vercel Cron runs only on production
deployments and uses UTC.

The refresh timestamp also needs the `pricing_refresh_states` table. Apply the
schema change once to the production database with `npm run db:push` using its
production `DATABASE_URL`.

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
