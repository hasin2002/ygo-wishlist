export const recordsPreviewStorageKey = "ygo-library:records-preview:v1";
export const recordsDraftStorageKey = "ygo-library:records-drafts:v1";

export type RecordEntryType =
  | "purchase"
  | "pack-opening"
  | "sale"
  | "imported-acquisition";

export type RecordStatus = "active" | "void";
export type LibraryCardStatus = "wishlist" | "owned";
export type InventoryKind = "card" | "sealed" | "bulk" | "supply";
export type ProductEdition = "1st Edition" | "Unlimited Edition" | "Limited Edition";
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
  bulkLotId: string | null;
  allocationIndex: number | null;
  allocationPence: number | null;
  status: "available" | "sold" | "void";
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
  titleGenerated?: boolean;
  source: string;
  listingUrl: string | null;
  amountPence: number;
  amountKnown?: boolean;
  notes: string;
  lines: RecordLine[];
  revision: number;
  createdAt: string;
};

export type SealedUnit = {
  id: string;
  name: string;
  edition?: ProductEdition | null;
  quantity: number;
  tcgplayerUrl?: string | null;
  imageUrl?: string | null;
  status: "sealed" | "opened" | "void";
  acquiredRecordId: string;
  openedRecordId: string | null;
};

export type BulkLot = {
  id: string;
  name: string;
  totalQuantity: number;
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

export type ResolvedProductMetadata = {
  title: string;
  imageUrl: string | null;
  edition: ProductEdition | "";
  rarity: string;
  setName: string;
  setCode: string;
  cardType: string;
  resolution: "page" | "fallback";
};

export type ProductIdentityInput = {
  selectedTargetId?: string | null;
  tcgplayerUrl: string;
  name: string;
  imageUrl: string | null;
  edition: ProductEdition;
  rarity: string;
  setName: string;
  setCode: string;
  metadataNeedsAttention: boolean;
};

export type CardContentsInput = ProductIdentityInput & {
  id: string;
  quantity: number;
};

export type PurchaseInput = {
  recordName: string;
  date: string;
  source: string;
  listingUrl: string;
  totalPence: number;
  notes: string;
} & (
  | { kind: "card"; card: CardContentsInput }
  | { kind: "sealed"; product: ProductIdentityInput & { quantity: number } }
  | { kind: "bulk"; cards: CardContentsInput[]; totalCardCount: number }
  | { kind: "supply"; category: SupplyCategory; otherName: string; quantity: number }
);

export type OpeningInput = {
  recordName: string;
  date: string;
  notes: string;
  product: ProductIdentityInput;
  sealedUnitId: string | null;
  source: string;
  pulls: CardContentsInput[];
};

export type SaleInput = {
  recordName: string;
  date: string;
  source: string;
  netProceedsPence: number;
  notes: string;
  copyIds: string[];
};

export type RecordsDrafts = Partial<
  Record<"purchase" | "pack-opening" | "sale", unknown>
>;

export type DataSourceResult = { ok: true; id?: string } | { ok: false; message: string };
export type RecordDetailsUpdate = {
  title: string;
  date: string;
  source: string;
  listingUrl: string | null;
  amountPence: number;
  notes: string;
};
export type RecordLineUpdate = {
  name: string;
  quantity: number;
  detail: string;
  edition?: ProductEdition;
  category?: SupplyCategory;
  totalQuantity?: number;
};
export type ResolveProductResult =
  | { ok: true; metadata: ResolvedProductMetadata }
  | { ok: false; message: string };

export type LibraryCardSuggestion = {
  targetId: string;
  printingId: string | null;
  name: string;
  rarity: string;
  edition: ProductEdition | "";
  setName: string;
  setCode: string;
  tcgplayerUrl: string | null;
  imageUrl: string | null;
};

export type RecordsDataSource = {
  mode: "preview" | "live";
  status: "loading" | "ready" | "error";
  errorMessage: string | null;
  snapshot: RecordsSnapshot;
  drafts: RecordsDrafts;
  resolveTcgplayerProduct: (url: string) => Promise<ResolveProductResult>;
  searchLibraryCards: (query: string) => LibraryCardSuggestion[];
  createPurchase: (input: PurchaseInput) => Promise<DataSourceResult>;
  createOpening: (input: OpeningInput) => Promise<DataSourceResult>;
  createSale: (input: SaleInput) => Promise<DataSourceResult>;
  updateRecordDetails: (recordId: string, update: RecordDetailsUpdate) => Promise<DataSourceResult>;
  replaceRecordCards: (recordId: string, cards: CardContentsInput[]) => Promise<DataSourceResult>;
  replaceSaleCopies: (recordId: string, copyIds: string[]) => Promise<DataSourceResult>;
  updateRecordLine: (recordId: string, lineId: string, update: RecordLineUpdate) => Promise<DataSourceResult>;
  deleteWishlistTarget: (targetId: string) => Promise<DataSourceResult>;
  voidRecord: (recordId: string) => Promise<DataSourceResult>;
  restoreRecord: (recordId: string) => Promise<DataSourceResult>;
  setDraft: (key: keyof RecordsDrafts, value: unknown) => void;
  clearDraft: (key: keyof RecordsDrafts) => void;
  resetPreview?: () => void;
};
