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
```

Before deploying a fresh database, create/update the tables:

```bash
npm run db:push
```

If migrating existing local SQLite data, run:

```bash
npm run db:migrate:postgres
```
