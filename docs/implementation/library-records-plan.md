# UI-First Unified Library and Records

## Authority and change control

This file is the durable implementation specification derived from the approved
plan in the Codex task. If the task and this file disagree, update this file with
the decision and a change-log entry before continuing.

Feedback is classified before implementation:

- Clarification/correction: update affected acceptance criteria.
- Product or UX change: document trade-offs and request a decision when approved
  behavior would materially change.
- Implementation detail: record it beneath the relevant checklist item.
- Future idea: add it to Deferred scope.

Replaced decisions are never silently overwritten. The change log records the
old decision, replacement, reason, and checklist items reopened. Completed work
invalidated by feedback returns to `review` or `in_progress`.

## Outcome

Replace the combined card-status concept with Wishlist Target, Card Printing,
Copy, and Record Entry. Rename Tracker to Library. Add private Records routes for
Overview, History, and Inventory. Deliver one complete release, with a UI review
before backend or database work.

The domain language and boundaries in [`CONTEXT.md`](../../CONTEXT.md) and the
separation decision in ADR 0001 are normative.

## Phase 1 — walkable UI/UX scaffold

### P1.1 Preview contract and state

- Define a typed `RecordsDataSource` whose consumers do not import fixtures or
  tRPC.
- Preview reads existing cards with the current read-only query.
- Wishlist legacy rows become desired quantity 1. Owned rows become desired
  quantity 1, one Copy, and one Imported Acquisition.
- Reuse current link, image, price, purchase month, binder/chase-adjacent fields
  where available. Flag missing printing, edition, cost, or TCGplayer metadata.
- Layer representative purchases, pulls, a sale, bulk, sealed goods, and supplies
  over existing Library data.
- Persist preview mutations only under a versioned `sessionStorage` key. Provide
  a reset action and conspicuous Preview mode labeling.

### P1.2 Records shell

- Add authenticated production-intended routes for Records Overview, History,
  and Inventory.
- Overview shows actual purchase cost, net proceeds, realized balance, recent
  entries, attention items, and clear routes into common tasks.
- History supports type/status filters and void/restore actions.
- Inventory distinguishes Cards, Sealed, Bulk, and Supplies without pretending
  supplies are card copies.
- Phone and desktop navigation use labeled controls with at least 44px touch
  targets and visible focus states.

### P1.3 Entry workflows

The detailed, authoritative field and interaction specification for Purchase and
Pack Opening is [`library-records-entry-flows-subplan.md`](./library-records-entry-flows-subplan.md).
Its open decisions must be closed before either flow is rewritten.

- Global Add exposes Purchase, Pack opening, Sale, Adjustment, and Bulk
  itemization.
- Purchase uses four stages: item-type choice, purchase details, item details,
  and review. One Purchase records one Single Card, one Sealed Product, one Bulk
  Lot with card contents, or one Supply/Extra; it does not mix inventory kinds.
- Purchase details include an optional source listing URL and a source selector.
  Choosing `Other` reveals a required free-text source name.
  Choosing `Gift` forces the all-in amount paid to £0 and makes that amount
  read-only until another source is selected.
- Item type is selected with labeled, icon-backed buttons rather than a compact
  dropdown. TCGplayer product URLs are the required primary identity field for
  new cards and sealed products. A labeled `Fetch details` action shows an
  accessible loading state and populates the visible name, image, set, rarity,
  or product fields applicable to that item type. Populated fields remain
  editable, manual corrections are marked, and re-fetch never overwrites a
  correction without confirmation.
- Bulk Lot Purchase and Pack Opening reuse one progressive Card Contents Editor;
  it repeats cards, not purchase item types, and avoids displaying every card's
  fields simultaneously.
- Every card added through Single Card Purchase, Bulk Lot contents, or Pack
  Opening pulls requires Card edition. New card rows default to `1st Edition`;
  the user may change the visible field to `Unlimited Edition` before Review.
- A Bulk Purchase requires at least one identified card and records whether more
  cards remain. It also requires the exact total number of physical cards in
  the lot. Its all-in cost is automatically and permanently allocated across
  that fixed count from the first identified Copy; later itemization receives
  the same per-Copy allocation and never changes an earlier Copy's allocation.
  Partial lots can be updated/itemized later without new spend; dependency rules
  prevent corrections that would contradict later history.
- Entering the Review stage never creates a record. Review shows the purchase
  facts and selected acquisition, and creation requires a separate explicit
  confirmation.
- Opening is link-first, records the sealed product opened and resulting pulled
  copies, and also requires an explicit confirmation from Review. It consumes a
  matching unopened Sealed Unit or creates an explicit Gift/unknown-cost
  Imported Acquisition before opening, so provenance is never orphaned.
- Bulk itemization attaches discovered contents to an existing lot with zero new
  spend.
