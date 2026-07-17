import { fetchLinkMetadata, normalizeUrl } from "@/server/metadata";

function isTcgplayerProductUrl(value: string) {
  try {
    const url = new URL(normalizeUrl(value));
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    return (
      (host === "tcgplayer.com" || host.endsWith(".tcgplayer.com")) &&
      /\/product\/\d+(?:\/|$)/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_RECORDS_UI_PREVIEW !== "1"
  ) {
    return Response.json({ message: "Not found." }, { status: 404 });
  }

  let url = "";
  try {
    const body = await request.json() as { url?: unknown };
    url = typeof body.url === "string" ? body.url.trim() : "";
  } catch {
    return Response.json({ message: "Send a TCGplayer product link." }, { status: 400 });
  }

  if (!isTcgplayerProductUrl(url)) {
    return Response.json(
      { message: "Use a complete TCGplayer product link containing a product ID." },
      { status: 400 },
    );
  }

  try {
    const metadata = await fetchLinkMetadata(url);
    return Response.json({ metadata });
  } catch {
    return Response.json(
      { message: "TCGplayer details could not be fetched right now. Retry or enter the required details manually." },
      { status: 502 },
    );
  }
}
