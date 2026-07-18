# Library and Records implementation progress

Last updated: 2026-07-17

## Emergency bulk-purchase recovery verification — 2026-07-18

- The saved browser draft in `bulk.json` was validated without modifying it:
  171 individual card entries, 207 physical cards, no incomplete card identity,
  and £5.16 (516p) total.
- Before any recovery write, its exact History identity (name, date, owner, and
  eBay listing URL) was checked. The normal purchase transaction had already
  completed despite the expired browser authentication state.
- Verified persisted result: active Purchase `record-62f3a54d-d51e-47be-94dd-e0d7a5cb400f`,
  171 card lines, 207 line quantity, 207 Copies, and one itemized 207/207 Bulk
  Lot at 516p. No duplicate Record, Target, Printing, or Copy was created.
- Added `scripts/recover-bulk-purchase.mjs` as a guarded recovery tool for a
  future saved Bulk draft: it validates exact quantity preservation, dry-runs by
  default, refuses a matching existing Record, and applies all entities within
  one transaction only when passed `--apply`.
- Release verification found and corrected one straightforward live-adapter
  wiring defect before commit: the new `library` tRPC namespace was registered
  alongside the existing compatibility `cards` namespace. The live Inventory
  delete mutation now type-checks; domain tests, lint, and the production build
  pass.

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
| P1.2 | review | Records shell | Compact Overview, filtered/paginated History, explicit type treatments/aligned card imagery, dependency-safe Record/item editing, and Inventory card provenance/source editing await renewed G1 review |
| P1.3 | review | Entry workflows | Required Purchase/Opening Record names, optional generated Sale names, required defaulted Card edition, and revised consistent Single/Bulk Sale selection await renewed G1 review |
| P1.4 | done | Library and global integration | Library rename, global Add, prefilled acquisition, removal of one-click ownership toggle; `/spend` preserved |
| P1.5 | review | Scaffold verification | Static checks, isolated production build, desktop Inventory walkthrough, and exact 375px Inventory/source-editor checks pass; full scaffold remains at G1 review |
| G1 | done | Scaffold review | User approved moving forward after the complete UI scaffold review cycle |
| P2.0 | done | Contract reconciliation | Audited plan, scaffold, preview reducers, and persistence shape; stale operations removed and exact Bulk total-card denominator restored |
| P2.1 | done | Persistent owner-scoped model | Additive Targets, Printings, Copies, Records/Lines, Sale history links, Sealed Units, Bulk Lots, Supplies, and legacy mapping defined without applying database changes |
| P2.2 | done | Transactional Records router | Owner-scoped snapshot plus create/edit/void/restore transactions, historical dependency checks, deterministic Bulk allocation, and revisions compile |
| P2.3 | done | Live data-source adapter | Authenticated live adapter and preview adapter satisfy one asynchronous contract; drafts recover from session storage and live mutations refetch one snapshot |
| P2.4 | done | Existing feature integration | Library, Binder, Wheel, chase/highlights, auth, public/private behavior, and spend transition all use Target/Printing/Copy; legacy live writes are not exposed |
| P2.5 | done | V2 integrity verification | Shared allocation/status tests, TypeScript, lint, owner/dependency audit, migration syntax, and isolated production build pass |
| P3.1 | blocked | Migration and hardening | Blocked by completed P2/V2 and separate migration approval |
| G3 | review | Migration approval | Dry-run reviewed: 1,146 legacy rows project to 1,126 Targets and 55 Imported Acquisitions/Copies; explicit user approval is still required before schema/import |
| G4 | blocked | Final site review | Required before deployment or landing on `main` |

## Current update

- Completed: the additive persistent model, transactional Records router, live
  adapter, Library/Binder/Wheel/chase/highlight integrations, `/spend` transition,
  migration dry-run/apply script, and V2 verification. Library status is derived
  from available Copies; acquisition and Sale Records mutate those same Copies.
- Current: G3 migration approval. No schema, migration, or production-affecting
  database command has been run.
- Next: the user runs `npm run records:migrate:dry-run` and shares the JSON report.
  Review that report before proposing the separately gated schema/import commands.
