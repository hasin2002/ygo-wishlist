import type {
  CardContentsInput,
  CardCopy,
  CardCopyUpdate,
  CardPrinting,
  DataSourceResult,
  RecordDetailsUpdate,
  OpeningInput,
  PreviewAttentionItem,
  ProductIdentityInput,
  PurchaseInput,
  RecordEntry,
  RecordLine,
  RecordLineUpdate,
  RecordsSnapshot,
  SaleInput,
  WishlistTarget,
} from "./types.ts";
import { allocatePenceAt } from "./allocation.ts";
import { compactRecordName, generatedSaleRecordName } from "./record-name.ts";

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
      revision: 1,
      createdAt: "2026-07-12T18:20:00.000Z",
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
      revision: 1,
      createdAt: "2026-07-13T19:15:00.000Z",
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
      notes: "Bought as one lot; known cards are maintained on this original Purchase.",
      revision: 1,
      createdAt: "2026-07-08T12:00:00.000Z",
      lines: [
        {
          id: "line-preview-bulk",
          kind: "bulk",
          name: "Childhood collection box",
          quantity: 1,
          allocationPence: null,
          entityIds: ["bulk-preview-childhood"],
          detail: "About 180 cards",
        },
        {
          id: "line-preview-ash",
          kind: "card",
          name: "Ash Blossom & Joyous Spring",
          quantity: 1,
          allocationPence: null,
          entityIds: ["copy-preview-ash"],
          detail: "MACR-EN036 · Secret Rare · from Childhood collection box",
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
      revision: 1,
      createdAt: "2026-07-15T17:40:00.000Z",
      lines: [
        {
          id: "line-preview-ash-sale",
          kind: "card",
          name: "Ash Blossom & Joyous Spring",
          quantity: 1,
          allocationPence: null,
          entityIds: ["copy-preview-ash"],
          detail: "Library status: Wishlist",
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
        bulkLotId: null,
        allocationIndex: null,
        allocationPence: 2100,
        status: "available",
        condition: "Near Mint", location: null, stickerNumber: null, privateNote: "", createdAt: "2026-07-12T18:20:00.000Z",
      },
      {
        id: "copy-preview-dark-2",
        printingId: printings[0].id,
        acquiredRecordId: records[0].id,
        soldRecordId: null,
        bulkLotId: null,
        allocationIndex: null,
        allocationPence: 2100,
        status: "available",
        condition: "Near Mint", location: null, stickerNumber: null, privateNote: "", createdAt: "2026-07-12T18:20:01.000Z",
      },
      {
        id: "copy-preview-blue-eyes",
        printingId: printings[1].id,
        acquiredRecordId: records[1].id,
        soldRecordId: null,
        bulkLotId: null,
        allocationIndex: null,
        allocationPence: null,
        status: "available",
        condition: "Lightly Played", location: null, stickerNumber: null, privateNote: "", createdAt: "2026-07-13T19:15:00.000Z",
      },
      {
        id: "copy-preview-ash",
        printingId: printings[2].id,
        acquiredRecordId: records[2].id,
        soldRecordId: records[3].id,
        bulkLotId: "bulk-preview-childhood",
        allocationIndex: 0,
        allocationPence: 22,
        status: "sold",
        condition: "Near Mint", location: null, stickerNumber: null, privateNote: "", createdAt: "2026-07-15T17:40:00.000Z",
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
        totalQuantity: 180,
        itemizedQuantity: 1,
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
        printingId,
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
        bulkLotId: null,
        allocationIndex: null,
        allocationPence: paidPence,
        status: "available",
        condition: "Unknown", location: null, stickerNumber: null, privateNote: "", createdAt: card.createdAt,
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
        revision: 1,
        createdAt: card.createdAt,
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

export function deleteWishlistTarget(snapshot: RecordsSnapshot, targetId: string) {
  const target = snapshot.targets.find((item) => item.id === targetId);
  if (!target) return { next: snapshot, result: { ok: false, message: "Wishlist Target not found." } satisfies DataSourceResult };
  const printingIds = new Set(snapshot.printings.filter((printing) => printing.targetId === targetId).map((printing) => printing.id));
  if (snapshot.copies.some((copy) => printingIds.has(copy.printingId))) {
    return { next: snapshot, result: { ok: false, message: "This Target has Copy history and cannot be deleted. Remove or void the relevant Record instead." } satisfies DataSourceResult };
  }
  const next = clone(snapshot);
  next.targets = next.targets.filter((item) => item.id !== targetId);
  next.printings = next.printings.filter((printing) => printing.targetId !== targetId);
  next.attention = next.attention.filter((item) => item.targetId !== targetId);
  return { next, result: { ok: true, id: targetId } satisfies DataSourceResult };
}

export function resolveCardAttention(snapshot: RecordsSnapshot, update: {
  targetId: string;
  printingId?: string | null;
  name: string;
  rarity: string;
  edition: string;
  tcgplayerUrl: string;
  setName: string;
  setCode: string;
  imageUrl: string | null;
}) {
  const target = snapshot.targets.find((item) => item.id === update.targetId);
  if (!target) return { next: snapshot, result: { ok: false, message: "This card is no longer in the current snapshot." } satisfies DataSourceResult };
  const printing = snapshot.printings.find((item) => (
    item.targetId === update.targetId && (!update.printingId || item.id === update.printingId)
  ));
  if (!printing) return { next: snapshot, result: { ok: false, message: "This printing is no longer in the current snapshot." } satisfies DataSourceResult };

  const next = clone(snapshot);
  const nextTarget = next.targets.find((item) => item.id === update.targetId)!;
  const nextPrinting = next.printings.find((item) => item.id === printing.id)!;
  nextTarget.name = update.name.trim();
  nextTarget.rarity = update.rarity.trim();
  nextTarget.edition = update.edition;
  nextTarget.tcgplayerUrl = update.tcgplayerUrl.trim();
  nextTarget.imageUrl = update.imageUrl;
  nextPrinting.setName = update.setName.trim();
  nextPrinting.setCode = update.setCode.trim();
  nextPrinting.tcgplayerUrl = update.tcgplayerUrl.trim();
  nextPrinting.imageUrl = update.imageUrl;
  const copyIds = new Set(next.copies.filter((copy) => copy.printingId === printing.id).map((copy) => copy.id));
  for (const record of next.records) {
    for (const line of record.lines) {
      if (line.entityIds.some((id) => copyIds.has(id))) {
        line.name = update.name.trim();
        line.detail = `${update.setCode.trim()} · ${update.edition} · ${update.rarity.trim()}`;
      }
    }
  }
  next.attention = next.attention.filter((item) => (
    !(item.printingId === printing.id || (
      item.targetId === update.targetId && item.field !== "cost"
    ))
  ));
  return { next, result: { ok: true, id: update.targetId } satisfies DataSourceResult };
}

function findOrCreatePrinting(
  snapshot: RecordsSnapshot,
  input: {
    name: string;
    selectedTargetId?: string | null;
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
  let target = input.selectedTargetId
    ? snapshot.targets.find((item) => item.id === input.selectedTargetId)
    : undefined;
  target ??= snapshot.targets.find(
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
  } else if (input.selectedTargetId) {
    target.name = input.name;
    target.rarity = rarity;
    target.edition = edition;
    target.tcgplayerUrl = tcgplayerUrl || target.tcgplayerUrl;
    target.imageUrl = input.imageUrl || target.imageUrl;
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
    selectedTargetId?: string | null;
    edition?: string;
    rarity?: string;
    setName: string;
    setCode: string;
    quantity: number;
    tcgplayerUrl?: string;
    imageUrl?: string | null;
  },
  recordId: string,
  allocation?: {
    bulkLotId: string;
    indexes: number[];
    values: number[];
  },
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
      bulkLotId: allocation?.bulkLotId ?? null,
      allocationIndex: allocation?.indexes[index] ?? null,
      allocationPence: allocation?.values[index] ?? null,
      status: "available",
      condition: "Near Mint", location: null, stickerNumber: null, privateNote: "", createdAt: nowIso(),
    });
  }

  return ids;
}

export function applyPurchase(snapshot: RecordsSnapshot, input: PurchaseInput) {
  const next = clone(snapshot);
  const id = previewId("record");
  const lines: RecordLine[] = [];
  let generatedTitle = "Purchase";

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
    generatedTitle = `Purchased ${card.name}`;
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
    generatedTitle = `Purchased ${input.product.name}`;
  } else if (input.kind === "bulk") {
    const bulkId = previewId("bulk");
    const copyCount = input.cards.reduce((sum, card) => sum + card.quantity, 0);
    if (!Number.isInteger(input.totalCardCount) || input.totalCardCount < copyCount) {
      return {
        next: snapshot,
        result: {
          ok: false,
          message: "Total cards in the lot must include every identified physical copy.",
        } satisfies DataSourceResult,
      };
    }
    const lotName = `Bulk lot · ${input.cards.length} card ${input.cards.length === 1 ? "type" : "types"}`;
    next.bulkLots.push({
      id: bulkId,
      name: lotName,
      totalQuantity: input.totalCardCount,
      itemizedQuantity: copyCount,
      acquiredRecordId: id,
      status: copyCount < input.totalCardCount ? "open" : "itemized",
    });
    lines.push(recordLine(
      "bulk",
      lotName,
      1,
      [bulkId],
      null,
      `${copyCount} identified of ${input.totalCardCount} total cards`,
    ));
    let allocationIndex = 0;
    for (const card of input.cards) {
      const indexes = Array.from(
        { length: card.quantity },
        (_, offset) => allocationIndex + offset,
      );
      const values = indexes.map((index) => (
        allocatePenceAt(input.totalPence, input.totalCardCount, index)
      ));
      allocationIndex += card.quantity;
      const ids = addCopies(next, card, id, { bulkLotId: bulkId, indexes, values });
      lines.push(recordLine(
        "card",
        card.name,
        card.quantity,
        ids,
        values.reduce((sum, value) => sum + value, 0),
        `${card.setCode || "Unknown code"} · ${card.edition} · from ${lotName}`,
      ));
      addAttention(card, card.name);
    }
    generatedTitle = `Purchased ${lotName.toLowerCase()}`;
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
    generatedTitle = `Purchased ${categoryLabel}`;
  }

  next.records.unshift({
    id,
    type: "purchase",
    status: "active",
    date: input.date,
    title: compactRecordName(input.recordName, generatedTitle),
    source: input.source || "Manual entry",
    listingUrl: input.listingUrl.trim() || null,
    amountPence: input.totalPence,
    notes: input.notes,
    lines,
    revision: 1,
    createdAt: nowIso(),
  });

  return { next, result: { ok: true, id } satisfies DataSourceResult };
}

export function applyOpening(snapshot: RecordsSnapshot, input: OpeningInput) {
  const next = clone(snapshot);
  let sealed = input.useTrackedStock && input.sealedUnitId
    ? next.sealedUnits.find((item) => item.id === input.sealedUnitId && item.status === "sealed")
    : undefined;
  if (input.useTrackedStock && !sealed) return { next: snapshot, result: { ok: false, message: "That sealed product is no longer available. Refresh and choose another unit." } satisfies DataSourceResult };

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
      title: `Untracked ${input.product.name}`,
      source: input.source,
      listingUrl: null,
      amountPence: isGift ? 0 : input.totalPence,
      amountKnown: true,
      notes: isGift ? "Gifted sealed product." : "Recorded alongside a pack opening.",
      lines: [recordLine("sealed", input.product.name, 1, [sealedId], isGift ? 0 : input.totalPence, isGift ? `Gift · £0 · ${input.product.edition}` : `£${(input.totalPence / 100).toFixed(2)} · ${input.product.edition}`)],
      revision: 1,
      createdAt: nowIso(),
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
    title: compactRecordName(input.recordName, `Opened ${input.product.name}`),
    source: input.source,
    listingUrl: null,
    amountPence: 0,
    notes: input.notes,
    lines,
    revision: 1,
    createdAt: nowIso(),
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
    title: compactRecordName(
      input.recordName,
      generatedSaleRecordName(Array.from(grouped.values()).map((group) => group.name)),
    ),
    titleGenerated: !input.recordName.trim(),
    source: input.source || "Manual entry",
    listingUrl: null,
    amountPence: input.netProceedsPence,
    notes: input.notes,
    lines: Array.from(grouped.values()).map((group) => recordLine("card", group.name, group.ids.length, group.ids, null, group.detail)),
    revision: 1,
    createdAt: nowIso(),
  });
  return { next, result: { ok: true, id } satisfies DataSourceResult };
}

