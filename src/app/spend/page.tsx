import { eq } from "drizzle-orm";
import { SpendApp } from "@/components/spend-app";
import { db } from "@/db";
import { cards as cardsTable } from "@/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function serializeCard(card: typeof cardsTable.$inferSelect) {
  return {
    ...card,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
}

export default async function SpendPage() {
  const initialCards = (
    await db
      .select()
      .from(cardsTable)
      .where(eq(cardsTable.status, "owned"))
  ).map(serializeCard);

  return <SpendApp initialCards={initialCards} />;
}