- Reviewable UI:
  - `/` — Library rename, target-only add language, global Add, per-card Record
    acquisition/View copies paths for signed-in users.
  - `/records` — compact period/custom-date cashflow controls,
    cost/proceeds/cash position, current Physical copies, recent history,
    attention list, reset; the
    global Add menu is the only event-entry menu.
  - `/records/history` — search/type/status filtering, pagination, explicit
    blue Purchase/green Sale labels, single-card or capped three-card image
    stacks, a two-panel Edit dialog for Record details and individual items,
    exact-Copy Sale selection, and dependency-aware mutation/void/restore.
  - `/records/inventory` — Cards (search, pagination, provenance/source editing),
    Sealed, Bulk, Supplies.
  - `/records/new/purchase` — type-first Single Card, Sealed Product, Bulk Lot,
    and Supply/Extra branches; purchase details; explicit metadata fetch;
    read-only Review and Confirm.
  - `/records/new/opening` — link-first opened product, existing-unit match or
    Gift/Old collection/Other provenance, shared pulled-card editor, read-only
    Review and Confirm.
  - `/records/new/sale` — four-step Single/Bulk exact-copy Sale with thumbnail
    search, rarity and Selected-only filters, pagination, Review, and Confirm.
  - `/spend` — intentionally preserved for comparison.
- Checks: TypeScript, lint, patch whitespace, migration-script syntax, four
  focused domain tests, owner/dependency inspection, and an isolated webpack
  production build pass. Browser walkthroughs covered Purchase Other-source/listing input,
  sealed-product fetch/loading, Opening inventory match, pulled-card
  name/rarity/set/code resolution, add/collapse/remove cards, Review boundaries,
  explicit confirmation, keyboard focus, and 375px no-overflow/touch sizing. All
  eight user-supplied metadata fixtures resolve the exact expected name, rarity,
  and set code. The Gorz and Slifer requests also pass through the running local
  Next.js metadata route. Additional probes cover repeated card names inside a
  set slug, apostrophes, and same-set rarity disambiguation. The P1.3i desktop
  pass covers Single/Bulk/Pull edition defaults, sealed-product edition
  resolution, Single/Bulk selection progress, neutral Library impact, card-tile
  selection, dark-mode contrast, and browser-console review.
  Inventory walkthroughs cover Single Purchase, Bulk Purchase, Pack Opening,
  later Sale provenance, exact source-line expansion, dependency-blocked delete
  recovery, dark mode, keyboard focus, 375px no-overflow, and 44px touch targets.
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
  Sale now distinguishes one-Copy Single from multi-Copy Bulk, without treating
  an unitemized Bulk Lot as a sellable card selection.
  New acquired cards require edition and default to `1st Edition`; Sale impact
  is explanatory information rather than an error-looking Wishlist warning.
  Bulk Lot cost allocation is required: a fixed total-card count is the
  denominator, each itemized Copy receives its predetermined share, and later
  inline entry editing never rebases earlier allocations.
  Purchase and Opening now require a short History-facing Record name; Sale may
  use one but otherwise generates a compact selected-card title.
  Inventory now uses computed `Owned` and `Wishlist` identifiers. A partially
  collected target remains `Wishlist` with explicit wanted, owned, and remaining
  quantities; Satisfied/Open are removed from the domain language rather than
  being replaced only in presentation copy.
  Inventory card editing is source-routed: the card dialog explains provenance,
  while mutations open and update the originating Record and relevant card line.
  No parallel Inventory-only card mutation is added.
- Blockers: schema creation and data import remain blocked by G3. The live
  Target/Printing/Copy routes cannot be exercised against real data until that
  schema exists; the approved preview adapter remains available meanwhile.

