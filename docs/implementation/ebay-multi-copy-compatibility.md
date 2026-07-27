# eBay Sandbox multi-Copy compatibility contract

Status: the local harness and its Sandbox-only safety contract are complete.
Sanitized live evidence proves a pseudonymized Sandbox seller, an authoritative
quantity-3 Listing that was verified, added, reduced to 2, increased back to 3
without an order or cancellation, and ended with `NotAvailable`, plus a second
quantity-3 Listing on which Sandbox recorded one two-unit Trading transaction.
The second Listing's order cancellation, post-cancellation quantity restoration,
and terminal end remain unavailable. During manual browser testing, the
Sandbox buyer-cancellation action generated a URL on an unresolvable eBay
Sandbox host, Seller Hub and legacy My eBay timed out, and eBay's seller cancel
action returned HTTP 500. A subsequent sanitized API capture proves the
purchase was still unpaid and not cancelled. Category evidence
identifies UK category `183455` as the leaf `CCG Mixed Card Lots`, confirms a
matching Metadata category-policy record, and records a successful
non-publishing `VerifyAddItem` probe for a quantity-1, two-card lot.

## Sandbox-only safety boundary

`scripts/ebay-sandbox-compatibility.mjs` is isolated from the application. It
has no database import and reads only:

- `EBAY_SANDBOX_ACCESS_TOKEN`, or all of `EBAY_SANDBOX_CLIENT_ID`,
  `EBAY_SANDBOX_CLIENT_SECRET`, and `EBAY_SANDBOX_REFRESH_TOKEN`;
- `EBAY_SANDBOX_MARKETPLACE_ID`, which defaults to `EBAY_GB`.

Every remote URL is restricted to `https://api.sandbox.ebay.com`; any other
host and every automatic redirect are rejected. The harness cannot read
Production `EBAY_*` inputs, the application's stored seller connection, or its
database. Trading requests carry the Sandbox User OAuth token only in the
`X-EBAY-API-IAF-TOKEN` header. REST requests use the same Sandbox token as a
Bearer credential. Credentials are never embedded in captured request XML or
evidence.

Read-only commands are `preflight`, `seller`, `read`, `category`, and `order`.
`verify-lot` is a validation-only command: it makes exactly one
`VerifyAddItem` call and never calls `AddItem`. `seller` returns only a
deterministic seller pseudonym. `order` combines
Trading `GetItemTransactions` evidence with Fulfillment `getOrders` evidence
and refuses to call the result complete unless both sources finish their
pagination checks. Trading requests include containing-order state so the
cancellation parser can distinguish exact terminal cancellation states from
pending, requested, rejected, failed, and unknown states.

Live mutation commands are `add-quantity`, `revise-inventory`, and
`end-not-available`. Every mutation requires an operation key and the exact
confirmation flag
`--confirm-sandbox-mutation=I_UNDERSTAND_THIS_MUTATES_EBAY_SANDBOX`. The CLI
prints an allowlisted plan before resolving credentials. `revise-item` remains
a request-shape helper only and cannot execute until a future captured
ReviseInventoryStatus compatibility rejection explicitly enables it.

Before a mutation can be sent, the harness writes an ignored local operation
intent containing a body hash, operation-key pseudonym, desired quantity, and
stable UUID or MessageID. Reusing an operation key with a different body is
refused. A successful AddItem, or a strictly proven duplicate-UUID recovery,
records its returned ItemID. Every revise/end requires the source Add operation
key and can target only that recorded ItemID.

Timeouts are not retried blindly. AddItem retries reuse the verified body and
the exact same deterministic 32-character uppercase hexadecimal UUID and
MessageID. Duplicate error 488 is recoverable only when structured ParamID `0`
proves same-application (`1` or `true`) and ParamID `1` contains the numeric
original ItemID. Revise/end retries first make an authoritative `GetItem` read
and obtain fresh, complete order evidence before either sending or
short-circuiting a mutation. They short-circuit only if the requested quantity
or ended state is already applied and the same order-safety gate passes;
otherwise that read proves the desired state is not applied before one resend.
Every revise/end outcome is persisted as confirmed or uncertain.

Revision and ending are fail-closed. An item with no orders must have
`QuantitySold=0`. For an unpaid Trading purchase, every Trading transaction
must have an exact terminal cancellation state and explicit unpaid evidence; a
complete, zero-match Fulfillment scan is then accepted because eBay documents
that `getOrders` omits purchases still awaiting payment. For a paid purchase,
every matching Fulfillment order must be exactly `CANCELED`, have
`paymentRefundStatus: FULLY_REFUNDED`, have
`cancelStatus.cancelState: CANCELED`, and reconcile the purchased quantity.
Pending, requested, rejected, failed, incomplete, or unknown cancellation and
payment states block mutation.

