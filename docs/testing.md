# Verification

`npm run check` is the repository quality gate. It runs the auth and Records
domain suites, disposable-database transaction tests, linting, a strict
TypeScript check, a production webpack build, and the Chromium journeys in
that order. The command stops at the first failing stage.

`npm run test:transactions` never reads `.env.local`. It creates a uniquely
named PostgreSQL cluster in the system temporary directory, accepts only a
`127.0.0.1` URL whose database name starts with `ygo_wishlist_test_`, strips
deployment markers from child processes, and deletes the cluster whether tests
pass or fail. It covers authenticated Records mutations, exact Copy allocation,
rollback/no-partial-write behaviour, and financial projections.

`npm run test:browser` uses Playwright Chromium against a local preview-only
Next server. It uses resettable session storage and mocked card metadata; it
does not authenticate against a real account, access a configured database, or
make eBay calls. Playwright owns and stops its web server, browser profile, and
test artifacts. In CI, install the pinned browser with
`npx playwright install --with-deps chromium` before running the browser suite.
