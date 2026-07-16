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
| P1.3 | done | Entry workflows | Purchase is now a four-stage flow with visual item-type selection, source/listing metadata, optional TCGplayer links, a mixed-item loop, and explicit review confirmation; opening, sale, adjustment, and bulk-itemization remain walkable |
| P1.4 | done | Library and global integration | Library rename, global Add, prefilled acquisition, removal of one-click ownership toggle; `/spend` preserved |
| P1.5 | done | Scaffold verification | Revised purchase flow passed TypeScript, lint, production build, desktop and phone browser review, responsive overflow, reduced-motion, and explicit-confirmation checks |
| G1 | review | Scaffold review | User reviews all listed UI before backend work starts |
| P2.1 | blocked | Real model and integration | Blocked by G1 |
| G2 | blocked | Backend approval | Blocked by P2.1 |
| P3.1 | blocked | Migration and hardening | Blocked by G2 and separate migration approval |
| G3 | blocked | Migration approval | Dry-run must be reviewed before apply |
| G4 | blocked | Final site review | Required before deployment or landing on `main` |

## Current update

- Completed: P1.1 through P1.5. Purchase now uses four progressive stages and
  requires explicit confirmation from its Review page.
- Current: G1 Scaffold review.
- Next: review the remaining entry flows and the revised Purchase flow. Begin
  Phase 2 only after explicit G1 approval.
- Reviewable UI:
  - `/` — Library rename, target-only add language, global Add, per-card Record
    acquisition/View copies paths for signed-in users.
  - `/records` — Overview, cost/proceeds/cash position, quick tasks, recent
    history, attention list, reset.
  - `/records/history` — search/type/status filtering and dependency-aware
    void/restore.
  - `/records/inventory` — Cards (search and pagination), Sealed, Bulk, Supplies.
  - `/records/new/purchase` — four-stage mixed-item purchase with optional listing
    and TCGplayer links, controlled source entry, visual type selection, editable
    review, and explicit confirmation.
  - `/records/new/opening` — three-step sealed-product-to-pulls flow.
  - `/records/new/sale` — two-step exact-copy sale with target-reopening warning.
  - `/records/new/adjustment` — reasoned add/remove correction flow.
  - `/records/new/bulk-itemization` — existing-lot itemization with explicit £0
    new spend.
  - `/spend` — intentionally preserved for comparison.
- Checks: TypeScript, lint, production build, patch whitespace, desktop and phone
  purchase walkthroughs, responsive overflow, reduced-motion behavior, explicit
  confirmation, mixed-item looping, and development server cleanup pass.
- Changed decisions: Purchase now has a dedicated visual item-type stage,
  optional purchase and TCGplayer URLs, a controlled source field with custom
  `Other`, and an explicit non-mutating Review/Confirm boundary. Optional links
  replace the earlier future requirement for mandatory TCGplayer URLs.
- Blockers: Phase 2 is intentionally blocked by G1 review.

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
- Implementation detail: a development-only `NEXT_PUBLIC_RECORDS_UI_PREVIEW=1`
  flag permits local visual review without credentials. It is ignored in
  production; normal Records routes remain authenticated.
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
