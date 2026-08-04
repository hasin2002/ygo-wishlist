export type EbayTradingAuthorizationFailureCode =
  | "trading_authorization"
  | "trading_configuration"
  | "trading_expired"
  | "trading_incomplete"
  | "trading_temporary";

export function ebayTradingAuthorizationFailureFromText(
  text: string,
  ebayCodes: Array<string | null> = [],
): EbayTradingAuthorizationFailureCode {
  const message = text.toLowerCase();
  if (
    ebayCodes.includes("21916017")
    || message.includes("has not completed auth")
    || message.includes("has not completed the auth")
    || message.includes("complete auth & auth sign in flow")
    || message.includes("complete auth'n'auth sign in flow")
  ) {
    return "trading_incomplete";
  }
  if (
    message.includes("session has expired")
    || message.includes("session is expired")
    || message.includes("invalid session")
    || message.includes("sessionid is not valid")
    || message.includes("session id is not valid")
  ) {
    return "trading_expired";
  }
  return "trading_authorization";
}

export function ebayTradingAuthorizationFailureCanRetry(
  code: EbayTradingAuthorizationFailureCode,
) {
  return code === "trading_incomplete" || code === "trading_temporary";
}
