export const ebayOAuthStateCookieName = "ebay-oauth-state";

export function ebayOAuthStateCookieOptions() {
  return {
    httpOnly: true,
    maxAge: 10 * 60,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

export function clearEbayOAuthStateCookie<T extends {
  cookies: { delete: (options: { name: string; path: string }) => void };
}>(response: T): T {
  response.cookies.delete({ name: ebayOAuthStateCookieName, path: "/" });
  return response;
}
