export type InventoryListState = {
  card: string;
  copyQuantity: "all" | "multiple";
  edition: string;
  kind: "cards" | "sealed" | "bulk" | "supplies";
  page: number;
  rarity: string[];
  status: "all" | "wishlist" | "owned";
};

export const defaultInventoryListState: InventoryListState = {
  card: "",
  copyQuantity: "all",
  edition: "all",
  kind: "cards",
  page: 1,
  rarity: [],
  status: "all",
};

function positiveInteger(value: string | null) {
  if (!value || !/^[1-9]\d*$/.test(value)) return 1;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function parseInventoryListState(searchParams: URLSearchParams): InventoryListState {
  const kind = searchParams.get("kind");
  const status = searchParams.get("status");
  const copyQuantity = searchParams.get("copies");

  return {
    card: searchParams.get("card") ?? "",
    copyQuantity: copyQuantity === "multiple" ? "multiple" : "all",
    edition: searchParams.get("edition") || "all",
    kind: kind === "sealed" || kind === "bulk" || kind === "supplies" ? kind : "cards",
    page: positiveInteger(searchParams.get("page")),
    rarity: Array.from(new Set(searchParams.getAll("rarity").filter(Boolean))),
    status: status === "wishlist" || status === "owned" ? status : "all",
  };
}

export function serializeInventoryListState(state: InventoryListState) {
  const searchParams = new URLSearchParams();
  searchParams.set("kind", state.kind);
  if (state.card) searchParams.set("card", state.card);
  if (state.copyQuantity !== "all") searchParams.set("copies", state.copyQuantity);
  if (state.status !== "all") searchParams.set("status", state.status);
  state.rarity.forEach((rarity) => searchParams.append("rarity", rarity));
  if (state.edition !== "all") searchParams.set("edition", state.edition);
  if (state.page > 1) searchParams.set("page", String(state.page));
  return searchParams;
}

export function inventoryListHref(state: InventoryListState) {
  return `/records/inventory?${serializeInventoryListState(state).toString()}`;
}

export function inventoryCardDetailHref(targetId: string, state: InventoryListState, copyId?: string | null) {
  const searchParams = serializeInventoryListState({ ...state, kind: "cards" });
  if (copyId) searchParams.set("copy", copyId);
  return `/records/inventory/cards/${encodeURIComponent(targetId)}?${searchParams.toString()}`;
}
