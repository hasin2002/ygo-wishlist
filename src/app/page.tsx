import { WishlistApp } from "@/components/wishlist-app";
import { db } from "@/db";
import { cards as cardsTable } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function serializeCard(card: typeof cardsTable.$inferSelect) {
  return {
    ...card,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
}

export default async function Home() {
  const initialCards = (
    await db
      .select()
      .from(cardsTable)
      .orderBy(desc(cardsTable.updatedAt))
  ).map(serializeCard);

  return <WishlistApp initialCards={initialCards} />;
}
