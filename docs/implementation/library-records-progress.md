# Library and Records implementation progress

Last updated: 2026-07-17

## Session resume protocol

At the start of each work session:

1. Read this file and `library-records-plan.md`.
2. Inspect branch, `git status`, and `git diff`.
3. Confirm the most recent checks below.
4. Resume the single `in_progress` item. Do not infer status from chat memory.

Allowed statuses: `pending`, `in_progress`, `review`, `done`, `blocked`. At most
one implementation item may be `in_progress`.

## Checklist

| ID | Status | Item | Evidence / acceptance |
| --- | --- | --- | --- |
| P0.1 | done | Clean feature branch and durable docs | `agent/collection-records` is checked out in the primary project directory; the abandoned Stardust experiment and redundant local branch were removed; plan, progress, context, ADR created |
| P1.1 | done | Preview contract and session state | Typed `RecordsDataSource`, legacy mapping, preview fixtures and resettable session state compile |
| P1.2 | done | Records shell | Overview, History, Inventory routes and responsive navigation compile |
| P1.3 | review | Entry workflows | Exact product metadata resolves all eight supplied card links; changed-link re-fetch clears the previous product before loading; Purchase and Pack Opening await renewed G1 review |
| P1.4 | done | Library and global integration | Library rename, global Add, prefilled acquisition, removal of one-click ownership toggle; `/spend` preserved |
| P1.5 | done | Scaffold verification | Lint, TypeScript, production build, eight-link live metadata regression, full local route checks, and additional matcher edge checks pass |
| G1 | review | Scaffold review | User reviews all listed UI before backend work starts |
| P2.1 | blocked | Real model and integration | Blocked by G1 |
| G2 | blocked | Backend approval | Blocked by P2.1 |
| P3.1 | blocked | Migration and hardening | Blocked by G2 and separate migration approval |
| G3 | blocked | Migration approval | Dry-run must be reviewed before apply |
| G4 | blocked | Final site review | Required before deployment or landing on `main` |

## Current update

- Completed: P1.3g UI behavior, changed-link state isolation, and the exact
  product metadata resolver correction.
  Sealed forms show only Product name and Product edition;
  Purchase and Opening share seller/source including Gift and Other; visible
  inventory provenance is gone; Review is read-only until explicit confirmation;
  and recoverable errors use destructive toasts.
- Current: G1 scaffold review. The resolver correction is implemented using the
  product ID already present in every required link, without per-card exceptions.
- Next: collect renewed G1 feedback or explicit approval. Phase 2 still requires
  explicit approval.
- Reviewable UI:
  - `/` — Library rename, target-only add language, global Add, per-card Record
    acquisition/View copies paths for signed-in users.
  - `/records` — Overview, cost/proceeds/cash position, quick tasks, recent
    history, attention list, reset.
  - `/records/history` — search/type/status filtering and dependency-aware
    void/restore.
  - `/records/inventory` — Cards (search and pagination), Sealed, Bulk, Supplies.
  - `/records/new/purchase` — type-first Single Card, Sealed Product, Bulk Lot,
    and Supply/Extra branches; purchase details; explicit metadata fetch;
    read-only Review and Confirm.
  - `/records/new/opening` — link-first opened product, existing-unit match or
    Gift/Old collection/Other provenance, shared pulled-card editor, read-only
    Review and Confirm.
  - `/records/new/sale` — two-step exact-copy sale with target-reopening warning.
  - `/records/new/adjustment` — reasoned add/remove correction flow.
  - `/records/new/bulk-itemization` — existing-lot itemization with explicit £0
    new spend.
  - `/spend` — intentionally preserved for comparison.
- Checks: TypeScript, lint, patch whitespace, and an isolated production build
  pass. Browser walkthroughs covered Purchase Other-source/listing input,
  sealed-product fetch/loading, Opening inventory match, pulled-card
  name/rarity/set/code resolution, add/collapse/remove cards, Review boundaries,
  explicit confirmation, keyboard focus, and 375px no-overflow/touch sizing. All
  eight user-supplied metadata fixtures resolve the exact expected name, rarity,
  and set code. The Gorz and Slifer requests also pass through the running local
  Next.js metadata route. Additional probes cover repeated card names inside a
  set slug, apostrophes, and same-set rarity disambiguation.
