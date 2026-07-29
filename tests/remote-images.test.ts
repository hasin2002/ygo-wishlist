import assert from "node:assert/strict";
import test from "node:test";
import {
  RemoteImageError,
  createRemoteImageRetriever,
  isPublicRemoteAddress,
  parseApprovedRemoteImageUrl,
  remoteImagePolicy,
} from "../src/server/remote-images.ts";

const source = "https://images.ygoprodeck.com/images/cards/46986414.jpg";
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

async function* body(...chunks: Uint8Array[]) {
  yield* chunks;
}

function successfulResponse(bytes = png) {
  return {
    body: body(bytes),
    headers: { "content-type": "image/png", "content-length": String(bytes.byteLength) },
    statusCode: 200,
  };
}

function publicResolver(hostname: string) {
  assert.ok(hostname.endsWith("ygoprodeck.com") || hostname.endsWith("tcgplayer.com"));
  return Promise.resolve([{ address: "8.8.8.8", family: 4 as const }]);
}

test("only accepts the approved public HTTPS image URL forms", () => {
  assert.equal(parseApprovedRemoteImageUrl(source).hostname, "images.ygoprodeck.com");
  assert.equal(parseApprovedRemoteImageUrl("https://product-images.tcgplayer.com/fit-in/437x437/176852.jpg").hostname, "product-images.tcgplayer.com");
  assert.equal(parseApprovedRemoteImageUrl("https://tcgplayer-cdn.tcgplayer.com/product/176852_in_1000x1000.jpg").hostname, "tcgplayer-cdn.tcgplayer.com");
  for (const url of [
    "http://images.ygoprodeck.com/image.jpg",
    "https://user:pass@images.ygoprodeck.com/image.jpg",
    "https://images.ygoprodeck.com:444/image.jpg",
    "https://example.test/image.jpg",
    "https://127.0.0.1/image.jpg",
    " https://images.ygoprodeck.com/image.jpg",
  ]) {
    assert.throws(() => parseApprovedRemoteImageUrl(url), RemoteImageError);
  }
});

test("rejects loopback, private, link-local, mapped, NAT64, special, and malformed addresses", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.1.1", "192.88.99.1", "192.168.1.1", "::1", "fe80::1", "fec0::1", "fd00::1", "2001::1", "2001:db8::1", "::ffff:7f00:1", "64:ff9b::c0a8:1", "64:ff9b:1::1", "2002:0a00:1::1", "not-an-address"]) {
    assert.equal(isPublicRemoteAddress(address), false, address);
  }
  assert.equal(isPublicRemoteAddress("8.8.8.8"), true);
  assert.equal(isPublicRemoteAddress("2606:4700:4700::1111"), true);
});

test("retrieves a normal approved image through a validated resolved address", async () => {
  let requestedAddress = "";
  const retriever = createRemoteImageRetriever({
    request: async (_url, address) => {
      requestedAddress = address.address;
      return successfulResponse();
    },
    resolve: publicResolver,
  });
  const image = await retriever.retrieve(source);
  assert.equal(requestedAddress, "8.8.8.8");
  assert.equal(image.contentType, "image/png");
  assert.deepEqual(image.bytes, png);
});

test("revalidates every redirect destination and refuses an unapproved hop", async () => {
  const resolved: string[] = [];
  const retriever = createRemoteImageRetriever({
    request: async (url) => url.hostname === "images.ygoprodeck.com"
      ? { body: body(), headers: { location: "https://tcgplayer-cdn.tcgplayer.com/product/1.jpg" }, statusCode: 302 }
      : successfulResponse(),
    resolve: async (hostname) => {
      resolved.push(hostname);
      return publicResolver(hostname);
    },
  });
  await retriever.retrieve(source);
  assert.deepEqual(resolved, ["images.ygoprodeck.com", "tcgplayer-cdn.tcgplayer.com"]);

  const blocked = createRemoteImageRetriever({
    request: async () => ({ body: body(), headers: { location: "https://example.test/image.jpg" }, statusCode: 302 }),
    resolve: publicResolver,
  });
  await assert.rejects(blocked.retrieve(source), (error: unknown) => error instanceof RemoteImageError && error.code === "unavailable");
});