- Single-dataset invariant: after G3 cutover, Library, Records, Binder, Wheel,
  chase, and highlights all use Target/Printing/Copy. The legacy `cards` table
  is migration input only; no permanent dual writes are allowed.
  A Wishlist-only edit changes Target intent and creates no fictional history;
  any ownership change must be an acquisition/Sale Record operating on the same
  Copies shown by Library and Inventory.

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
| 2026-07-17 | P1.3h TypeScript, lint, and patch whitespace | pass | The four-stage Sale, extracted component, image grid, filters, Review boundary, and draft reset compile without errors or lint warnings |
| 2026-07-17 | P1.3h desktop Sale review | pass | Bulk requires two Copies; search and Selected-only preserve selection; Review creates no record; Confirm creates the preview Sale; thumbnails and target-reopening warnings are visible |
| 2026-07-17 | P1.3h Single Sale review | pass | Single uses radio semantics and replacing the selection leaves exactly one physical Copy selected |
| 2026-07-17 | P1.3h phone Sale review | pass | 375×812 picker and Review have no horizontal overflow; the two-column thumbnail grid, filters, progress, and actions remain usable |
| 2026-07-17 | P1.3h production build | not run | The isolated runner rejected the temporary build command before it started; no project or dev-server state changed, and the previous full scaffold production build remains green |
| 2026-07-17 | P1.3h development server cleanup | pass | The isolated port-3100 review server stopped; the user's existing port-3000 server remained untouched |
| 2026-07-17 | P1.3i TypeScript, lint, and patch whitespace | pass | Required Card edition, draft-version resets, edition-aware preview matching, revised Sale feedback, and image loading compile without errors or warnings |
| 2026-07-17 | P1.3i Single/Bulk/Pull edition review | pass | Single Purchase, the shared Bulk card editor, and Pack Opening pulls visibly default Card edition to 1st Edition; sealed Opening still resolves Unlimited Edition from its product link |
| 2026-07-17 | P1.3i Single/Bulk Sale desktop review | pass | Both modes use the same filters, tiles, markers, progress, and Review path; one-copy Bulk shows one more required with disabled Continue, while completed selections enable Continue |
| 2026-07-17 | P1.3i Library impact and theme review | pass | The warning-looking Wishlist message is replaced by neutral current/after owned counts and wanted quantity; ready and selected states remain legible in dark mode |
| 2026-07-17 | P1.3i browser console | review | Purchase, Bulk Purchase, and Opening had no warnings/errors; Sale emitted an LCP warning during the walkthrough, so the first visible grid row now loads eagerly while later images remain lazy; browser confirmation is pending under P1.5 |
| 2026-07-17 | P1.3i exact 375px review | not run | The in-app browser viewport override did not change the active 1280px viewport; previous 375px scaffold checks remain green, but this refinement is not falsely marked as rechecked |
| 2026-07-17 | P1.3i production build | not run | The earlier isolated build runner rejection remains in effect; TypeScript, lint, live route compilation, and desktop browser behavior pass |
| 2026-07-17 | P1.3i development server cleanup | pass | The isolated port-3100 review server stopped; the user's existing port-3000 server remained untouched |
| 2026-07-17 | P1.3i Bulk-to-Single correction | pass | TypeScript, lint, and patch whitespace pass. A one-Copy Bulk selection now identifies the two-Copy minimum and offers an in-place Single switch that preserves the selected Copy; Library impact remains informational only |
| 2026-07-17 | Removed Adjustment and Bulk Itemization scaffold routes | pass | Next route type generation, TypeScript, lint, and patch whitespace pass. The two pages, forms, Add-menu entries, Inventory CTA, and stale Bulk Purchase continuation prompt are removed |
| 2026-07-17 | Record names and generated Sale titles | pass | Next route types, TypeScript, lint, and patch whitespace pass. Purchase and Opening require a short identifying History title; Sale previews a compact selected-card fallback only when its optional name is blank |
| 2026-07-17 | Compact Overview controls and History editor | review | Next route types, TypeScript, lint, and patch whitespace pass. Period controls now use a compact segmented row; Physical copies remains current-state. History has pagination plus safe type-aware detail/cashflow editing and Void/Restore. Isolated visual review remains blocked at the private sign-in gate |
| 2026-07-17 | Individual Record item CRUD | review | Route types, TypeScript, lint, patch whitespace, focused reducer checks, and an isolated webpack production build pass. The Items tab supports shared card editing for acquisitions/openings, exact-Copy Sale editing, sealed/supply fields, and transactional dependency blocks; signed-in visual G1 review remains outstanding |
| 2026-07-17 | Owned/Wishlist terminology | pass | Computed domain status helper, Inventory identifiers, preview wording, CONTEXT, ADR, main plan, and entry-flow language updated; route types, TypeScript, lint, UX guidance review, and patch whitespace pass |
| 2026-07-17 | Inventory provenance and source editing | pass | Card targets open a responsive Copy/source dialog; Purchase, Bulk Purchase, Pack Opening, and later Sale provenance are visible; editing opens the exact source Record/card line without nested modals; unsafe removal restores the draft and explains the dependency. Route types, TypeScript, lint, UX guidance, patch whitespace, isolated webpack production build, desktop/dark-mode walkthrough, and exact 375px overflow/touch checks pass |
| 2026-07-17 | History type treatments and card imagery | pass | Next route type generation, TypeScript, lint, patch whitespace, UX accessibility/performance review, and isolated webpack production build pass. Purchase is explicit blue, Sale explicit green; card-backed rows show one thumbnail or a maximum three-card lazy overlapping stack |
| 2026-07-17 | History fixed visual lead column | pass | Next route type generation, TypeScript, lint, patch whitespace, UX validation, and isolated webpack production build pass. Every row reserves the same 96px visual lead column; cards use their existing thumbnail/stack and non-card records use a subdued generic marker |
| 2026-07-17 | P2 single-dataset integration audit | pass | Library status, Binder, Wheel, chase, highlights, and Records all use Target/Printing/Copy. The exposed legacy router is read-only preview/migration input; direct ownership mutation rejects and visible Library/Wheel acquisition actions enter Records |
| 2026-07-17 | P2 domain tests | pass | `npm run test:records`: fixed-denominator Bulk allocation, exact penny reconciliation, stable later-itemization indexes, and Copy-derived Owned/Wishlist status; 4/4 pass |
| 2026-07-17 | P2 TypeScript, lint, and patch whitespace | pass | Live routers, adapters, Target consumers, attention items, explicit legacy Unknown edition handling, and migration preparation pass without code errors or lint warnings |
| 2026-07-17 | P2 migration script audit | pass | Script syntax passes; dry-run remains read-only and reports merged groups, ownerless rows, unknown cost/link metadata, and Binder/Wheel collisions. The script has not connected to or changed the database |
| 2026-07-17 | P2 isolated production build | pass | Webpack build compiled all 17 routes from a temporary copy without touching the active `.next`; only expected Better Auth warnings appeared because verification credentials were intentionally omitted |
| 2026-07-17 | G3 user-run migration dry-run | review | 1,146 legacy rows, 1 owner, 1,091 Wishlist rows, 55 Owned rows; 1,126 projected Targets, 55 Imported Acquisition Records/Copies, 11 merged Target groups, 177 Binder slots, 1,104 Wheel entries, 3 favourites. Seven imported costs and five rarities need attention; no TCGplayer links are missing. Six Binder and ten Wheel duplicate Target entries resolve deterministically during migration |
| 2026-07-17 | G3 dry-run script warning correction | pass | Legacy reads are now sequential on one pg client, eliminating the pg@9 concurrent-query deprecation without changing report contents or writing data; syntax, TypeScript, lint, and whitespace checks pass |
| 2026-07-17 | G3 schema apply and interrupted import | review | User applied the additive schema. Import stopped inside its transaction on an out-of-range legacy timestamp; a read-only count confirmed the rollback left 0 Targets, 0 Records, and 0 Copies. The importer now normalizes invalid legacy timestamps, reports their count, and notes any imported acquisition whose date falls back to today |

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
- Feedback classification: the Sale request is a product/UX and workflow
  replacement under P1.3. Recommendation applied: `Bulk sale` means two or more
  already-tracked card Copies in one Sale; selling sealed products, unitemized
  Bulk Lots, and supplies remains deferred. P1.3h is active and P1.5 returns to
  review until the new flow is verified.