- Changed decisions: Purchase type moves first and becomes single-kind;
  TCGplayer links become required primary identity for cards/sealed products;
  Bulk repeats cards rather than purchase items; Opening reuses that card editor;
  details are populated only after an explicit `Fetch details` action with a
  loading state; populated fields remain editable and protected from silent
  same-link re-fetch overwrite; fetching a changed product link clears every
  old derived field before loading; exact unauthenticated marketplace product
  details precede the slug/catalogue fallback; a Bulk Lot may remain partially
  itemized and be updated later without new spend; Pack Opening uses
  match-or-explain provenance; every pull requires link and rarity; notes move
  before read-only Review; both Reviews require explicit confirmation.
  Gift now forces Purchase spend to £0 while selected, and quantity fields
  select their existing value on focus for one-keystroke replacement.
- Blockers: no scaffold implementation blocker. Phase 2 remains intentionally
  blocked by explicit G1 approval.

## Check log

| Date/time | Check | Result | Notes |
| --- | --- | --- | --- |
| 2026-07-16 | Pre-change branch/status | pass | Clean `agent/collection-records` worktree |
| 2026-07-16 | TypeScript `--noEmit` | pass | Preview data source, Records routes, and initial entry flows |
| 2026-07-16 | `npm run lint` | pass | No warnings or errors |
| 2026-07-16 | Production build | pass | Built all 18 routes with a dummy local `DATABASE_URL`; expected Better Auth warnings because verification intentionally omitted real auth secret/base URL |
| 2026-07-16 | Desktop browser review | pass | Overview, Add menu, purchase progression/submission, History, void/restore, duplicate sale/reopening, inventory |
| 2026-07-16 | Phone browser review | pass | 390×844; menu, Add, Overview, navigation, no horizontal overflow |
| 2026-07-16 | Theme/reduced motion | pass | Dark palette inspected; step animation has `prefers-reduced-motion` fallback |
| 2026-07-16 | Development server cleanup | pass | Server exited and port 3100 has no listener |
| 2026-07-17 | TypeScript `--noEmit` | pass | Revised purchase input, record entry, preview adapter, and four-stage UI compile |
| 2026-07-17 | `npm run lint` | pass | No warnings or errors after purchase and mobile action-bar changes |
| 2026-07-17 | Patch whitespace | pass | `git diff --check` returned no errors |
| 2026-07-17 | Production build | pass | Isolated build compiled all 18 routes with a dummy local `DATABASE_URL`; expected Better Auth warnings because real auth secret/base URL were intentionally omitted |
| 2026-07-17 | Desktop purchase review | pass | Other-source disclosure, listing URL, visual type choice, card link, mixed single/supply lines, editable Review, and explicit Confirm verified |
| 2026-07-17 | Phone purchase review | pass | 390×844; all four type cards, form actions, and Review remain usable with no horizontal overflow or covered fields |
| 2026-07-17 | Review boundary | pass | Reaching Review created no record; only `Confirm preview purchase` displayed the saved state |
| 2026-07-17 | Development server cleanup | pass | Temporary review server exited and port 3100 has no listener; the user's port-3000 server was left untouched |
| 2026-07-17 | TypeScript `--noEmit` and `npm run lint` | pass | Revised discriminated inputs, metadata endpoint, shared editors, Purchase, Opening, provenance, and focus behavior compile without warnings |
| 2026-07-17 | Patch whitespace | pass | `git diff --check` returned no errors after the final UI pass |
| 2026-07-17 | Production build | pass | Isolated build compiled all 19 routes with a dummy local `DATABASE_URL`; expected Better Auth warnings because real auth secret/base URL were intentionally omitted |
| 2026-07-17 | Metadata resolver | pass | User-provided sealed-product URL resolved image and cleaned product name; a card URL resolved Dark Magician, Ultra Rare, Starter Deck: Yugi, and SDY-006 |
| 2026-07-17 | Supplied metadata fixtures | pass | Product 22954 resolved Red-Eyes Black Metal Dragon (Forbidden Memories), Prismatic Secret Rare, FMR-001; product 702350 resolved Black Chaos, Secret Rare, CORI-EN001; product 22940 resolved Blue-Eyes White Dragon, Prismatic Secret Rare, DDS-001 |
| 2026-07-17 | Desktop Purchase and Opening review | pass | Explicit fetch/loading, existing sealed match, shared pulled-card editor, Review boundary, and Confirmed preview saved state verified |
| 2026-07-17 | Phone and focus review | pass | 375×812; no horizontal overflow or visible controls below 40px; step changes focus the new panel; reduced-motion fallback remains in CSS |
| 2026-07-17 | Development server cleanup | pass | Isolated port-3100 review server stopped; the user's existing port-3000 server was not stopped or changed |
| 2026-07-17 | Final TypeScript, lint, and patch whitespace | pass | Checks rerun after promotional-card resolver changes; no errors or warnings |
| 2026-07-17 | Final production build | pass | Isolated build compiled all 19 routes after the resolver acceptance fixes; expected Better Auth warnings because real auth secret/base URL were intentionally omitted |
| 2026-07-17 | P1.3g TypeScript, lint, and patch whitespace | pass | Simplified sealed identity, shared source, hidden matching, Review confirmation, toasts, and reducers compile without warnings |
| 2026-07-17 | P1.3g sealed resolver | pass | Spellcasters Command URL resolved Product name `Spellcasters Command Structure Deck` and Product edition `Unlimited Edition` without line/set/code fields |
| 2026-07-17 | P1.3g desktop Purchase review | pass | Gift source, missing-required destructive toast, sealed fetch, two-option edition, dedicated Review, and explicit non-automatic confirmation verified |
| 2026-07-17 | P1.3g desktop Opening review | pass | Shared Gift/Other source, no visible provenance/matching controls, product edition, pulled-card summary, explicit Review boundary, confirmation, and exact-link inventory consumption verified |
| 2026-07-17 | P1.3g phone review | pass | 375×812 had no horizontal overflow or visible controls below 40px; destructive toast stayed inside the viewport |
| 2026-07-17 | P1.3g production build | pass | Isolated build compiled all 19 routes; expected Better Auth warnings because real auth secret/base URL were intentionally omitted |
| 2026-07-17 | P1.3g development server cleanup | pass | Isolated port-3100 server stopped; the user's existing port-3000 server remained untouched |
| 2026-07-17 | P1.3g currency-prefix alignment | pass | The All-in amount paid prefix now uses a full-height flex overlay with tight line height so the pound glyph is vertically centred without changing the input geometry |
| 2026-07-17 | Six-link live metadata regression | pass | Products 66848, 108220, 66832, 22954, 702350, and 22940 resolved every supplied name, rarity, and set code exactly against live TCGplayer pages and YGOPRODeck data |
| 2026-07-17 | Metadata matcher edge probes | pass | Repeated Blue-Eyes card/set wording resolved LOB-001; apostrophe-normalized Jack's Knight resolved KICO-EN028 Collector's Rare; rarity-suffixed Big Shield Gardna resolved BP02-EN032 Mosaic Rare |
| 2026-07-17 | Resolver TypeScript, lint, and patch whitespace | pass | Generalized context scoring and possessive normalization compile without errors or lint warnings |
| 2026-07-17 | Resolver production build | pass | Isolated build compiled all 19 routes after the matcher correction |
| 2026-07-17 | Exact marketplace metadata | pass | Product 149350 resolved Gorz the Emissary of Darkness, Ultra Rare, YR01-EN003; product 25371 resolved Slifer the Sky Dragon, Ultra Rare, GBI-001 without developer credentials |
| 2026-07-17 | Running Next.js metadata route | pass | The user's existing port-3000 server returned the same exact Gorz and Slifer facts through `/api/records/metadata`; the server was not stopped or replaced |
| 2026-07-17 | Changed-link state isolation | pass | A stale link now creates a blank pending identity containing only the new URL before resolving; failures retain the new URL and blank fields, and superseded requests cannot repopulate an edited link |
| 2026-07-17 | Exact metadata/state production build | pass | An isolated webpack build compiled all 19 routes without writing into the user's active `.next` dev session; expected Better Auth warnings because review credentials were intentionally omitted |
| 2026-07-17 | Rarity status-label alignment | pass | The Rarity Auto-filled/Edited indicator now appears beside the label and required marker, matching the other derived fields; TypeScript, lint, and patch whitespace pass |
| 2026-07-17 | Card-list action ordering | pass | The shared Card Contents Editor now places Add another card above the existing card summaries; behavior and touch-target styling are unchanged |
| 2026-07-17 | Gift amount and quantity input UX | pass | Gift forces the Purchase amount to a read-only £0; Records quantity inputs select their current value on focus so a typed number replaces the default immediately; TypeScript, lint, and patch whitespace pass |