test("fails closed for timeout, wrong type, mismatched signature, truncated stream, and oversized stream", async () => {
  const cases = [
    createRemoteImageRetriever({ request: async () => { throw new RemoteImageError("timed_out"); }, resolve: publicResolver }),
    createRemoteImageRetriever({ request: async () => ({ body: body(new Uint8Array([1])), headers: { "content-type": "text/html" }, statusCode: 200 }), resolve: publicResolver }),
    createRemoteImageRetriever({ request: async () => ({ body: body(new Uint8Array([1, 2, 3])), headers: { "content-type": "image/png" }, statusCode: 200 }), resolve: publicResolver }),
    createRemoteImageRetriever({ request: async () => ({ body: body(png), headers: { "content-length": String(png.byteLength + 1), "content-type": "image/png" }, statusCode: 200 }), resolve: publicResolver }),
    createRemoteImageRetriever({ request: async () => successfulResponse(new Uint8Array(remoteImagePolicy.maxBytes + 1)), resolve: publicResolver }),
  ];
  for (const retriever of cases) await assert.rejects(retriever.retrieve(source), RemoteImageError);
});

test("the total deadline also stops a slow streamed body", async () => {
  async function* slowBody() {
    await new Promise((resolve) => setTimeout(resolve, 20));
    yield png;
  }
  const retriever = createRemoteImageRetriever({
    request: async () => ({ body: slowBody(), headers: { "content-type": "image/png" }, statusCode: 200 }),
    requestTimeoutMs: 5,
    resolve: publicResolver,
  });
  await assert.rejects(retriever.retrieve(source), (error: unknown) => error instanceof RemoteImageError && error.code === "timed_out");
});

test("uses bounded successful-response caching and applies the per-client abuse limit", async () => {
  let calls = 0;
  let now = 10_000;
  const retriever = createRemoteImageRetriever({
    now: () => now,
    request: async () => {
      calls += 1;
      return successfulResponse();
    },
    resolve: publicResolver,
  });
  await retriever.retrieve(source, { abuseKey: "client-a" });
  await retriever.retrieve(source, { abuseKey: "client-a" });
  assert.equal(calls, 1, "the second response comes from the bounded cache");
  now += remoteImagePolicy.cacheTtlMs + 1;
  await retriever.retrieve(source, { abuseKey: "client-b" });
  assert.equal(calls, 2, "expired entries refetch");

  const limited = createRemoteImageRetriever({ request: async () => successfulResponse(), resolve: publicResolver });
  for (let count = 0; count < remoteImagePolicy.maxRequestsPerClientPerMinute; count += 1) {
    await limited.retrieve(source, { abuseKey: "busy-client" });
  }
  await assert.rejects(limited.retrieve(source, { abuseKey: "busy-client" }), (error: unknown) => error instanceof RemoteImageError && error.code === "rate_limited");
});

test("prunes expired client rate keys and keeps the rate map bounded", async () => {
  let now = 10_000;
  const retriever = createRemoteImageRetriever({
    now: () => now,
    request: async () => successfulResponse(),
    resolve: publicResolver,
  });
  for (let count = 0; count < 12; count += 1) await retriever.retrieve(source, { abuseKey: `old-client-${count}` });
  assert.equal(retriever.rateEntryCountForTests(), 12);
  now += remoteImagePolicy.rateWindowMs + 1;
  await retriever.retrieve(source, { abuseKey: "current-client" });
  assert.equal(retriever.rateEntryCountForTests(), 1);

  for (let count = 0; count <= remoteImagePolicy.maxRateEntries; count += 1) {
    await retriever.retrieve(source, { abuseKey: `rotating-client-${count}` });
  }
  assert.equal(retriever.rateEntryCountForTests(), remoteImagePolicy.maxRateEntries);
});