- Sale uses four stages: sale type, sale details, cards sold, and Review. Single
  selects exactly one available physical Copy; Bulk selects two or more tracked
  Copies within one Sale record. This does not sell an unitemized Bulk Lot.
- Sale card selection uses the same paginated thumbnail grid and selection
  feedback for Single and Bulk, with search, rarity filtering, a selected-only
  view, persistent selection across filters, and inline progress toward the
  mode's required Copy count. A neutral Library-impact explanation replaces
  target-reopening/error language and states the before/after owned and wanted
  quantities in plain language. Sale selects existing Copy IDs and never asks
  for a new TCGplayer link.
- Entering Sale Review never creates a record; a separate confirmation records
  net proceeds and marks the selected Copies sold.
- Adjustment explicitly captures reason and direction; it is not a shortcut for
  normal acquisitions or sales.
- Forms preserve a preview draft while navigating in the current session and
  clearly state that submission is simulated.
- Use short, progressive multi-step flows where the task has distinct decisions:
  purchase, pack opening, sale, adjustment, and bulk itemization. Keep each step
  focused, show progress and a compact running summary, and avoid artificial
  steps for fields that belong together.
- Use a subtle directional step transition. Respect `prefers-reduced-motion` and
  never make animation necessary to understand or operate the form.
- Quantity inputs select their current value on focus so typing replaces the
  default `1` without cursor positioning or manual deletion.

### P1.4 Library and global integration

- Rename user-facing Tracker navigation and headings to Library while preserving
  existing root behavior.
- Add a global signed-in Add menu.
- From Library, offer a prefilled “Record acquisition” path instead of silently
  changing ownership.
- Preserve `/spend` unchanged for comparison during G1.

### P1.5 Scaffold verification

- Run automated checks available in the repository, `npm run lint`, and
  `npm run build`.
- Review desktop and phone layouts, keyboard flow/focus, touch targets, contrast,
  reduced motion, loading/error/empty states, long names, missing images, and
  unknown values.
- Stop any development server used during review.

### G1 Scaffold review

Stop implementation before schema/backend changes. Report every reviewable route,
known scaffold limitation, check result, and changed decision. Collect approval
or feedback and update this plan before Phase 2.

## Phase 2 — real model and integration (blocked by G1)

- Implement owner-scoped card groups, targets, printings, copies, record
  entries/lines, sealed units, bulk lots, supplies, and highlights.
- Store GBP as integer pence. Purchase amount is all-in cost; Sale amount is net
  proceeds. Bulk-Lot per-Copy allocations are required and derived from the
  all-in cost divided by the lot's fixed total-card count; deterministic penny
  rounding must reconcile exactly to the purchase amount without later rebasing.
- Match targets on normalized Card Name + Rarity + Edition. Nest exact printings
  and copies.
- Require TCGplayer product URLs as the primary identity field for new physical
  cards and sealed products in the covered entry flows. Legacy missing links
  remain attention items.
  Reuse target metadata only when the set also matches.
- Resolve printing metadata through the exact unauthenticated TCGplayer
  marketplace product detail keyed by the required product link, then use the
  current link parser and YGOPRODeck set data as fallbacks. Do not depend on
  unavailable TCGplayer developer credentials.
- Replace the preview data source with a tRPC adapter satisfying the same
  contract.
- Integrate Library, Binder, Wheel, Assign Chase, navigation, authentication,
  public/private views, highlights, and eventual `/spend` redirect.
- Keep mutations transactional and block removal when later history depends on
  an entry.

### G2 Backend approval

Review contracts, arithmetic, dependencies, owner isolation, and integration
behavior before migration work.

## Phase 3 — migration and UX hardening (blocked by G2)

- Prepare an additive, idempotent migration and dry-run report.
- Merge legacy rows by normalized name, rarity, and Unknown edition.
- Give each owned legacy row desired quantity 1 and one Copy. Convert numeric paid
  prices into editable Imported Acquisitions.
- Preserve month precision, binder slots, wheel/chase state, and favourites.
- Surface incomplete data without making legacy records unusable.
- Apply database changes only after explicit G3 approval; do not permanently dual
  write.
- Add real loading, timeout, retry, validation, conflict, draft-recovery, and
  expired-auth behavior. Prevent duplicate submissions.
- Tune density, pagination, search, image loading, and responsive behavior against
  real data.

### G3 Migration approval

Review the dry-run report before applying any database change.

### G4 Final site review

Review complete real-data behavior before deployment or landing on `main`.

## Deferred scope

- Generalized inventory locations beyond the existing Binder integration.
- Sales of sealed products, bulk lots, or supplies.
- Automated marketplace/order importing.
- TCGplayer developer-credential integrations.
- Deployment, production migration, and landing on `main` until their gates.

## Decision change log

