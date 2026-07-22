import { NextRequest, NextResponse } from "next/server";
import { deleteEbayConnection } from "@/server/ebay-seller";
import { getSessionFromHeaders } from "@/server/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await getSessionFromHeaders(request.headers);
  if (!session || session.user.role !== "admin") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const configuredOrigin = process.env.BETTER_AUTH_URL ? new URL(process.env.BETTER_AUTH_URL).origin : null;
  const origin = request.headers.get("origin");
  if (!configuredOrigin || origin !== configuredOrigin) {
    return NextResponse.redirect(new URL("/ebay?error=security", request.url));
  }

  await deleteEbayConnection(session.user.id);
  return NextResponse.redirect(new URL("/ebay?disconnected=1", request.url));
}
