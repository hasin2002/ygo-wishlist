import type {
  BulkItemizationInput,
  CardCopy,
  CardPrinting,
  DataSourceResult,
  OpeningInput,
  PreviewAttentionItem,
  ProductIdentityInput,
  PurchaseInput,
  RecordEntry,
  RecordLine,
  RecordsSnapshot,
  SaleInput,
  AdjustmentInput,
  WishlistTarget,
} from "@/lib/records/types";

export type LegacyCard = {
  id: number;
  name: string;
  url: string | null;
  source: "tcgplayer" | "ebay" | "other" | "manual";
  imageUrl: string | null;
  priceText: string | null;
  marketPriceText: string | null;
  paidPriceText: string | null;
  purchaseMonth: string | null;
  rarity: string | null;
  status: "wishlist" | "owned";
  createdAt: string;
  updatedAt: string;
};

function priceToPence(value: string | null) {
  const match = value?.match(/\d+(?:[,.]\d{1,2})?/);

  if (!match) return null;

  const parsed = Number(match[0].replace(",", ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

function isoDate(month: string | null, fallback: string) {
  return month && /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : fallback.slice(0, 10);
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("en-GB");
}

function normalizedEdition(value: string | null | undefined) {
  const edition = normalized(value || "");
  return edition === "unlimited" ? "unlimited edition" : edition;
}

function canonicalProductUrl(value: string | null | undefined) {
  if (!value) return "";

  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return normalized(value);
  }
}

function previewId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function recordLine(
  kind: RecordLine["kind"],
  name: string,
  quantity: number,
  entityIds: string[],
  allocationPence: number | null = null,
  detail: string | null = null,
): RecordLine {
  return {
    id: previewId("line"),
    kind,
    name,
    quantity,
    allocationPence,
    entityIds,
    detail,
  };
}

function seededSnapshot(): RecordsSnapshot {
  const targets: WishlistTarget[] = [
    {
      id: "target-preview-dark-magician",
      name: "Dark Magician",
      rarity: "Ultra Rare",
      edition: "1st Edition",
      desiredQuantity: 2,
      imageUrl: "https://images.ygoprodeck.com/images/cards/46986414.jpg",
      tcgplayerUrl: "https://www.tcgplayer.com/",
      marketPricePence: 2899,
    },
    {
      id: "target-preview-blue-eyes",
      name: "Blue-Eyes White Dragon",
      rarity: "Ultra Rare",
      edition: "Unlimited",
      desiredQuantity: 1,
      imageUrl: "https://images.ygoprodeck.com/images/cards/89631139.jpg",
      tcgplayerUrl: "https://www.tcgplayer.com/",
      marketPricePence: 1840,
    },
    {
      id: "target-preview-ash-blossom",
      name: "Ash Blossom & Joyous Spring",
      rarity: "Secret Rare",
      edition: "1st Edition",
      desiredQuantity: 1,
      imageUrl: "https://images.ygoprodeck.com/images/cards/14558127.jpg",
      tcgplayerUrl: "https://www.tcgplayer.com/",
      marketPricePence: 1350,
    },
  ];
  const printings: CardPrinting[] = [
    {
      id: "printing-preview-dark-magician",
      targetId: targets[0].id,
      setName: "Starter Deck: Yugi",
      setCode: "SDY-006",
      tcgplayerUrl: targets[0].tcgplayerUrl,
      imageUrl: targets[0].imageUrl,
    },
    {
      id: "printing-preview-blue-eyes",
      targetId: targets[1].id,
      setName: "Starter Deck: Kaiba",
      setCode: "SDK-001",
      tcgplayerUrl: targets[1].tcgplayerUrl,
      imageUrl: targets[1].imageUrl,
    },
    {
      id: "printing-preview-ash-blossom",
      targetId: targets[2].id,
      setName: "Maximum Crisis",
      setCode: "MACR-EN036",
      tcgplayerUrl: targets[2].tcgplayerUrl,
      imageUrl: targets[2].imageUrl,
    },
  ];
  const records: RecordEntry[] = [
    {
      id: "record-preview-purchase",
      type: "purchase",
      status: "active",
      date: "2026-07-12",
      title: "Mixed eBay order",
      source: "eBay",
      listingUrl: null,
      amountPence: 7250,
      notes: "Two singles, a tin, and sleeves in one delivered total.",
      createdAt: "2026-07-12T18:20:00.000Z",
      preview: true,
      lines: [
        {
          id: "line-preview-dark-magician",
          kind: "card",
          name: "Dark Magician",
          quantity: 2,
          allocationPence: 4200,
          entityIds: ["copy-preview-dark-1", "copy-preview-dark-2"],
          detail: "SDY-006 · Ultra Rare",
        },
        {
          id: "line-preview-tin",
          kind: "sealed",
          name: "25th Anniversary Tin: Dueling Heroes",
          quantity: 1,
          allocationPence: 2250,
          entityIds: ["sealed-preview-tin"],
          detail: "Sealed product",
        },
        {
          id: "line-preview-sleeves",
          kind: "supply",
          name: "Burgundy Japanese-size sleeves",
          quantity: 2,
          allocationPence: 800,
          entityIds: ["supply-preview-sleeves"],
          detail: "Sleeves",
        },
      ],
    },
    {
      id: "record-preview-opening",
      type: "pack-opening",
      status: "active",
      date: "2026-07-13",
      title: "Opened Dueling Heroes tin",
      source: "Collection",
      listingUrl: null,
      amountPence: 0,
      notes: "The product cost remains on the original purchase.",
      createdAt: "2026-07-13T19:15:00.000Z",
      preview: true,
      lines: [
        {
          id: "line-preview-blue-eyes",
          kind: "card",
          name: "Blue-Eyes White Dragon",
          quantity: 1,
          allocationPence: null,
          entityIds: ["copy-preview-blue-eyes"],
          detail: "SDK-001 · Ultra Rare",
        },
      ],
    },
    {
      id: "record-preview-bulk-purchase",
      type: "purchase",
      status: "active",
      date: "2026-07-08",
      title: "Marketplace childhood collection",
      source: "Facebook Marketplace",
      listingUrl: null,
      amountPence: 3800,
      notes: "Bought as one lot; contents were not known at purchase time.",
      createdAt: "2026-07-08T12:00:00.000Z",
      preview: true,
      lines: [
        {
          id: "line-preview-bulk",
          kind: "bulk",
          name: "Childhood collection box",
          quantity: 1,
          allocationPence: 3800,
          entityIds: ["bulk-preview-childhood"],
          detail: "About 180 cards",
        },
      ],
    },
    {
      id: "record-preview-itemization",
      type: "bulk-itemization",
      status: "active",
      date: "2026-07-09",
      title: "Itemized childhood collection box",
      source: "Collection",
      listingUrl: null,
      amountPence: 0,
      notes: "12 useful cards identified. No additional spend recorded.",
      createdAt: "2026-07-09T20:30:00.000Z",
      preview: true,
      lines: [
        {
          id: "line-preview-ash",
          kind: "card",
          name: "Ash Blossom & Joyous Spring",
          quantity: 1,
          allocationPence: null,
          entityIds: ["copy-preview-ash"],
          detail: "MACR-EN036 · Secret Rare",
        },
      ],
    },
    {
      id: "record-preview-sale",
      type: "sale",
      status: "active",
      date: "2026-07-15",
      title: "Sold Ash Blossom & Joyous Spring",
      source: "eBay",
      listingUrl: null,
      amountPence: 1650,
      notes: "Net after fees and postage.",
      createdAt: "2026-07-15T17:40:00.000Z",
      preview: true,
      lines: [
        {
          id: "line-preview-ash-sale",
          kind: "card",
          name: "Ash Blossom & Joyous Spring",
          quantity: 1,
          allocationPence: null,
          entityIds: ["copy-preview-ash"],
          detail: "Target automatically reopened",
        },
      ],
    },
  ];

  return {
    version: 1,
    records,
    targets,
    printings,
    copies: [
      {
        id: "copy-preview-dark-1",
        printingId: printings[0].id,
        acquiredRecordId: records[0].id,
        soldRecordId: null,
        removedRecordId: null,
        status: "available",
        condition: "Near Mint",
      },
      {
        id: "copy-preview-dark-2",
        printingId: printings[0].id,
        acquiredRecordId: records[0].id,
        soldRecordId: null,
        removedRecordId: null,
        status: "available",
        condition: "Near Mint",
      },
      {
        id: "copy-preview-blue-eyes",
        printingId: printings[1].id,
        acquiredRecordId: records[1].id,
        soldRecordId: null,
        removedRecordId: null,
        status: "available",
        condition: "Lightly Played",
      },
      {
        id: "copy-preview-ash",
        printingId: printings[2].id,
        acquiredRecordId: records[3].id,
        soldRecordId: records[4].id,
        removedRecordId: null,
        status: "sold",
        condition: "Near Mint",
      },
    ],
    sealedUnits: [
      {
        id: "sealed-preview-tin",
        name: "25th Anniversary Tin: Dueling Heroes",
        quantity: 1,
        status: "opened",
        acquiredRecordId: records[0].id,
        openedRecordId: records[1].id,
      },
      {
        id: "sealed-preview-box",
        name: "Spellcaster's Command Structure Deck",
        edition: "Unlimited Edition",
        quantity: 1,
        status: "sealed",
        acquiredRecordId: records[0].id,
        openedRecordId: null,
        tcgplayerUrl: "https://www.tcgplayer.com/product/176852/yugioh-structure-deck-spellcasters-command-spellcasters-command-structure-deck-unlimited-edition",
        imageUrl: "https://product-images.tcgplayer.com/fit-in/437x437/176852.jpg",
      },
    ],
    bulkLots: [
      {
        id: "bulk-preview-childhood",
        name: "Childhood collection box",
        estimatedQuantity: 180,
        itemizedQuantity: 12,
        acquiredRecordId: records[2].id,
        status: "open",
      },
    ],
    supplies: [
      {
        id: "supply-preview-sleeves",
        name: "Burgundy Japanese-size sleeves",
        category: "sleeves",
        quantity: 2,
        acquiredRecordId: records[0].id,
        status: "held",
      },
      {
        id: "supply-preview-storage",
        name: "Four-row card storage box",
        category: "storage",
        quantity: 1,
        acquiredRecordId: records[2].id,
        status: "held",
      },
    ],
    attention: [],
  };
}

export function createPreviewSnapshot(legacyCards: LegacyCard[]): RecordsSnapshot {
  const snapshot = seededSnapshot();
  const attention: PreviewAttentionItem[] = [];

  for (const card of legacyCards) {
    const targetId = `target-legacy-${card.id}`;
    const printingId = `printing-legacy-${card.id}`;
    const recordId = `record-legacy-${card.id}`;
    const copyId = `copy-legacy-${card.id}`;
    const isTcgplayer = card.source === "tcgplayer" || Boolean(card.url?.includes("tcgplayer"));
    const paidPence = priceToPence(card.paidPriceText);
    const marketPence = priceToPence(card.marketPriceText) ?? priceToPence(card.priceText);
    const target: WishlistTarget = {
      id: targetId,
      name: card.name,
      rarity: card.rarity || "Unknown rarity",
      edition: "Unknown edition",
      desiredQuantity: 1,
      imageUrl: card.imageUrl,
      tcgplayerUrl: isTcgplayer ? card.url : null,
      marketPricePence: marketPence,
      legacyCardId: card.id,
    };

    snapshot.targets.push(target);
    snapshot.printings.push({
      id: printingId,
      targetId,
      setName: "Unknown set",
      setCode: "Unknown code",
      tcgplayerUrl: target.tcgplayerUrl,
      imageUrl: card.imageUrl,
    });

    attention.push(
      {
        id: `attention-edition-${card.id}`,
        targetId,
        label: card.name,
        detail: "Edition was not stored on the legacy card.",
        field: "edition",
      },
      {
        id: `attention-printing-${card.id}`,
        targetId,
        label: card.name,
        detail: "Exact set and code need confirmation.",
        field: "printing",
      },
    );

    if (!target.tcgplayerUrl) {
      attention.push({
        id: `attention-tcgplayer-${card.id}`,
        targetId,
        label: card.name,
        detail: "TCGplayer product metadata is missing.",
        field: "tcgplayer",
      });
    }

    if (card.status === "owned") {
      if (paidPence === null) {
        attention.push({
          id: `attention-cost-${card.id}`,
          targetId,
          label: card.name,
          detail: "Acquisition cost is unknown.",
          field: "cost",
        });
      }

      snapshot.copies.push({
        id: copyId,
        printingId,
        acquiredRecordId: recordId,
        soldRecordId: null,
        removedRecordId: null,
        status: "available",
        condition: "Unknown",
      });
      snapshot.records.push({
        id: recordId,
        type: "imported-acquisition",
        status: "active",
        date: isoDate(card.purchaseMonth, card.createdAt),
        title: `Imported ${card.name}`,
        source: "Legacy Library",
        listingUrl: null,
        amountPence: paidPence ?? 0,
        amountKnown: paidPence !== null,
        notes: paidPence === null ? "Cost missing; review after migration." : "Imported from the current owned-card row.",
        lines: [
          {
            id: `line-legacy-${card.id}`,
            kind: "card",
            name: card.name,
            quantity: 1,
            allocationPence: paidPence,
            entityIds: [copyId],
            detail: `${card.rarity || "Unknown rarity"} · Unknown printing`,
          },
        ],
        createdAt: card.createdAt,
        preview: true,
      });
    }
  }

  snapshot.attention = attention;
  snapshot.records.sort((a, b) => b.date.localeCompare(a.date));
  return snapshot;
}

function clone(snapshot: RecordsSnapshot) {
  return structuredClone(snapshot);
}

function findOrCreatePrinting(
  snapshot: RecordsSnapshot,
  input: {
    name: string;
    edition?: string;
    rarity?: string;
    setName: string;
    setCode: string;
    tcgplayerUrl?: string;
    imageUrl?: string | null;
  },
) {
  const tcgplayerUrl = input.tcgplayerUrl?.trim() || null;
  const rarity = input.rarity?.trim() || "Unknown rarity";
  const edition = input.edition?.trim() || "Unknown edition";
  let target = snapshot.targets.find(
    (item) =>
      normalized(item.name) === normalized(input.name) &&
      normalized(item.rarity) === normalized(rarity) &&
      normalizedEdition(item.edition) === normalizedEdition(edition),
  );

  if (!target) {
    target = {
      id: previewId("target"),
      name: input.name,
      rarity,
      edition,
      desiredQuantity: 1,
      imageUrl: input.imageUrl || null,
      tcgplayerUrl,
      marketPricePence: null,
    };
    snapshot.targets.push(target);
  } else if (tcgplayerUrl && !target.tcgplayerUrl) {
    target.tcgplayerUrl = tcgplayerUrl;
  }
  if (input.imageUrl && !target.imageUrl) target.imageUrl = input.imageUrl;

  let printing = snapshot.printings.find(
    (item) => item.targetId === target.id && (
      (input.setCode && normalized(item.setCode) === normalized(input.setCode)) ||
      (tcgplayerUrl && item.tcgplayerUrl === tcgplayerUrl)
    ),
  );

  if (!printing) {
    printing = {
      id: previewId("printing"),
      targetId: target.id,
      setName: input.setName || "Unknown set",
      setCode: input.setCode || "Unknown code",
      tcgplayerUrl: tcgplayerUrl || target.tcgplayerUrl,
      imageUrl: input.imageUrl || target.imageUrl,
    };
    snapshot.printings.push(printing);
  } else if (tcgplayerUrl && !printing.tcgplayerUrl) {
    printing.tcgplayerUrl = tcgplayerUrl;
  }

  return printing;
}

function addCopies(
  snapshot: RecordsSnapshot,
  input: {
    name: string;
    edition?: string;
    rarity?: string;
    setName: string;
    setCode: string;
    quantity: number;
    tcgplayerUrl?: string;
    imageUrl?: string | null;
  },
  recordId: string,
) {
  const printing = findOrCreatePrinting(snapshot, input);
  const ids: string[] = [];

  for (let index = 0; index < input.quantity; index += 1) {
    const id = previewId("copy");
    ids.push(id);
    snapshot.copies.push({
      id,
      printingId: printing.id,
      acquiredRecordId: recordId,
      soldRecordId: null,
      removedRecordId: null,
      status: "available",
      condition: "Near Mint",
    });
  }

  return ids;
}

export function applyPurchase(snapshot: RecordsSnapshot, input: PurchaseInput) {
  const next = clone(snapshot);
  const id = previewId("record");
  const lines: RecordLine[] = [];
  let title = "Purchase";

  const addAttention = (item: ProductIdentityInput, label: string) => {
    if (!item.metadataNeedsAttention) return;
    const target = next.targets.find(
      (candidate) =>
        normalized(candidate.name) === normalized(item.name) &&
        normalized(candidate.rarity) === normalized(item.rarity) &&
        normalizedEdition(candidate.edition) === normalizedEdition(item.edition),
    );
    next.attention.push({
      id: previewId("attention"),
      targetId: target?.id ?? null,
      label,
      detail: "Some TCGplayer metadata was entered manually after details could not be fully resolved.",
      field: "tcgplayer",
    });
  };

  if (input.kind === "card") {
    const card = input.card;
    const ids = addCopies(next, card, id);
    lines.push(recordLine("card", card.name, card.quantity, ids, null, `${card.setCode || "Unknown code"} · ${card.edition} · ${card.rarity}`));
    addAttention(card, card.name);
    title = `Purchased ${card.name}`;
  } else if (input.kind === "sealed") {
    const entityIds: string[] = [];
    for (let index = 0; index < input.product.quantity; index += 1) {
      const sealedId = previewId("sealed");
      entityIds.push(sealedId);
      next.sealedUnits.push({
        id: sealedId,
        name: input.product.name,
        edition: input.product.edition || null,
        quantity: 1,
        tcgplayerUrl: input.product.tcgplayerUrl,
        imageUrl: input.product.imageUrl,
        status: "sealed",
        acquiredRecordId: id,
        openedRecordId: null,
      });
    }
    lines.push(recordLine("sealed", input.product.name, input.product.quantity, entityIds, null, input.product.edition || "Edition unknown"));
    addAttention(input.product, input.product.name);
    title = `Purchased ${input.product.name}`;
  } else if (input.kind === "bulk") {
    const bulkId = previewId("bulk");
    const copyCount = input.cards.reduce((sum, card) => sum + card.quantity, 0);
    const lotName = `Bulk lot · ${input.cards.length} card ${input.cards.length === 1 ? "type" : "types"}`;
    next.bulkLots.push({
      id: bulkId,
      name: lotName,
      estimatedQuantity: null,
      itemizedQuantity: copyCount,
      acquiredRecordId: id,
      status: input.moreToItemize ? "open" : "itemized",
    });
    lines.push(recordLine("bulk", lotName, 1, [bulkId], null, input.moreToItemize ? "Partially itemized" : "Fully itemized"));
    for (const card of input.cards) {
      const ids = addCopies(next, card, id);
      lines.push(recordLine("card", card.name, card.quantity, ids, null, `${card.setCode || "Unknown code"} · ${card.edition} · from ${lotName}`));
      addAttention(card, card.name);
    }
    title = `Purchased ${lotName.toLowerCase()}`;
  } else {
    const supplyId = previewId("supply");
    const categoryLabel = input.category === "other"
      ? input.otherName
      : input.category.charAt(0).toUpperCase() + input.category.slice(1);
    next.supplies.push({
      id: supplyId,
      name: categoryLabel,
      category: input.category,
      quantity: input.quantity,
      acquiredRecordId: id,
      status: "held",
    });
    lines.push(recordLine("supply", categoryLabel, input.quantity, [supplyId], null, "Supply or extra"));
    title = `Purchased ${categoryLabel}`;
  }

  next.records.unshift({
    id,
    type: "purchase",
    status: "active",
    date: input.date,
    title,
    source: input.source || "Manual entry",
    listingUrl: input.listingUrl.trim() || null,
    amountPence: input.totalPence,
    notes: input.notes,
    lines,
    createdAt: nowIso(),
    preview: true,
  });

  return { next, result: { ok: true, id } satisfies DataSourceResult };
}

export function applyOpening(snapshot: RecordsSnapshot, input: OpeningInput) {
  const next = clone(snapshot);
  let sealed = input.sealedUnitId
    ? next.sealedUnits.find((item) => item.id === input.sealedUnitId && item.status === "sealed")
    : undefined;
  const productKey = canonicalProductUrl(input.product.tcgplayerUrl);
  sealed ??= productKey
    ? next.sealedUnits.find((item) => item.status === "sealed" && canonicalProductUrl(item.tcgplayerUrl) === productKey)
    : undefined;

  if (!sealed) {
    const importedId = previewId("record");
    const sealedId = previewId("sealed");
    const isGift = normalized(input.source) === "gift";
    sealed = {
      id: sealedId,
      name: input.product.name,
      edition: input.product.edition || null,
      quantity: 1,
      tcgplayerUrl: input.product.tcgplayerUrl,
      imageUrl: input.product.imageUrl,
      status: "sealed",
      acquiredRecordId: importedId,
      openedRecordId: null,
    };
    next.sealedUnits.push(sealed);
    next.records.unshift({
      id: importedId,
      type: "imported-acquisition",
      status: "active",
      date: input.date,
      title: `Imported ${input.product.name}`,
      source: input.source,
      listingUrl: null,
      amountPence: 0,
      amountKnown: isGift,
      notes: isGift ? "Gifted sealed product." : "Historical cost is unknown and excluded from known spend.",
      lines: [recordLine("sealed", input.product.name, 1, [sealedId], null, isGift ? `Gift · £0 · ${input.product.edition}` : `Unknown historical cost · ${input.product.edition}`)],
      createdAt: nowIso(),
      preview: true,
    });
  }

  const id = previewId("record");
  const lines = input.pulls.map((pull) => {
    const ids = addCopies(next, pull, id);
    if (pull.metadataNeedsAttention) {
      const target = next.targets.find(
        (candidate) =>
          normalized(candidate.name) === normalized(pull.name) &&
          normalized(candidate.rarity) === normalized(pull.rarity) &&
          normalizedEdition(candidate.edition) === normalizedEdition(pull.edition),
      );
      next.attention.push({
        id: previewId("attention"),
        targetId: target?.id ?? null,
        label: pull.name,
        detail: "Pulled-card metadata needs another fetch or later correction.",
        field: "tcgplayer",
      });
    }
    return recordLine("card", pull.name, pull.quantity, ids, null, `${pull.setCode || "Unknown code"} · ${pull.edition} · ${pull.rarity} · pulled`);
  });
  sealed.status = "opened";
  sealed.openedRecordId = id;
  next.records.unshift({
    id,
    type: "pack-opening",
    status: "active",
    date: input.date,
    title: `Opened ${input.product.name}`,
    source: input.source,
    listingUrl: null,
    amountPence: 0,
    notes: input.notes,
    lines,
    createdAt: nowIso(),
    preview: true,
  });
  return { next, result: { ok: true, id } satisfies DataSourceResult };
}

export function applySale(snapshot: RecordsSnapshot, input: SaleInput) {
  const next = clone(snapshot);
  const copies = input.copyIds.map((copyId) => next.copies.find((copy) => copy.id === copyId));
  if (!copies.length || copies.some((copy) => !copy || copy.status !== "available")) {
    return { next: snapshot, result: { ok: false, message: "Select one or more available copies." } satisfies DataSourceResult };
  }
  const id = previewId("record");
  const grouped = new Map<string, { name: string; ids: string[]; detail: string }>();
  for (const copy of copies as CardCopy[]) {
    const printing = next.printings.find((item) => item.id === copy.printingId)!;
    const target = next.targets.find((item) => item.id === printing.targetId)!;
    const group = grouped.get(target.id) ?? { name: target.name, ids: [], detail: `${printing.setCode} · ${copy.condition}` };
    group.ids.push(copy.id);
    grouped.set(target.id, group);
    copy.status = "sold";
    copy.soldRecordId = id;
  }
  next.records.unshift({
    id,
    type: "sale",
    status: "active",
    date: input.date,
    title: grouped.size === 1 ? `Sold ${Array.from(grouped.values())[0].name}` : `Sold ${copies.length} card copies`,
    source: input.source || "Manual entry",
    listingUrl: null,
    amountPence: input.netProceedsPence,
    notes: input.notes,
    lines: Array.from(grouped.values()).map((group) => recordLine("card", group.name, group.ids.length, group.ids, null, group.detail)),
    createdAt: nowIso(),
    preview: true,
  });
  return { next, result: { ok: true, id } satisfies DataSourceResult };
}

export function applyAdjustment(snapshot: RecordsSnapshot, input: AdjustmentInput) {
  const next = clone(snapshot);
  const id = previewId("record");
  let ids: string[];
  if (input.direction === "add") {
    ids = addCopies(next, input, id);
  } else {
    const copies = input.copyIds.map((copyId) => next.copies.find((copy) => copy.id === copyId));
    if (!copies.length || copies.some((copy) => !copy || copy.status !== "available")) {
      return { next: snapshot, result: { ok: false, message: "Select available copies to remove." } satisfies DataSourceResult };
    }
    ids = input.copyIds;
    for (const copy of copies as CardCopy[]) {
      copy.status = "removed";
      copy.removedRecordId = id;
    }
  }
  next.records.unshift({
    id,
    type: "adjustment",
    status: "active",
    date: input.date,
    title: `${input.direction === "add" ? "Added" : "Removed"} ${input.quantity} × ${input.name}`,
    source: "Manual correction",
    listingUrl: null,
    amountPence: 0,
    notes: `${input.reason}${input.notes ? ` · ${input.notes}` : ""}`,
    lines: [recordLine("card", input.name, input.quantity, ids, null, `${input.setCode || "Unknown code"} · ${input.reason}`)],
    createdAt: nowIso(),
    preview: true,
  });
  return { next, result: { ok: true, id } satisfies DataSourceResult };
}

export function applyBulkItemization(snapshot: RecordsSnapshot, input: BulkItemizationInput) {
  const next = clone(snapshot);
  const lot = next.bulkLots.find((item) => item.id === input.bulkLotId && item.status !== "void");
  if (!lot) return { next: snapshot, result: { ok: false, message: "Choose an active bulk lot." } satisfies DataSourceResult };
  const id = previewId("record");
  const lines = input.items.map((item) => {
    const ids = addCopies(next, item, id);
    return recordLine("card", item.name, item.quantity, ids, null, `${item.setCode || "Unknown code"} · from ${lot.name}`);
  });
  lot.itemizedQuantity += input.items.reduce((total, item) => total + item.quantity, 0);
  if (lot.estimatedQuantity !== null && lot.itemizedQuantity >= lot.estimatedQuantity) lot.status = "itemized";
  next.records.unshift({
    id,
    type: "bulk-itemization",
    status: "active",
    date: input.date,
    title: `Itemized ${lot.name}`,
    source: "Collection",
    listingUrl: null,
    amountPence: 0,
    notes: input.notes,
    lines,
    createdAt: nowIso(),
    preview: true,
  });
  return { next, result: { ok: true, id } satisfies DataSourceResult };
}

export function changeRecordStatus(snapshot: RecordsSnapshot, recordId: string, status: "active" | "void") {
  const next = clone(snapshot);
  const record = next.records.find((item) => item.id === recordId);
  if (!record) return { next: snapshot, result: { ok: false, message: "Record not found." } satisfies DataSourceResult };
  if (record.status === status) return { next: snapshot, result: { ok: false, message: `Record is already ${status}.` } satisfies DataSourceResult };

  if (record.type === "sale") {
    for (const copy of next.copies.filter((item) => item.soldRecordId === record.id)) {
      copy.status = status === "void" ? "available" : "sold";
    }
  } else if (record.type === "pack-opening") {
    for (const copy of next.copies.filter((item) => item.acquiredRecordId === record.id)) {
      copy.status = status === "void" ? "void" : "available";
    }
    for (const sealed of next.sealedUnits.filter((item) => item.openedRecordId === record.id)) {
      sealed.status = status === "void" ? "sealed" : "opened";
    }
  } else if (record.type === "adjustment") {
    for (const line of record.lines) {
      for (const copy of next.copies.filter((item) => line.entityIds.includes(item.id))) {
        if (copy.removedRecordId === record.id) copy.status = status === "void" ? "available" : "removed";
        if (copy.acquiredRecordId === record.id) copy.status = status === "void" ? "void" : "available";
      }
    }
  } else if (status === "void") {
    const dependentCopy = next.copies.find(
      (copy) => copy.acquiredRecordId === record.id && (copy.soldRecordId || copy.removedRecordId),
    );
    const dependentSealed = next.sealedUnits.find(
      (sealed) => sealed.acquiredRecordId === record.id && sealed.openedRecordId,
    );
    const dependentBulk = next.bulkLots.find(
      (bulk) => bulk.acquiredRecordId === record.id && bulk.itemizedQuantity > 0,
    );
    if (dependentCopy || dependentSealed || dependentBulk) {
      return { next: snapshot, result: { ok: false, message: "This acquisition has later copy history. Void the dependent sale or adjustment first." } satisfies DataSourceResult };
    }
    for (const copy of next.copies.filter((item) => item.acquiredRecordId === record.id)) copy.status = "void";
    for (const sealed of next.sealedUnits.filter((item) => item.acquiredRecordId === record.id)) sealed.status = "void";
    for (const bulk of next.bulkLots.filter((item) => item.acquiredRecordId === record.id)) bulk.status = "void";
    for (const supply of next.supplies.filter((item) => item.acquiredRecordId === record.id)) supply.status = "void";
  } else {
    for (const copy of next.copies.filter((item) => item.acquiredRecordId === record.id && item.status === "void")) copy.status = "available";
    for (const sealed of next.sealedUnits.filter((item) => item.acquiredRecordId === record.id && item.status === "void")) sealed.status = "sealed";
    for (const bulk of next.bulkLots.filter((item) => item.acquiredRecordId === record.id && item.status === "void")) bulk.status = "open";
    for (const supply of next.supplies.filter((item) => item.acquiredRecordId === record.id && item.status === "void")) supply.status = "held";
  }
  record.status = status;
  return { next, result: { ok: true, id: record.id } satisfies DataSourceResult };
}
