# Card Printing migrations and reconciliation

`drizzle/` is the sole ordered PostgreSQL schema history. `0000` is the audited
baseline for an empty database; `0001` adds the two owner-and-Target-scoped
unique identities for exact Printings: a canonical TCGplayer product URL and a
complete normalized set name/code. Missing/placeholder set data is deliberately
outside the set constraint. Null, empty, and whitespace-only canonical product
URLs are all treated as missing, never as a shared Printing identity.

Run these commands only against the intended isolated local database:

1. `npm run db:migrate:preflight` shows whether a database is empty, already
   tracked, or needs audited baseline adoption.
2. `npm run db:printings:preflight` lists automatic candidates, affected Copy
   IDs, and photo/record/eBay downstream reference counts. It never writes.
3. If there are ambiguous pairs, stop and resolve them manually. If automatic
   candidates are correct, run `npm run db:printings:reconcile:apply --
   --confirm-configured-nonloopback-database` for a configured local database.
   A disposable loopback database does not need the extra confirmation.
4. For an existing pre-migration schema, run `npm run db:migrate:apply --
   --adopt-current-schema --confirm-configured-nonloopback-database`; for an
   empty or already tracked configured database, use the same explicit
   confirmation. Loopback disposable databases do not need it.

Reconciliation changes only `card_copies.printing_id`, then deletes empty
duplicate Printing containers. Copies, photos, record links, and eBay members
retain their exact IDs and history. Ambiguous metadata is never silently merged.

Migrations are forward-only. Do not edit an applied SQL file and do not use
`db:push` for schema evolution. If a released migration needs correction, add a
new forward-fix migration; restore from a verified backup before any exceptional
manual rollback.

The runner refuses Vercel and production-marked environments. It also requires
an explicit flag before applying to a non-loopback configured database, so a
local managed host cannot be changed by accident.
