import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
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

/**
 * A seller connection is deliberately separate from Better Auth's `accounts`
 * table. The latter belongs to the site's sign-in system; this table holds the
 * eBay consent needed to act on a seller account.
 */
export const ebayConnections = pgTable("ebay_connections", {
  ownerId: text("owner_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
  refreshTokenIv: text("refresh_token_iv").notNull(),
  refreshTokenTag: text("refresh_token_tag").notNull(),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    mode: "date",
  }).notNull(),
  scopes: text("scopes").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
});

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
    uniqueIndex("record_entries_owner_id_unique").on(table.ownerId, table.id),
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
    // A complete set/code identifies one exact Printing within a Target. Legacy
    // placeholders deliberately remain outside the constraint so they can be
    // reported for human review rather than silently combined.
    uniqueIndex("card_printings_owner_target_set_identity_unique")
      .on(table.ownerId, table.targetId, table.normalizedSetName, table.normalizedSetCode)
      .where(sql`${table.normalizedSetName} not in ('', 'unknown', 'unknown set')
        and ${table.normalizedSetCode} not in ('', 'unknown', 'unknown code')`),
    uniqueIndex("card_printings_owner_target_tcgplayer_identity_unique")
      .on(table.ownerId, table.targetId, table.canonicalTcgplayerUrl)
      .where(sql`nullif(btrim(${table.canonicalTcgplayerUrl}), '') is not null`),
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
    condition: text("condition", {
      enum: ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played"],
    }).notNull().default("Near Mint"),
    location: text("location"),
    stickerNumber: text("sticker_number"),
    privateNote: text("private_note").notNull().default(""),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("card_copies_owner_id_unique").on(table.ownerId, table.id),
    index("card_copies_owner_printing_idx").on(table.ownerId, table.printingId),
    index("card_copies_owner_status_idx").on(table.ownerId, table.status),
    index("card_copies_owner_acquired_record_idx").on(table.ownerId, table.acquiredRecordId),
    index("card_copies_owner_sold_record_idx").on(table.ownerId, table.soldRecordId),
    uniqueIndex("card_copies_owner_sticker_number_unique")
      .on(table.ownerId, table.stickerNumber)
      .where(sql`${table.stickerNumber} is not null`),
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

/** Private image index for a physical Copy. Image bytes remain in S3. */
export const cardCopyImages = pgTable(
  "card_copy_images",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    copyId: text("copy_id").notNull().references(() => cardCopies.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("card_copy_images_object_key_unique").on(table.objectKey),
    uniqueIndex("card_copy_images_copy_position_unique").on(table.copyId, table.position),
    index("card_copy_images_owner_copy_idx").on(table.ownerId, table.copyId),
    check("card_copy_images_position_nonnegative", sql`${table.position} >= 0`),
  ],
);

/**
 * A published eBay item is linked to the physical Copy it represents. A Copy
 * stays available until a Sale record is created; listing it must not imply it
 * has been sold.
 */