export function updateRecordDetails(snapshot: RecordsSnapshot, recordId: string, update: RecordDetailsUpdate) {
  const next = clone(snapshot);
  const record = next.records.find((item) => item.id === recordId);
  if (!record) return { next: snapshot, result: { ok: false, message: "Record not found." } satisfies DataSourceResult };
  if (record.status === "void") return { next: snapshot, result: { ok: false, message: "Restore this Record before editing it." } satisfies DataSourceResult };
  if (!update.title.trim() || !update.date || !update.source.trim()) {
    return { next: snapshot, result: { ok: false, message: "Add a record name, date, and source before saving." } satisfies DataSourceResult };
  }
  if (!Number.isInteger(update.amountPence) || update.amountPence < 0) {
    return { next: snapshot, result: { ok: false, message: "Enter a valid non-negative amount." } satisfies DataSourceResult };
  }
  record.title = update.title.trim();
  record.titleGenerated = false;
  record.date = update.date;
  record.source = update.source.trim();
  record.listingUrl = update.listingUrl?.trim() || null;
  record.amountPence = update.amountPence;
  record.amountKnown = true;
  next.attention = next.attention.filter((item) => item.id !== `attention-cost-${record.id}`);
  record.notes = update.notes.trim();
  const bulkLot = next.bulkLots.find((lot) => lot.acquiredRecordId === record.id);
  if (bulkLot) {
    for (const copy of next.copies.filter((item) => item.bulkLotId === bulkLot.id)) {
      if (copy.allocationIndex !== null) {
        copy.allocationPence = allocatePenceAt(update.amountPence, bulkLot.totalQuantity, copy.allocationIndex);
      }
    }
    for (const line of record.lines.filter((item) => item.kind === "card")) {
      line.allocationPence = next.copies
        .filter((copy) => line.entityIds.includes(copy.id))
        .reduce((sum, copy) => sum + (copy.allocationPence ?? 0), 0);
    }
  }
  record.revision += 1;
  next.records.sort((left, right) => (
    right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt)
  ));
  return { next, result: { ok: true, id: record.id } satisfies DataSourceResult };
}

