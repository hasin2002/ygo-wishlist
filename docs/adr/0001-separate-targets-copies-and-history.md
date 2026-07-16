# ADR 0001: Separate targets, copies, and history

- Status: Accepted for scaffold; backend implementation awaits G2
- Date: 2026-07-16

## Context

The current card row combines “I want this”, “I own this”, price, and purchase
details. That works for one card at a time but cannot faithfully represent
duplicates, pack pulls, a mixed purchase, a sale, an unitemized bulk lot, or a
reopened wishlist target.

## Decision

Model desire, identity, inventory, and history separately:

1. Wishlist Target stores desired quantity for a normalized card identity.
2. Card Printing stores exact set/code and product metadata.
3. Copy stores one physical instance of a printing.
4. Record Entry and its lines explain cashflow and every inventory change.

Ownership will be derived from copies and their record history. A sale changes a
copy through a Sale entry; it does not delete acquisition history. If a sale
drops owned quantity below desired quantity, the target becomes open again.

Purchases store all-in cost and Sales store net proceeds. Optional line
allocations describe how a total is distributed but never create more cashflow.
Bulk itemization can add discovered inventory to an existing lot without adding
another purchase amount.

## Consequences

- Duplicate copies and provenance become representable.
- Inventory totals can be reconciled with an append-oriented history.
- Entry removal must be blocked when later events depend on it; void/restore is
  safer and preserves an audit trail.
- UI components require a data-source boundary so the Phase 1 preview and the
  later tRPC implementation can expose the same behavior.
- Migration must preserve incomplete legacy data and label uncertainty rather
  than invent exact printing or acquisition facts.

## Rejected alternatives

- A single `wishlist | owned | sold` status cannot represent quantity or event
  history.
- One-click ownership toggles bypass acquisition provenance and are therefore
  not part of the new UI.
- Treating bulk itemization as a new purchase would double-count spend.
