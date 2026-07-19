import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    username: text("username"),
    displayUsername: text("display_username"),
    role: text("role", { enum: ["user", "admin"] })
      .notNull()
      .default("user"),
    publicCollection: boolean("public_collection").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_username_unique").on(table.username),
  ],
);

export type FeatureIdeasCanvas = {
  canvasHeight: number;
  canvasWidth: number;
  connections: Array<{ from: string; id: string; to: string; type: "arrow" | "line" }>;
  freeTexts: Array<{ id: string; text: string; x: number; y: number }>;
  ideas: Array<{ id: string; text: string; x: number; y: number }>;
};

export const featureIdeaPages = pgTable(
  "feature_idea_pages",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    canvas: jsonb("canvas").$type<FeatureIdeasCanvas>().notNull(),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [index("feature_idea_pages_updated_idx").on(table.updatedAt)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("sessions_token_unique").on(table.token),
    index("sessions_user_id_idx").on(table.userId),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { mode: "date" }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      mode: "date",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [index("accounts_user_id_idx").on(table.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

export const authRateLimits = pgTable(
  "auth_rate_limits",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    count: integer("count").notNull(),
    lastRequest: bigint("last_request", { mode: "number" }).notNull(),
  },
  (table) => [uniqueIndex("auth_rate_limits_key_unique").on(table.key)],
);

export const cards = pgTable("cards", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url"),
  source: text("source", { enum: ["tcgplayer", "ebay", "other", "manual"] })
    .notNull()
    .default("manual"),
  imageUrl: text("image_url"),
  priceText: text("price_text"),
  marketPriceText: text("market_price_text"),
  paidPriceText: text("paid_price_text"),
  purchaseMonth: text("purchase_month"),
  ebaySearchUrl: text("ebay_search_url"),
  ebayListingUrl: text("ebay_listing_url"),
  rarity: text("rarity"),
  cardType: text("card_type"),
  chaseLevel: integer("chase_level"),
  status: text("status", { enum: ["wishlist", "owned"] })
    .notNull()
    .default("wishlist"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
});

export const binderSlots = pgTable(
  "binder_slots",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").references(() => users.id, { onDelete: "cascade" }),
    pageIndex: integer("page_index").notNull(),
    slotIndex: integer("slot_index").notNull(),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("binder_slots_owner_page_slot_unique").on(
      table.ownerId,
      table.pageIndex,
      table.slotIndex,
    ),
    uniqueIndex("binder_slots_owner_card_unique").on(table.ownerId, table.cardId),
  ],
);

export const wheelEntries = pgTable(
  "wheel_entries",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").references(() => users.id, { onDelete: "cascade" }),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    selectedAt: timestamp("selected_at", { mode: "date" }),
    selectedOrder: integer("selected_order"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("wheel_entries_owner_card_unique").on(table.ownerId, table.cardId),
  ],
);

export const monthlyFavorites = pgTable(
  "monthly_favorites",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").references(() => users.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("monthly_favorites_owner_month_unique").on(
      table.ownerId,
      table.month,
    ),
  ],
);

export const recordEntries = pgTable(
  "record_entries",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["purchase", "pack-opening", "sale", "imported-acquisition"],
    }).notNull(),
    status: text("status", { enum: ["active", "void"] })
      .notNull()
      .default("active"),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    title: text("title").notNull(),
    titleGenerated: boolean("title_generated").notNull().default(false),
    source: text("source").notNull(),
    listingUrl: text("listing_url"),
    amountPence: integer("amount_pence").notNull().default(0),
    amountKnown: boolean("amount_known").notNull().default(true),
    notes: text("notes").notNull().default(""),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    index("record_entries_owner_date_idx").on(table.ownerId, table.occurredOn),
    index("record_entries_owner_type_idx").on(table.ownerId, table.type),
    check("record_entries_amount_nonnegative", sql`${table.amountPence} >= 0`),
    check("record_entries_revision_positive", sql`${table.revision} >= 1`),
  ],
);

