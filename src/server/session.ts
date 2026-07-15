import "server-only";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { cache } from "react";
import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";

export const getCurrentSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);

export async function getPublicCollectionOwnerId() {
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.publicCollection, true))
    .limit(1);

  return owner?.id ?? null;
}
