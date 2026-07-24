const missingSchemaErrorCodes = new Set([
  "42P01", // undefined_table
  "42703", // undefined_column
]);

function databaseErrorCode(error: unknown) {
  const visited = new Set<unknown>();
  let current = error;

  while (
    current
    && typeof current === "object"
    && !visited.has(current)
  ) {
    visited.add(current);
    const candidate = current as { cause?: unknown; code?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }

  return null;
}

export function isMissingDatabaseSchemaError(error: unknown) {
  const code = databaseErrorCode(error);
  return code ? missingSchemaErrorCodes.has(code) : false;
}
