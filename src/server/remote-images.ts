import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import type { IncomingHttpHeaders } from "node:http";

/** The application only proxies catalogue images from these supported providers. */
export const approvedRemoteImageHosts = new Set([
  "images.ygoprodeck.com",
  "product-images.tcgplayer.com",
  "tcgplayer-cdn.tcgplayer.com",
]);

export const remoteImagePolicy = {
  cacheEntries: 32,
  cacheTtlMs: 10 * 60_000,
  maxBytes: 5 * 1024 * 1024,
  maxRedirects: 3,
  maxUrlLength: 8_192,
  requestTimeoutMs: 8_000,
  maxConcurrentRequests: 8,
  maxRequestsPerClientPerMinute: 24,
  maxRequestsPerMinute: 120,
  maxRateEntries: 64,
  rateWindowMs: 60_000,
} as const;

const imageTypes = new Set([
  "image/avif", "image/bmp", "image/gif", "image/heic", "image/jpeg",
  "image/png", "image/tiff", "image/webp",
]);

type Address = { address: string; family: 4 | 6 };
type RemoteResponse = {
  body: AsyncIterable<Uint8Array>;
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
  statusCode: number;
};
type CacheEntry = { bytes: Uint8Array; contentType: string; expiresAt: number };
type RateEntry = { count: number; startedAt: number };

export class RemoteImageError extends Error {
  readonly code: "invalid_url" | "unavailable" | "too_large" | "invalid_image" | "rate_limited" | "timed_out";

  constructor(code: "invalid_url" | "unavailable" | "too_large" | "invalid_image" | "rate_limited" | "timed_out") {
    super("The image could not be retrieved.");
    this.code = code;
  }
}

function header(headers: RemoteResponse["headers"], name: string) {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function isPublicIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first, second, third] = octets;
  if (first === 0 || first === 10 || first === 127 || first >= 224) return false;
  if (first === 100 && second >= 64 && second <= 127) return false;
  if (first === 169 && second === 254) return false;
  if (first === 172 && second >= 16 && second <= 31) return false;
  if (first === 192 && (second === 0 || second === 168 || (second === 88 && third === 99))) return false;
  if (first === 198 && (second === 18 || second === 19 || second === 51)) return false;
  if (first === 203 && second === 0) return false;
  return true;
}

function ipv6Bytes(address: string) {
  const [left, right, ...extra] = address.toLowerCase().split("::");
  if (extra.length) return null;
  const segments = (part: string) => part ? part.split(":") : [];
  const leftSegments = segments(left);
  const rightSegments = segments(right);
  const expandIpv4 = (values: string[]) => {
    const last = values.at(-1);
    if (!last?.includes(".")) return values;
    if (isIP(last) !== 4) return [];
    const octets = last.split(".").map(Number);
    return [...values.slice(0, -1), ((octets[0]! << 8) | octets[1]!).toString(16), ((octets[2]! << 8) | octets[3]!).toString(16)];
  };
  const expandedLeft = expandIpv4(leftSegments);
  const expandedRight = expandIpv4(rightSegments);
  if (!expandedLeft.length && leftSegments.length || !expandedRight.length && rightSegments.length) return null;
  const count = expandedLeft.length + expandedRight.length;
  if ((address.includes("::") && count > 7) || (!address.includes("::") && count !== 8)) return null;
  const values = address.includes("::")
    ? [...expandedLeft, ...Array(8 - count).fill("0"), ...expandedRight]
    : [...expandedLeft, ...expandedRight];
  const bytes: number[] = [];
  for (const value of values) {
    if (!/^[0-9a-f]{1,4}$/.test(value)) return null;
    const number = Number.parseInt(value, 16);
    bytes.push(number >> 8, number & 0xff);
  }
  return bytes;
}

function startsWithBytes(bytes: number[], ...prefix: number[]) {
  return prefix.every((value, index) => bytes[index] === value);
}

function isPublicIpv6(address: string) {
  const bytes = ipv6Bytes(address);
  if (!bytes) return false;
  if (bytes.every((byte) => byte === 0) || startsWithBytes(bytes, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1)) return false;
  if (bytes[0]! === 0xfc || bytes[0]! === 0xfd || bytes[0]! === 0xff || (bytes[0]! === 0xfe && (bytes[1]! & 0xc0) === 0x80) || (bytes[0]! === 0xfe && (bytes[1]! & 0xc0) === 0xc0)) return false;
  if (startsWithBytes(bytes, 0x20, 0x01, 0x0d, 0xb8) || startsWithBytes(bytes, 0x01, 0x00, 0, 0, 0, 0, 0, 0) || startsWithBytes(bytes, 0x20, 0x01, 0x00, 0x02) || startsWithBytes(bytes, 0x20, 0x01, 0, 0)) return false;
  // IPv4-compatible/mapped IPv6, NAT64, and 6to4 must not hide a non-public IPv4 destination.
  const embeddedIpv4 = (offset: number) => bytes.slice(offset, offset + 4).join(".");
  if (bytes.slice(0, 12).every((byte) => byte === 0) || startsWithBytes(bytes, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff) || startsWithBytes(bytes, 0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0)) return isPublicIpv4(embeddedIpv4(12));
  if (startsWithBytes(bytes, 0x00, 0x64, 0xff, 0x9b, 0x00, 0x01)) return false;
  if (startsWithBytes(bytes, 0x20, 0x02)) return isPublicIpv4(embeddedIpv4(2));
  return true;
}

