/** Saving many physical Copies has a different deadline from an interactive read. */
export function timeoutForRequest(url: RequestInfo | URL) {
  const procedures = String(url).split("?")[0].split("/").at(-1)?.split(",") ?? [];
  if (procedures.includes("records.addOwnedCards")) return {
    milliseconds: 60_000,
    message: "Saving your cards is taking longer than expected and may still complete. Your list is preserved. Retry the same list safely; already saved copies will not be duplicated.",
  };
  if (procedures.includes("records.createOpening")) return {
    milliseconds: 60_000,
    message: "Saving this opening is taking longer than expected and may still complete. Your draft is preserved. Check Records History or retry the same draft.",
  };
  if (procedures.includes("records.createPurchase")) return {
    milliseconds: 60_000,
    message: "This Purchase is taking longer than expected and may still have been saved. Check Records History before retrying; a retry will not create a duplicate.",
  };
  return { milliseconds: 15_000, message: "The request took too long. Please try again." };
}