export const ebayListings = pgTable(
  "ebay_listings",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    copyId: text("copy_id")
      .notNull()
      .references(() => cardCopies.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: ["individual", "quantity", "bundle"] })
      .notNull()
      .default("individual"),
    itemId: text("item_id").notNull(),
    listingUrl: text("listing_url").notNull(),
    title: text("title").notNull(),
    status: text("status", { enum: ["active", "ended"] })
      .notNull()
      .default("active"),
    listingState: text("listing_state", {
      enum: ["active", "ended", "suspended", "unknown"],
    })
      .notNull()
      .default("unknown"),
    saleState: text("sale_state", {
      enum: ["none", "pending", "paid", "cancelled", "needs_review"],
    })
      .notNull()
      .default("none"),
    remoteListingStatus: text("remote_listing_status"),
    remoteOrderStatus: text("remote_order_status"),
    quantitySold: integer("quantity_sold"),
    endingReason: text("ending_reason"),
    listingStartedAt: timestamp("listing_started_at", { mode: "date" }),
    listingEndedAt: timestamp("listing_ended_at", { mode: "date" }),
    paymentPendingAt: timestamp("payment_pending_at", { mode: "date" }),
    paidAt: timestamp("paid_at", { mode: "date" }),
    cancelledAt: timestamp("cancelled_at", { mode: "date" }),
    orderId: text("order_id"),
    orderLineItemId: text("order_line_item_id"),
    transactionId: text("transaction_id"),
    saleRecordId: text("sale_record_id"),
    lastRemoteEventAt: timestamp("last_remote_event_at", { mode: "date" }),
    lastNotificationId: text("last_notification_id"),
    lastNotificationAt: timestamp("last_notification_at", { mode: "date" }),
    lastSyncAttemptAt: timestamp("last_sync_attempt_at", { mode: "date" }),
    lastSyncedAt: timestamp("last_synced_at", { mode: "date" }),
    retryCount: integer("retry_count").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { mode: "date" }),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("ebay_listings_owner_id_unique").on(table.ownerId, table.id),
    foreignKey({
      name: "ebay_listings_owner_sale_record_fk",
      columns: [table.ownerId, table.saleRecordId],
      foreignColumns: [recordEntries.ownerId, recordEntries.id],
    }).onDelete("restrict"),
    uniqueIndex("ebay_listings_item_id_unique").on(table.itemId),
    uniqueIndex("ebay_listings_owner_copy_open_unique")
      .on(table.ownerId, table.copyId)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex("ebay_listings_owner_order_line_unique")
      .on(table.ownerId, table.orderId, table.orderLineItemId)
      .where(sql`${table.orderId} is not null and ${table.orderLineItemId} is not null`),
    uniqueIndex("ebay_listings_owner_transaction_unique")
      .on(table.ownerId, table.transactionId)
      .where(sql`${table.transactionId} is not null`),
    index("ebay_listings_owner_copy_idx").on(table.ownerId, table.copyId),
    index("ebay_listings_owner_status_idx").on(table.ownerId, table.status),
    index("ebay_listings_owner_lifecycle_idx").on(
      table.ownerId,
      table.listingState,
      table.saleState,
    ),
    index("ebay_listings_reconcile_due_idx").on(
      table.listingState,
      table.saleState,
      table.nextRetryAt,
    ),
    index("ebay_listings_sale_record_idx").on(table.ownerId, table.saleRecordId),
    check(
      "ebay_listings_quantity_sold_nonnegative",
      sql`${table.quantitySold} is null or ${table.quantitySold} >= 0`,
    ),
    check("ebay_listings_retry_count_nonnegative", sql`${table.retryCount} >= 0`),
  ],
);

/**
 * Exact physical Copies composing an eBay Listing. The legacy copyId remains
 * the compatibility anchor while this relation becomes the authoritative
 * composition once backfilled.
 */
export const ebayListingMembers = pgTable(
  "ebay_listing_members",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    listingId: text("listing_id").notNull(),
    copyId: text("copy_id").notNull(),
    fulfilmentPosition: integer("fulfilment_position").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("ebay_listing_members_owner_id_unique").on(table.ownerId, table.id),
    uniqueIndex("ebay_listing_members_owner_listing_id_unique").on(
      table.ownerId,
      table.listingId,
      table.id,
    ),
    uniqueIndex("ebay_listing_members_owner_listing_copy_unique").on(
      table.ownerId,
      table.listingId,
      table.copyId,
    ),
    uniqueIndex("ebay_listing_members_owner_listing_id_copy_unique").on(
      table.ownerId,
      table.listingId,
      table.id,
      table.copyId,
    ),
    foreignKey({
      name: "ebay_listing_members_owner_listing_fk",
      columns: [table.ownerId, table.listingId],
      foreignColumns: [ebayListings.ownerId, ebayListings.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "ebay_listing_members_owner_copy_fk",
      columns: [table.ownerId, table.copyId],
      foreignColumns: [cardCopies.ownerId, cardCopies.id],
    }).onDelete("restrict"),
    uniqueIndex("ebay_listing_members_listing_copy_unique").on(
      table.listingId,
      table.copyId,
    ),
    uniqueIndex("ebay_listing_members_listing_position_unique").on(
      table.listingId,
      table.fulfilmentPosition,
    ),
    index("ebay_listing_members_owner_copy_idx").on(table.ownerId, table.copyId),
    index("ebay_listing_members_owner_listing_idx").on(table.ownerId, table.listingId),
    check(
      "ebay_listing_members_position_nonnegative",
      sql`${table.fulfilmentPosition} >= 0`,
    ),
  ],
);

