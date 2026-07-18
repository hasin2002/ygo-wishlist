# Product Context

This application is a personal Yu-Gi-Oh! collection hub. It separates what the
owner wants, what physically exists, and the events that explain how inventory
changed.

## Agreed language

- **Library** is the card-focused catalogue. It shows wanted cards, owned
  printings, copies, collection context, and market estimates. It replaces the
  old user-facing name “Tracker”.
- **Records** is the private operational area for acquisitions, openings,
  sales, sealed goods, bulk lots, supplies, cost, and realized results.
- A **Wishlist Target** describes a desired card and quantity. It is not proof
  of ownership.
- **Wishlist** is the computed Library state when available Copies are below a
  target's desired quantity. A partially collected target remains Wishlist and
  shows how many Copies are still wanted.
- **Owned** is the computed Library state when available Copies meet or exceed
  the desired quantity. `Wishlist` and `Owned` are derived presentation
  language, never a manually toggled source of truth.
- Do not use `Satisfied`, `Open`, or `Reopened` as user-facing Library status
  identifiers. Use `Owned` and `Wishlist`, with explicit wanted/owned quantities
  when more detail is needed.
- A **Card Printing** identifies an exact set/code plus TCGplayer metadata.
- A **Copy** is one physical card. Ownership changes through record history,
  never through an unexplained status toggle.
- A **Record Entry** is one dated Purchase, Pack Opening, Sale, or Imported
  Acquisition event. An entry can contain several lines.
- A **Pack Opening** consumes one Sealed Unit and creates the physical card
  Copies pulled from it. If that unit was not previously recorded, an explicit
  Imported Acquisition establishes its provenance first; gifts have zero cost,
  while unknown historical cost is not treated as zero.
- A **Bulk Lot** is one grouped card acquisition. Its known contents belong to
  the original Purchase; future inline Record editing will add or correct those
  contents without creating a second cash expense, while preserving any later
  history that depends on those Copies.
- A **Supply** is a non-card collecting expense. Initial categories are sleeves,
  binder, storage, playmat, and other.
- **Actual cost** and **net proceeds** belong in Records. Market estimates belong
  in Library and never change cashflow totals.

## Product boundaries

- Library may be public read-only; Records is owner-only.
- Library and Records are projections of one owner-scoped collection model.
  Library creates or edits Wishlist Targets; physical ownership is always
  derived from the same Copies and Record Entries shown in Records. The legacy
  `cards` table is migration input only after cutover and is never maintained by
  permanent dual writes.
- New card identities and sealed-product identities use a required TCGplayer
  product URL as their primary reference. Names, images, printing/set facts, and
  rarity are derived from that reference where possible. Legacy rows with
  missing metadata remain usable and are surfaced as needing attention.
- Sales initially cover card copies only.
- Binder location remains an integration with the existing Binder feature, not
  a generalized inventory-location model. Binder, Wheel, chase, and highlights
  reference the same Wishlist Targets/Copies after migration rather than a
  parallel card row.
- The approved Phase 1 UI preview remains a safe development adapter. Phase 2
  adds an authenticated live adapter at the same Records seam; production data
  migration remains separately gated and is never inferred from UI approval.