- Feedback classification: required Card edition is a product/data correction
  because edition participates in target identity. The Sale screenshot is a UX
  clarity correction: the consequence is valid, but target-reopening language
  exposes implementation mechanics and the amber treatment looks like an error.
  P1.3i reopens P1.3 and P1.5 for shared-editor and Sale verification.
- Feedback classification: the apparent blocked Bulk sale is an interaction
  clarity correction, not a Wishlist rule. Bulk still requires two or more
  Copies; when exactly one is selected, the form now explains that requirement
  and offers a direct switch to Single sale without dropping the selection.
- Feedback classification: Bulk allocation is a product/accounting correction.
  Recommendation accepted: require the lot's exact total-card count and divide
  its all-in cost across that stable denominator, rather than the temporarily
  identified subset. This reopens Bulk Purchase, future inline-entry editing,
  and the Phase 2 allocation model; no backend or preview-model change is made
  before renewed G1 review and explicit backend approval.
- Feedback classification: removing Adjustment and standalone Bulk Itemization
  is a product/navigation replacement. Both pages, forms, Add-menu choices, and
  Inventory itemization CTA are removed. Inline editing of the original Record
  Entry is explicitly deferred; it is not falsely represented as implemented.
- Feedback classification: Record names are a product/UX correction. Purchase
  and Opening must be intentionally named; Sale remains fast by generating a
  compact selected-card title only if its optional name is blank. P1.3 and P1.5
  return to review for field, Review-summary, and History-title verification.
