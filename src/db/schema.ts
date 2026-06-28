import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const cards = sqliteTable("cards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const binderSlots = sqliteTable(
  "binder_slots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pageIndex: integer("page_index").notNull(),
    slotIndex: integer("slot_index").notNull(),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("binder_slots_page_slot_unique").on(
      table.pageIndex,
      table.slotIndex,
    ),
    uniqueIndex("binder_slots_card_unique").on(table.cardId),
  ],
);

export const wheelEntries = sqliteTable(
  "wheel_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    selectedAt: integer("selected_at", { mode: "timestamp" }),
    selectedOrder: integer("selected_order"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [uniqueIndex("wheel_entries_card_unique").on(table.cardId)],
);

export const monthlyFavorites = sqliteTable(
  "monthly_favorites",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    month: text("month").notNull(),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [uniqueIndex("monthly_favorites_month_unique").on(table.month)],
);

export type Card = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;
export type BinderSlot = typeof binderSlots.$inferSelect;
export type WheelEntry = typeof wheelEntries.$inferSelect;
export type MonthlyFavorite = typeof monthlyFavorites.$inferSelect;
