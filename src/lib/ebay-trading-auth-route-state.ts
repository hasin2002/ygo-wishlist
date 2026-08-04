export const ebayTradingAuthSessionCookieName = "ebay-trading-auth-session";

export function ebayTradingAuthSessionCookieOptions() {
  return {
    httpOnly: true,
    maxAge: 5 * 60,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

export function clearEbayTradingAuthSessionCookie<T extends {
  cookies: { delete: (options: { name: string; path: string }) => void };
}>(response: T): T {
  response.cookies.delete({ name: ebayTradingAuthSessionCookieName, path: "/" });
  return response;
}