- Feedback classification: removing duplicated Overview event shortcuts and
  adding period context/pagination are a product/UX improvement. The global Add
  menu remains the single event-entry point; the selected period filters cash
  metrics, while Physical copies and Wishlist targets remain current-state
  details.
- Feedback classification: a type-aware History editor is a Product/UX change.
  The initial header-only editor was superseded by reviewed item-level CRUD.
  Record details and Items are separated into tabs; card acquisition/opening
  reuses the existing card editor, Sales select exact Copies, and destructive
  mutations are blocked when they contradict later history. Void/Restore remains
  the correct action for a Record's last subject.
- Feedback classification: Owned/Wishlist is a terminology correction with a
  domain consequence. The identifiers are computed from desired and available
  Copy quantities, so clearer language does not reintroduce the rejected
  combined status model. Partial targets remain Wishlist and show their exact
  wanted, owned, and remaining quantities.
- Feedback classification: clickable Inventory cards with visible provenance
  and editing are a Product/UX change. Recommendation applied: Inventory opens a
  source-aware view but does not own a separate edit mutation; editing replaces
  that dialog with the originating Record editor at the relevant card line so
  Bulk Purchase, Single Purchase, Pack Opening, and imported history remain the
  authoritative source.
- Feedback classification: History row colour and imagery are a Product/UX
  refinement. Purchase and Sale retain their explicit labels so colour is never
  the only signal; linked card images are lazy, bounded to three, and overlap
  only for multi-card entries to preserve the ledger's compact scanability.
- Feedback classification: the History alignment request is a Product/UX
  refinement. A grid was considered but rejected because chronological
  comparison of date, source, amount, and actions is the primary History job.
  The user approved the fixed visual lead-column alternative: card imagery and
  non-card markers occupy the same reserved width, keeping every text block
  aligned without pretending all Records are cards.
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

## Collection reset evidence — 2026-07-17

At the user's explicit request, the collection data was cleared in one
transaction after the migration was applied. This reset removed legacy cards,
unified Targets/Printings/Copies, Record Entries and Lines, Bulk Lots, Binder,
Wheel, favourites/highlights, and migration links. It preserved the schema,
authentication tables, the signed-in user, and the exported card JSON backup.

Before → after counts:

- `cards`: 1,146 → 0
- `card_targets`: 1,137 → 0
- `card_printings`: 1,157 → 0
- `card_copies`: 70 → 0
- `record_entries`: 56 → 0
- `record_lines`: 67 → 0
- `bulk_lots`: 1 → 0
- `binder_slots`: 187 → 0
- `wheel_entries`: 1,123 → 0
- `monthly_favorites`: 3 → 0
- all target/migration-link tables: 0 after reset

The `users` count remained 1; sessions/accounts/auth rate-limit rows were not
modified. The reset script also verified every collection table was empty after
commit.

## Combined card Wishlist import evidence — 2026-07-17

The exported `yugioh-combined-card-data.json` was imported into the unified
Wishlist model with no legacy `cards` rows or fictional acquisition Records.
Each distinct normalized card name + rarity + edition received a Wishlist
Target with desired quantity 1, and each distinct TCGplayer product received a
nested Card Printing. Product IDs provide deterministic TCGplayer CDN image
URLs; set, set code, rarity, card URL, release-date note, and image metadata are
retained where present.

