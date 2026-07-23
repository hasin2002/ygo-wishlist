import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedAuthHosts,
  getAuthClientFetchHeaders,
  getAllowedRequestOrigin,
  isAllowedAuthOrigin,
} from "../src/lib/auth-hosts.ts";

test("the approved auth host allowlist contains every supported environment", () => {
  assert.deepEqual(allowedAuthHosts, [
    "localhost:3000",
    "armless-backslid-surrogate.ngrok-free.dev",
    "ygo-wishlist.vercel.app",
  ]);
});

test("only approved origins are accepted", () => {
  assert.equal(isAllowedAuthOrigin("http://localhost:3000"), true);
  assert.equal(isAllowedAuthOrigin("https://armless-backslid-surrogate.ngrok-free.dev"), true);
  assert.equal(isAllowedAuthOrigin("https://ygo-wishlist.vercel.app"), true);
  assert.equal(isAllowedAuthOrigin("http://armless-backslid-surrogate.ngrok-free.dev"), false);
  assert.equal(isAllowedAuthOrigin("https://attacker.example"), false);
  assert.equal(isAllowedAuthOrigin("https://ygo-wishlist.vercel.app/path"), false);
});

test("only the configured ngrok host bypasses the browser warning", () => {
  assert.deepEqual(
    getAuthClientFetchHeaders("armless-backslid-surrogate.ngrok-free.dev"),
    { "ngrok-skip-browser-warning": "true" },
  );
  assert.equal(getAuthClientFetchHeaders("localhost"), undefined);
  assert.equal(getAuthClientFetchHeaders("ygo-wishlist.vercel.app"), undefined);
  assert.equal(getAuthClientFetchHeaders("untrusted.ngrok-free.dev"), undefined);
});

test("the request origin uses validated forwarded public host and protocol", () => {
  const localRequest = new Request("http://localhost:3000/api/ebay/disconnect");
  const request = new Request("http://localhost:3000/api/ebay/disconnect", {
    headers: {
      "x-forwarded-host": "armless-backslid-surrogate.ngrok-free.dev",
      "x-forwarded-proto": "https",
    },
  });
  const vercelRequest = new Request("http://localhost:3000/api/ebay/disconnect", {
    headers: {
      "x-forwarded-host": "ygo-wishlist.vercel.app",
      "x-forwarded-proto": "https",
    },
  });

  assert.equal(getAllowedRequestOrigin(localRequest), "http://localhost:3000");
  assert.equal(
    getAllowedRequestOrigin(request),
    "https://armless-backslid-surrogate.ngrok-free.dev",
  );
  assert.equal(getAllowedRequestOrigin(vercelRequest), "https://ygo-wishlist.vercel.app");
});

test("the request origin rejects unapproved forwarded hosts", () => {
  const request = new Request("http://localhost:3000/api/ebay/disconnect", {
    headers: {
      "x-forwarded-host": "attacker.example",
      "x-forwarded-proto": "https",
    },
  });

  assert.equal(getAllowedRequestOrigin(request), null);
});
