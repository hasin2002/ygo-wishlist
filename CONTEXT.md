# Product Context

This application is a personal Yu-Gi-Oh! collection hub. It separates what the
owner wants, what physically exists, and the events that explain how inventory
changed.

## Agreed language

- **Library** is the card-focused catalogue. It shows wanted cards, owned
  printings, copies, collection context, and market estimates. It replaces the
  old user-facing name “Tracker”.
- **Records** is the private operational area for acquisitions, openings,
  sales, adjustments, sealed goods, bulk lots, supplies, cost, and realized
  results.
- A **Wishlist Target** describes a desired card and quantity. It is not proof
  of ownership.
- A **Card Printing** identifies an exact set/code plus TCGplayer metadata.
- A **Copy** is one physical card. Ownership changes through record history,
  never through an unexplained status toggle.
- A **Record Entry** is one dated Purchase, Pack Opening, Sale, Adjustment,
  Imported Acquisition, or Bulk Itemization event. An entry can contain several
  lines.
- A **Pack Opening** consumes one Sealed Unit and creates the physical card
  Copies pulled from it. If that unit was not previously recorded, an explicit
  Imported Acquisition establishes its provenance first; gifts have zero cost,
  while unknown historical cost is not treated as zero.
- A **Bulk Lot** is one grouped card acquisition that may be only partially
  identified when purchased. At least one card is identified initially; later
  itemization adds or corrects its known contents without creating a second cash
  expense, while preserving any later history that depends on those Copies.
- A **Supply** is a non-card collecting expense. Initial categories are sleeves,
  binder, storage, playmat, and other.
- **Actual cost** and **net proceeds** belong in Records. Market estimates belong
  in Library and never change cashflow totals.

## Product boundaries

- Library may be public read-only; Records is owner-only.
- New card identities and sealed-product identities use a required TCGplayer
  product URL as their primary reference. Names, images, printing/set facts, and
  rarity are derived from that reference where possible. Legacy rows with
  missing metadata remain usable and are surfaced as needing attention.
- Sales initially cover card copies only.
- Binder location remains an integration with the existing Binder feature, not
  a generalized inventory-location model.
- Phase 1 is a UI-only preview. It may read existing cards but stores all preview
  changes only in `sessionStorage` and never writes to the database.