## Feedback and implementation notes

- UI guidance: retain the established burgundy/zinc visual language; use touch-first
  controls, progressive disclosure, explicit labels/errors, and deep routes. A
  generic blue/newsletter-style recommendation was rejected as inconsistent with
  the product and existing UI.
- Feedback classification: multi-page form request is a Product/UX change. Applied
  to P1.3 because it improves progressive disclosure without changing domain
  behavior or backend scope. Recommendation: use steps for meaningful decisions,
  not one-field-per-page fragmentation.
- Feedback classification: the 2026-07-17 purchase feedback is a Product/UX and
  contract correction. Recommendation: make type choice repeatable per line so
  the clearer step does not remove mixed purchases; use a real Review state and
  explicit Confirm action. P1.3 is reopened and P1.5 returned to review.
- Feedback classification: the later 2026-07-17 Purchase and Pack Opening field
  specification is a Product/UX and input-contract replacement. It explicitly
  replaces the prior mixed-purchase recommendation. P1.3 is reopened, P1.5
  returns to review, and implementation is paused while the linked subplan's
  domain decisions are resolved one at a time.
- Feedback classification: Bulk partial itemization and user-triggered metadata
  fetching are clarified product decisions. Bulk remains updateable without
  duplicate spend, while dependency checks protect later history. `Fetch
  details` owns idle/loading/resolved/error/stale states and populates visible
  fields instead of silently replacing them.
