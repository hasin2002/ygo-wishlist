import assert from "node:assert/strict";
import test from "node:test";
import {
  createSignedEbayOAuthState,
  ebayOAuthStateLifetimeMs,
  parseSignedEbayOAuthState,
} from "../src/lib/ebay-oauth-state.ts";

const secret = "test-only-signing-secret";
const issuedAt = 1_000_000;

test("replacement state is signed, short-lived, and binds its owner and Copy return path", () => {
  const state = createSignedEbayOAuthState("owner-a", secret, {
    now: issuedAt,
    purpose: "replacement",
    returnTo: "/records/inventory/card/target-a?copy=copy-a",
  });
  const parsed = parseSignedEbayOAuthState(state, secret, issuedAt + 1);
  assert.equal(parsed?.ownerId, "owner-a");
  assert.equal(parsed?.purpose, "replacement");
  assert.equal(parsed?.returnTo, "/records/inventory/card/target-a?copy=copy-a");
  assert.notEqual(parsed?.ownerId, "owner-b");
});

test("tampering, expiry, and a wrong signing secret are rejected before any exchange", () => {
  const state = createSignedEbayOAuthState("owner-a", secret, { now: issuedAt, purpose: "replacement" });
  const [payload, signature] = state.split(".");
  assert.equal(parseSignedEbayOAuthState(`${payload}x.${signature}`, secret, issuedAt + 1), null);
  assert.equal(parseSignedEbayOAuthState(state, "another-secret", issuedAt + 1), null);
  assert.equal(parseSignedEbayOAuthState(state, secret, issuedAt + ebayOAuthStateLifetimeMs + 1), null);
});
