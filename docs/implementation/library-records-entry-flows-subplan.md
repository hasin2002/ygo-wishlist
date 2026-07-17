# Purchase and Pack Opening scaffold redesign

Status: G1 refinements implemented and verified; ready for scaffold review.
Backend and database work remain blocked by G1.

## Authority and scope

This subplan is the detailed specification for `P1.3 Entry workflows` in
[`library-records-plan.md`](./library-records-plan.md). It currently covers only
Purchase and Pack Opening. Sale, Adjustment, and standalone Bulk Itemization
remain unchanged until separately reviewed.

If this file conflicts with the main plan on either covered flow, this file is
more specific. The main plan's decision log must still record every replacement.

## Goals

- Make TCGplayer product links the primary identity field for new cards and
  sealed products.
- Keep one Purchase focused on one acquisition kind instead of mixing unrelated
  inventory kinds in one wizard.
- Reuse one calm, scalable card-contents editor for a Bulk Lot and Pack Opening.
- Let metadata remove typing without hiding resolution failures or creating
  inventory before an explicit confirmation.
- Keep the scaffold UI-only: drafts and submitted preview records remain in
  `sessionStorage`; no database mutation or migration is introduced.

## Shared interaction and metadata contract

### TCGplayer product field

- A card or sealed-product identity begins with a required TCGplayer product
  URL. The field is visually primary and appears before derived information.
- Pasting or changing the URL does not fetch automatically. A labeled
  `Fetch details` button gives the user control over the network action.
- While fetching, disable duplicate requests, show a spinner plus `Fetching
  details…`, and announce the state without moving keyboard focus unexpectedly.
- Fetching then produces either:
  - `resolved`: show a compact product preview with image, title, and any
    available rarity/set facts, and populate the relevant form fields; or
  - `needs attention`: retain the valid URL, explain which facts could not be
    resolved, and provide Retry.
- Keep the relevant derived fields in the form rather than replacing them with a
  read-only summary. Card fields are name, rarity, set name, and set code where
  available. Sealed fields are product name and any applicable product/set or
  edition facts.
- Populated fields remain editable. Label fetched values as `Auto-filled` and
  changed values as `Edited`. Re-fetching after a manual correction must ask
  before overwriting those corrections; cancelling keeps the current values.
- Reuse the existing TCGplayer URL rules and metadata parser behavior through a
  typed resolver boundary. The preview adapter may provide deterministic
  scaffold results; the Phase 2 adapter will call the server resolver.
- Resolution must preserve the user's link and draft when navigating backward,
  retrying, or leaving and returning to the route.
- For a sealed product, the editable derived fields are only Product name and
  Product edition. Do not show Product line, Set, or Product code. Product
  edition is required and uses `1st Edition` or `Unlimited Edition`; the latter
  is the marketplace/card-game term replacing the requested but inaccurate
  `Second Edition` label. Resolve it from the link when possible.

### Shared seller or source control

- Purchase and Pack Opening use the same labeled seller/source selector.
- Options are eBay, TCGplayer, Cardmarket, Facebook Marketplace, Local card
  shop, Private seller, Gift, and Other.
- Other reveals one required free-text source field. Gift is a real zero-cost
  source; every other unpriced Opening source has unknown historical cost.
- Pack Opening does not expose inventory-provenance language, matching-unit
  selection, or imported-acquisition mechanics. An exact unopened URL match is
  consumed automatically in the preview; without a match, the selected source
  creates and immediately consumes the necessary acquisition behind the scenes.

### Validation feedback

- Missing required values and other recoverable form errors use an accessible
  destructive toast with a clear correction message and dismiss action.
- The same feedback is used by Purchase, Pack Opening, and the shared Card
  Contents Editor so nested card validation does not fail silently.
- Toasts never steal focus and auto-dismiss after five seconds. The form still
  preserves every entered value.

### Metadata resolver acceptance fixtures

The following user-supplied links are durable resolver checks. Name casing may
be normalized for display, but the meaning, rarity, and set code must not drift:

| TCGplayer product | Expected name | Expected rarity | Expected set code |
| --- | --- | --- | --- |
| `22954` Forbidden Memories promo | Red-Eyes Black Metal Dragon (Forbidden Memories) | Prismatic Secret Rare | FMR-001 |
| `702350` Chaos Origins | Black Chaos | Secret Rare | CORI-EN001 |
| `22940` Dark Duel Stories promo | Blue-Eyes White Dragon | Prismatic Secret Rare | DDS-001 |

Promotional-card URLs may put a game/set qualifier after the card name. The
resolver therefore matches the longest card name on slug-token boundaries and
uses both the prefix and suffix to identify its printing. A small title
normalization preserves TCGplayer's Forbidden Memories qualifier; all populated
fields remain editable if marketplace naming changes.