function cardInputError(card: CardContentsInput, existing: boolean) {
  if (!card.name.trim() || !card.edition || !card.rarity.trim()) return "Every card needs a name, edition, and rarity.";
  if (!Number.isInteger(card.quantity) || card.quantity < 1) return "Every card quantity must be at least one.";
  if (!existing && !/tcgplayer\.com\/product\/\d+/i.test(card.tcgplayerUrl)) return "New cards need a complete TCGplayer product link.";
  return null;
}

export function replaceRecordCards(snapshot: RecordsSnapshot, recordId: string, cards: CardContentsInput[]) {
  const next = clone(snapshot);
  const record = next.records.find((item) => item.id === recordId);
  if (!record) return { next: snapshot, result: { ok: false, message: "Record not found." } satisfies DataSourceResult };
  const editableRecord = record;
  if (record.status === "void") return { next: snapshot, result: { ok: false, message: "Restore this Record before editing its items." } satisfies DataSourceResult };
  if (record.type === "sale") return { next: snapshot, result: { ok: false, message: "Use exact Copy selection to edit a Sale." } satisfies DataSourceResult };
  const existingLines = record.lines.filter((line) => line.kind === "card");
  const hasBulkContainer = record.lines.some((line) => line.kind === "bulk");
  const bulkLot = hasBulkContainer
    ? next.bulkLots.find((lot) => lot.acquiredRecordId === record.id)
    : undefined;
  if (!existingLines.length && !hasBulkContainer) return { next: snapshot, result: { ok: false, message: "This Record does not contain editable card items." } satisfies DataSourceResult };
  if (!cards.length && !hasBulkContainer && record.type !== "pack-opening") return { next: snapshot, result: { ok: false, message: "Keep at least one card item, or void the whole Record." } satisfies DataSourceResult };

  for (const card of cards) {
    const problem = cardInputError(card, existingLines.some((line) => line.id === card.id));
    if (problem) return { next: snapshot, result: { ok: false, message: problem } satisfies DataSourceResult };
  }
  const requestedCopyCount = cards.reduce((sum, card) => sum + card.quantity, 0);
  if (bulkLot && requestedCopyCount > bulkLot.totalQuantity) {
    return {
      next: snapshot,
      result: {
        ok: false,
        message: `This Bulk Lot contains ${bulkLot.totalQuantity} cards in total. Reduce the identified quantities or update the lot total first.`,
      } satisfies DataSourceResult,
    };
  }

  const retainedIds = new Set(cards.map((card) => card.id));
  for (const line of existingLines) {
    const requested = cards.find((card) => card.id === line.id);
    if (!requested || requested.quantity < line.entityIds.length) {
      return { next: snapshot, result: { ok: false, message: "Choose the exact physical Copy from Manage copies instead of reducing this source quantity." } satisfies DataSourceResult };
    }
  }
  for (const line of existingLines.filter((item) => !retainedIds.has(item.id))) {
    const copies = next.copies.filter((copy) => line.entityIds.includes(copy.id));
    if (copies.some((copy) => copy.soldRecordId)) {
      return { next: snapshot, result: { ok: false, message: `“${line.name}” has later history and cannot be deleted.` } satisfies DataSourceResult };
    }
    next.copies = next.copies.filter((copy) => !line.entityIds.includes(copy.id));
  }

  function addRecordCopies(card: CardContentsInput, quantity: number) {
    if (!bulkLot) return addCopies(next, { ...card, quantity }, editableRecord.id);
    const usedIndexes = new Set(
      next.copies
        .filter((copy) => copy.bulkLotId === bulkLot.id && copy.allocationIndex !== null)
        .map((copy) => copy.allocationIndex as number),
    );
    const indexes = Array.from({ length: bulkLot.totalQuantity }, (_, index) => index)
      .filter((index) => !usedIndexes.has(index))
      .slice(0, quantity);
    if (indexes.length !== quantity) return null;
    const values = indexes.map((index) => (
      allocatePenceAt(editableRecord.amountPence, bulkLot.totalQuantity, index)
    ));
    return addCopies(
      next,
      { ...card, quantity },
      editableRecord.id,
      { bulkLotId: bulkLot.id, indexes, values },
    );
  }

  const nextCardLines: RecordLine[] = [];
  for (const card of cards) {
    const existingLine = existingLines.find((line) => line.id === card.id);
    if (!existingLine) {
      const ids = addRecordCopies(card, card.quantity);
      if (!ids) return { next: snapshot, result: { ok: false, message: "The Bulk Lot total has no unallocated card positions left." } satisfies DataSourceResult };
      const allocation = next.copies
        .filter((copy) => ids.includes(copy.id))
        .reduce((sum, copy) => sum + (copy.allocationPence ?? 0), 0);
      nextCardLines.push({ ...recordLine("card", card.name.trim(), card.quantity, ids, bulkLot ? allocation : null, `${card.setCode || "Unknown code"} · ${card.edition} · ${card.rarity}`), id: card.id });
      continue;
    }

    const copies = next.copies.filter((copy) => existingLine.entityIds.includes(copy.id));
    const firstCopy = copies[0];
    const currentPrinting = firstCopy ? next.printings.find((printing) => printing.id === firstCopy.printingId) : null;
    const currentTarget = currentPrinting ? next.targets.find((target) => target.id === currentPrinting.targetId) : null;
    const identityChanged = !currentTarget || !currentPrinting
      || normalized(currentTarget.name) !== normalized(card.name)
      || normalized(currentTarget.rarity) !== normalized(card.rarity)
      || normalizedEdition(currentTarget.edition) !== normalizedEdition(card.edition)
      || normalized(currentPrinting.setName) !== normalized(card.setName)
      || normalized(currentPrinting.setCode) !== normalized(card.setCode)
      || canonicalProductUrl(currentPrinting.tcgplayerUrl) !== canonicalProductUrl(card.tcgplayerUrl);
    if (identityChanged && copies.some((copy) => copy.soldRecordId)) {
      return { next: snapshot, result: { ok: false, message: `“${existingLine.name}” has later history, so its printing identity cannot be changed.` } satisfies DataSourceResult };
    }

    let entityIds = [...existingLine.entityIds];
    if (card.quantity < entityIds.length) {
      const removeCount = entityIds.length - card.quantity;
      const removable = copies.filter((copy) => !copy.soldRecordId && copy.status === "available").slice(0, removeCount);
      if (removable.length !== removeCount) {
        return { next: snapshot, result: { ok: false, message: `“${existingLine.name}” has dependent Copies, so its quantity cannot be reduced that far.` } satisfies DataSourceResult };
      }
      const removedIds = new Set(removable.map((copy) => copy.id));
      next.copies = next.copies.filter((copy) => !removedIds.has(copy.id));
      entityIds = entityIds.filter((id) => !removedIds.has(id));
    } else if (card.quantity > entityIds.length) {
      const addedIds = addRecordCopies(card, card.quantity - entityIds.length);
      if (!addedIds) return { next: snapshot, result: { ok: false, message: "The Bulk Lot total has no unallocated card positions left." } satisfies DataSourceResult };
      entityIds.push(...addedIds);
    }

    if (identityChanged) {
      const printing = findOrCreatePrinting(next, card);
      for (const copy of next.copies.filter((item) => entityIds.includes(item.id))) copy.printingId = printing.id;
    }
    nextCardLines.push({
      ...existingLine,
      name: card.name.trim(),
      quantity: card.quantity,
      entityIds,
      allocationPence: bulkLot
        ? next.copies
            .filter((copy) => entityIds.includes(copy.id))
            .reduce((sum, copy) => sum + (copy.allocationPence ?? 0), 0)
        : existingLine.allocationPence,
      detail: `${card.setCode || "Unknown code"} · ${card.edition} · ${card.rarity}`,
    });
  }

  record.lines = [...record.lines.filter((line) => line.kind !== "card"), ...nextCardLines];
  if (bulkLot) {
    bulkLot.itemizedQuantity = next.copies.filter((copy) => copy.bulkLotId === bulkLot.id).length;
    bulkLot.status = bulkLot.itemizedQuantity >= bulkLot.totalQuantity ? "itemized" : "open";
    const bulkLine = record.lines.find((line) => line.kind === "bulk");
    if (bulkLine) bulkLine.detail = `${bulkLot.itemizedQuantity} identified of ${bulkLot.totalQuantity} total cards`;
  }
  record.revision += 1;
  return { next, result: { ok: true, id: record.id } satisfies DataSourceResult };
}

