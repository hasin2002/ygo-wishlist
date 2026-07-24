import assert from "node:assert/strict";
import test from "node:test";
import { isMissingDatabaseSchemaError } from "../src/lib/database-error.ts";

test("recognises missing schema errors wrapped by a query error", () => {
  assert.equal(
    isMissingDatabaseSchemaError({
      cause: {
        code: "42P01",
        message: 'relation "ebay_notification_subscriptions" does not exist',
      },
      message: "Failed query",
    }),
    true,
  );
  assert.equal(
    isMissingDatabaseSchemaError({
      cause: {
        cause: {
          code: "42703",
        },
      },
    }),
    true,
  );
});

test("does not hide unrelated database failures", () => {
  assert.equal(isMissingDatabaseSchemaError({ code: "28P01" }), false);
  assert.equal(isMissingDatabaseSchemaError(new Error("Connection refused")), false);
});
