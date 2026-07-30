/**
 * Safe, internal navigation destinations used when a user crosses a workflow
 * boundary (sign-in, global Add, and Records task return links). Keeping this
 * in one place prevents individual screens from accidentally accepting an
 * open redirect or forgetting URL-backed workspace state.
 */
export type NavigationIntent = Readonly<{
  href: string;
  pathname: string;
}>;

export type SaleReviewIntent = Readonly<{
  recordId: string;
}>;

const fallbackHref = "/records";
const maximumHrefLength = 2_048;
const disallowedCharacter = /[\\\u0000-\u001f\u007f]/;
const encodedPathSeparator = /%(?:2f|5c)/i;

/**
 * Proxy overwrites this request-only header for every protected navigation.
 * Server-side guards can therefore preserve the exact URL even when a stale
 * session-shaped cookie caused Proxy to optimistically continue the request.
 */
export const protectedNavigationIntentHeader = "x-ygo-protected-navigation-intent";

function isAllowedPathname(pathname: string) {
  return pathname === "/"
    || pathname === "/assign-chase"
    || pathname === "/spend"
    || pathname === "/wheel"
    || pathname === "/wishlist/new"
    || pathname === "/ebay"
    || pathname.startsWith("/ebay/")
    || pathname === "/records"
    || pathname.startsWith("/records/");
}

/**
 * Parse only app-owned protected routes. The browser URL constructor handles
 * malformed query strings consistently; the surrounding checks deliberately
 * reject protocol-relative, external, encoded-separator, and control-char
 * inputs before a router or redirect ever receives them.
 */
export function parseNavigationIntent(value: unknown): NavigationIntent | null {
  if (typeof value !== "string" || !value || value.length > maximumHrefLength) return null;
  if (!value.startsWith("/") || value.startsWith("//") || disallowedCharacter.test(value)) return null;

  const pathnameEnd = value.search(/[?#]/);
  const rawPathname = pathnameEnd === -1 ? value : value.slice(0, pathnameEnd);
  let decodedValue: string;
  try {
    decodedValue = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (disallowedCharacter.test(decodedValue) || /(?:^|\/)\.\.?(?:\/|$)/.test(decodeURIComponent(rawPathname))) return null;

  let url: URL;
  try {
    url = new URL(value, "https://collection-hub.invalid");
  } catch {
    return null;
  }

  if (url.origin !== "https://collection-hub.invalid" || encodedPathSeparator.test(url.pathname)) return null;
  if (!isAllowedPathname(url.pathname)) return null;

  return {
    href: `${url.pathname}${url.search}${url.hash}`,
    pathname: url.pathname,
  };
}

export function serializeNavigationIntent(intent: NavigationIntent) {
  return intent.href;
}

export function safeNavigationHref(value: unknown, fallback = fallbackHref) {
  return parseNavigationIntent(value)?.href ?? fallback;
}

export function loginHref(destination: string | NavigationIntent | null | undefined) {
  const intent = typeof destination === "string"
    ? parseNavigationIntent(destination)
    : destination;
  return intent ? `/login?next=${encodeURIComponent(serializeNavigationIntent(intent))}` : "/login";
}

/**
 * Build a sign-in URL from Proxy's request header, with a route-specific
 * fallback for requests that did not pass through Proxy (such as unit tests).
 */
export function protectedLoginHref(
  proxyIntent: string | null | undefined,
  fallback: string | NavigationIntent,
) {
  return loginHref(parseNavigationIntent(proxyIntent) ?? fallback);
}

export function addTaskHref(taskPathname: "/wishlist/new" | "/records/new/purchase" | "/records/new/opening" | "/records/new/sale" | "/records/listings/new-lot", origin: string | NavigationIntent | null | undefined) {
  const intent = typeof origin === "string" ? parseNavigationIntent(origin) : origin;
  if (!intent) return taskPathname;
  return `${taskPathname}?origin=${encodeURIComponent(serializeNavigationIntent(intent))}`;
}

export function taskReturnHref(origin: string | null | undefined, fallback = fallbackHref) {
  return safeNavigationHref(origin, fallback);
}

export function parseSaleReviewIntent(value: unknown): SaleReviewIntent | null {
  if (typeof value !== "string" || !value || value.length > 160 || disallowedCharacter.test(value)) return null;
  return { recordId: value };
}

export function reviewSaleHref(value: unknown) {
  const intent = parseSaleReviewIntent(value);
  return intent ? `/records/history?record=${encodeURIComponent(intent.recordId)}` : "/records/history";
}

export function currentNavigationHref(pathname: string | null, searchParams: Pick<URLSearchParams, "toString"> | null) {
  const search = searchParams?.toString();
  return parseNavigationIntent(`${pathname || "/"}${search ? `?${search}` : ""}`);
}
