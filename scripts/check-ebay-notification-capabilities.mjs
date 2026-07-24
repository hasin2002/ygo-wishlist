import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const clientId = process.env.EBAY_CLIENT_ID?.trim();
const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim();
const baseUrl = process.env.EBAY_NOTIFICATION_SANDBOX === "true"
  ? "https://api.sandbox.ebay.com"
  : "https://api.ebay.com";

if (!clientId || !clientSecret) {
  console.error("eBay notification probe skipped: EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be configured.");
  process.exitCode = 1;
} else {
  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const tokenResponse = await fetch(`${baseUrl}/identity/v1/oauth2/token`, {
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "https://api.ebay.com/oauth/api_scope",
      }),
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });
    const token = await tokenResponse.json().catch(() => null);
    if (!tokenResponse.ok || typeof token?.access_token !== "string") {
      console.error(`eBay notification probe failed while obtaining an application token (HTTP ${tokenResponse.status}).`);
      process.exitCode = 1;
    } else {
      const topicsResponse = await fetch(`${baseUrl}/commerce/notification/v1/topic`, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      const payload = await topicsResponse.json().catch(() => null);
      if (!topicsResponse.ok || !Array.isArray(payload?.topics)) {
        console.error(`eBay notification probe failed while reading topics (HTTP ${topicsResponse.status}).`);
        process.exitCode = 1;
      } else {
        for (const topicId of ["LISTING", "ORDER_CONFIRMATION"]) {
          const topic = payload.topics.find((candidate) => candidate?.topicId === topicId);
          if (!topic) {
            console.log(`${topicId}: unavailable to this application keyset.`);
            continue;
          }
          const scopes = Array.isArray(topic.authorizationScopes) ? topic.authorizationScopes.join(", ") : "none reported";
          console.log(`${topicId}: ${topic.status ?? "unknown status"}; ${topic.scope ?? "unknown scope"}; required scopes: ${scopes}.`);
        }
        const configResponse = await fetch(`${baseUrl}/commerce/notification/v1/config`, {
          headers: { Authorization: `Bearer ${token.access_token}` },
        });
        const config = await configResponse.json().catch(() => null);
        if (configResponse.ok) {
          console.log(`Notification alert configuration: ${typeof config?.alertEmail === "string" && config.alertEmail.trim() ? "present" : "missing"}.`);
        } else if (configResponse.status === 404) {
          console.log("Notification alert configuration: missing.");
        } else {
          console.log(`Notification alert configuration: could not be checked (HTTP ${configResponse.status}).`);
        }
      }
    }
  } catch {
    console.error("eBay notification probe could not reach eBay.");
    process.exitCode = 1;
  }
}