| Date | Previous decision | Replacement | Reason | Reopened items |
| --- | --- | --- | --- | --- |
| 2026-07-16 | None | Initial approved specification recorded | Implementation start | None |
| 2026-07-16 | Long entry pages with all sections visible | Progressive multi-step entry flows with subtle reduced-motion-safe transitions | User feedback: the forms felt potentially overwhelming | P1.3 |
| 2026-07-17 | Purchase combined item entry and type selection in one dropdown-driven page; the future model required TCGplayer links | Four-stage repeatable type selection with visual buttons, optional listing/product URLs, controlled source choice, and a non-mutating review that requires explicit confirmation | G1 feedback showed that the scaffold did not yet communicate the purchase workflow or confirmation boundary clearly | P1.3, P1.5, Phase 2 URL rule |
| 2026-07-17 | Purchase details preceded type; one Purchase could repeat and mix item kinds; product URLs were optional; Pack Opening manually selected/named products and its Review submitted without a clear confirmation boundary | Type-first, single-acquisition-kind Purchase; required link-first card/sealed identity; shared progressive card editor for Bulk and Opening; explicit confirmations for both flows | Detailed G1 field review clarified that product links should drive identity and that repeated rows represent cards within a lot/opening, not unrelated purchase kinds | P1.3, P1.5, Phase 2 input contracts |
| 2026-07-17 | Link metadata resolved implicitly into summary-only derived facts; Bulk completion behavior was undecided | User-triggered `Fetch details` with loading/result states and populated form fields; Bulk requires at least one identified card, may remain partially itemized, and can be updated later without new spend | Explicit fetching makes the network action and result legible; partial itemization reflects real unsorted purchases without blocking later correction | P1.3, Phase 2 resolver and dependency contracts |
| 2026-07-17 | Fetched metadata field editability was undecided | Auto-filled fields remain editable, manual corrections are marked, and re-fetch confirms before overwriting them | Metadata extraction can be incomplete or wrong; a required link must accelerate entry without trapping the user in incorrect data | P1.3 metadata UI and resolver state |
| 2026-07-17 | Pack Opening required an existing sealed-unit selection before link resolution; remaining quantity, pull identity, notes, and resolver-failure details were undecided | Link-first match-or-explain opening provenance; same-printing multi-copy Single purchases; required link/rarity for every pull; notes before Review; recoverable unresolved metadata | Preserves inventory history without blocking gifts/old stock, keeps Review a confirmation surface, and prevents marketplace availability from making records impossible | P1.3 Purchase/Opening contracts and review UI |
| 2026-07-17 | Sealed identity exposed product line/set and product code/edition; Opening exposed inventory-provenance choices and matching units; validation used page-level messages | Sealed identity shows Product name plus `1st Edition`/`Unlimited Edition`; Purchase and Opening share seller/source including Gift; inventory matching is automatic and hidden; errors use destructive toasts; Review is a dedicated read-only confirmation state | G1 feedback showed the prior labels and provenance mechanics were implementation language rather than a natural manual-entry experience | P1.3d, P1.3e, P1.3f, P1.3g |
| 2026-07-17 | Re-fetch protection treated same-link edits and a changed product link alike; printing facts depended on slug/YGOPRODeck matching | Same-link re-fetch still protects manual edits, while fetching a changed link first clears all prior derived fields; exact unauthenticated marketplace product details supply rarity/set code before the existing fallbacks | A changed link was retaining prior card values, and YGOPRODeck omits valid marketplace printings such as GBI-001 | P1.3, P1.5, Phase 2 resolver contract |
| 2026-07-17 | Sale was a two-step unfiltered text-row list with unrestricted multi-selection and submission from its final editing page | Four-stage Single/Bulk card Sale with details before inventory selection, paginated searchable/filterable thumbnail cards, read-only Review, and explicit confirmation | G1 feedback requires scalable discovery and a Purchase-like flow while continuing to operate on already-tracked Copies | P1.3, P1.5 |
| 2026-07-17 | Card edition was omitted for Single/Bulk/Pull cards; Sale displayed a target-reopening warning that looked like an unexplained error | Require visible Card edition defaulted to `1st Edition` for every acquired card; use one consistent Single/Bulk selection surface with inline minimum progress and a neutral plain-language Library-impact summary | Edition is part of target identity, while implementation terms such as “reopens Wishlist” do not explain the real effect to the user | P1.3, P1.5, preview target matching |
| 2026-07-17 | Bulk per-card allocation was optional/absent | Require a fixed total-card count for every Bulk Lot and automatically allocate its all-in cost across that count from first itemization; later cards receive their original share without rebasing earlier cards | Dividing by identified cards makes cost and realised results change as sorting progresses; the advertised/known lot count is the stable denominator | P1.3 Bulk, Bulk Itemization, P2 allocation model |