Console and capture output use a strict allowlist projector rather than
serializing raw XML or JSON and applying a denylist. It drops free text, tokens,
seller/buyer/contact/address data, order and item identifiers, payment
references, titles, descriptions, image URLs, timestamps, and unknown fields.
It retains only the evidence needed for this spike: Ack, HTTP status, error
code/severity, quantities, listing status/ending reason, safe
transaction/cancellation states, pagination facts, seller pseudonym, category
identity, and allowlisted policy facts.

## Current compatibility decisions

The decision words in this table are the runbook's `Supported`, `Unsupported`,
and `Fallback required`. A Supported decision applies only to the exact
Sandbox evidence described here and does not authorize Production use.

| Capability | Decision | Sanitized Sandbox evidence | Boundary or remaining work |
| --- | --- | --- | --- |
| Publish a homogeneous Listing with quantity above one | **Supported** | `issue14-quantity-add-v2.json` is the authoritative successful evidence: VerifyAddItem and AddItem returned Success, then GetItem reconciled Active with quantity/available 3 and sold 0 | Applies to the tested UK fixed-price Trading Listing |
| Reduce its quantity | **Supported** | `issue14-quantity-reduce.json` records confirmed 3 → 2 pre-read/readback | ReviseInventoryStatus is the supported primary operation |
| Increase it after cancellation | **Fallback required** | `issue14-quantity-increase.json` proves a plain 2 → 3 increase only; the later `issue14-order-after-cancel-ui-failure.json` capture proves the purchase was still unpaid and not cancelled | Manual browser observations found no working Sandbox cancellation UI, so the guarded restoration correctly remained blocked |
| End an individual or whole-lot Listing | **Supported** | `issue14-quantity-end.json` records confirmed Active → Ended with `NotAvailable` for the first temporary Listing | The second order-bearing Listing must not end until its cancellation evidence is terminal; heterogeneous-lot publication itself was not tested |
| Receive and reconcile a multi-unit order | **Supported** | `issue14-order-created-v2.json` is authoritative: complete Trading pagination contains one not-cancelled, unpaid transaction with quantity purchased 2; complete Fulfillment pagination returned zero orders, as expected for a purchase awaiting payment | This proves observation and quantity reconciliation, not terminal cancellation, allocation, or Sale creation |
| Validate a UK multi-card-lot Listing | **Supported** | `issue14-category-183455-v2.json` identifies leaf category `183455` as `CCG Mixed Card Lots`; `issue14-lot-verify-v2.json` records a successful, non-publishing `VerifyAddItem` with `LotSize: 2` and `Quantity: 1` | This proves eBay accepts the tested lot shape without publishing it. Actual heterogeneous-lot publication was intentionally not performed |
| ReviseItem fallback | **Unsupported** | Local request-shape tests only; no live compatibility rejection exists | Execution is disabled. No fallback is currently required because ReviseInventoryStatus succeeded |

## Evidence index

All JSON files below are strict allowlist projections. The XML files are
synthetic request templates, not captured seller data.

| Fixture | Status | What it proves |
| --- | --- | --- |
| `issue14-seller-preflight.json` | Current | GetUser succeeded for the named pseudonymous Sandbox seller |
| `issue14-quantity-item.xml` | Synthetic request template | Input used for the first temporary homogeneous quantity Listing |
| `issue14-quantity-add.json` | **Superseded negative evidence** | The first Add attempt failed with error `21916328` and warning `219026`; it has no successful verification or reconciliation and must not be cited as publish support |
| `issue14-quantity-add-v2.json` | **Authoritative quantity Add evidence** | VerifyAddItem, AddItem, and Active quantity-3 reconciliation succeeded |
| `issue14-quantity-reduce.json` | Current | Confirmed ReviseInventoryStatus reduction from 3 to 2 |
| `issue14-quantity-increase.json` | Current but limited | Confirmed plain increase from 2 to 3 without an order or cancellation |
| `issue14-quantity-end.json` | Terminal evidence for first Listing | Confirmed EndItem and readback as Ended/`NotAvailable` |
| `issue14-category-183454.json` | Earlier category evidence | Category `183454` is a leaf; no name or matching policy category was retained |
| `issue14-category-183455.json` | Superseded by v2 | Category `183455` is a leaf; the first projection omitted its name and policy category |
| `issue14-category-183455-v2.json` | **Authoritative lot-category evidence** | Category `183455` is the leaf `CCG Mixed Card Lots`; Metadata returned the same category ID |
| `issue14-lot-verify-item.xml` | Synthetic request template | Quantity-1, two-card lot used only with `VerifyAddItem` |
| `issue14-lot-verify.json` | **Superseded negative evidence** | The first non-publishing probe failed because the supplied condition was not valid for the category |
| `issue14-lot-verify-v2.json` | **Authoritative lot validation evidence** | The corrected non-publishing probe returned Success; `publishingAttempted` is false |
| `issue14-order-item.xml` | Synthetic request template | Input used for the second temporary quantity-3 order Listing in category `183454` |
| `issue14-order-add.json` | Current | VerifyAddItem, AddItem, and Active quantity-3 reconciliation succeeded for the second Listing |
| `issue14-order-created.json` | Superseded by v2 | Earlier complete pagination evidence before exact cancellation/payment states were projected |
| `issue14-order-created-v2.json` | **Authoritative live order evidence** | Complete Trading pagination shows one not-cancelled, unpaid two-unit transaction; complete Fulfillment pagination scanned one page and returned zero orders |
| `issue14-order-listing-after-purchase.json` | Current Listing evidence | The quantity-3 Listing has sold 2 and has 1 available |
| `issue14-order-after-cancel-ui-failure.json` | **Authoritative subsequent order-state evidence** | The later read-only API capture proves the two-unit purchase was still unpaid and not cancelled; the preceding UI failures are separate manual observations |

