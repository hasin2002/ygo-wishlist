import { eq } from "drizzle-orm";
import { SpendApp } from "@/components/spend-app";
import { db } from "@/db";
import { cards as cardsTable } from "@/db/schema";

export const dynamic = "force-dynamic";

function serializeCard(card: typeof cardsTable.$inferSelect) {
  return {
    ...card,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
}

export default function SpendPage() {
  const initialCards = db
    .select()
    .from(cardsTable)
    .where(eq(cardsTable.status, "owned"))
    .all()
    .map(serializeCard);

  return <SpendApp initialCards={initialCards} />;
}