### Rarity control

- Extract the existing rarity list and searchable combobox from the Library into
  reusable modules instead of creating a second list or a plain text input.
- Rarity is required for a Single Card and for every identified card in a Bulk
  Lot. Metadata may prefill it, but the selected value remains visible for
  confirmation or correction.
- Pack Opening pulls use the same required rarity control as Bulk Lot cards.

### Card contents editor

- One reusable editor powers Bulk Lot contents and Pack Opening pulls.
- A new card opens as a focused editor with TCGplayer link first, followed by
  `Fetch details`, populated metadata fields, required rarity when applicable,
  and quantity.
- Saving that card collapses it into a compact summary row containing thumbnail,
  title, rarity, quantity, and Edit/Remove controls.
- Only one card is expanded at a time. `Add another card` creates and focuses a
  fresh editor; it does not create another purchase item or inventory kind.
- Show a running summary such as `4 card types · 7 copies` outside the rows.
- Avoid nested modals, an always-expanded wall of fields, drag-only controls, and
  icon-only actions. Preserve at least 44px touch targets, keyboard order, and
  reduced-motion-safe 150–300ms transitions.

## Purchase wizard

Purchase is four stages in this order:

1. `Item type`
2. `Purchase details`
3. `Item details`
4. `Review`

### P1.3-P1 Item type

- Show Single Card, Sealed Product, Bulk Lot, and Supply or Extra as labeled
  Lucide-icon selection cards.
- One Purchase has exactly one acquisition subject:
  - one Single Card printing;
  - one Sealed Product;
  - one Bulk Lot whose card contents may contain several rows; or
  - one Supply or Extra.
- Remove the repeatable item-type loop and every `Add another item` control.

### P1.3-P2 Purchase details

- Keep purchase date, seller/source selector, conditional `Other` source name,
  optional purchase listing URL, and all-in amount paid.
- Keep purchase-level facts independent of the chosen inventory kind so Back
  navigation does not discard them.

### P1.3-P3 Item details

The page branches by the type selected in stage 1:

- `Single Card`: required TCGplayer product link, resolved product preview,
  explicit `Fetch details`, populated card-name/set fields, required reusable
  rarity control, and quantity. Quantity may exceed one, but every Copy created
  here must share that exact TCGplayer product/printing.
- `Sealed Product`: required TCGplayer product link, resolved product preview,
  explicit `Fetch details`, Product name, required Product edition with only
  `1st Edition` and `Unlimited Edition`, and quantity. Product line, Set, and
  Product code are not shown.
- `Bulk Lot`: the shared Card Contents Editor. The generic lot-description and
  estimated-card-count experience is removed. At least one identified card is
  required. The user explicitly marks whether more cards remain unitemized.
- `Supply or Extra`: one required category selector containing Sleeves, Binder,
  Storage, Playmat, and Other; choosing Other reveals a required free-text name.
  Do not show a second duplicate supply-name field. Keep quantity.

### P1.3-P4 Review and confirmation

- Review summarizes the chosen type, purchase facts, amount, listing link,
  resolved product/card previews, quantities, rarity, supply Other text, and any
  metadata attention state relevant to the final decision.
- Remove `Add another item`. Each section has a labeled Edit route back to its
  owning step.
- Reaching Review never submits. A distinct `Confirm preview purchase` action is
  required and shows pending, success, and recoverable error feedback.
- Optional purchase notes are entered on Purchase Details and displayed
  read-only on Review. Review contains no editable form fields.
- Review is rendered as a dedicated summary state rather than a continuation of
  the data-entry layout. Entering it never calls a create method; only its
  explicit confirmation button may submit.

## Pack Opening wizard

Pack Opening remains three stages:

1. `Product`
2. `Pulled cards`
3. `Review`

### P1.3-O1 Product

- The primary field is a required TCGplayer product URL for the pack, tin, box,
  deck, or other sealed product opened.
- Resolve and show its product name and image. Do not ask the user to type the
  product name from the URL alone; use the explicit `Fetch details` action and
  populate the product fields.
- Show only Product name and required Product edition (`1st Edition` or
  `Unlimited Edition`) for the sealed product identity.
- Keep the opening date and use the shared seller/source selector. Do not expose
  inventory provenance or sealed-unit matching controls.

### P1.3-O2 Pulled cards

- Reuse the same Card Contents Editor as Bulk Lot rather than maintaining a
  separate Pull Rows implementation.
- Every accepted pull creates the stated quantity of physical Copies tied to
  the Pack Opening record.
- Every pull uses the same required TCGplayer URL, `Fetch details`, editable
  populated metadata, required rarity, and quantity behavior as a Bulk card.

