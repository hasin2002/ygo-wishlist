const localhostAuthHost = "localhost:3000";

export const allowedAuthHosts = [
  localhostAuthHost,
  "armless-backslid-surrogate.ngrok-free.dev",
  "ygo-wishlist.vercel.app",
] as const;

export const dynamicAuthBaseURL = {
  allowedHosts: [...allowedAuthHosts],
  protocol: "auto" as const,
};

function firstForwardedHeaderValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || null;
}

export function isAllowedAuthHost(host: string) {
  return allowedAuthHosts.includes(host.toLowerCase() as (typeof allowedAuthHosts)[number]);
}

export function isAllowedAuthOrigin(origin: string | null) {
  if (!origin) return false;

  try {
    const url = new URL(origin);
    if (url.origin !== origin || !isAllowedAuthHost(url.host)) return false;

    return url.host === localhostAuthHost || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function getAllowedRequestOrigin(request: Request) {
  const requestURL = new URL(request.url);
  const host = firstForwardedHeaderValue(request.headers.get("x-forwarded-host"))
    ?? request.headers.get("host")
    ?? requestURL.host;
  const forwardedProtocol = firstForwardedHeaderValue(request.headers.get("x-forwarded-proto"));
  const protocol = forwardedProtocol ?? requestURL.protocol.slice(0, -1);

  if (!host || (protocol !== "http" && protocol !== "https")) return null;

  const origin = `${protocol}://${host}`;
  return isAllowedAuthOrigin(origin) ? origin : null;
}