## Pagination and combined order evidence

Trading `GetItemTransactions` requests up to 200 entries on page 1 and records
`HasMoreTransactions`, page number, returned count, total entries, and total
pages. Every pagination field is mandatory. It is complete only when eBay
reports no more transactions, at most one page, and the reported counts agree
with the projected transactions. The harness fails closed rather than silently
ignoring a second Trading page or missing pagination metadata.

Fulfillment `getOrders` scans successive 50-order pages until its offset reaches
the stable, mandatory integer `total`. It rejects a changing or missing total,
a non-progressing page, more than 100 pages, a non-Sandbox URL, a redirect, or
a failed response. Only orders whose line items contain the Trading legacy
ItemID become matching evidence. Buyer, address, order ID, and other private
fields are not projected.

`issue14-order-created-v2.json` records both checks as complete. Its Trading
side contains exactly one transaction with `quantityPurchased: 2`,
`cancellationState: not-cancelled`, and `paymentState: unpaid`. Its Fulfillment
side records one page scanned, zero total orders, and no matches. This
establishes that the two-unit purchase was visible through Trading while still
awaiting payment and that the Fulfillment scan completed. It does not establish
that the purchase later became cancelled.

## Category evidence

Category evidence uses Sandbox Taxonomy REST to load the default `EBAY_GB`
category tree and validate an explicit category as a leaf, then uses Sandbox
Metadata `get_category_policies` for the same category. Category suggestions
are not accepted as compatibility evidence. `GetCategoryFeatures` was
decommissioned on 4 June 2026 and is never called by this harness.

The authoritative category fixture is `issue14-category-183455-v2.json`. It
proves the Taxonomy category name `CCG Mixed Card Lots`, leaf status, and a
matching Metadata policy category ID. Its `policyFlags` object is empty, so it
proves the policy did not return `lsd: true`; eBay's Metadata contract returns
`lsd` only when lot listings are disabled. The first non-publishing lot probe
failed because its condition was invalid for the category. After correcting
the condition from the category's Metadata policy, the authoritative
`issue14-lot-verify-v2.json` probe returned Success with `LotSize: 2`,
`Quantity: 1`, category mapping disabled, and `publishingAttempted: false`.
Category `183454` was used for the homogeneous live Listings; no heterogeneous
lot was published under `183455`.

## Exact current live state and remaining checkpoint

The first temporary Listing has terminal evidence: it was ended with
`NotAvailable`.

The second temporary Listing produced one live Trading transaction for two
units. At the authoritative observation, Trading reported it as unpaid and not
cancelled while Fulfillment returned no orders. The buyer-side cancellation
action generated a URL on the unresolvable host `sandbox.ebay.co.uk`. With the
seller account, Seller Hub timed out, legacy My eBay timed out, and eBay's
official cancel-order action returned its HTTP 500 error page. The subsequent
read-only `issue14-order-after-cancel-ui-failure.json` capture proves no
cancellation was visible in the subsequent API state. The browser failures and
their sequence are manual operator observations rather than fields embedded in
that sanitized fixture.

The required safe sequence remains terminal cancellation, authoritative order
reconciliation, quantity restoration if needed, and ending the Listing. Because
the first step is unavailable in Sandbox, the harness correctly refuses the
later mutations. Post-cancellation increase therefore requires a fallback
outside this Sandbox proof, and cleanup of the second Listing remains blocked
rather than being forced through an ambiguous order state.

[eBay's seller guidance](https://www.ebay.co.uk/help/selling/selling-getting-paid/buyer-hasnt-paid-open-unpaid-item-case?id=4137)
also says the `Buyer hasn't paid` cancellation reason becomes available only
after four calendar days. This immediate test therefore does not prove that a
delayed seller-side cancellation would fail; it proves that no safe terminal
cancellation was available during the bounded execution. That is why the
decision is `Fallback required`, not `Unsupported`.

The existing approval covers only the named Sandbox test. It does not authorize
any Production eBay operation.
