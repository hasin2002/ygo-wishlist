import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing image URL." }, { status: 400 });
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid image URL." }, { status: 400 });
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return NextResponse.json(
      { error: "Unsupported image URL." },
      { status: 400 },
    );
  }

  const response = await fetch(parsedUrl, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    },
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: "Could not fetch image." },
      { status: response.status },
    );
  }

  const contentType = response.headers.get("content-type") ?? "image/jpeg";

  if (!contentType.startsWith("image/")) {
    return NextResponse.json(
      { error: "URL did not return an image." },
      { status: 400 },
    );
  }

  return new Response(await response.arrayBuffer(), {
    headers: {
      "cache-control": "public, max-age=86400",
      "content-type": contentType,
    },
  });
}