export function replaceSaleCopies(snapshot: RecordsSnapshot, recordId: string, copyIds: string[]) {
  const next = clone(snapshot);
  const record = next.records.find((item) => item.id === recordId && item.type === "sale");
  if (!record) return { next: snapshot, result: { ok: false, message: "Sale not found." } satisfies DataSourceResult };
  if (record.status === "void") return { next: snapshot, result: { ok: false, message: "Restore this Sale before editing its sold Copies." } satisfies DataSourceResult };
  const uniqueIds = Array.from(new Set(copyIds));
  if (!uniqueIds.length) return { next: snapshot, result: { ok: false, message: "Keep at least one sold Copy, or void the whole Sale." } satisfies DataSourceResult };
  const selected = uniqueIds.map((id) => next.copies.find((copy) => copy.id === id));
  if (selected.some((copy) => !copy || (copy.status !== "available" && copy.soldRecordId !== record.id))) {
    return { next: snapshot, result: { ok: false, message: "One of the selected Copies is no longer available." } satisfies DataSourceResult };
  }

  for (const copy of next.copies.filter((item) => item.soldRecordId === record.id && !uniqueIds.includes(item.id))) {
    copy.status = "available";
    copy.soldRecordId = null;
  }
  const grouped = new Map<string, { name: string; ids: string[]; detail: string }>();
  for (const copy of selected as CardCopy[]) {
    const printing = next.printings.find((item) => item.id === copy.printingId);
    const target = printing ? next.targets.find((item) => item.id === printing.targetId) : null;
    if (!printing || !target) return { next: snapshot, result: { ok: false, message: "A selected Copy has incomplete printing data." } satisfies DataSourceResult };
    copy.status = "sold";
    copy.soldRecordId = record.id;
    const key = target.id;
    const group = grouped.get(key) ?? { name: target.name, ids: [], detail: `${printing.setCode} · ${copy.condition}` };
    group.ids.push(copy.id);
    grouped.set(key, group);
  }
  record.lines = Array.from(grouped.values()).map((group) => recordLine("card", group.name, group.ids.length, group.ids, null, group.detail));
  if (record.titleGenerated) {
    record.title = compactRecordName("", generatedSaleRecordName(Array.from(grouped.values()).map((group) => group.name)));
  }
  record.revision += 1;
  return { next, result: { ok: true, id: record.id } satisfies DataSourceResult };
}

