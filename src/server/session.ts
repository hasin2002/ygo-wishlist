import "server-only";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { cache } from "react";
import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";

const sessionCookiePattern =
  /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token(?:\.|=)/;

export async function getSessionFromHeaders(requestHeaders: Headers) {
  // Public requests have no session cookie. Avoid invoking the auth library for
  // them so the public tracker and binder are independent of sign-in state.
  if (!sessionCookiePattern.test(requestHeaders.get("cookie") ?? "")) {
    return null;
  }

  return auth.api.getSession({ headers: requestHeaders });
}

export const getCurrentSession = cache(async () =>
  getSessionFromHeaders(await headers()),
);

export async function getPublicCollectionOwnerId() {
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.publicCollection, true))
    .limit(1);

  return owner?.id ?? null;
}