export function isPublicRemoteAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? isPublicIpv4(address) : family === 6 ? isPublicIpv6(address) : false;
}

/** Validates syntax and provider ownership before DNS lookup or network activity. */
export function parseApprovedRemoteImageUrl(value: string) {
  if (!value || value !== value.trim() || value.length > remoteImagePolicy.maxUrlLength) throw new RemoteImageError("invalid_url");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RemoteImageError("invalid_url");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !approvedRemoteImageHosts.has(url.hostname.toLowerCase())) {
    throw new RemoteImageError("invalid_url");
  }
  return url;
}

function contentType(value: string | undefined) {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function hasExpectedImageSignature(bytes: Uint8Array, type: string) {
  const startsWith = (...expected: number[]) => expected.every((byte, index) => bytes[index] === byte);
  switch (type) {
    case "image/avif": return bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp" && String.fromCharCode(...bytes.slice(8, 12)).startsWith("avi");
    case "image/bmp": return startsWith(0x42, 0x4d);
    case "image/gif": return startsWith(0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || startsWith(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
    case "image/heic": return bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp" && /^(heic|heix|hevc|hevx|mif1)$/.test(String.fromCharCode(...bytes.slice(8, 12)));
    case "image/jpeg": return startsWith(0xff, 0xd8, 0xff);
    case "image/png": return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/tiff": return startsWith(0x49, 0x49, 0x2a, 0x00) || startsWith(0x4d, 0x4d, 0x00, 0x2a);
    case "image/webp": return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
    default: return false;
  }
}

function isRedirect(statusCode: number) {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}

function destroyBody(body: AsyncIterable<Uint8Array>) {
  if ("destroy" in body && typeof body.destroy === "function") body.destroy();
}

async function defaultResolve(hostname: string): Promise<Address[]> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map((address) => ({ address: address.address, family: address.family === 6 ? 6 : 4 }));
}

async function defaultRequest(url: URL, address: Address, timeoutMs: number, signal?: AbortSignal): Promise<RemoteResponse> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest({
      agent: false,
      family: address.family,
      headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8", host: url.host, "user-agent": "CollectionHub/1.0 remote-image" },
      hostname: address.address,
      method: "GET",
      path: `${url.pathname}${url.search}`,
      port: 443,
      rejectUnauthorized: true,
      servername: url.hostname,
      timeout: timeoutMs,
    }, (response) => resolve({ body: response, headers: response.headers, statusCode: response.statusCode ?? 0 }));
    request.once("timeout", () => request.destroy(new RemoteImageError("timed_out")));
    signal?.addEventListener("abort", () => request.destroy(new RemoteImageError("timed_out")), { once: true });
    request.once("error", reject);
    request.end();
  });
}