export function updateCardCopy(snapshot: RecordsSnapshot, copyId: string, update: CardCopyUpdate) {
  const next = clone(snapshot);
  const copy = next.copies.find((item) => item.id === copyId);
  if (!copy) return { next: snapshot, result: { ok: false, message: "Physical Copy not found." } satisfies DataSourceResult };
  const stickerNumber = update.stickerNumber.trim() || null;
  const duplicate = stickerNumber && next.copies.find((item) => item.id !== copyId && item.stickerNumber === stickerNumber);
  if (duplicate) {
    return {
      next: snapshot,
      result: { ok: false, message: `Sticker number ${stickerNumber} is already assigned to another physical Copy.` } satisfies DataSourceResult,
    };
  }
  copy.condition = update.condition;
  copy.location = update.location.trim() || null;
  copy.stickerNumber = stickerNumber;
  copy.privateNote = update.privateNote.trim();
  return { next, result: { ok: true, id: copyId } satisfies DataSourceResult };
}

export function removeCardCopy(snapshot: RecordsSnapshot, copyId: string) {
  const next = clone(snapshot);
  const copy = next.copies.find((item) => item.id === copyId);
  if (!copy) return { next: snapshot, result: { ok: false, message: "Physical Copy not found." } satisfies DataSourceResult };
  if (copy.status !== "available") return { next: snapshot, result: { ok: false, message: copy.status === "sold" ? "Edit the Sale before removing this Copy." : "Restore the source Record before removing this Copy." } satisfies DataSourceResult };
  const record = next.records.find((item) => item.id === copy.acquiredRecordId);
  const line = record?.lines.find((item) => item.entityIds.includes(copyId));
  if (!record || !line) return { next: snapshot, result: { ok: false, message: "The source Record is unavailable." } satisfies DataSourceResult };
  next.copies = next.copies.filter((item) => item.id !== copyId);
  if (copy.bulkLotId) {
    const lot = next.bulkLots.find((item) => item.id === copy.bulkLotId);
    if (!lot) return { next: snapshot, result: { ok: false, message: "The source Bulk Lot is unavailable." } satisfies DataSourceResult };
    lot.itemizedQuantity = next.copies.filter((item) => item.bulkLotId === lot.id).length;
    lot.status = lot.itemizedQuantity >= lot.totalQuantity ? "itemized" : "open";
    const bulkLine = record.lines.find((item) => item.kind === "bulk" && item.entityIds.includes(lot.id));
    if (bulkLine) bulkLine.detail = `${lot.itemizedQuantity} identified of ${lot.totalQuantity} total cards`;
  }
  if (line.quantity <= 1) {
    record.lines = record.lines.filter((item) => item.id !== line.id);
    if (!record.lines.length) record.status = "void";
  } else {
    line.quantity -= 1;
    line.entityIds = line.entityIds.filter((id) => id !== copyId);
    const remainingCopies = line.entityIds.flatMap((id) => {
      const item = next.copies.find((candidate) => candidate.id === id);
      return item ? [item] : [];
    });
    if (copy.bulkLotId) {
      line.allocationPence = remainingCopies.reduce((sum, item) => sum + (item.allocationPence ?? 0), 0);
    } else if (record.type === "purchase") {
      line.allocationPence = record.amountPence;
      for (const [index, item] of remainingCopies.entries()) {
        item.allocationPence = allocatePenceAt(record.amountPence, remainingCopies.length, index);
      }
    }
  }
  record.revision += 1;
  return { next, result: { ok: true, id: copyId } satisfies DataSourceResult };
}

