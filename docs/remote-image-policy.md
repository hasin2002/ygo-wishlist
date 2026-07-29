# Remote image retrieval policy

The application retrieves remote images only for the catalogue providers that
its metadata integration supports: YGOProDeck and TCGplayer's image CDNs.
Remote image URLs must use HTTPS, have no credentials or explicit port, and
match the explicit host allowlist in `src/server/remote-images.ts`.

The server parses every URL before DNS lookup, rejects non-public resolved
addresses, connects to the vetted address while preserving the provider's TLS
hostname and normal certificate verification, and repeats those checks for each
redirect. One eight-second wall-clock deadline covers DNS, connection, headers,
and the full streamed body; the body stops at 5 MiB. Responses must have an
allowed image MIME type and a matching file signature. Errors returned to
callers deliberately stay generic.

Successful small images are stored in a bounded 32-entry, ten-minute in-memory
LRU cache. The retrieval boundary limits concurrent downloads and applies both
a process-wide per-minute budget and a best-effort per-client per-minute budget
at the public proxy. Client rate keys expire after one minute and the map is
also capped at 64 least-recently-used entries, so rotating forwarded keys cannot
grow process memory without bound. Proxy errors send `Cache-Control: no-store`,
so failures cannot be retained as image results. These bounds are defensive
controls rather than durable cross-instance rate limiting; platform-level rate
limiting should remain in front of the application when it is deployed at scale.

The policy is deliberately not a general image proxy. If a new catalogue image
provider is needed, add it explicitly with tests for a normal response and
redirect behavior. Do not weaken the provider allowlist or local-address
checks to accommodate a one-off URL.
