export const recordsPreviewStorageKey = "ygo-library:records-preview:v1";

export type RecordEntryType =
  | "purchase"
  | "pack-opening"
  | "sale"
  | "adjustment"
  | "imported-acquisition"
  | "bulk-itemization";

export type RecordStatus = "active" | "void";
export type InventoryKind = "card" | "sealed" | "bulk" | "supply";
export type SupplyCategory =
  | "sleeves"
  | "binder"
  | "storage"
  | "playmat"
  | "other";

export type WishlistTarget = {
  id: string;
  name: string;
  rarity: string;
  edition: string;
  desiredQuantity: number;
  imageUrl: string | null;
  tcgplayerUrl: string | null;
  marketPricePence: number | null;
  legacyCardId?: number;
};

export type CardPrinting = {
  id: string;
  targetId: string;
  setName: string;
  setCode: string;
  tcgplayerUrl: string | null;
  imageUrl: string | null;
};

export type CardCopy = {
  id: string;
  printingId: string;
  acquiredRecordId: string;
  soldRecordId: string | null;
  removedRecordId: string | null;
  status: "available" | "sold" | "removed" | "void";
  condition: string;
};

export type RecordLine = {
  id: string;
  kind: InventoryKind;
  name: string;
  quantity: number;
  allocationPence: number | null;
  entityIds: string[];
  detail: string | null;
};

export type RecordEntry = {
  id: string;
  type: RecordEntryType;
  status: RecordStatus;
  date: string;
  title: string;
  source: string;
  listingUrl: string | null;
  amountPence: number;
  notes: string;
  lines: RecordLine[];
  createdAt: string;
  preview: true;
};

export type SealedUnit = {
  id: string;
  name: string;
  quantity: number;
  status: "sealed" | "opened" | "void";
  acquiredRecordId: string;
  openedRecordId: string | null;
};

export type BulkLot = {
  id: string;
  name: string;
  estimatedQuantity: number | null;
  itemizedQuantity: number;
  acquiredRecordId: string;
  status: "open" | "itemized" | "void";
};

export type SupplyItem = {
  id: string;
  name: string;
  category: SupplyCategory;
  quantity: number;
  acquiredRecordId: string;
  status: "held" | "used" | "void";
};

export type PreviewAttentionItem = {
  id: string;
  targetId: string | null;
  label: string;
  detail: string;
  field: "cost" | "edition" | "printing" | "tcgplayer";
};

export type RecordsSnapshot = {
  version: 1;
  records: RecordEntry[];
  targets: WishlistTarget[];
  printings: CardPrinting[];
  copies: CardCopy[];
  sealedUnits: SealedUnit[];
  bulkLots: BulkLot[];
  supplies: SupplyItem[];
  attention: PreviewAttentionItem[];
};

export type PurchaseLineInput = {
  id: string;
  kind: InventoryKind;
  name: string;
  quantity: number;
  allocationPence: number | null;
  setName?: string;
  setCode?: string;
  tcgplayerUrl?: string;
  category?: SupplyCategory;
  estimatedQuantity?: number | null;
};

export type PurchaseInput = {
  date: string;
  source: string;
  listingUrl: string;
  totalPence: number;
  notes: string;
  lines: PurchaseLineInput[];
};

export type OpeningInput = {
  date: string;
  sealedUnitId: string;
  notes: string;
  pulls: Array<{
    id: string;
    name: string;
    quantity: number;
    setName: string;
    setCode: string;
  }>;
};

export type SaleInput = {
  date: string;
  source: string;
  netProceedsPence: number;
  notes: string;
  copyIds: string[];
};

export type AdjustmentInput = {
  date: string;
  direction: "add" | "remove";
  reason: string;
  notes: string;
  name: string;
  quantity: number;
  copyIds: string[];
  setName: string;
  setCode: string;
};

export type BulkItemizationInput = {
  date: string;
  bulkLotId: string;
  notes: string;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    setName: string;
    setCode: string;
  }>;
};

export type PreviewDrafts = Partial<
  Record<
    "purchase" | "pack-opening" | "sale" | "adjustment" | "bulk-itemization",
    unknown
  >
>;

export type DataSourceResult = { ok: true; id?: string } | { ok: false; message: string };

export type RecordsDataSource = {
  mode: "preview";
  status: "loading" | "ready" | "error";
  errorMessage: string | null;
  snapshot: RecordsSnapshot;
  drafts: PreviewDrafts;
  createPurchase: (input: PurchaseInput) => DataSourceResult;
  createOpening: (input: OpeningInput) => DataSourceResult;
  createSale: (input: SaleInput) => DataSourceResult;
  createAdjustment: (input: AdjustmentInput) => DataSourceResult;
  itemizeBulk: (input: BulkItemizationInput) => DataSourceResult;
  voidRecord: (recordId: string) => DataSourceResult;
  restoreRecord: (recordId: string) => DataSourceResult;
  setDraft: (key: keyof PreviewDrafts, value: unknown) => void;
  clearDraft: (key: keyof PreviewDrafts) => void;
  resetPreview: () => void;
};