- Feedback classification: editable fetched fields are a clarification of the
  metadata UX. Auto-filled versus manually edited provenance remains visible,
  and re-fetch requires confirmation before replacing a correction.
- Feedback classification: Pack Opening provenance is resolved as
  match-or-explain. A Gift is zero-cost; Old collection/Other remains
  unknown-cost and is excluded from known-spend totals rather than falsely
  recorded as £0. Remaining low-risk flow choices use the recommendations in the
  approved subplan after the user requested uninterrupted implementation.
- Feedback classification: the latest sealed/source/review/error request is a
  Product/UX correction that replaces visible provenance and sealed metadata
  fields. Recommendation applied with one terminology correction: use
  `Unlimited Edition`, not `Second Edition`, because that is the actual
  TCGplayer/Yu-Gi-Oh printing label. Automatic exact-link matching preserves
  coherent inventory without exposing its mechanics. P1.3d–P1.3f return to
  review and P1.3g becomes the single active item.
- Feedback classification: the additional Dark Paladin, Right Leg of the
  Forbidden One, and Big Shield Gardna links are a resolver correction under
  P1.3, not a new product behavior. The correction must generalize across
  marketplace/catalog naming differences and repeated card-name occurrences;
  product-ID exceptions would hide rather than fix the reliability defect.
- Implementation detail: printing resolution now scores every occurrence of the
  card name against set text on both sides, tolerates meaningful marketplace
  prefixes/suffixes, normalizes possessive apostrophes, and uses a URL rarity
  suffix to disambiguate otherwise identical set matches.
- Feedback classification: the Gorz/Slifer report is both a UI-state correction
  and a resolver-source correction. A changed link must never inherit fields
  from its predecessor; exact marketplace product details are preferred because
  the fallback catalogue does not contain every valid printing, including
  `GBI-001`. Same-link edit protection remains intact.
- Implementation detail: the TCGplayer product ID already required in the form
  is sent to TCGplayer's unauthenticated marketplace detail endpoint. Failure is
  non-blocking because the generalized slug/YGOPRODeck matcher remains the
  fallback; no developer key or per-product mapping was added.
- Implementation detail: a development-only `NEXT_PUBLIC_RECORDS_UI_PREVIEW=1`
  flag permits local visual review without credentials. It is ignored in
  production; normal Records routes remain authenticated.
- Implementation detail: the All-in amount paid currency prefix is optically
  centred with a non-interactive full-height flex overlay; form behaviour and
  the approved product contract are unchanged.
- Implementation detail: the shared Rarity combobox accepts an inline label
  suffix so its Auto-filled/Edited indicator appears beside the label rather
  than below the input; field behaviour is unchanged.
- Implementation detail: the shared Card Contents Editor places its add action
  before existing card summaries so the action precedes the content it creates;
  add/edit/remove behaviour is unchanged.
- Feedback classification: Gift amount behavior is a product/UX correction and
  quantity replacement is a form interaction correction under P1.3. Gift is
  enforced as zero-cost in both the visible field and submitted preview data;
  quantity validation and stored values are otherwise unchanged.
- Worktree update: after G1 scaffold completion, the temporary checkout was
  removed and `agent/collection-records` was switched into the primary project
  directory at the user's request. The uncommitted Stardust modelling experiment
  and its redundant local branch pointer were subsequently deleted at the user's
  request, leaving one clean feature worktree.

## G1 known scaffold limitations

- Record changes are intentionally tab-scoped preview data and disappear on
  reset/closed tab; existing Library rows are only read.
- Sample entities make every workflow walkable when a review browser has no
  authenticated session. Signed-in use additionally maps current Library cards.
- Legacy rows do not contain exact edition/set/cost/product facts; the scaffold
  labels these for attention instead of inventing them.
- No schema, migration, tRPC mutation adapter, production auth behavior change,
  or `/spend` redirect has been implemented. Those remain behind G1/G2/G3.
