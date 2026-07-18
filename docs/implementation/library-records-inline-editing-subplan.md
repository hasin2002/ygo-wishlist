# Record and item editing scaffold

Status: G1 approved; Phase 2 persistence implementation is in progress.

## Authority and scope

This subplan is the detailed specification for editing existing entries from
Records History or their Inventory card projection. It replaces the earlier
deferral of item-level editing. The main implementation plan remains
authoritative for the broader release.

## Interaction model

- Every History entry has one `Edit` action opening a responsive dialog.
- The dialog separates `Record details` from `Items` so the user never faces one
  long mixed form.
- Record details edit name, date, source, notes, and the cash/listing fields
  relevant to that Record type.
- Items begin as compact summaries. Only one card or non-card item expands for
  editing at a time.
- Item changes have a local, explicit save action and do not submit merely by
  opening or switching panels.
- A voided Record must be restored before its inventory items can be changed.
- Selecting a card in Inventory opens one responsive Card Inventory dialog with
  its wanted/owned summary and physical Copies grouped by acquisition Record.
  Each source group shows Record type/name, date, seller/source, original
  listing where available, printing, condition, current Copy state, and a later
  Sale where one exists.
- `Edit source record` replaces the Card Inventory dialog with the existing
  Record editor on its Items panel and expands the relevant card line. Closing
  the Record editor returns to the refreshed Card Inventory dialog; dialogs are
  never nested.
- Inventory is a projection, not another write model. Every edit is submitted
  through the originating Purchase, Pack Opening, or Imported Acquisition and
  uses the same dependency checks as History editing.

## Type-aware item editing

- Single-card and imported acquisitions edit their one exact card but cannot
  add a second item; voiding the Record replaces deleting its only subject.
- Bulk Purchases and Pack Openings reuse the shared Card Contents Editor. Cards
  may be added from a required TCGplayer product link, corrected, quantity
  adjusted, or removed. A Bulk Lot may temporarily have zero identified cards
  because its lot container remains; a Pack Opening retains at least one pull.
- Sales use the exact-Copy inventory picker. Adding selects an available Copy;
  removing a selected Copy returns it to available inventory. At least one Copy
  must remain unless the entire Sale is voided. A Sale that still uses its
  generated Record name refreshes that name from the edited Copy selection; a
  user-edited Record name is never overwritten.
- Sealed items edit Product name, Product edition, and quantity.
- Supplies edit item name, category, and quantity.
- Bulk container metadata may be renamed but its container quantity stays one;
  its individual cards are edited through the shared card editor.

## Dependency and deletion rules

- An acquired card Copy with a later Sale or removal cannot be deleted.
- A card printing identity cannot be rewritten if any Copy on that line has
  later history. Quantity may only be reduced by the number of still-available
  independent Copies.
- An opened sealed unit cannot be deleted or have its product identity changed.
- Removing a Copy from a Sale is allowed because it reverses that Sale's own
  ownership effect; it does not erase the acquisition.
- The last subject of a Record is never hard-deleted. Use Void/Restore so the
  ledger remains explainable.
- All preview mutations are transactional: a failed dependency check leaves the
  original snapshot unchanged.

## Phase 2 contract

- The tRPC adapter must expose the same edit operations and enforce every rule
  transactionally under owner scope.
- Inventory queries must return enough owner-scoped provenance to resolve each
  Copy to its acquisition Record and optional later Sale. Inventory-triggered
  mutations call the same Record operations as History; no Inventory-only card
  update endpoint is introduced.
- Server-side checks are authoritative; UI disabled states and explanations are
  guidance, not the security or consistency boundary.
- Concurrent edits must use the Record revision and return a recoverable
  conflict rather than overwriting a newer Record revision.

## G1 acceptance

- Desktop and phone layouts remain usable without nested modals or horizontal
  overflow.
- Keyboard users can reach tabs, item actions, selectors, pagination, save, and
  close controls with visible focus.
- Adding, editing, reducing, and removing a card item updates Inventory and
  History together.
- Every Inventory card is keyboard/touch operable, its dialog exposes the source
  of each Copy, and source editing opens the correct Record/card line without a
  nested modal.
- Sale Copy selection remains searchable and paginated inside the dialog.
- Every blocked mutation gives a plain-language dependency reason.
