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

- Global Add exposes Purchase, Pack opening, Sale, Adjustment, and Bulk
  itemization.
- Purchase supports mixed lines (cards, sealed products, bulk lots, supplies),
  one all-in amount, and optional allocations that never add cashflow.
- Purchase uses four stages: purchase details, item-type choice, item details,
  and review. Adding another item returns to the visual type choice so one
  purchase can still mix singles, sealed products, bulk lots, and supplies.
- Purchase details include an optional source listing URL and a source selector.
  Choosing `Other` reveals a required free-text source name.
- Item type is selected with labeled, icon-backed buttons rather than a compact
  dropdown. Card and sealed item details accept an optional TCGplayer product
  URL; a missing URL remains visible as incomplete metadata rather than blocking
  manual entry.
- Entering the Review stage never creates a record. Review shows the purchase
  facts and every item, and creation requires a separate explicit confirmation.
- Opening records sealed product opened and resulting pulled copies.
- Bulk itemization attaches discovered contents to an existing lot with zero new
  spend.
- Sale selects available copy IDs and shows target reopening when owned quantity
  falls below desired quantity.
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
  proceeds; allocations are optional descriptions only.
- Match targets on normalized Card Name + Rarity + Edition. Nest exact printings
  and copies.
- Accept TCGplayer product URLs for new targets and physical cards without
  requiring them during manual entry. Missing links remain attention items.
  Reuse target metadata only when the set also matches.
- Resolve printing metadata through the current link parser and YGOPRODeck set
  data without depending on unavailable TCGplayer credentials.
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
