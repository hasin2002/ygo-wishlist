# ADR 0001: Separate targets, copies, and history

- Status: Accepted; backend implementation in progress
- Date: 2026-07-16

## Context

The current card row combines “I want this”, “I own this”, price, and purchase
details. That works for one card at a time but cannot faithfully represent
duplicates, pack pulls, a mixed purchase, a sale, an unitemized bulk lot, or a
card returning to Wishlist.

## Decision

Model desire, identity, inventory, and history separately:

1. Wishlist Target stores desired quantity for a normalized card identity.
2. Card Printing stores exact set/code and product metadata.
3. Copy stores one physical instance of a printing.
4. Record Entry and its lines explain cashflow and every inventory change.

Ownership will be derived from copies and their record history. A sale changes a
copy through a Sale entry; it does not delete acquisition history. If a sale
drops available quantity below desired quantity, the card returns to Wishlist.
Owned and Wishlist are computed presentation states: Wishlist means the desired
quantity is not yet met, while Owned means it is met. They are not stored
ownership toggles and do not replace Copy history.

Library and Records are two projections over this same model. Library mutations
may create or update a Wishlist Target, but any change to physical ownership
must create or edit the relevant Record Entry and Copy. The legacy `cards` table
is an import source during migration, not a second live collection, and no
permanent dual-write path is permitted.

Purchases store all-in cost and Sales store net proceeds. Optional line
allocations describe how a total is distributed but never create more cashflow.
Bulk itemization can add discovered inventory to an existing lot without adding
another purchase amount.

## Consequences

- Duplicate copies and provenance become representable.
- The Library can use familiar Owned/Wishlist language without collapsing
  partial quantities or making a status field authoritative.
- Inventory totals can be reconciled with an append-oriented history.
- Entry removal must be blocked when later events depend on it; void/restore is
  safer and preserves an audit trail.
- UI components require a data-source boundary so the Phase 1 preview and the
  later tRPC implementation can expose the same behavior.
- Binder, Wheel, chase, and highlights must move to Target/Copy references at
  cutover; migration links may preserve old IDs but are not authoritative data.
- Migration must preserve incomplete legacy data and label uncertainty rather
  than invent exact printing or acquisition facts.

## Rejected alternatives

- A stored `wishlist | owned | sold` status cannot represent quantity or event
  history. Computed Owned/Wishlist presentation states remain valid.
- One-click ownership toggles bypass acquisition provenance and are therefore
  not part of the new UI.
- Treating bulk itemization as a new purchase would double-count spend.
