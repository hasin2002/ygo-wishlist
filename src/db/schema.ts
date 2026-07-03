import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const cards = pgTable("cards", {
  id: serial("id").primaryKey(),
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
    pageIndex: integer("page_index").notNull(),
    slotIndex: integer("slot_index").notNull(),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("binder_slots_page_slot_unique").on(
      table.pageIndex,
      table.slotIndex,
    ),
    uniqueIndex("binder_slots_card_unique").on(table.cardId),
  ],
);

export const wheelEntries = pgTable(
  "wheel_entries",
  {
    id: serial("id").primaryKey(),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    selectedAt: timestamp("selected_at", { mode: "date" }),
    selectedOrder: integer("selected_order"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [uniqueIndex("wheel_entries_card_unique").on(table.cardId)],
);

export const monthlyFavorites = pgTable(
  "monthly_favorites",
  {
    id: serial("id").primaryKey(),
    month: text("month").notNull(),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [uniqueIndex("monthly_favorites_month_unique").on(table.month)],
);

export type Card = typeof cards.$inferSelect;
export type NewCard = typeof cards.$inferInsert;
export type BinderSlot = typeof binderSlots.$inferSelect;
export type WheelEntry = typeof wheelEntries.$inferSelect;
export type MonthlyFavorite = typeof monthlyFavorites.$inferSelect;
