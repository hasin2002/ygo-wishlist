# Library and Records implementation progress

Last updated: 2026-07-16

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
| P0.1 | done | Clean feature branch and durable docs | `agent/collection-records` is now checked out in the primary project directory; Stardust files remain unrelated, uncommitted, and excluded; plan, progress, context, ADR created |
| P1.1 | done | Preview contract and session state | Typed `RecordsDataSource`, legacy mapping, preview fixtures and resettable session state compile |
| P1.2 | done | Records shell | Overview, History, Inventory routes and responsive navigation compile |
| P1.3 | done | Entry workflows | Progressive Purchase, opening, sale, adjustment, and bulk itemization; drafts and preview submission verified |
| P1.4 | done | Library and global integration | Library rename, global Add, prefilled acquisition, removal of one-click ownership toggle; `/spend` preserved |
| P1.5 | done | Scaffold verification | Lint/build pass; desktop, phone, dark mode and interactions reviewed; dev server stopped |
| G1 | review | Scaffold review | User reviews all listed UI before backend work starts |
| P2.1 | blocked | Real model and integration | Blocked by G1 |
| G2 | blocked | Backend approval | Blocked by P2.1 |
| P3.1 | blocked | Migration and hardening | Blocked by G2 and separate migration approval |
| G3 | blocked | Migration approval | Dry-run must be reviewed before apply |
| G4 | blocked | Final site review | Required before deployment or landing on `main` |

## Current update

- Completed: Phase 1 scaffold P1.1–P1.5.
- Current: G1 Scaffold review.
- Next: collect UI/UX feedback; update the durable plan; begin Phase 2 only after
  explicit G1 approval.
- Reviewable UI:
  - `/` — Library rename, target-only add language, global Add, per-card Record
    acquisition/View copies paths for signed-in users.
  - `/records` — Overview, cost/proceeds/cash position, quick tasks, recent
    history, attention list, reset.
  - `/records/history` — search/type/status filtering and dependency-aware
    void/restore.
  - `/records/inventory` — Cards (search and pagination), Sealed, Bulk, Supplies.
  - `/records/new/purchase` — mixed-item three-step purchase with allocation
    guardrails and Library prefill.
  - `/records/new/opening` — three-step sealed-product-to-pulls flow.
  - `/records/new/sale` — two-step exact-copy sale with target-reopening warning.
  - `/records/new/adjustment` — reasoned add/remove correction flow.
  - `/records/new/bulk-itemization` — existing-lot itemization with explicit £0
    new spend.
  - `/spend` — intentionally preserved for comparison.
- Checks: lint, TypeScript, and production build pass. Browser review passed at
  1280×720 and 390×844 with no horizontal overflow; current browser console was
  clean after fixing the preview hydration boundary.
- Changed decisions: entry pages now use short multi-step flows with subtle,
  reduced-motion-safe transitions instead of showing all sections at once.
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

## Feedback and implementation notes

- UI guidance: retain the established burgundy/zinc visual language; use touch-first
  controls, progressive disclosure, explicit labels/errors, and deep routes. A
  generic blue/newsletter-style recommendation was rejected as inconsistent with
  the product and existing UI.
- Feedback classification: multi-page form request is a Product/UX change. Applied
  to P1.3 because it improves progressive disclosure without changing domain
  behavior or backend scope. Recommendation: use steps for meaningful decisions,
  not one-field-per-page fragmentation.
- Implementation detail: a development-only `NEXT_PUBLIC_RECORDS_UI_PREVIEW=1`
  flag permits local visual review without credentials. It is ignored in
  production; normal Records routes remain authenticated.
- Worktree update: after G1 scaffold completion, the temporary checkout was
  removed and `agent/collection-records` was switched into the primary project
  directory at the user's request. Existing Stardust modifications were carried
  across unchanged and remain explicitly out of scope.

## G1 known scaffold limitations

- Record changes are intentionally tab-scoped preview data and disappear on
  reset/closed tab; existing Library rows are only read.
- Sample entities make every workflow walkable when a review browser has no
  authenticated session. Signed-in use additionally maps current Library cards.
- Legacy rows do not contain exact edition/set/cost/product facts; the scaffold
  labels these for attention instead of inventing them.
- No schema, migration, tRPC mutation adapter, production auth behavior change,
  or `/spend` redirect has been implemented. Those remain behind G1/G2/G3.