export function updateRecordLine(snapshot: RecordsSnapshot, recordId: string, lineId: string, update: RecordLineUpdate) {
  const next = clone(snapshot);
  const record = next.records.find((item) => item.id === recordId);
  const line = record?.lines.find((item) => item.id === lineId);
  if (!record || !line) return { next: snapshot, result: { ok: false, message: "Record item not found." } satisfies DataSourceResult };
  if (record.status === "void") return { next: snapshot, result: { ok: false, message: "Restore this Record before editing its items." } satisfies DataSourceResult };
  if (line.kind === "card") return { next: snapshot, result: { ok: false, message: "Use the card editor for this item." } satisfies DataSourceResult };
  if (!update.name.trim() || !Number.isInteger(update.quantity) || update.quantity < 1) {
    return { next: snapshot, result: { ok: false, message: "Add an item name and a quantity of at least one." } satisfies DataSourceResult };
  }
  if (line.kind === "sealed") {
    const units = next.sealedUnits.filter((unit) => line.entityIds.includes(unit.id));
    if (units.some((unit) => unit.openedRecordId) && (
      update.name.trim() !== line.name
      || update.quantity < line.quantity
      || Boolean(update.edition && units.some((unit) => unit.edition !== update.edition))
    )) {
      return { next: snapshot, result: { ok: false, message: `“${line.name}” has already been opened, so its identity or quantity cannot be reduced.` } satisfies DataSourceResult };
    }
    let ids = [...line.entityIds];
    if (update.quantity < ids.length) {
      const removable = units.filter((unit) => !unit.openedRecordId).slice(0, ids.length - update.quantity);
      if (removable.length !== ids.length - update.quantity) return { next: snapshot, result: { ok: false, message: "Opened units cannot be deleted." } satisfies DataSourceResult };
      const removedIds = new Set(removable.map((unit) => unit.id));
      next.sealedUnits = next.sealedUnits.filter((unit) => !removedIds.has(unit.id));
      ids = ids.filter((id) => !removedIds.has(id));
    } else if (update.quantity > ids.length) {
      const base = units[0];
      if (!base) return { next: snapshot, result: { ok: false, message: "The sealed item data is incomplete." } satisfies DataSourceResult };
      for (let index = ids.length; index < update.quantity; index += 1) {
        const id = previewId("sealed");
        ids.push(id);
        next.sealedUnits.push({ ...base, id, name: update.name.trim(), status: "sealed", openedRecordId: null });
      }
    }
    for (const unit of next.sealedUnits.filter((item) => ids.includes(item.id))) {
      unit.name = update.name.trim();
      if (update.edition) unit.edition = update.edition;
    }
    line.entityIds = ids;
  } else if (line.kind === "supply") {
    const supplies = next.supplies.filter((item) => line.entityIds.includes(item.id));
    for (const supply of supplies) {
      supply.name = update.name.trim();
      supply.quantity = update.quantity;
      if (update.category) supply.category = update.category;
    }
  } else if (line.kind === "bulk") {
    const lots = next.bulkLots.filter((item) => line.entityIds.includes(item.id));
    for (const lot of lots) {
      const nextTotal = update.totalQuantity ?? lot.totalQuantity;
      if (!Number.isInteger(nextTotal) || nextTotal < lot.itemizedQuantity) {
        return {
          next: snapshot,
          result: {
            ok: false,
            message: `Total cards cannot be less than the ${lot.itemizedQuantity} identified Copies.`,
          } satisfies DataSourceResult,
        };
      }
      const lotCopies = next.copies.filter((copy) => copy.bulkLotId === lot.id);
      if (nextTotal !== lot.totalQuantity && lotCopies.some((copy) => copy.soldRecordId)) {
        return {
          next: snapshot,
          result: {
            ok: false,
            message: "The lot total cannot change after one of its Copies has been sold.",
          } satisfies DataSourceResult,
        };
      }
      lot.name = update.name.trim();
      lot.totalQuantity = nextTotal;
      lot.status = lot.itemizedQuantity >= lot.totalQuantity ? "itemized" : "open";
      for (const copy of lotCopies) {
        if (copy.allocationIndex !== null) {
          copy.allocationPence = allocatePenceAt(record.amountPence, nextTotal, copy.allocationIndex);
        }
      }
      for (const cardLine of record.lines.filter((item) => item.kind === "card")) {
        cardLine.allocationPence = next.copies
          .filter((copy) => cardLine.entityIds.includes(copy.id))
          .reduce((sum, copy) => sum + (copy.allocationPence ?? 0), 0);
      }
      line.detail = `${lot.itemizedQuantity} identified of ${lot.totalQuantity} total cards`;
    }
  }
  line.name = update.name.trim();
  line.quantity = update.quantity;
  line.detail = line.kind === "sealed" && update.edition
    ? update.edition
    : line.kind === "supply" && update.category
      ? update.category === "other" ? "Other supply or extra" : `${update.category.charAt(0).toUpperCase()}${update.category.slice(1)}`
      : line.kind === "bulk"
        ? line.detail
        : update.detail.trim() || null;
  record.revision += 1;
  return { next, result: { ok: true, id: record.id } satisfies DataSourceResult };
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
  } else if (status === "void") {
    const dependentCopy = next.copies.find(
      (copy) => copy.acquiredRecordId === record.id && copy.soldRecordId,
    );
    const dependentSealed = next.sealedUnits.find(
      (sealed) => sealed.acquiredRecordId === record.id && sealed.openedRecordId,
    );
    if (dependentCopy || dependentSealed) {
      return { next: snapshot, result: { ok: false, message: "This acquisition has later Copy history. Void the dependent Sale or Pack Opening first." } satisfies DataSourceResult };
    }
    for (const copy of next.copies.filter((item) => item.acquiredRecordId === record.id)) copy.status = "void";
    for (const sealed of next.sealedUnits.filter((item) => item.acquiredRecordId === record.id)) sealed.status = "void";
    for (const bulk of next.bulkLots.filter((item) => item.acquiredRecordId === record.id)) bulk.status = "void";
    for (const supply of next.supplies.filter((item) => item.acquiredRecordId === record.id)) supply.status = "void";
  } else {
    for (const copy of next.copies.filter((item) => item.acquiredRecordId === record.id && item.status === "void")) copy.status = "available";
    for (const sealed of next.sealedUnits.filter((item) => item.acquiredRecordId === record.id && item.status === "void")) sealed.status = "sealed";
    for (const bulk of next.bulkLots.filter((item) => item.acquiredRecordId === record.id && item.status === "void")) {
      bulk.status = bulk.itemizedQuantity >= bulk.totalQuantity ? "itemized" : "open";
    }
    for (const supply of next.supplies.filter((item) => item.acquiredRecordId === record.id && item.status === "void")) supply.status = "held";
  }
  record.status = status;
  record.revision += 1;
  return { next, result: { ok: true, id: record.id } satisfies DataSourceResult };
}