/** One normalized remote eBay order line for a Listing. */
export const ebayOrderLines = pgTable(
  "ebay_order_lines",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    listingId: text("listing_id").notNull(),
    orderId: text("order_id"),
    orderLineItemId: text("order_line_item_id"),
    transactionId: text("transaction_id"),
    quantityPurchased: integer("quantity_purchased").notNull(),
    paymentState: text("payment_state", {
      enum: ["pending", "paid", "cancelled", "needs_review"],
    }).notNull().default("pending"),
    remoteOrderStatus: text("remote_order_status"),
    paymentPendingAt: timestamp("payment_pending_at", { mode: "date" }),
    paidAt: timestamp("paid_at", { mode: "date" }),
    cancelledAt: timestamp("cancelled_at", { mode: "date" }),
    needsReviewAt: timestamp("needs_review_at", { mode: "date" }),
    lastRemoteEventAt: timestamp("last_remote_event_at", { mode: "date" }),
    saleRecordId: text("sale_record_id").references(() => recordEntries.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("ebay_order_lines_owner_id_unique").on(table.ownerId, table.id),
    foreignKey({
      name: "ebay_order_lines_owner_listing_fk",
      columns: [table.ownerId, table.listingId],
      foreignColumns: [ebayListings.ownerId, ebayListings.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "ebay_order_lines_owner_sale_record_fk",
      columns: [table.ownerId, table.saleRecordId],
      foreignColumns: [recordEntries.ownerId, recordEntries.id],
    }).onDelete("restrict"),
    uniqueIndex("ebay_order_lines_owner_listing_id_unique").on(
      table.ownerId,
      table.listingId,
      table.id,
    ),
    uniqueIndex("ebay_order_lines_owner_order_line_unique")
      .on(table.ownerId, table.orderId, table.orderLineItemId)
      .where(sql`${table.orderId} is not null and ${table.orderLineItemId} is not null`),
    uniqueIndex("ebay_order_lines_owner_transaction_unique")
      .on(table.ownerId, table.transactionId)
      .where(sql`${table.transactionId} is not null`),
    index("ebay_order_lines_owner_listing_idx").on(table.ownerId, table.listingId),
    index("ebay_order_lines_owner_sale_record_idx").on(table.ownerId, table.saleRecordId),
    check("ebay_order_lines_quantity_positive", sql`${table.quantityPurchased} >= 1`),
  ],
);

/** Exact Copy allocations for an eBay order line, retained after release. */
export const ebayOrderLineAllocations = pgTable(
  "ebay_order_line_allocations",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orderLineId: text("order_line_id").notNull(),
    listingId: text("listing_id").notNull(),
    listingMemberId: text("listing_member_id").notNull(),
    copyId: text("copy_id").notNull(),
    fulfilmentPosition: integer("fulfilment_position").notNull(),
    allocatedAt: timestamp("allocated_at", { mode: "date" }).notNull(),
    releasedAt: timestamp("released_at", { mode: "date" }),
    releaseReason: text("release_reason"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "ebay_order_line_allocations_owner_line_fk",
      columns: [table.ownerId, table.orderLineId],
      foreignColumns: [ebayOrderLines.ownerId, ebayOrderLines.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "ebay_order_line_allocations_owner_listing_line_fk",
      columns: [table.ownerId, table.listingId, table.orderLineId],
      foreignColumns: [
        ebayOrderLines.ownerId,
        ebayOrderLines.listingId,
        ebayOrderLines.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "ebay_order_line_allocations_owner_copy_fk",
      columns: [table.ownerId, table.copyId],
      foreignColumns: [cardCopies.ownerId, cardCopies.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "ebay_order_line_allocations_owner_listing_member_copy_fk",
      columns: [
        table.ownerId,
        table.listingId,
        table.listingMemberId,
        table.copyId,
      ],
      foreignColumns: [
        ebayListingMembers.ownerId,
        ebayListingMembers.listingId,
        ebayListingMembers.id,
        ebayListingMembers.copyId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("ebay_order_line_allocations_line_copy_unique").on(
      table.orderLineId,
      table.copyId,
    ),
    uniqueIndex("ebay_order_line_allocations_line_position_unique").on(
      table.orderLineId,
      table.fulfilmentPosition,
    ),
    uniqueIndex("ebay_order_line_allocations_owner_copy_open_unique")
      .on(table.ownerId, table.copyId)
      .where(sql`${table.releasedAt} is null`),
    index("ebay_order_line_allocations_owner_line_idx").on(table.ownerId, table.orderLineId),
    check(
      "ebay_order_line_allocations_position_nonnegative",
      sql`${table.fulfilmentPosition} >= 0`,
    ),
  ],
);

/**
 * The expected state of one eBay notification subscription for an owner/topic.
 * Notification setup is retained independently of a seller refresh token so
 * connection or scope failures can be repaired without losing health history.
 */
export const ebayNotificationSubscriptions = pgTable(
  "ebay_notification_subscriptions",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    destinationId: text("destination_id").notNull(),
    remoteSubscriptionId: text("remote_subscription_id"),
    status: text("status", {
      enum: ["pending", "enabled", "disabled", "marked_down", "unsupported", "error"],
    })
      .notNull()
      .default("pending"),
    scopeVersion: integer("scope_version").notNull().default(1),
    enabledAt: timestamp("enabled_at", { mode: "date" }),
    disabledAt: timestamp("disabled_at", { mode: "date" }),
    verifiedAt: timestamp("verified_at", { mode: "date" }),
    expiresAt: timestamp("expires_at", { mode: "date" }),
    lastCheckedAt: timestamp("last_checked_at", { mode: "date" }),
    lastNotificationAt: timestamp("last_notification_at", { mode: "date" }),
    retryCount: integer("retry_count").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { mode: "date" }),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("ebay_notification_sub_remote_id_unique")
      .on(table.remoteSubscriptionId)
      .where(sql`${table.remoteSubscriptionId} is not null`),
    uniqueIndex("ebay_notification_sub_owner_topic_dest_unique").on(
      table.ownerId,
      table.topic,
      table.destinationId,
    ),
    index("ebay_notification_sub_owner_status_idx").on(table.ownerId, table.status),
    index("ebay_notification_sub_retry_idx").on(table.status, table.nextRetryAt),
    check(
      "ebay_notification_sub_scope_version_positive",
      sql`${table.scopeVersion} >= 1`,
    ),
    check(
      "ebay_notification_sub_retry_count_nonnegative",
      sql`${table.retryCount} >= 0`,
    ),
  ],
);

/**
 * Idempotent notification inbox. Only normalized routing/audit fields are
 * stored; unnecessary buyer payload data does not belong in this table.
 */
export const ebayNotificationEvents = pgTable(
  "ebay_notification_events",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").references(() => users.id, { onDelete: "cascade" }),
    subscriptionId: text("subscription_id").references(
      () => ebayNotificationSubscriptions.id,
      { onDelete: "set null" },
    ),
    listingId: text("listing_id").references(() => ebayListings.id, {
      onDelete: "set null",
    }),
    notificationId: text("notification_id").notNull(),
    topic: text("topic").notNull(),
    sellerUserId: text("seller_user_id"),
    itemId: text("item_id"),
    listingRefs: jsonb("listing_refs")
      .$type<Array<{ itemId: string; orderLineItemId: string | null }>>()
      .notNull()
      .default([]),
    orderId: text("order_id"),
    orderLineItemId: text("order_line_item_id"),
    eventAt: timestamp("event_at", { mode: "date" }),
    publishedAt: timestamp("published_at", { mode: "date" }),
    receivedAt: timestamp("received_at", { mode: "date" }).notNull(),
    payloadHash: text("payload_hash").notNull(),
    processingStatus: text("processing_status", {
      enum: ["pending", "processing", "processed", "ignored", "failed"],
    })
      .notNull()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { mode: "date" }),
    nextAttemptAt: timestamp("next_attempt_at", { mode: "date" }),
    processedAt: timestamp("processed_at", { mode: "date" }),
    outcome: text("outcome"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("ebay_notification_events_notification_id_unique").on(
      table.notificationId,
    ),
    index("ebay_notification_events_owner_status_retry_idx").on(
      table.ownerId,
      table.processingStatus,
      table.nextAttemptAt,
    ),
    index("ebay_notification_events_owner_item_idx").on(table.ownerId, table.itemId),
    index("ebay_notification_events_owner_order_idx").on(table.ownerId, table.orderId),
    index("ebay_notification_events_seller_user_idx").on(table.sellerUserId),
    index("ebay_notification_events_listing_idx").on(table.listingId),
    check(
      "ebay_notification_events_attempt_count_nonnegative",
      sql`${table.attemptCount} >= 0`,
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
export type EbayListingRow = typeof ebayListings.$inferSelect;
export type EbayListingMemberRow = typeof ebayListingMembers.$inferSelect;
export type EbayOrderLineRow = typeof ebayOrderLines.$inferSelect;
export type EbayOrderLineAllocationRow = typeof ebayOrderLineAllocations.$inferSelect;
export type EbayNotificationEventRow = typeof ebayNotificationEvents.$inferSelect;
export type EbayNotificationSubscriptionRow =
  typeof ebayNotificationSubscriptions.$inferSelect;
export type User = typeof users.$inferSelect;
