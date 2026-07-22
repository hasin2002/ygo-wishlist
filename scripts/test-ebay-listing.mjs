import crypto from "node:crypto";
import fs from "node:fs/promises";
import pg from "pg";

const marketplaceId = process.env.EBAY_MARKETPLACE_ID || "EBAY_GB";
const publish = process.argv.includes("--publish");
const imagePath = "public/card-wall/card-01.webp";
const testCategoryId = "183454";
const tradingCompatibilityLevel = "1423";
const tradingSiteId = "3";

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xmlValue(xml, name) {
  return xml.match(new RegExp(`<${name}(?: [^>]*)?>([^<]*)</${name}>`))?.[1] ?? null;
}

function parseErrors(xml) {
  return [...xml.matchAll(/<Errors>([\s\S]*?)<\/Errors>/g)].map((match) => ({
    code: xmlValue(match[1], "ErrorCode"),
    message: xmlValue(match[1], "LongMessage") || xmlValue(match[1], "ShortMessage"),
    severity: xmlValue(match[1], "SeverityCode"),
  }));
}

function parseFees(xml) {
  return [...xml.matchAll(/<Fee>([\s\S]*?)<\/Fee>/g)].map((match) => {
    const amount = Number(xmlValue(match[1], "Fee") ?? 0);
    return {
      amount,
      currency: match[1].match(/<Fee currencyID="([^"]+)"/)?.[1] ?? "GBP",
      name: xmlValue(match[1], "Name"),
    };
  });
}

function decryptRefreshToken(connection) {
  const key = crypto
    .createHash("sha256")
    .update(requiredEnvironment("BETTER_AUTH_SECRET"))
    .update("\0ebay-seller-token-encryption-v1")
    .digest();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(connection.refresh_token_iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(connection.refresh_token_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(connection.refresh_token_ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

async function sellerAccessToken() {
  const pool = new pg.Pool({
    connectionString: requiredEnvironment("DATABASE_URL"),
    connectionTimeoutMillis: 8_000,
    statement_timeout: 12_000,
  });
  try {
    const { rows } = await pool.query("select * from ebay_connections limit 1");
    if (!rows[0]) throw new Error("No eBay seller connection is stored.");
    const connection = rows[0];
    const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: decryptRefreshToken(connection),
        scope: connection.scopes,
      }),
      headers: {
        Authorization: `Basic ${Buffer.from(`${requiredEnvironment("EBAY_CLIENT_ID")}:${requiredEnvironment("EBAY_CLIENT_SECRET")}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });
    const body = await response.json();
    if (!response.ok || !body.access_token) {
      throw new Error(`eBay token refresh failed (${response.status}).`);
    }
    return body.access_token;
  } finally {
    await pool.end();
  }
}

async function tradingCall({ accessToken, callName, innerXml }) {
  const response = await fetch("https://api.ebay.com/ws/api.dll", {
    body: `<?xml version="1.0" encoding="utf-8"?><${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents"><RequesterCredentials><eBayAuthToken>${xmlEscape(accessToken)}</eBayAuthToken></RequesterCredentials>${innerXml}</${callName}Request>`,
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-COMPATIBILITY-LEVEL": tradingCompatibilityLevel,
      "X-EBAY-API-SITEID": tradingSiteId,
    },
    method: "POST",
  });
  const xml = await response.text();
  return {
    ack: xmlValue(xml, "Ack"),
    errors: parseErrors(xml),
    fees: parseFees(xml),
    httpStatus: response.status,
    xml,
  };
}

async function sellerPostalCode(accessToken) {
  const result = await tradingCall({ accessToken, callName: "GetUser", innerXml: "" });
  if (result.ack !== "Success") {
    throw new Error(`GetUser failed: ${JSON.stringify(result.errors)}`);
  }
  const address = result.xml.match(/<RegistrationAddress>([\s\S]*?)<\/RegistrationAddress>/)?.[1];
  let postalCode = address ? xmlValue(address, "PostalCode") : null;
  if (!postalCode) {
    const selling = await tradingCall({
      accessToken,
      callName: "GetMyeBaySelling",
      innerXml: "<ActiveList><Include>true</Include><Pagination><EntriesPerPage>1</EntriesPerPage><PageNumber>1</PageNumber></Pagination></ActiveList><UnsoldList><Include>true</Include><Pagination><EntriesPerPage>1</EntriesPerPage><PageNumber>1</PageNumber></Pagination></UnsoldList>",
    });
    postalCode = xmlValue(selling.xml, "PostalCode");
  }
  return postalCode;
}

async function uploadImage(accessToken) {
  const imageBytes = await fs.readFile(imagePath);
  const form = new FormData();
  form.append("image", new Blob([imageBytes], { type: "image/webp" }), "card-01.webp");
  const response = await fetch(
    "https://apim.ebay.com/commerce/media/v1_beta/image/create_image_from_file",
    {
      body: form,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
      },
      method: "POST",
    },
  );
  const text = await response.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {}
  if (!response.ok || !body.imageUrl) {
    throw new Error(`eBay image upload failed (${response.status}): ${text.slice(0, 500)}`);
  }
  return {
    imageId: response.headers.get("location")?.split("/").pop() ?? null,
    imageUrl: body.imageUrl,
  };
}

