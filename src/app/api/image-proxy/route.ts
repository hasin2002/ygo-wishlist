import { NextResponse } from "next/server";
import { remoteImageRetriever } from "@/server/remote-images";

export const runtime = "nodejs";

function unavailableResponse() {
  return NextResponse.json(
    { error: "Image unavailable." },
    { headers: { "cache-control": "no-store" }, status: 404 },
  );
}

function clientKey(request: Request) {
  // Hosting platforms overwrite these before forwarding. This remains a
  // best-effort key; the retriever also has a process-wide budget.
  return request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for")?.split(",", 1)[0]
    ?? "anonymous";
}

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) return unavailableResponse();

  try {
    const image = await remoteImageRetriever.retrieve(url, { abuseKey: clientKey(request) });
    return new Response(image.bytes, {
      headers: {
        "cache-control": "public, max-age=600, stale-while-revalidate=60",
        "content-type": image.contentType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    // Do not expose destination, resolver, timeout, or upstream response detail.
    return unavailableResponse();
  }
}
