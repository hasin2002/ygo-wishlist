import assert from "node:assert/strict";
import test from "node:test";
import { ebayListingDetailHref, ebayListingsHref, parseEbayListingsRouteState, serializeEbayListingsRouteState } from "../src/lib/records/ebay-listings-route-state.ts";

test("Listings route state round-trips search, filters, and page", () => {
  const state = parseEbayListingsRouteState(new URLSearchParams("query=Blue-Eyes&lifecycle=needs_attention&composition=bundle&page=3"));
  assert.deepEqual(state, { composition: "bundle", lifecycle: "needs_attention", page: 3, query: "Blue-Eyes" });
  assert.equal(serializeEbayListingsRouteState(state).toString(), "query=Blue-Eyes&lifecycle=needs_attention&composition=bundle&page=3");
  assert.equal(ebayListingsHref(state), "/records/listings?query=Blue-Eyes&lifecycle=needs_attention&composition=bundle&page=3");
  assert.equal(ebayListingDetailHref("listing/1", state), "/records/listings/listing%2F1?query=Blue-Eyes&lifecycle=needs_attention&composition=bundle&page=3");
});

test("Listings route state rejects unknown filters and invalid pages", () => {
  assert.deepEqual(parseEbayListingsRouteState(new URLSearchParams("lifecycle=nope&composition=mixed&page=0")), { composition: "all", lifecycle: "all", page: 1, query: "" });
});