- Source rows: 1,146
- Wishlist Targets created: 1,123 (duplicate identity rows intentionally merge)
- Card Printings created: 1,142 (four exact duplicate product URLs collapse)
- Default edition: `1st Edition`
- Edition overrides detected from source links: none

TCGplayer's public product-details response exposes product, set, number, and
rarity fields but does not expose a reliable edition field for these products.
Edition therefore remains the explicit 1st-edition default unless a link slug
clearly identifies another edition; the importer supports Limited and Unlimited
Edition when such a signal is present.

## Library integration refinements — 2026-07-17

- Acquisition integration verified: Purchases, Bulk-card itemization, and Pack
  Openings resolve the same Target identity (name + rarity + edition), create
  available Copies, and derive Library status from wanted versus available
  quantity. A one-copy Wishlist Target therefore becomes Owned immediately;
  future higher desired quantities remain Wishlist until fulfilled.
- Card-type filtering was a data-completeness defect, not a filtering-rule
  defect. `wishlist:backfill-types` fetched the YGOPRODeck catalogue once and
  populated `card_targets.card_type` for all 1,123 imported Targets (0
  unmatched).
- Library card actions were simplified after UX review. Record acquisition and
  copy management remain in the global Add/Records flows; each card retains
  only contextual TCGplayer/eBay links, and its accessible name button opens
  Target editing. Delete remains behind the editor and its existing confirmation
  dialog, avoiding a destructive control on every card tile.
- The legacy `price:ebay` script remains SQLite/legacy-card-only and must not
  be run against this unified PostgreSQL Library. It does not update current
  Targets. The in-app refresh updates current Target estimates but does not yet
  implement the requested distinct sold-vs-for-sale pricing strategy.

## Pricing and Target metadata refinement — 2026-07-17

- The Library `Refresh estimates` control now uses the unified Target refresh
  mutation with cached eBay OAuth credentials, retry/backoff for rate-limit or
  server failures, and a small paced batch interval. It updates
  `card_targets.estimated_price_pence` and its eBay search link, then reports
  a success/failure summary in the interface.
- The current public eBay Browse API can provide current, purchasable UK
  listings; it cannot supply the desired completed-sale history. eBay documents
  its Marketplace Insights API (the sold-listing API) as restricted to new
  users, so Owned-card sold estimates remain intentionally unimplemented rather
  than silently substituting active-listing prices.
- Add Target now mirrors the Record acquisition metadata interaction: changing
  and fetching a TCGplayer link clears stale card fields, shows a loading state,
  then fills title, rarity, edition, image, and a set summary for review before
  saving. The server remains the final source of truth and fetches the linked
  Printing metadata again on save.
- Price-refresh UX now processes Targets independently in two-card batches from
  the Library client. Its minimisable progress tray reports checked/total,
  estimated, no-usable-listing, and individual failures. A run only halts for a
  systemic failure (six consecutive request failures or inability to load the
  candidate list), which uses a destructive toast; a bad individual listing
  never aborts the rest of the Library.

## Wishlist card lookup in acquisition forms — 2026-07-17

- The shared card identity editor now offers a keyboard-accessible optional
  Wishlist lookup for a typed card name. It is used unchanged by a single-card
  Purchase, a card added to a Bulk Purchase, and a Pack Opening pull.
- Matches are exact Printing choices, displayed as `name · rarity · edition ·
  set name`, so a Target with multiple printings does not lose its set-specific
  identity. Choosing one fills the known card name, rarity, edition, set name,
  set code, TCGplayer product URL, and image. The link remains editable and can
  still be re-fetched as the authoritative external source.
- The lookup reads the active Records snapshot in both preview and live modes;
  it creates no parallel catalogue or duplicate data path. It opens after two
  typed characters, limits the list to six matches, supports arrow keys,
  Enter, Escape, focus handling, and 44px minimum options.
- Verification: `npm run lint` and `npm run build` both passed after this
  change.

## Inventory removal and selected-Target corrections — 2026-07-18