export const recordLines = pgTable(
  "record_lines",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recordId: text("record_id")
      .notNull()
      .references(() => recordEntries.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: text("kind", { enum: ["card", "sealed", "bulk", "supply"] }).notNull(),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull(),
    allocationPence: integer("allocation_pence"),
    detail: text("detail"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("record_lines_record_position_unique").on(table.recordId, table.position),
    index("record_lines_owner_record_idx").on(table.ownerId, table.recordId),
    check("record_lines_quantity_positive", sql`${table.quantity} >= 1`),
    check(
      "record_lines_allocation_nonnegative",
      sql`${table.allocationPence} is null or ${table.allocationPence} >= 0`,
    ),
  ],
);

export const cardTargets = pgTable(
  "card_targets",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    rarity: text("rarity").notNull(),
    normalizedRarity: text("normalized_rarity").notNull(),
    edition: text("edition").notNull(),
    normalizedEdition: text("normalized_edition").notNull(),
    desiredQuantity: integer("desired_quantity").notNull().default(1),
    imageUrl: text("image_url"),
    tcgplayerUrl: text("tcgplayer_url"),
    estimatedPricePence: integer("estimated_price_pence"),
    marketPricePence: integer("market_price_pence"),
    ebaySearchUrl: text("ebay_search_url"),
    ebayListingUrl: text("ebay_listing_url"),
    cardType: text("card_type"),
    notes: text("notes").notNull().default(""),
    chaseLevel: integer("chase_level"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("card_targets_owner_identity_unique").on(
      table.ownerId,
      table.normalizedName,
      table.normalizedRarity,
      table.normalizedEdition,
    ),
    index("card_targets_owner_name_idx").on(table.ownerId, table.normalizedName),
    check("card_targets_desired_quantity_positive", sql`${table.desiredQuantity} >= 1`),
    check(
      "card_targets_estimated_price_nonnegative",
      sql`${table.estimatedPricePence} is null or ${table.estimatedPricePence} >= 0`,
    ),
    check(
      "card_targets_market_price_nonnegative",
      sql`${table.marketPricePence} is null or ${table.marketPricePence} >= 0`,
    ),
  ],
);

export const pricingRefreshStates = pgTable("pricing_refresh_states", {
  ownerId: text("owner_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  lastRefreshedAt: timestamp("last_refreshed_at", { mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
});

export const cardPrintings = pgTable(
  "card_printings",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetId: text("target_id")
      .notNull()
      .references(() => cardTargets.id, { onDelete: "cascade" }),
    setName: text("set_name").notNull(),
    normalizedSetName: text("normalized_set_name").notNull(),
    setCode: text("set_code").notNull(),
    normalizedSetCode: text("normalized_set_code").notNull(),
    tcgplayerUrl: text("tcgplayer_url"),
    canonicalTcgplayerUrl: text("canonical_tcgplayer_url"),
    imageUrl: text("image_url"),
    metadataNeedsAttention: boolean("metadata_needs_attention").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    index("card_printings_owner_target_idx").on(table.ownerId, table.targetId),
    index("card_printings_owner_code_idx").on(table.ownerId, table.normalizedSetCode),
    index("card_printings_owner_tcgplayer_idx").on(table.ownerId, table.canonicalTcgplayerUrl),
  ],
);

export const bulkLots = pgTable(
  "bulk_lots",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    acquiredRecordId: text("acquired_record_id")
      .notNull()
      .references(() => recordEntries.id, { onDelete: "restrict" }),
    acquiredLineId: text("acquired_line_id")
      .notNull()
      .references(() => recordLines.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    totalQuantity: integer("total_quantity").notNull(),
    itemizedQuantity: integer("itemized_quantity").notNull().default(0),
    status: text("status", { enum: ["open", "itemized", "void"] })
      .notNull()
      .default("open"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    index("bulk_lots_owner_record_idx").on(table.ownerId, table.acquiredRecordId),
    uniqueIndex("bulk_lots_acquired_line_unique").on(table.acquiredLineId),
    check("bulk_lots_total_positive", sql`${table.totalQuantity} >= 1`),
    check("bulk_lots_itemized_nonnegative", sql`${table.itemizedQuantity} >= 0`),
    check(
      "bulk_lots_itemized_within_total",
      sql`${table.itemizedQuantity} <= ${table.totalQuantity}`,
    ),
  ],
);

export const cardCopies = pgTable(
  "card_copies",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    printingId: text("printing_id")
      .notNull()
      .references(() => cardPrintings.id, { onDelete: "restrict" }),
    acquiredRecordId: text("acquired_record_id")
      .notNull()
      .references(() => recordEntries.id, { onDelete: "restrict" }),
    acquiredLineId: text("acquired_line_id")
      .notNull()
      .references(() => recordLines.id, { onDelete: "restrict" }),
    soldRecordId: text("sold_record_id").references(() => recordEntries.id, {
      onDelete: "restrict",
    }),
    soldLineId: text("sold_line_id").references(() => recordLines.id, {
      onDelete: "restrict",
    }),
    bulkLotId: text("bulk_lot_id").references(() => bulkLots.id, {
      onDelete: "restrict",
    }),
    allocationIndex: integer("allocation_index"),
    allocationPence: integer("allocation_pence"),
    status: text("status", { enum: ["available", "sold", "void"] })
      .notNull()
      .default("available"),
    condition: text("condition").notNull().default("Near Mint"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    index("card_copies_owner_printing_idx").on(table.ownerId, table.printingId),
    index("card_copies_owner_status_idx").on(table.ownerId, table.status),
    index("card_copies_owner_acquired_record_idx").on(table.ownerId, table.acquiredRecordId),
    index("card_copies_owner_sold_record_idx").on(table.ownerId, table.soldRecordId),
    uniqueIndex("card_copies_bulk_allocation_unique").on(
      table.ownerId,
      table.bulkLotId,
      table.allocationIndex,
    ),
    check(
      "card_copies_allocation_index_nonnegative",
      sql`${table.allocationIndex} is null or ${table.allocationIndex} >= 0`,
    ),
    check(
      "card_copies_allocation_nonnegative",
      sql`${table.allocationPence} is null or ${table.allocationPence} >= 0`,
    ),
  ],
);

export const recordLineCopies = pgTable(
  "record_line_copies",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recordId: text("record_id")
      .notNull()
      .references(() => recordEntries.id, { onDelete: "cascade" }),
    lineId: text("line_id")
      .notNull()
      .references(() => recordLines.id, { onDelete: "cascade" }),
    copyId: text("copy_id")
      .notNull()
      .references(() => cardCopies.id, { onDelete: "restrict" }),
    role: text("role", { enum: ["acquisition", "sale"] }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("record_line_copies_line_copy_unique").on(table.lineId, table.copyId),
    index("record_line_copies_owner_record_idx").on(table.ownerId, table.recordId),
    index("record_line_copies_owner_copy_idx").on(table.ownerId, table.copyId),
  ],
);

export const sealedUnits = pgTable(
  "sealed_units",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    acquiredRecordId: text("acquired_record_id")
      .notNull()
      .references(() => recordEntries.id, { onDelete: "restrict" }),
    acquiredLineId: text("acquired_line_id")
      .notNull()
      .references(() => recordLines.id, { onDelete: "restrict" }),
    openedRecordId: text("opened_record_id").references(() => recordEntries.id, {
      onDelete: "restrict",
    }),
    name: text("name").notNull(),
    edition: text("edition"),
    tcgplayerUrl: text("tcgplayer_url"),
    canonicalTcgplayerUrl: text("canonical_tcgplayer_url"),
    imageUrl: text("image_url"),
    status: text("status", { enum: ["sealed", "opened", "void"] })
      .notNull()
      .default("sealed"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    index("sealed_units_owner_status_idx").on(table.ownerId, table.status),
    index("sealed_units_owner_product_idx").on(table.ownerId, table.canonicalTcgplayerUrl),
    index("sealed_units_owner_record_idx").on(table.ownerId, table.acquiredRecordId),
  ],
);

export const supplyItems = pgTable(
  "supply_items",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    acquiredRecordId: text("acquired_record_id")
      .notNull()
      .references(() => recordEntries.id, { onDelete: "restrict" }),
    acquiredLineId: text("acquired_line_id")
      .notNull()
      .references(() => recordLines.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    category: text("category", {
      enum: ["sleeves", "binder", "storage", "playmat", "other"],
    }).notNull(),
    quantity: integer("quantity").notNull(),
    status: text("status", { enum: ["held", "used", "void"] })
      .notNull()
      .default("held"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    index("supply_items_owner_status_idx").on(table.ownerId, table.status),
    index("supply_items_owner_record_idx").on(table.ownerId, table.acquiredRecordId),
    check("supply_items_quantity_positive", sql`${table.quantity} >= 1`),
  ],
);

export const legacyCardTargetLinks = pgTable(
  "legacy_card_target_links",
  {
    legacyCardId: integer("legacy_card_id")
      .primaryKey()
      .references(() => cards.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetId: text("target_id")
      .notNull()
      .references(() => cardTargets.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
  },
  (table) => [
    index("legacy_card_target_links_owner_target_idx").on(table.ownerId, table.targetId),
  ],
);

export const targetBinderSlots = pgTable(
  "target_binder_slots",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pageIndex: integer("page_index").notNull(),
    slotIndex: integer("slot_index").notNull(),
    targetId: text("target_id")
      .notNull()
      .references(() => cardTargets.id, { onDelete: "cascade" }),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("target_binder_slots_owner_page_slot_unique").on(
      table.ownerId,
      table.pageIndex,
      table.slotIndex,
    ),
    uniqueIndex("target_binder_slots_owner_target_unique").on(table.ownerId, table.targetId),
  ],
);

export const targetWheelEntries = pgTable(
  "target_wheel_entries",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetId: text("target_id")
      .notNull()
      .references(() => cardTargets.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    selectedAt: timestamp("selected_at", { mode: "date" }),
    selectedOrder: integer("selected_order"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("target_wheel_entries_owner_target_unique").on(table.ownerId, table.targetId),
  ],
);

export const targetMonthlyFavorites = pgTable(
  "target_monthly_favorites",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    targetId: text("target_id")
      .notNull()
      .references(() => cardTargets.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("target_monthly_favorites_owner_month_unique").on(table.ownerId, table.month),
  ],
);

export type Card = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;
export type BinderSlot = typeof binderSlots.$inferSelect;
export type WheelEntry = typeof wheelEntries.$inferSelect;
export type MonthlyFavorite = typeof monthlyFavorites.$inferSelect;
export type RecordEntryRow = typeof recordEntries.$inferSelect;
export type RecordLineRow = typeof recordLines.$inferSelect;
export type CardTargetRow = typeof cardTargets.$inferSelect;
export type CardPrintingRow = typeof cardPrintings.$inferSelect;
export type CardCopyRow = typeof cardCopies.$inferSelect;
export type RecordLineCopyRow = typeof recordLineCopies.$inferSelect;
export type SealedUnitRow = typeof sealedUnits.$inferSelect;
export type BulkLotRow = typeof bulkLots.$inferSelect;
export type SupplyItemRow = typeof supplyItems.$inferSelect;
export type TargetBinderSlotRow = typeof targetBinderSlots.$inferSelect;
export type TargetWheelEntryRow = typeof targetWheelEntries.$inferSelect;
export type TargetMonthlyFavoriteRow = typeof targetMonthlyFavorites.$inferSelect;
export type User = typeof users.$inferSelect;
