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
export const cardConditions = [
  "Near Mint",
  "Lightly Played",
  "Moderately Played",
  "Heavily Played",
] as const;
export type CardCondition = (typeof cardConditions)[number];
export function isCardCondition(value: string): value is CardCondition {
  return cardConditions.some((condition) => condition === value);
}
export const cardConditionOptions: ReadonlyArray<{
  ebayDescriptorValueId: "400010" | "400015" | "400016" | "400017";
  label: string;
  value: CardCondition;
}> = [
  { value: "Near Mint", label: "Near mint or better", ebayDescriptorValueId: "400010" },
  { value: "Lightly Played", label: "Lightly played (Excellent)", ebayDescriptorValueId: "400015" },
  { value: "Moderately Played", label: "Moderately played (Very good)", ebayDescriptorValueId: "400016" },
  { value: "Heavily Played", label: "Heavily played (Poor)", ebayDescriptorValueId: "400017" },
];
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
  estimatedPricePence?: number | null;
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
  location: string | null;
  stickerNumber: string | null;
  privateNote: string;
  createdAt: string;
};

/** The physical ownership of a Copy, deliberately independent of eBay offers. */
export type CopyPhysicalState = {
  state: "owned" | "sold" | "unavailable";
  code:
    | "owned"
    | "sold"
    | "copy_void"
    | "source_record_void"
    | "source_record_unavailable";
  reason: string;
};

/** One persisted eBay offer related to an exact physical Copy. */
export type EbayOfferExposure = {
  copyId: string;
  listingId: string;
  memberId: string | null;
  fulfilmentPosition: number | null;
  relationSource: "member" | "legacy";
  kind: "individual" | "quantity" | "bundle";
  title: string;
  itemId: string;
  listingUrl: string;
  listingState: "active" | "ended" | "suspended" | "unknown";
  saleState: "none" | "pending" | "paid" | "cancelled" | "needs_review";
  saleRecordId: string | null;
  quantitySold: number | null;
  listingStartedAt: string | null;
  listingEndedAt: string | null;
  paymentPendingAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  updatedAt: string;
};

export type EbayExposureAggregateState =
  | "not_listed"
  | "live"
  | "reserved_by_order"
  | "payment_pending"
  | "ending_automatically"
  | "needs_takedown"
  | "paid_sale_recorded"
  | "needs_attention";

/** A persisted explanation for the Inventory action; validate/publish still recheck on the server. */
export type CopyEbayActionState = {
  disposition: "sell" | "review" | "blocked";
  code:
    | "no_related_offers"
    | "only_ended_offers"
    | "live_offer"
    | "payment_pending"
    | "paid_sale_recorded"
    | "needs_takedown"
    | "needs_attention"
    | "copy_sold"
    | "copy_unavailable";
  reason: string;
};

/** Per-Copy ownership and eBay exposure summary returned in the Records snapshot. */
export type CopyEbayExposureState = {
  copyId: string;
  physical: CopyPhysicalState;
  offers: EbayOfferExposure[];
  liveOfferCount: number;
  endedOfferCount: number;
  aggregateState: EbayExposureAggregateState;
  action: CopyEbayActionState;
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
  /** Exact unit cost from its source Purchase line; null is genuinely unknown. */
  allocationPence?: number | null;
  allocationMode?: "equal" | "override";
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
  copyId?: string | null;
  ebayAttentionAction?: "confirm_copy_link" | "review_ebay_status";
  listingId?: string | null;
  printingId?: string | null;
  label: string;
  detail: string;
  field: "cost" | "edition" | "printing" | "tcgplayer" | "ebay_copy_link" | "ebay_status";
};