### P1.3-O3 Review and confirmation

- Show the resolved sealed product, opening date, number of distinct pulled
  cards, total Copies, and compact card summaries.
- Reaching Review never submits. A separate `Confirm preview opening` action is
  required, with pending, success, and recoverable error feedback.
- Each section has an Edit route; the pulled-card list must not be an uneditable
  count-only summary.
- Optional opening notes are entered on Product and displayed read-only on
  Review.

## Preview contract changes

- Replace the current multi-line `PurchaseInput` with a discriminated input
  containing common purchase facts and exactly one of `card`, `sealed`, `bulk`,
  or `supply` details.
- Introduce shared `TcgplayerProductDraft`, `ResolvedProductMetadata`, and
  `CardContentsRow` types so Purchase and Opening cannot drift.
- Add an asynchronous metadata-resolution method to the data-source contract,
  invoked only by `Fetch details`, including idle, fetching, resolved, stale,
  and recoverable error behavior. Editing the URL after a successful fetch marks
  the old metadata stale until details are fetched again.
- Update preview reducers and fixtures to derive target, printing, copy, sealed,
  bulk, supply, record-line, review, and attention behavior from the same input.
- Preserve valid older session drafts through an explicit draft-version upgrade
  where practical; otherwise reset only the affected flow with a clear preview
  notice.

## Resolved decisions

- `D1 Bulk completion`: A Bulk Purchase requires at least one identified card
  and an explicit `More cards remain to itemize` choice. A partial lot remains
  open. Later Bulk Itemization reuses the same Card Contents Editor, adds no new
  spend, and can add cards or correct existing itemization. Backend dependency
  rules must reject a correction that would invalidate later history, such as a
  Sale of a Copy being removed.
- `D7 Metadata trigger`: Details are fetched only after the user presses the
  labeled button. The UI shows an accessible loading identifier, prevents a
  duplicate request, populates fields appropriate to the item kind, and marks
  those results stale if the URL subsequently changes.
- `D8 Metadata correction`: Auto-filled name, rarity, set, and product fields
  remain editable. Manual changes are visibly distinguished from fetched values.
  Re-fetching asks before replacing any manual correction and never overwrites it
  silently.
- `D2 Opening source and hidden inventory continuity`: The visible flow uses the
  same seller/source selector as Purchase, including Gift and Other. The term
  `inventory provenance` and matching-unit picker are removed. The preview
  silently consumes an exact unopened URL match; otherwise it creates and
  immediately consumes an acquisition from the selected source. Gift is £0;
  other unpriced sources remain unknown-cost and excluded from known spend.
- `D3 Single quantity`: A Single Card purchase may create several Copies only
  when all share the same exact TCGplayer product/printing.
- `D4 Pull identity`: Every pulled card requires its own valid TCGplayer product
  URL, an attempted `Fetch details`, confirmed rarity, and quantity, using the
  same Card Contents Editor as Bulk.
- `D5 Notes placement`: Purchase notes live on Purchase Details; Opening notes
  live on Product. Both are read-only summaries on Review, which remains a true
  confirmation screen rather than another editing form.
- `D6 Resolution failure`: A valid TCGplayer link and at least one fetch attempt
  are required. A temporary/partial fetch failure does not block confirmation if
  the user supplies the required editable identity fields. The row is saved as
  `needs attention` with Retry; it never pretends unresolved metadata succeeded.

## Execution checklist

| ID | State | Item | Acceptance |
| --- | --- | --- | --- |
| P1.3a | done | Close entry-flow decisions | Every listed decision resolved and recorded without contradictory acceptance criteria |
| P1.3b | done | Shared metadata and rarity UI | One resolver boundary, one rarity list/control, visible async and recovery states |
| P1.3c | done | Shared Card Contents Editor | Bulk and Opening share collapsed rows, single expanded editor, Add card, Edit, Remove, summaries |
| P1.3d | done | Purchase rewrite | Type-first four-stage flow now includes simplified sealed fields, shared source, dedicated Review, and explicit confirmation |
| P1.3e | done | Pack Opening rewrite | Link-first product and pulls flow now hides inventory mechanics, shares source, and requires explicit confirmation from Review |
| P1.3f | done | Verification | Automated checks, supplied metadata fixtures, desktop walkthroughs, and 375px/focus/touch checks pass |
| P1.3g | done | G1 form refinements | Sealed fields, shared source, dedicated Review, destructive toast, reducers, and responsive verification match this specification |

## Review gate

Stop again at G1 after `P1.3f`. Report both routes, every derived/failed metadata
state, known preview limitation, changed decision, and check result. Phase 2
remains blocked until explicit scaffold approval.