function itemXml({ imageUrl, postalCode, uuid }) {
  const title = "Yu Gi Oh Blackwing Simoon Poison Wind Ultra Rare BLCR EN062 1st Ed NM";
  const description = "Yu-Gi-Oh! Blackwing - Simoon the Poison Wind. Battles of Legend: Crystal Revenge BLCR-EN062. Ultra Rare, 1st Edition, Near Mint. Please review all photos carefully before buying. You are buying the card described in the title and shown in the images. Please feel free to contact me with any questions or to request additional images.";
  const postalCodeXml = postalCode ? `<PostalCode>${xmlEscape(postalCode)}</PostalCode>` : "";
  return `<Item><Title>${xmlEscape(title)}</Title><Description>${xmlEscape(description)}</Description><PrimaryCategory><CategoryID>${testCategoryId}</CategoryID></PrimaryCategory><ConditionDescriptors><ConditionDescriptor><Name>40001</Name><Value>400010</Value></ConditionDescriptor></ConditionDescriptors><ConditionID>4000</ConditionID><ItemSpecifics><NameValueList><Name>Card Size</Name><Value>Japanese</Value></NameValueList><NameValueList><Name>Rarity</Name><Value>Ultra Rare</Value></NameValueList><NameValueList><Name>Manufacturer</Name><Value>Konami</Value></NameValueList><NameValueList><Name>Set</Name><Value>Battles of Legend: Crystal Revenge</Value></NameValueList><NameValueList><Name>Game</Name><Value>Yu-Gi-Oh! TCG</Value></NameValueList><NameValueList><Name>Features</Name><Value>1st Edition</Value></NameValueList><NameValueList><Name>Card Number</Name><Value>BLCR-EN062</Value></NameValueList><NameValueList><Name>Language</Name><Value>English</Value></NameValueList></ItemSpecifics><StartPrice currencyID="GBP">9.99</StartPrice><CategoryMappingAllowed>true</CategoryMappingAllowed><Country>GB</Country><Currency>GBP</Currency><DispatchTimeMax>3</DispatchTimeMax><ListingDuration>GTC</ListingDuration><ListingType>FixedPriceItem</ListingType><Location>Surrey</Location><PictureDetails><PictureURL>${xmlEscape(imageUrl)}</PictureURL></PictureDetails>${postalCodeXml}<Quantity>1</Quantity><ReturnPolicy><ReturnsAcceptedOption>ReturnsNotAccepted</ReturnsAcceptedOption></ReturnPolicy><ShippingDetails><ShippingType>Flat</ShippingType><ShippingServiceOptions><ShippingServicePriority>1</ShippingServicePriority><ShippingService>UK_RoyalMailSecondClassStandard</ShippingService><ShippingServiceCost currencyID="GBP">1.55</ShippingServiceCost><FreeShipping>false</FreeShipping></ShippingServiceOptions></ShippingDetails><Site>UK</Site><UUID>${uuid}</UUID></Item>`;
}

const accessToken = await sellerAccessToken();
const postalCode = await sellerPostalCode(accessToken);
const image = await uploadImage(accessToken);
const uuid = crypto.randomBytes(16).toString("hex").toUpperCase();
const definition = itemXml({ imageUrl: image.imageUrl, postalCode, uuid });
const verification = await tradingCall({
  accessToken,
  callName: "VerifyAddItem",
  innerXml: definition,
});
const verificationFailed = verification.errors.some((error) => error.severity === "Error");
const nonZeroFees = verification.fees.filter((fee) => Number.isFinite(fee.amount) && fee.amount > 0);

if (verificationFailed || !["Success", "Warning"].includes(verification.ack)) {
  console.log(JSON.stringify({
    action: "verify",
    ack: verification.ack,
    errors: verification.errors,
    imageUploaded: true,
  }, null, 2));
  process.exitCode = 1;
} else if (!publish) {
  console.log(JSON.stringify({
    action: "verify",
    ack: verification.ack,
    errors: verification.errors,
    imageUploaded: true,
    nonZeroFees,
    readyToPublish: nonZeroFees.length === 0,
  }, null, 2));
} else if (nonZeroFees.length > 0) {
  console.log(JSON.stringify({
    action: "publish-refused",
    reason: "eBay reported non-zero listing fees.",
    nonZeroFees,
  }, null, 2));
  process.exitCode = 1;
} else {
  const listing = await tradingCall({
    accessToken,
    callName: "AddItem",
    innerXml: definition,
  });
  const itemId = xmlValue(listing.xml, "ItemID");
  console.log(JSON.stringify({
    action: "publish",
    ack: listing.ack,
    errors: listing.errors,
    itemId,
    listingUrl: itemId ? `https://www.ebay.co.uk/itm/${itemId}` : null,
  }, null, 2));
  if (!itemId || listing.errors.some((error) => error.severity === "Error")) {
    process.exitCode = 1;
  }
}
