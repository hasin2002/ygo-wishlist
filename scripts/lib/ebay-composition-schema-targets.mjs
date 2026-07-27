export const ebayCompositionCompositeTargets = [
  {
    table: "record_entries",
    name: "record_entries_owner_id_unique",
    backingName: "record_entries_owner_id_fk_key",
    columns: ["owner_id", "id"],
  },
  {
    table: "card_copies",
    name: "card_copies_owner_id_unique",
    backingName: "card_copies_owner_id_fk_key",
    columns: ["owner_id", "id"],
  },
  {
    table: "ebay_listings",
    name: "ebay_listings_owner_id_unique",
    backingName: "ebay_listings_owner_id_fk_key",
    columns: ["owner_id", "id"],
  },
  {
    table: "ebay_listing_members",
    name: "ebay_listing_members_owner_listing_id_copy_unique",
    backingName: "ebay_listing_members_owner_listing_id_copy_fk_key",
    columns: ["owner_id", "listing_id", "id", "copy_id"],
  },
  {
    table: "ebay_order_lines",
    name: "ebay_order_lines_owner_id_unique",
    backingName: "ebay_order_lines_owner_id_fk_key",
    columns: ["owner_id", "id"],
  },
  {
    table: "ebay_order_lines",
    name: "ebay_order_lines_owner_listing_id_unique",
    backingName: "ebay_order_lines_owner_listing_id_fk_key",
    columns: ["owner_id", "listing_id", "id"],
  },
];