- Inventory now exposes a per-physical-Copy `Remove` action in the card detail
  dialog. It requires confirmation, updates the original source Record, and
  preserves recoverability: removing the only card in an acquisition Record
  voids that Record rather than destroying its cash-history row. Sold Copies
  remain protected until their Sale is edited; voided source Records must be
  restored first. A Pack Opening may retain its historical opening after its
  final tracked pull is removed.
- Selecting a Wishlist card in an acquisition autocomplete now retains the
  selected Target identity through submit. Correcting its edition in the form
  updates that Target and its identity rather than creating a second Target.
  The new Copy then fulfils its existing desired quantity, making the card
  Owned through the normal calculated status. `desiredQuantity` is intentionally
  not decremented: it remains the collection goal, while available Copies
  satisfy it.
- If an identical corrected Target already exists, the save is blocked with a
  specific message rather than silently merging targets, copies, highlights, or
  history. This prevents accidental data loss and leaves a deliberate merge UX
  as future scoped work.
- Verification: `npm run lint` and `npm run build` passed after this change.

## Browser autofill false-positive prevention — 2026-07-18

- Purchase, Pack Opening, and Sale forms now opt out of browser autofill, and
  the TCGplayer-link and collectible-name fields repeat that explicit setting.
  This prevents Chromium browsers from misclassifying collectible-card name,
  printing, and code fields as an identity-card form and showing a misleading
  "Save ID card" browser prompt after recording an item.
- This is a browser-owned prompt, so an individual browser may still offer a
  user-controlled autofill feature in the future; the application no longer
  supplies the form semantics that triggered this false positive.
- Verification: `npm run lint` and `npm run build` passed after this change.

## Clear Wishlist versus physical-Copy removal — 2026-07-18

- Inventory cards with no physical Copies now say `View Wishlist Target` rather
  than `View copies and sources`. Their detail dialog offers a confirmed
  `Remove from Wishlist` action, which removes the Target and nested Printing
  metadata only when there is no Copy history.
- Owned cards continue to use the per-physical-Copy `Remove` action in the
  same dialog. This makes the two destructive actions explicit rather than
  presenting a misleading deletion control on every card tile.
- The Records data-source contract now exposes target deletion in both preview
  and live adapters; the live adapter uses the existing owner-scoped Library
  deletion safeguard and refreshes the shared Records snapshot afterwards.
- Verification: `npm run lint` and `npm run build` passed after this change.

## Inventory filtering, purchase value, and Stardust cleanup — 2026-07-18

- Inventory Cards now has the same high-value discovery controls as Library:
  All/Wishlist/Owned status selection, name search, plus compact rarity and
  edition filters. These operate on the shared Target/Copy snapshot and reset
  pagination when changed.
- Owned cards show their recorded purchase value both on the card tile and in
  the detail dialog. The figure sums actual allocated acquisition costs for
  available Copies; a card obtained from an unallocated Pack Opening clearly
  displays `Unknown` rather than a misleading £0.
- At the user's explicit request, the erroneous `Stardust Dragon · Quarter
  Century Secret Rare` data was permanently removed from the development
  database. The deleted scope was verified first: one Limited Edition Target,
  one Printing, one available Copy, and its one-item Purchase (`Stardust Dragon
  QCSR`), with no unrelated line items. A final read-only check confirmed zero
  matching Targets and zero matching records remain.
- Verification: `npm run lint` and `npm run build` passed after the Inventory
  UI changes.

## Bulk card-editor action placement — 2026-07-18

- `Done with this card` moved from below the final quantity field into the
  active card editor's sticky header. It remains visible while working through
  fetched card metadata in a long Bulk Purchase or Pack Opening. The duplicate
  bottom action was removed; the header keeps the 44px action and visible focus
  treatment, with Remove beside it when that is allowed.
- Verification: `npm run lint` and `npm run build` passed after this change.

## New-card placement in progressive card entry — 2026-07-18

- Adding a card to a Bulk Purchase or Pack Opening now prepends its active form
  directly below the Add another card area. Previously completed card summaries
  remain below it, removing the growing-scroll penalty from entering several
  cards. Record line order is not a product-level ordering concept, so this
  presentation order does not change the meaning of the saved Record.
- Verification: `npm run lint` and `npm run build` passed after this change.