export type RecordsSnapshot = {
  version: 1;
  records: RecordEntry[];
  targets: WishlistTarget[];
  printings: CardPrinting[];
  copies: CardCopy[];
  copyEbayExposures: CopyEbayExposureState[];
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
  /** false means the amount is genuinely unknown, never a known £0. */
  amountKnown?: boolean;
  notes: string;
} & (
  | { kind: "card"; card: CardContentsInput }
  | { kind: "sealed"; product: ProductIdentityInput & {
    quantity: number;
    /** Optional reviewed unequal exact-unit costs, in displayed unit order. */
    unitAllocations?: number[];
    unitAllocationsReviewed?: boolean;
  } }
  | { kind: "bulk"; cards: CardContentsInput[]; totalCardCount: number }
  | { kind: "supply"; category: SupplyCategory; otherName: string; quantity: number }
);

export type OpeningInput = {
  recordName: string;
  date: string;
  notes: string;
  product: ProductIdentityInput;
  useTrackedStock: boolean;
  sealedUnitId: string | null;
  source: string;
  totalPence: number;
  amountKnown?: boolean;
  pulls: CardContentsInput[];
};

export type SaleInput = {
  recordName: string;
  date: string;
  source: string;
  netProceedsPence: number;
  notes: string;
  copyIds: string[];
  paidEbayReview?: {
    copyId: string;
    listingId: string;
  };
};

export type RecordsDrafts = Partial<
  Record<"purchase" | "pack-opening" | "sale", unknown>
>;

export type DataSourceResult =
  | { ok: true; id?: string; warning?: string }
  | { ok: false; message: string };
export type RecordDetailsUpdate = {
  title: string;
  date: string;
  source: string;
  listingUrl: string | null;
  amountPence: number;
  amountKnown?: boolean;
  notes: string;
  /** Confirms a pre-opening replacement of reviewed unequal sealed-unit costs. */
  sealedAllocationOverrideConfirmed?: boolean;
};
export type CardAttentionUpdate = {
  targetId: string;
  printingId?: string | null;
  name: string;
  rarity: string;
  edition: ProductEdition;
  tcgplayerUrl: string;
  setName: string;
  setCode: string;
  imageUrl: string | null;
};
export type CardSourceUpdate = {
  targetId: string;
  printingId: string;
  tcgplayerUrl: string;
};
export type CardCopyUpdate = {
  condition: CardCondition;
  location: string;
  stickerNumber: string;
  privateNote: string;
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
  draftOwnerScope: string;
  draftsHydrated: boolean;
  draftRecoveryMessage: string | null;
  snapshot: RecordsSnapshot;
  drafts: RecordsDrafts;
  refresh: () => Promise<void>;
  resolveTcgplayerProduct: (url: string) => Promise<ResolveProductResult>;
  searchLibraryCards: (query: string) => LibraryCardSuggestion[];
  createPurchase: (input: PurchaseInput) => Promise<DataSourceResult>;
  createOpening: (input: OpeningInput) => Promise<DataSourceResult>;
  createSale: (input: SaleInput) => Promise<DataSourceResult>;
  updateRecordDetails: (recordId: string, update: RecordDetailsUpdate) => Promise<DataSourceResult>;
  resolveCardAttention: (update: CardAttentionUpdate) => Promise<DataSourceResult>;
  updateCardSource: (update: CardSourceUpdate) => Promise<DataSourceResult>;
  resolveEbayCopyLinkAttention: (listingId: string) => Promise<DataSourceResult>;
  replaceRecordCards: (recordId: string, cards: CardContentsInput[]) => Promise<DataSourceResult>;
  replaceSaleCopies: (recordId: string, copyIds: string[]) => Promise<DataSourceResult>;
  updateCardCopy: (copyId: string, update: CardCopyUpdate) => Promise<DataSourceResult>;
  removeCardCopy: (copyId: string) => Promise<DataSourceResult>;
  updateRecordLine: (recordId: string, lineId: string, update: RecordLineUpdate) => Promise<DataSourceResult>;
  deleteWishlistTarget: (targetId: string) => Promise<DataSourceResult>;
  voidRecord: (recordId: string) => Promise<DataSourceResult>;
  restoreRecord: (recordId: string) => Promise<DataSourceResult>;
  setDraft: (key: keyof RecordsDrafts, value: unknown) => void;
  clearDraft: (key: keyof RecordsDrafts) => void;
  resetPreview?: () => void;
};