function beforeDeadline<T>(promise: Promise<T>, deadline: number, onTimeout?: () => void) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    onTimeout?.();
    return Promise.reject(new RemoteImageError("timed_out"));
  }
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      onTimeout?.();
      reject(new RemoteImageError("timed_out"));
    }, remaining);
    promise.then((value) => {
      clearTimeout(timeout);
      resolve(value);
    }, (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

export function createRemoteImageRetriever({
  now = () => Date.now(), request = defaultRequest, resolve = defaultResolve, requestTimeoutMs = remoteImagePolicy.requestTimeoutMs,
}: {
  now?: () => number;
  request?: (url: URL, address: Address, timeoutMs: number, signal?: AbortSignal) => Promise<RemoteResponse>;
  resolve?: (hostname: string) => Promise<Address[]>;
  /** Test seam; production always uses the documented policy deadline. */
  requestTimeoutMs?: number;
} = {}) {
  const cache = new Map<string, CacheEntry>();
  const clientRates = new Map<string, RateEntry>();
  let globalRate: RateEntry = { count: 0, startedAt: 0 };
  let inFlight = 0;

  function consumeRateLimit(key: string) {
    const timestamp = now();
    if (timestamp - globalRate.startedAt >= remoteImagePolicy.rateWindowMs) globalRate = { count: 0, startedAt: timestamp };
    for (const [rateKey, rate] of clientRates) {
      if (timestamp - rate.startedAt >= remoteImagePolicy.rateWindowMs) clientRates.delete(rateKey);
    }
    const previous = clientRates.get(key);
    const client = !previous || timestamp - previous.startedAt >= remoteImagePolicy.rateWindowMs ? { count: 0, startedAt: timestamp } : previous;
    if (globalRate.count >= remoteImagePolicy.maxRequestsPerMinute || client.count >= remoteImagePolicy.maxRequestsPerClientPerMinute) throw new RemoteImageError("rate_limited");
    if (!previous && clientRates.size >= remoteImagePolicy.maxRateEntries) clientRates.delete(clientRates.keys().next().value!);
    globalRate.count += 1;
    client.count += 1;
    clientRates.delete(key);
    clientRates.set(key, client);
  }

  function cacheResult(key: string, result: CacheEntry) {
    if (result.bytes.byteLength > remoteImagePolicy.maxBytes / 2) return;
    cache.delete(key);
    cache.set(key, result);
    while (cache.size > remoteImagePolicy.cacheEntries) cache.delete(cache.keys().next().value!);
  }

  async function resolveApprovedAddress(url: URL) {
    let addresses: Address[];
    try {
      addresses = await resolve(url.hostname);
    } catch {
      throw new RemoteImageError("unavailable");
    }
    if (!addresses.length || addresses.some((address) => !isPublicRemoteAddress(address.address))) throw new RemoteImageError("unavailable");
    return addresses[0]!;
  }

  return {
    async retrieve(value: string, { abuseKey = "anonymous" }: { abuseKey?: string } = {}) {
      const initialUrl = parseApprovedRemoteImageUrl(value);
      const key = initialUrl.href;
      consumeRateLimit(abuseKey.slice(0, 128));
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now()) {
        cache.delete(key);
        cache.set(key, cached);
        return { bytes: new Uint8Array(cached.bytes), contentType: cached.contentType };
      }
      if (inFlight >= remoteImagePolicy.maxConcurrentRequests) throw new RemoteImageError("rate_limited");
      inFlight += 1;
      const controller = new AbortController();
      const deadline = Date.now() + requestTimeoutMs;
      try {
        let url = initialUrl;
        for (let redirects = 0; redirects <= remoteImagePolicy.maxRedirects; redirects += 1) {
          const address = await beforeDeadline(resolveApprovedAddress(url), deadline, () => controller.abort());
          let response: RemoteResponse;
          try {
            response = await beforeDeadline(request(url, address, Math.max(1, deadline - Date.now()), controller.signal), deadline, () => controller.abort());
          } catch (error) {
            throw error instanceof RemoteImageError ? error : new RemoteImageError("unavailable");
          }
          if (isRedirect(response.statusCode)) {
            const location = header(response.headers, "location");
            destroyBody(response.body);
            if (!location || redirects === remoteImagePolicy.maxRedirects) throw new RemoteImageError("unavailable");
            try {
              url = parseApprovedRemoteImageUrl(new URL(location, url).href);
            } catch {
              throw new RemoteImageError("unavailable");
            }
            continue;
          }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            destroyBody(response.body);
            throw new RemoteImageError("unavailable");
          }
          const type = contentType(header(response.headers, "content-type"));
          if (!imageTypes.has(type)) {
            destroyBody(response.body);
            throw new RemoteImageError("invalid_image");
          }
          const declaredLength = Number(header(response.headers, "content-length"));
          if (Number.isFinite(declaredLength) && (declaredLength < 1 || declaredLength > remoteImagePolicy.maxBytes)) {
            destroyBody(response.body);
            throw new RemoteImageError("too_large");
          }
          const chunks: Uint8Array[] = [];
          let total = 0;
          try {
            const iterator = response.body[Symbol.asyncIterator]();
            for (;;) {
              const next = await beforeDeadline(iterator.next(), deadline, () => {
                controller.abort();
                destroyBody(response.body);
              });
              if (next.done) break;
              const chunk = next.value;
              total += chunk.byteLength;
              if (total > remoteImagePolicy.maxBytes) {
                destroyBody(response.body);
                throw new RemoteImageError("too_large");
              }
              chunks.push(new Uint8Array(chunk));
            }
          } catch (error) {
            throw error instanceof RemoteImageError ? error : new RemoteImageError("unavailable");
          }
          if (Number.isFinite(declaredLength) && total !== declaredLength) throw new RemoteImageError("invalid_image");
          const bytes = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          if (!hasExpectedImageSignature(bytes, type)) throw new RemoteImageError("invalid_image");
          cacheResult(key, { bytes, contentType: type, expiresAt: now() + remoteImagePolicy.cacheTtlMs });
          return { bytes: new Uint8Array(bytes), contentType: type };
        }
        throw new RemoteImageError("unavailable");
      } finally {
        inFlight -= 1;
      }
    },
    rateEntryCountForTests() {
      return clientRates.size;
    },
  };
}

export const remoteImageRetriever = createRemoteImageRetriever();
