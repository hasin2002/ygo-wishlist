function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Keeps the legacy notification credential isolated from ordinary OAuth calls. */
export function ebayTradingRequestAuthentication({
  authToken,
  oauthAccessToken,
}: {
  authToken?: string;
  oauthAccessToken?: string;
}) {
  const normalizedAuthToken = authToken?.trim();
  const normalizedOauthToken = oauthAccessToken?.trim();
  if (Boolean(normalizedAuthToken) === Boolean(normalizedOauthToken)) {
    throw new TypeError("Provide exactly one Trading API authentication token.");
  }
  if (normalizedAuthToken) {
    return {
      authorizationHeaders: {} as Record<string, string>,
      requesterCredentialsXml: `<RequesterCredentials><eBayAuthToken>${xmlEscape(normalizedAuthToken)}</eBayAuthToken></RequesterCredentials>`,
    };
  }
  return {
    authorizationHeaders: {
      "X-EBAY-API-IAF-TOKEN": normalizedOauthToken!,
    },
    requesterCredentialsXml: "",
  };
}

/** GetTokenStatus is the Auth'n'Auth exception that also requires app keys. */
export function ebayTradingAuthTokenKeysetHeaders({
  appId,
  authToken,
  callName,
  certId,
  devId,
}: {
  appId?: string;
  authToken?: string;
  callName: string;
  certId?: string;
  devId?: string;
}) {
  if (callName !== "GetTokenStatus" || !authToken?.trim()) {
    return {} as Record<string, string>;
  }
  const normalizedAppId = appId?.trim();
  const normalizedCertId = certId?.trim();
  const normalizedDevId = devId?.trim();
  if (!normalizedAppId || !normalizedCertId || !normalizedDevId) {
    throw new TypeError(
      "GetTokenStatus requires the eBay AppID, DevID, and CertID.",
    );
  }
  return {
    "X-EBAY-API-APP-NAME": normalizedAppId,
    "X-EBAY-API-CERT-NAME": normalizedCertId,
    "X-EBAY-API-DEV-NAME": normalizedDevId,
  };
}
