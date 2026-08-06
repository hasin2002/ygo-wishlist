import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  bulkLots,
  cardCopies,
  cardCopyImages,
  cardPrintings,
  cardTargets,
  ebayListings,
  ebayListingMembers,
  ebayOrderLineAllocations,
  ebayOrderLines,
  recordEntries,
  recordLineCopies,
  recordLines,
  sealedUnits,
  supplyItems,
} from "@/db/schema";
import { deleteCardInventoryImage } from "@/server/card-inventory-images";
import { allocatePenceAt } from "@/lib/records/allocation";
import {
  ordinaryPurchaseCopyAllocations,
  ordinaryPurchaseLineAllocation,
} from "@/lib/records/purchase-accounting";
import { sealedPurchaseUnitAllocations } from "@/lib/records/sealed-purchase-accounting";
import { compactRecordName, generatedSaleRecordName } from "@/lib/records/record-name";
import {
  buildCopyEbayExposureStates,
} from "@/lib/records/copy-ebay-exposure";
import type { EbayOfferExposure } from "@/lib/records/types";
import { cardConditions } from "@/lib/records/types";
import {
  ebayCopyLinkAttentionDecision,
  ebayListingStatusAttentionDecision,
} from "@/lib/records/ebay-listing-copy-link-attention";
import type {
  PreviewAttentionItem,
  RecordLine,
  RecordsSnapshot,
} from "@/lib/records/types";
import {
  EbayListingReconciliationError,
  ebayListingStatusSummary,
  reconcileEbayListing,
} from "@/server/ebay-listing-reconciliation";
import {
  getEbayListingsForCopiesMembershipFirst,
  hasEbayCompositionSchema,
  isMissingEbayCompositionSchema,
} from "@/server/ebay-listing-composition";
import { listEbayListingsWorkspace } from "@/server/records/ebay-listings-workspace";
import {
  inspectPaidEbaySaleReviewIntent,
  lockPaidEbaySaleReviewIntent,
} from "@/server/records/paid-ebay-sale-review";
import { requireEbayExternalCapability } from "@/server/ebay-capabilities";
import { CopySelectionError, lockReconciledCopies } from "@/server/records/copy-selection";
import {
  compatiblePrintingIdentity,
  conflictsWithPrintingIdentity,
  normalizePrintingValue,
} from "@/server/printing-identity";
import { adminProcedure, authenticatedProcedure, router } from "@/server/trpc";
import { dismissRecordsSuggestion, listRecordsActions, urgentRecordsActionCount } from "@/server/records/actions";
import { fetchLinkMetadata } from "@/server/metadata";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function listingIdsForCopies(
  ownerId: string,
  copyIds: string[],
) {
  if (!copyIds.length) return [];
  const listingIds = new Set<string>();
  try {
    const members = await db.select({ copyId: ebayListingMembers.copyId, listingId: ebayListingMembers.listingId })
      .from(ebayListingMembers)
      .where(and(
        eq(ebayListingMembers.ownerId, ownerId),
        inArray(ebayListingMembers.copyId, copyIds),
      ));
    for (const member of members) {
      listingIds.add(member.listingId);
    }
  } catch (error) {
    if (!isMissingEbayCompositionSchema(error)) throw error;
  }
  const legacyRows = await db.select({ id: ebayListings.id }).from(ebayListings).where(and(
    eq(ebayListings.ownerId, ownerId),
    inArray(ebayListings.copyId, copyIds),
  ));
  for (const listing of legacyRows) listingIds.add(listing.id);
  return [...listingIds];
}

/** Locks the exact listing relationships after Copy rows are locked. */
async function lockListingsForCopies(
  tx: Transaction,
  ownerId: string,
  copyIds: string[],
  compositionSchemaReady: boolean,
) {
  const relations = new Map<string, {
    copyId: string;
    listing: typeof ebayListings.$inferSelect;
  }>();
  const memberRelations: Array<{ copyId: string; listingId: string }> = [];
  if (compositionSchemaReady) {
    const members = await tx.select({
      copyId: ebayListingMembers.copyId,
      listingId: ebayListingMembers.listingId,
    }).from(ebayListingMembers).where(and(
      eq(ebayListingMembers.ownerId, ownerId),
      inArray(ebayListingMembers.copyId, copyIds),
    )).orderBy(
      asc(ebayListingMembers.copyId),
      asc(ebayListingMembers.listingId),
    ).for("update");
    memberRelations.push(...members);
  }
  const memberListingIds = Array.from(
    new Set(memberRelations.map((relation) => relation.listingId)),
  );
  const listings = await tx.select().from(ebayListings).where(and(
    eq(ebayListings.ownerId, ownerId),
    or(
      inArray(ebayListings.copyId, copyIds),
      memberListingIds.length
        ? inArray(ebayListings.id, memberListingIds)
        : undefined,
    ),
  )).orderBy(asc(ebayListings.id)).for("update");
  const listingById = new Map(listings.map((listing) => [listing.id, listing]));
  for (const relation of memberRelations) {
    const listing = listingById.get(relation.listingId);
    if (listing) {
      relations.set(`${relation.copyId}:${listing.id}`, {
        copyId: relation.copyId,
        listing,
      });
    }
  }
  const selectedCopyIds = new Set(copyIds);
  for (const listing of listings) {
    if (selectedCopyIds.has(listing.copyId)) {
      relations.set(`${listing.copyId}:${listing.id}`, {
        copyId: listing.copyId,
        listing,
      });
    }
  }
  return [...relations.values()];
}

const productEditionSchema = z.enum(["1st Edition", "Unlimited Edition", "Limited Edition"]);
const supplyCategorySchema = z.enum(["sleeves", "binder", "storage", "playmat", "other"]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cardInputSchema = z.object({
  id: z.string().min(1),
  selectedTargetId: z.string().min(1).nullable().optional(),
  tcgplayerUrl: z.string().url().regex(/tcgplayer\.com\/product\/\d+/i),
  name: z.string().trim().min(1).max(160),
  imageUrl: z.string().url().nullable(),
  edition: productEditionSchema,
  rarity: z.string().trim().min(1).max(80),
  setName: z.string().trim().max(160),
  setCode: z.string().trim().max(80),
  metadataNeedsAttention: z.boolean(),
  quantity: z.number().int().positive().max(10_000),
});
const productInputSchema = cardInputSchema.omit({ id: true, quantity: true }).extend({
  rarity: z.string().trim().max(80),
});
const sealedProductInputSchema = productInputSchema.extend({
  edition: productEditionSchema.or(z.literal("")),
});
const commonRecordSchema = z.object({
  recordName: z.string().trim().min(1).max(80),
  date: dateSchema,
  source: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(4_000),
});
const purchaseSchema = z.discriminatedUnion("kind", [
  commonRecordSchema.extend({
    kind: z.literal("card"),
    listingUrl: z.string().trim().url().or(z.literal("")),
    totalPence: z.number().int().nonnegative(),
    amountKnown: z.boolean().default(true),
    card: cardInputSchema,
  }),
  commonRecordSchema.extend({
    kind: z.literal("sealed"),
    listingUrl: z.string().trim().url().or(z.literal("")),
    totalPence: z.number().int().nonnegative(),
    amountKnown: z.boolean().default(true),
    product: sealedProductInputSchema.extend({
      quantity: z.number().int().positive().max(10_000),
      /** Whole-pence values, in the reviewed unit order shown by the form. */
      unitAllocations: z.array(z.number().int().nonnegative()).optional(),
      unitAllocationsReviewed: z.boolean().optional(),
    }),
  }),
  commonRecordSchema.extend({
    kind: z.literal("bulk"),
    listingUrl: z.string().trim().url().or(z.literal("")),
    totalPence: z.number().int().nonnegative(),
    amountKnown: z.boolean().default(true),
    cards: z.array(cardInputSchema).min(1),
    totalCardCount: z.number().int().positive().max(1_000_000),
  }),
  commonRecordSchema.extend({
    kind: z.literal("supply"),
    listingUrl: z.string().trim().url().or(z.literal("")),
    totalPence: z.number().int().nonnegative(),
    amountKnown: z.boolean().default(true),
    category: supplyCategorySchema,
    otherName: z.string().trim().max(160),
    quantity: z.number().int().positive().max(1_000_000),
  }),
]);
const openingSchema = commonRecordSchema.omit({ source: true }).extend({
  source: z.string().trim().min(1).max(120),
  totalPence: z.number().int().nonnegative(),
  amountKnown: z.boolean().default(true),
  useTrackedStock: z.boolean(),
  product: sealedProductInputSchema,
  sealedUnitId: z.string().nullable(),
  pulls: z.array(cardInputSchema).min(1),
});
const saleSchema = z.object({
  recordName: z.string().trim().max(80),
  date: dateSchema,
  source: z.string().trim().min(1).max(120),
  netProceedsPence: z.number().int().nonnegative(),
  notes: z.string().trim().max(4_000),
  copyIds: z.array(z.string().min(1)).min(1).max(100),
  paidEbayReview: z.object({
    copyId: z.string().min(1).max(160),
    listingId: z.string().min(1).max(160),
  }).optional(),
});
const recordMutationIdentitySchema = z.object({
  recordId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
});
const updateRecordDetailsSchema = recordMutationIdentitySchema.extend({
  update: z.object({
    title: z.string().trim().min(1).max(80),
    date: dateSchema,
    source: z.string().trim().min(1).max(120),
    listingUrl: z.string().trim().url().nullable().or(z.literal("")),
    amountPence: z.number().int().nonnegative(),
    amountKnown: z.boolean().optional(),
    /** Required before replacing reviewed unequal sealed-unit allocations. */
    sealedAllocationOverrideConfirmed: z.boolean().optional(),
    notes: z.string().trim().max(4_000),
  }),
});
const resolveCardAttentionSchema = z.object({
  targetId: z.string().min(1),
  printingId: z.string().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(160),
  rarity: z.string().trim().min(1).max(80),
  edition: productEditionSchema,
  tcgplayerUrl: z.string().url().regex(/tcgplayer\.com\/product\/\d+/i),
  setName: z.string().trim().min(1).max(160),
  setCode: z.string().trim().max(80),
  imageUrl: z.string().url().nullable(),
});
const updateCardSourceSchema = z.object({
  targetId: z.string().min(1),
  printingId: z.string().min(1),
  tcgplayerUrl: z.string().trim().url().regex(/tcgplayer\.com\/product\/\d+/i),
});
const resolveEbayCopyLinkAttentionSchema = z.object({
  listingId: z.string().min(1),
});
const ebayListingsWorkspaceSchema = z.object({
  composition: z.enum(["all", "individual", "quantity", "bundle"]),
  lifecycle: z.enum(["all", "live", "pending", "paid", "ended", "cancelled", "needs_attention"]),
  listingId: z.string().min(1).optional(),
  page: z.number().int().positive().max(1_000_000),
  query: z.string().trim().max(160),
});
const replaceRecordCardsSchema = recordMutationIdentitySchema.extend({
  cards: z.array(cardInputSchema),
});
const replaceSaleCopiesSchema = recordMutationIdentitySchema.extend({
  copyIds: z.array(z.string().min(1)).min(1),
});
const updateCardCopySchema = z.object({
  copyId: z.string().min(1),
  update: z.object({
    condition: z.enum(cardConditions),
    location: z.string().trim().max(160).transform((value) => value || null),
    stickerNumber: z.string().trim().max(20).regex(/^\d*$/, "Sticker number must contain digits only.").transform((value) => value || null),
    privateNote: z.string().trim().max(1_000),
  }),
});
const removeCardCopySchema = z.object({ copyId: z.string().min(1) });

function isStickerNumberUniqueViolation(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") return false;
    const databaseError = current as { cause?: unknown; code?: unknown; constraint?: unknown };
    if (
      databaseError.code === "23505"
      && (databaseError.constraint === undefined || databaseError.constraint === "card_copies_owner_sticker_number_unique")
    ) return true;
    current = databaseError.cause;
  }
  return false;
}

const updateRecordLineSchema = recordMutationIdentitySchema.extend({
  lineId: z.string().min(1),
  update: z.object({
    name: z.string().trim().min(1).max(160),
    quantity: z.number().int().positive().max(1_000_000),
    detail: z.string().trim().max(1_000),
    edition: productEditionSchema.optional(),
    category: supplyCategorySchema.optional(),
    totalQuantity: z.number().int().positive().max(1_000_000).optional(),
  }),
});

async function lockRecord(
  tx: Transaction,
  ownerId: string,
  recordId: string,
  expectedRevision: number,
) {
  const [record] = await tx.select().from(recordEntries).where(and(
    eq(recordEntries.id, recordId),
    eq(recordEntries.ownerId, ownerId),
  )).for("update").limit(1);
  if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found." });
  if (record.revision !== expectedRevision) {
    conflict("This Record changed elsewhere. Refresh it, review the latest values, and try again.");
  }
  return record;
}

async function bumpRecord(
  tx: Transaction,
  ownerId: string,
  recordId: string,
  revision: number,
  now: Date,
) {
  await tx.update(recordEntries).set({
    revision: revision + 1,
    updatedAt: now,
  }).where(and(
    eq(recordEntries.id, recordId),
    eq(recordEntries.ownerId, ownerId),
    eq(recordEntries.revision, revision),
  ));
}

/**
 * Reconcile the supported ordinary-card Purchase shape. This intentionally
 * rejects a hand-crafted multi-line Purchase edit rather than treating the
 * receipt total as the cost of every line.
 */
async function syncOrdinaryPurchaseAccounting(
  tx: Transaction,
  ownerId: string,
  recordId: string,
  amountKnown: boolean,
  amountPence: number,
  now: Date,
) {
  const lines = await tx.select().from(recordLines).where(and(
    eq(recordLines.ownerId, ownerId),
    eq(recordLines.recordId, recordId),
  )).orderBy(asc(recordLines.position)).for("update");
  const cardLines = lines.filter((line) => line.kind === "card");
  if (!cardLines.length) return false;
  if (lines.length !== 1 || cardLines.length !== 1) {
    conflict("Ordinary card Purchases support one card line only. Edit the original card item or use a Bulk Lot for multiple card types.");
  }

  const [line] = cardLines;
  const copies = await tx.select().from(cardCopies).where(and(
    eq(cardCopies.ownerId, ownerId),
    eq(cardCopies.acquiredRecordId, recordId),
  )).orderBy(asc(cardCopies.id)).for("update");
  if (copies.length !== line.quantity || copies.some((copy) => copy.acquiredLineId !== line.id)) {
    conflict("This Purchase's physical Copies no longer match its one card line. No changes were saved.");
  }

  const allocations = ordinaryPurchaseCopyAllocations({ amountKnown, amountPence, copyCount: copies.length });
  for (const [index, copy] of copies.entries()) {
    await tx.update(cardCopies).set({
      allocationPence: allocations[index]!,
      updatedAt: now,
    }).where(and(eq(cardCopies.id, copy.id), eq(cardCopies.ownerId, ownerId)));
  }
  await tx.update(recordLines).set({
    allocationPence: ordinaryPurchaseLineAllocation({ amountKnown, amountPence }),
    updatedAt: now,
  }).where(and(eq(recordLines.id, line.id), eq(recordLines.ownerId, ownerId)));
  return true;
}

/** Reconcile one sealed Purchase line without ever using its whole receipt as one unit's cost. */
async function syncSealedPurchaseAccounting(
  tx: Transaction,
  ownerId: string,
  recordId: string,
  amountKnown: boolean,
  amountPence: number,
  now: Date,
  overrideConfirmed = false,
) {
  const lines = await tx.select().from(recordLines).where(and(
    eq(recordLines.ownerId, ownerId), eq(recordLines.recordId, recordId),
  )).orderBy(asc(recordLines.position)).for("update");
  const sealedLines = lines.filter((line) => line.kind === "sealed");
  if (!sealedLines.length) return false;
  if (lines.length !== 1 || sealedLines.length !== 1) {
    conflict("Sealed Purchases support one sealed line only. No cost changes were saved.");
  }
  const [line] = sealedLines;
  const units = await tx.select().from(sealedUnits).where(and(
    eq(sealedUnits.ownerId, ownerId), eq(sealedUnits.acquiredRecordId, recordId),
  )).orderBy(asc(sealedUnits.allocationIndex), asc(sealedUnits.id)).for("update");
  if (
    units.length !== line.quantity
    || units.some((unit) => unit.acquiredLineId !== line.id || unit.allocationIndex === null)
  ) {
    conflict("This sealed Purchase has historical units without a reviewed allocation. Run the sealed-unit allocation dry-run before editing its cost.");
  }
  const currentKnown = units.every((unit) => unit.allocationPence !== null);
  const currentTotal = units.reduce((sum, unit) => sum + (unit.allocationPence ?? 0), 0);
  if (units.some((unit) => unit.openedRecordId) && (
    currentKnown !== amountKnown || (amountKnown && currentTotal !== amountPence)
  )) {
    conflict("This Purchase has an opened sealed unit, so its exact historical allocation cannot be changed.");
  }
  const hasOverrides = units.some((unit) => unit.allocationMode === "override");
  // The comparison above deliberately does not infer a receipt total from a
  // unit. We only need confirmation when the requested accounting state will
  // replace an override (including known -> unknown).
  if (hasOverrides && overrideConfirmed === false) {
    const unchanged = amountKnown && currentTotal === amountPence;
    if (!unchanged) {
      conflict("This Purchase has reviewed unequal unit costs. Confirm the new cost before any sealed unit opens.");
    }
  }
  if (hasOverrides && amountKnown && units.reduce((sum, unit) => sum + (unit.allocationPence ?? 0), 0) === amountPence && !overrideConfirmed) {
    return true;
  }
  const { allocations } = sealedPurchaseUnitAllocations({ amountKnown, amountPence, unitCount: units.length });
  for (const [index, unit] of units.entries()) {
    await tx.update(sealedUnits).set({
      allocationIndex: index,
      allocationPence: allocations[index]!,
      allocationMode: "equal",
      updatedAt: now,
    }).where(and(eq(sealedUnits.id, unit.id), eq(sealedUnits.ownerId, ownerId)));
  }
  await tx.update(recordLines).set({
    allocationPence: amountKnown ? amountPence : null,
    updatedAt: now,
  }).where(and(eq(recordLines.id, line.id), eq(recordLines.ownerId, ownerId)));
  return true;
}

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
}

function normalizeEdition(value: string) {
  const normalized = normalize(value);
  return normalized === "unlimited" ? "unlimited edition" : normalized;
}

function canonicalProductUrl(value: string | null | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return normalize(value);
  }
}

function conflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}

async function findOrCreatePrinting(
  tx: Transaction,
  ownerId: string,
  input: z.infer<typeof cardInputSchema>,
  now: Date,
) {
  const normalizedName = normalize(input.name);
  const normalizedRarity = normalize(input.rarity);
  const normalizedEditionValue = normalizeEdition(input.edition);
  let target = input.selectedTargetId
    ? (await tx.select().from(cardTargets).where(and(
        eq(cardTargets.id, input.selectedTargetId),
        eq(cardTargets.ownerId, ownerId),
      )).for("update").limit(1))[0]
    : undefined;

  if (!target) {
    [target] = await tx
      .select()
      .from(cardTargets)
      .where(and(
        eq(cardTargets.ownerId, ownerId),
        eq(cardTargets.normalizedName, normalizedName),
        eq(cardTargets.normalizedRarity, normalizedRarity),
        eq(cardTargets.normalizedEdition, normalizedEditionValue),
      ))
      .limit(1);
  }

  if (!target) {
    const targetId = id("target");
    [target] = await tx.insert(cardTargets).values({
      id: targetId,
      ownerId,
      name: input.name,
      normalizedName,
      rarity: input.rarity,
      normalizedRarity,
      edition: input.edition,
      normalizedEdition: normalizedEditionValue,
      // A target created while recording a physical Copy belongs in the
      // collection, not the Wishlist. Explicitly created Wishlist targets
      // keep their normal default of one wanted Copy.
      desiredQuantity: 0,
      imageUrl: input.imageUrl,
      tcgplayerUrl: input.tcgplayerUrl,
      createdAt: now,
      updatedAt: now,
    }).returning();
  } else if (input.selectedTargetId) {
    const identityChanged = target.normalizedName !== normalizedName
      || target.normalizedRarity !== normalizedRarity
      || target.normalizedEdition !== normalizedEditionValue;
    if (identityChanged) {
      const [duplicate] = await tx.select({ id: cardTargets.id }).from(cardTargets).where(and(
        eq(cardTargets.ownerId, ownerId),
        eq(cardTargets.normalizedName, normalizedName),
        eq(cardTargets.normalizedRarity, normalizedRarity),
        eq(cardTargets.normalizedEdition, normalizedEditionValue),
      )).limit(1);
      if (duplicate && duplicate.id !== target.id) {
        conflict("This corrected card already exists in your Library. Select that existing card instead so the two Targets are not merged unexpectedly.");
      }
    }
    [target] = await tx.update(cardTargets).set({
      name: input.name,
      normalizedName,
      rarity: input.rarity,
      normalizedRarity,
      edition: input.edition,
      normalizedEdition: normalizedEditionValue,
      imageUrl: input.imageUrl || target.imageUrl,
      tcgplayerUrl: input.tcgplayerUrl || target.tcgplayerUrl,
      updatedAt: now,
    }).where(and(
      eq(cardTargets.id, target.id),
      eq(cardTargets.ownerId, ownerId),
    )).returning();
  } else {
    const updates = {
      imageUrl: target.imageUrl || input.imageUrl,
      tcgplayerUrl: target.tcgplayerUrl || input.tcgplayerUrl,
      updatedAt: now,
    };
    [target] = await tx.update(cardTargets).set(updates).where(and(
      eq(cardTargets.id, target.id),
      eq(cardTargets.ownerId, ownerId),
    )).returning();
  }

  const canonicalUrl = canonicalProductUrl(input.tcgplayerUrl);
  const normalizedSetName = normalizePrintingValue(input.setName || "Unknown set");
  const normalizedSetCode = normalizePrintingValue(input.setCode || "Unknown code");
  const requestedIdentity = { canonicalTcgplayerUrl: canonicalUrl || null, normalizedSetName, normalizedSetCode };
  const candidates = await tx.select().from(cardPrintings).where(and(
    eq(cardPrintings.ownerId, ownerId), eq(cardPrintings.targetId, target.id),
  ));
  const compatible = candidates.filter((candidate) => compatiblePrintingIdentity(candidate, requestedIdentity));
  if (compatible.length > 1) {
    conflict("This exact Printing has duplicate rows. Run the Printing reconciliation preflight before recording another Copy.");
  }
  let [printing] = compatible;
  const hasConflict = candidates.some((candidate) => conflictsWithPrintingIdentity(candidate, requestedIdentity));
  if (hasConflict) {
    conflict("Existing Printing metadata conflicts with this TCGplayer link or set/code. Review it before recording a Copy.");
  }

  if (!printing) {
    const values = {
      id: id("printing"), ownerId, targetId: target.id,
      setName: input.setName || "Unknown set", normalizedSetName,
      setCode: input.setCode || "Unknown code", normalizedSetCode,
      tcgplayerUrl: input.tcgplayerUrl, canonicalTcgplayerUrl: requestedIdentity.canonicalTcgplayerUrl,
      imageUrl: input.imageUrl, metadataNeedsAttention: input.metadataNeedsAttention,
      createdAt: now, updatedAt: now,
    };
    // The database indexes are the concurrency authority; a losing request
    // reads the survivor instead of creating a second Printing.
    [printing] = await tx.insert(cardPrintings).values(values).onConflictDoNothing().returning();
    if (!printing) {
      const afterConflict = await tx.select().from(cardPrintings).where(and(
        eq(cardPrintings.ownerId, ownerId), eq(cardPrintings.targetId, target.id),
      ));
      const survivors = afterConflict.filter((candidate) => compatiblePrintingIdentity(candidate, requestedIdentity));
      if (survivors.length !== 1) {
        conflict("A conflicting Printing already exists. Review its metadata before recording a Copy.");
      }
      [printing] = survivors;
    }
  }

  return { printing, target };
}

async function insertRecord(
  tx: Transaction,
  values: typeof recordEntries.$inferInsert,
) {
  await tx.insert(recordEntries).values(values);
  return values.id;
}

async function insertLine(
  tx: Transaction,
  values: typeof recordLines.$inferInsert,
) {
  await tx.insert(recordLines).values(values);
  return values.id;
}

export async function loadRecordsSnapshot(ownerId: string): Promise<RecordsSnapshot> {
  const [records, lines, targets, printings, copies, lineCopyLinks, sealed, lots, supplies] = await Promise.all([
    db.select().from(recordEntries).where(eq(recordEntries.ownerId, ownerId)).orderBy(desc(recordEntries.occurredOn), desc(recordEntries.createdAt)),
    db.select().from(recordLines).where(eq(recordLines.ownerId, ownerId)).orderBy(asc(recordLines.position)),
    db.select().from(cardTargets).where(eq(cardTargets.ownerId, ownerId)).orderBy(asc(cardTargets.name)),
    db.select().from(cardPrintings).where(eq(cardPrintings.ownerId, ownerId)),
    db.select().from(cardCopies).where(eq(cardCopies.ownerId, ownerId)),
    db.select().from(recordLineCopies).where(eq(recordLineCopies.ownerId, ownerId)),
    db.select().from(sealedUnits).where(eq(sealedUnits.ownerId, ownerId)),
    db.select().from(bulkLots).where(eq(bulkLots.ownerId, ownerId)),
    db.select().from(supplyItems).where(eq(supplyItems.ownerId, ownerId)),
  ]);

  const entityIdsByLine = new Map<string, string[]>();
  const addEntity = (lineId: string | null, entityId: string) => {
    if (!lineId) return;
    const entities = entityIdsByLine.get(lineId);
    if (entities) {
      entities.push(entityId);
    } else {
      entityIdsByLine.set(lineId, [entityId]);
    }
  };
  for (const copy of copies) {
    addEntity(copy.acquiredLineId, copy.id);
  }
  for (const link of lineCopyLinks) addEntity(link.lineId, link.copyId);
  for (const unit of sealed) addEntity(unit.acquiredLineId, unit.id);
  for (const lot of lots) addEntity(lot.acquiredLineId, lot.id);
  for (const supply of supplies) addEntity(supply.acquiredLineId, supply.id);

  const linesByRecord = new Map<string, RecordLine[]>();
  for (const line of lines) {
    const serialized: RecordLine = {
      id: line.id,
      kind: line.kind,
      name: line.name,
      quantity: line.quantity,
      allocationPence: line.allocationPence,
      entityIds: entityIdsByLine.get(line.id) ?? [],
      detail: line.detail,
    };
    const recordLines = linesByRecord.get(line.recordId);
    if (recordLines) {
      recordLines.push(serialized);
    } else {
      linesByRecord.set(line.recordId, [serialized]);
    }
  }

  const attention: PreviewAttentionItem[] = [];
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const printingById = new Map(printings.map((printing) => [printing.id, printing]));
  const copyById = new Map(copies.map((copy) => [copy.id, copy]));
  if (await hasEbayCompositionSchema()) {
    const protectedListings = await db.select().from(ebayListings).where(
      eq(ebayListings.ownerId, ownerId),
    );
    const listingIds = protectedListings.map((listing) => listing.id);
    const members = listingIds.length
      ? await db.select({ listingId: ebayListingMembers.listingId })
        .from(ebayListingMembers)
        .where(and(
          eq(ebayListingMembers.ownerId, ownerId),
          inArray(ebayListingMembers.listingId, listingIds),
        ))
      : [];
    const memberListingIds = new Set(members.map((member) => member.listingId));
    for (const listing of protectedListings) {
      const copy = copyById.get(listing.copyId);
      const printing = copy ? printingById.get(copy.printingId) : null;
      const target = printing ? targetById.get(printing.targetId) : null;
      const hasExactMember = memberListingIds.has(listing.id);
      const copyLinkDecision = ebayCopyLinkAttentionDecision({
        hasExactMember,
        kind: listing.kind,
        legacyCopyExists: Boolean(copy),
      });
      if (copyLinkDecision) {
        attention.push({
          copyId: listing.copyId,
          detail: copyLinkDecision.detail,
          ebayAttentionAction: copyLinkDecision.action,
          field: "ebay_copy_link",
          id: `attention-ebay-copy-link-${listing.id}`,
          label: target?.name ?? listing.title,
          listingId: listing.id,
          targetId: target?.id ?? null,
        });
        continue;
      }
      const statusDecision = ebayListingStatusAttentionDecision({
        hasExactMember,
        lastError: listing.lastError,
        saleState: listing.saleState,
      });
      if (statusDecision) {
        attention.push({
          copyId: listing.copyId,
          detail: statusDecision.detail,
          ebayAttentionAction: statusDecision.action,
          field: "ebay_status",
          id: `attention-ebay-status-${listing.id}`,
          label: target?.name ?? listing.title,
          listingId: listing.id,
          targetId: target?.id ?? null,
        });
      }
    }
  }
  for (const target of targets) {
    if (normalizeEdition(target.edition) === "unknown edition") {
      attention.push({
        id: `attention-edition-${target.id}`,
        targetId: target.id,
        label: target.name,
        detail: "Edition was not available in the legacy data and needs confirmation.",
        field: "edition",
      });
    }
    if (!target.tcgplayerUrl) {
      attention.push({
        id: `attention-tcgplayer-${target.id}`,
        targetId: target.id,
        label: target.name,
        detail: "Add the exact TCGplayer product link for this Target.",
        field: "tcgplayer",
      });
    }
  }
  for (const printing of printings) {
    if (!printing.metadataNeedsAttention) continue;
    const target = targetById.get(printing.targetId);
    attention.push({
      id: `attention-printing-${printing.id}`,
      targetId: printing.targetId,
      printingId: printing.id,
      label: target?.name ?? "Card metadata",
      detail: "Printing metadata needs confirmation.",
      field: "tcgplayer",
    });
  }
  for (const record of records) {
    if (record.type !== "imported-acquisition" || record.amountKnown) continue;
    const sealedOrCard = linesByRecord.get(record.id)?.[0];
    attention.push({
      id: `attention-cost-${record.id}`,
      targetId: null,
      label: sealedOrCard?.name ?? record.title,
      detail: "Acquisition cost is unknown and can be updated from History.",
      field: "cost",
    });
  }

  const relatedListings = await getEbayListingsForCopiesMembershipFirst(
    ownerId,
    copies.map((copy) => copy.id),
  );
  const ebayOffers: EbayOfferExposure[] = relatedListings.map((related) => ({
    cancelledAt: related.listing.cancelledAt?.toISOString() ?? null,
    copyId: related.copyId,
    fulfilmentPosition: related.fulfilmentPosition,
    itemId: related.listing.itemId,
    kind: related.listing.kind,
    lastError: related.listing.lastError,
    lastErrorAt: related.listing.lastErrorAt?.toISOString() ?? null,
    lastSyncedAt: related.listing.lastSyncedAt?.toISOString() ?? null,
    listingEndedAt: related.listing.listingEndedAt?.toISOString() ?? null,
    listingId: related.listing.id,
    listingStartedAt: related.listing.listingStartedAt?.toISOString() ?? null,
    listingState: related.listing.listingState,
    listingUrl: related.listing.listingUrl,
    memberId: related.memberId,
    paidAt: related.listing.paidAt?.toISOString() ?? null,
    paymentPendingAt: related.listing.paymentPendingAt?.toISOString() ?? null,
    quantitySold: related.listing.quantitySold,
    relationSource: related.relationSource,
    saleRecordId: related.listing.saleRecordId,
    saleState: related.listing.saleState,
    title: related.listing.title,
    updatedAt: related.listing.updatedAt.toISOString(),
  }));
  const copyEbayExposures = buildCopyEbayExposureStates(
    copies.map((copy) => ({
      id: copy.id,
      printingId: copy.printingId,
      acquiredRecordId: copy.acquiredRecordId,
      soldRecordId: copy.soldRecordId,
      bulkLotId: copy.bulkLotId,
      allocationIndex: copy.allocationIndex,
      allocationPence: copy.allocationPence,
      status: copy.status,
      condition: copy.condition,
      location: copy.location,
      stickerNumber: copy.stickerNumber,
      privateNote: copy.privateNote,
      createdAt: copy.createdAt.toISOString(),
    })),
    records.map((record) => ({ id: record.id, status: record.status })),
    ebayOffers,
  );

  return {
    version: 1,
    records: records.map((record) => ({
      id: record.id,
      type: record.type,
      status: record.status,
      date: record.occurredOn,
      title: record.title,
      titleGenerated: record.titleGenerated,
      source: record.source,
      listingUrl: record.listingUrl,
      amountPence: record.amountPence,
      amountKnown: record.amountKnown,
      notes: record.notes,
      lines: linesByRecord.get(record.id) ?? [],
      revision: record.revision,
      createdAt: record.createdAt.toISOString(),
    })),
    targets: targets.map((target) => ({
      id: target.id,
      name: target.name,
      rarity: target.rarity,
      edition: target.edition,
      desiredQuantity: target.desiredQuantity,
      imageUrl: target.imageUrl,
      tcgplayerUrl: target.tcgplayerUrl,
      estimatedPricePence: target.estimatedPricePence,
      marketPricePence: target.marketPricePence,
    })),
    printings: printings.map((printing) => ({
      id: printing.id,
      targetId: printing.targetId,
      setName: printing.setName,
      setCode: printing.setCode,
      tcgplayerUrl: printing.tcgplayerUrl,
      imageUrl: printing.imageUrl,
    })),
    copies: copies.map((copy) => ({
      id: copy.id,
      printingId: copy.printingId,
      acquiredRecordId: copy.acquiredRecordId,
      soldRecordId: copy.soldRecordId,
      bulkLotId: copy.bulkLotId,
      allocationIndex: copy.allocationIndex,
      allocationPence: copy.allocationPence,
      status: copy.status,
      condition: copy.condition,
      location: copy.location,
      stickerNumber: copy.stickerNumber,
      privateNote: copy.privateNote,
      createdAt: copy.createdAt.toISOString(),
    })),
    copyEbayExposures,
    sealedUnits: sealed.map((unit) => ({
      id: unit.id,
      name: unit.name,
      edition: unit.edition as "1st Edition" | "Unlimited Edition" | "Limited Edition" | null,
      quantity: 1,
      tcgplayerUrl: unit.tcgplayerUrl,
      imageUrl: unit.imageUrl,
      status: unit.status,
      acquiredRecordId: unit.acquiredRecordId,
      openedRecordId: unit.openedRecordId,
      allocationPence: unit.allocationPence,
      allocationMode: unit.allocationMode,
    })),
    bulkLots: lots.map((lot) => ({
      id: lot.id,
      name: lot.name,
      totalQuantity: lot.totalQuantity,
      itemizedQuantity: lot.itemizedQuantity,
      acquiredRecordId: lot.acquiredRecordId,
      status: lot.status,
    })),
    supplies: supplies.map((supply) => ({
      id: supply.id,
      name: supply.name,
      category: supply.category,
      quantity: supply.quantity,
      acquiredRecordId: supply.acquiredRecordId,
      status: supply.status,
    })),
    attention,
  };
}

export const recordsRouter = router({
  snapshot: authenticatedProcedure.query(({ ctx }) => loadRecordsSnapshot(ctx.collectionOwnerId)),

  actions: authenticatedProcedure.query(async ({ ctx }) => (
    listRecordsActions(ctx.collectionOwnerId, await loadRecordsSnapshot(ctx.collectionOwnerId))
  )),

  urgentActionCount: authenticatedProcedure.query(async ({ ctx }) => ({
    count: await urgentRecordsActionCount(ctx.collectionOwnerId, await loadRecordsSnapshot(ctx.collectionOwnerId)),
  })),

  dismissSuggestion: authenticatedProcedure.input(z.object({ dedupeKey: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const snapshot = await loadRecordsSnapshot(ctx.collectionOwnerId);
    const action = (await listRecordsActions(ctx.collectionOwnerId, snapshot)).find((candidate) => candidate.dedupeKey === input.dedupeKey && candidate.status === "open");
    if (!action || action.category !== "suggestion") throw new TRPCError({ code: "NOT_FOUND", message: "That suggestion is no longer available." });
    await dismissRecordsSuggestion(ctx.collectionOwnerId, action);
    return { ok: true };
  }),

  ebayLifecycleChangeMarker: adminProcedure.query(async ({ ctx }) => {
    const [row] = await db.select({
      marker: sql<string | null>`max(${ebayListings.updatedAt})::text`,
    }).from(ebayListings).where(eq(
      ebayListings.ownerId,
      ctx.collectionOwnerId,
    ));
    return { marker: row?.marker ?? null };
  }),

  listEbayListings: adminProcedure.input(ebayListingsWorkspaceSchema).query(({ ctx, input }) =>
    listEbayListingsWorkspace(ctx.collectionOwnerId, input)),

  inspectPaidEbaySaleReview: authenticatedProcedure.input(z.object({
    copyId: z.string().min(1).max(160),
    listingId: z.string().min(1).max(160),
    responseVersion: z.literal(2).optional(),
  })).query(async ({ ctx, input }) => {
    if (!await hasEbayCompositionSchema()) {
      return {
        ok: false as const,
        code: "composition_unavailable" as const,
        message: "Paid eBay Sale review is not ready yet. Refresh after the approved Records migration has completed.",
      };
    }
    return inspectPaidEbaySaleReviewIntent(ctx.collectionOwnerId, input);
  }),

  resolveEbayCopyLinkAttention: authenticatedProcedure.input(resolveEbayCopyLinkAttentionSchema).mutation(async ({ ctx, input }) => {
    await requireEbayExternalCapability(ctx.session);
    if (!await hasEbayCompositionSchema()) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "eBay Copy links are not ready yet. Refresh and try again." });
    }
    const [knownListing] = await db.select({
      copyId: ebayListings.copyId,
    }).from(ebayListings).where(and(
      eq(ebayListings.id, input.listingId),
      eq(ebayListings.ownerId, ctx.collectionOwnerId),
    )).limit(1);
    if (!knownListing) {
      throw new TRPCError({ code: "NOT_FOUND", message: "That eBay listing was not found." });
    }
    const now = new Date();
    return db.transaction(async (tx) => {
      const [copy] = await tx.select().from(cardCopies).where(and(
        eq(cardCopies.id, knownListing.copyId),
        eq(cardCopies.ownerId, ctx.collectionOwnerId),
      )).orderBy(asc(cardCopies.id)).for("update").limit(1);
      if (!copy) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The saved physical Copy no longer exists, so this link needs investigation." });
      const members = await tx.select().from(ebayListingMembers).where(and(
        eq(ebayListingMembers.ownerId, ctx.collectionOwnerId),
        eq(ebayListingMembers.listingId, input.listingId),
      )).orderBy(
        asc(ebayListingMembers.copyId),
        asc(ebayListingMembers.id),
      ).for("update");
      const [listing] = await tx.select().from(ebayListings).where(and(
        eq(ebayListings.id, input.listingId),
        eq(ebayListings.ownerId, ctx.collectionOwnerId),
      )).orderBy(asc(ebayListings.id)).for("update").limit(1);
      if (!listing) throw new TRPCError({ code: "NOT_FOUND", message: "That eBay listing was not found." });
      if (listing.copyId !== copy.id) {
        throw new TRPCError({ code: "CONFLICT", message: "This listing's saved physical Copy changed. Refresh and review it again." });
      }
      if (
        listing.kind !== "individual"
      ) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This listing needs investigation and cannot be repaired automatically." });
      }
      if (members.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "This listing already has a physical Copy link. Refresh and review its latest status." });
      }
      const memberId = `ebay-member-${randomUUID()}`;
      await tx.insert(ebayListingMembers).values({
        copyId: copy.id,
        createdAt: now,
        fulfilmentPosition: 0,
        id: memberId,
        listingId: listing.id,
        ownerId: ctx.collectionOwnerId,
        updatedAt: now,
      });
      return { id: listing.id };
    });
  }),

  updateCardCopy: authenticatedProcedure.input(updateCardCopySchema).mutation(async ({ ctx, input }) => {
    const now = new Date();
    if (input.update.stickerNumber) {
      const [duplicate] = await db.select({ id: cardCopies.id }).from(cardCopies).where(and(
        eq(cardCopies.ownerId, ctx.collectionOwnerId),
        eq(cardCopies.stickerNumber, input.update.stickerNumber),
      ));
      if (duplicate && duplicate.id !== input.copyId) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Sticker number ${input.update.stickerNumber} is already assigned to another physical Copy.`,
        });
      }
    }
    let updated: { id: string } | undefined;
    try {
      [updated] = await db.update(cardCopies).set({
        condition: input.update.condition,
        location: input.update.location,
        stickerNumber: input.update.stickerNumber,
        privateNote: input.update.privateNote,
        updatedAt: now,
      }).where(and(eq(cardCopies.id, input.copyId), eq(cardCopies.ownerId, ctx.collectionOwnerId))).returning({ id: cardCopies.id });
    } catch (error) {
      if (isStickerNumberUniqueViolation(error)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Sticker number ${input.update.stickerNumber} is already assigned to another physical Copy.`,
        });
      }
      throw error;
    }
    if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Physical Copy not found." });
    return { id: updated.id };
  }),

  removeCardCopy: authenticatedProcedure.input(removeCardCopySchema).mutation(async ({ ctx, input }) => {
    const ownerId = ctx.collectionOwnerId;
    const compositionSchemaReady = await hasEbayCompositionSchema();
    const keys: string[] = [];
    let removedCopy: { id: string; acquiredRecordId: string } | undefined;
    await db.transaction(async (tx) => {
      const now = new Date();
      const [copy] = await tx.select().from(cardCopies).where(and(
        eq(cardCopies.id, input.copyId), eq(cardCopies.ownerId, ownerId),
      )).for("update");
      if (!copy) conflict("That physical Copy was not found.");
      if (copy.status !== "available") conflict(copy.status === "sold" ? "Edit the Sale before removing this Copy." : "Restore the source Record before removing this Copy.");
      const [record] = await tx.select().from(recordEntries).where(and(eq(recordEntries.id, copy.acquiredRecordId), eq(recordEntries.ownerId, ownerId))).for("update");
      if (!record || record.status !== "active") conflict("Restore the source Record before removing this Copy.");
      if (record.type === "purchase" && !copy.bulkLotId) {
        await syncOrdinaryPurchaseAccounting(
          tx,
          ownerId,
          record.id,
          record.amountKnown,
          record.amountPence,
          now,
        );
      }
      const saleLinks = await tx.select({ id: recordLineCopies.id }).from(recordLineCopies).where(and(eq(recordLineCopies.ownerId, ownerId), eq(recordLineCopies.copyId, copy.id), eq(recordLineCopies.role, "sale"))).limit(1);
      if (saleLinks.length) conflict("This Copy has Sale history and cannot be removed.");
      const listingHistoryIds = new Set<string>();
      if (compositionSchemaReady) {
        const memberships = await tx.select({ listingId: ebayListingMembers.listingId })
          .from(ebayListingMembers)
          .where(and(
            eq(ebayListingMembers.ownerId, ownerId),
            eq(ebayListingMembers.copyId, copy.id),
          ))
          .limit(1);
        for (const membership of memberships) {
          listingHistoryIds.add(membership.listingId);
        }
      }
      const legacyListings = await tx.select({ id: ebayListings.id })
        .from(ebayListings)
        .where(and(
          eq(ebayListings.ownerId, ownerId),
          eq(ebayListings.copyId, copy.id),
        ))
        .limit(1);
      for (const listing of legacyListings) listingHistoryIds.add(listing.id);
      if (listingHistoryIds.size) conflict("This Copy has an eBay listing history and cannot be removed.");
      const images = await tx.select({ objectKey: cardCopyImages.objectKey }).from(cardCopyImages).where(and(eq(cardCopyImages.ownerId, ownerId), eq(cardCopyImages.copyId, copy.id)));
      keys.push(...images.map((image) => image.objectKey));
      const [line] = await tx.select().from(recordLines).where(and(eq(recordLines.id, copy.acquiredLineId), eq(recordLines.ownerId, ownerId))).for("update");
      if (!line) conflict("The source Record line is unavailable.");
      await tx.delete(recordLineCopies).where(and(eq(recordLineCopies.ownerId, ownerId), eq(recordLineCopies.copyId, copy.id)));
      await tx.delete(cardCopies).where(and(eq(cardCopies.id, copy.id), eq(cardCopies.ownerId, ownerId)));
      if (copy.bulkLotId) {
        const [lot] = await tx.select().from(bulkLots).where(and(
          eq(bulkLots.id, copy.bulkLotId), eq(bulkLots.ownerId, ownerId),
        )).for("update").limit(1);
        if (!lot) conflict("The source Bulk Lot is unavailable.");
        const remainingLotCopies = await tx.select({ id: cardCopies.id }).from(cardCopies).where(and(
          eq(cardCopies.ownerId, ownerId), eq(cardCopies.bulkLotId, lot.id),
        ));
        const itemizedQuantity = remainingLotCopies.length;
        await tx.update(bulkLots).set({
          itemizedQuantity,
          status: itemizedQuantity >= lot.totalQuantity ? "itemized" : "open",
          updatedAt: now,
        }).where(and(eq(bulkLots.id, lot.id), eq(bulkLots.ownerId, ownerId)));
        await tx.update(recordLines).set({
          detail: `${itemizedQuantity} identified of ${lot.totalQuantity} total cards`,
          updatedAt: now,
        }).where(and(eq(recordLines.id, lot.acquiredLineId), eq(recordLines.ownerId, ownerId)));
      }
      if (line.quantity <= 1) {
        await tx.delete(recordLines).where(and(eq(recordLines.id, line.id), eq(recordLines.ownerId, ownerId)));
        const remaining = await tx.select({ id: recordLines.id }).from(recordLines).where(and(eq(recordLines.ownerId, ownerId), eq(recordLines.recordId, record.id))).limit(1);
        if (!remaining.length) await tx.update(recordEntries).set({ status: "void", revision: record.revision + 1, updatedAt: now }).where(eq(recordEntries.id, record.id));
        else await bumpRecord(tx, ownerId, record.id, record.revision, now);
      } else {
        const remainingCopies = await tx.select().from(cardCopies).where(and(
          eq(cardCopies.ownerId, ownerId), eq(cardCopies.acquiredLineId, line.id),
        )).orderBy(asc(cardCopies.id));
        let allocationPence = line.allocationPence;
        if (copy.bulkLotId) {
          allocationPence = record.amountKnown
            ? remainingCopies.reduce((sum, item) => sum + (item.allocationPence ?? 0), 0)
            : null;
        } else if (record.type === "purchase") {
          allocationPence = ordinaryPurchaseLineAllocation({
            amountKnown: record.amountKnown,
            amountPence: record.amountPence,
          });
          const allocations = ordinaryPurchaseCopyAllocations({
            amountKnown: record.amountKnown,
            amountPence: record.amountPence,
            copyCount: remainingCopies.length,
          });
          for (const [index, item] of remainingCopies.entries()) {
            await tx.update(cardCopies).set({
              allocationPence: allocations[index]!,
              updatedAt: now,
            }).where(and(eq(cardCopies.id, item.id), eq(cardCopies.ownerId, ownerId)));
          }
        }
        await tx.update(recordLines).set({
          allocationPence,
          quantity: line.quantity - 1,
          updatedAt: now,
        }).where(and(eq(recordLines.id, line.id), eq(recordLines.ownerId, ownerId)));
        await bumpRecord(tx, ownerId, record.id, record.revision, now);
      }
      removedCopy = { id: copy.id, acquiredRecordId: copy.acquiredRecordId };
    });
    if (removedCopy) await Promise.all(keys.map((key) => deleteCardInventoryImage(ownerId, removedCopy!.id, key).catch(() => undefined)));
    return { id: input.copyId };
  }),

  resolveCardAttention: authenticatedProcedure.input(resolveCardAttentionSchema).mutation(async ({ ctx, input }) => {
    const now = new Date();
    const [target] = await db.select().from(cardTargets).where(and(
      eq(cardTargets.id, input.targetId),
      eq(cardTargets.ownerId, ctx.collectionOwnerId),
    )).limit(1);
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Card Target not found." });

    const printing = input.printingId
      ? (await db.select().from(cardPrintings).where(and(
          eq(cardPrintings.id, input.printingId),
          eq(cardPrintings.targetId, target.id),
          eq(cardPrintings.ownerId, ctx.collectionOwnerId),
        )).limit(1))[0]
      : (await db.select().from(cardPrintings).where(and(
          eq(cardPrintings.targetId, target.id),
          eq(cardPrintings.ownerId, ctx.collectionOwnerId),
        )).limit(1))[0];
    if (!printing) throw new TRPCError({ code: "NOT_FOUND", message: "Card printing not found." });
    const relatedCopies = await db.select({ acquiredLineId: cardCopies.acquiredLineId }).from(cardCopies).where(and(
      eq(cardCopies.ownerId, ctx.collectionOwnerId),
      eq(cardCopies.printingId, printing.id),
    ));
    const relatedLineIds = Array.from(new Set(relatedCopies.map((copy) => copy.acquiredLineId).filter((id): id is string => Boolean(id))));

    await db.transaction(async (tx) => {
      await tx.update(cardTargets).set({
        name: input.name,
        normalizedName: normalize(input.name),
        rarity: input.rarity,
        normalizedRarity: normalize(input.rarity),
        edition: input.edition,
        normalizedEdition: normalizeEdition(input.edition),
        tcgplayerUrl: input.tcgplayerUrl,
        imageUrl: input.imageUrl,
        updatedAt: now,
      }).where(and(eq(cardTargets.id, target.id), eq(cardTargets.ownerId, ctx.collectionOwnerId)));
      await tx.update(cardPrintings).set({
        setName: input.setName,
        normalizedSetName: normalize(input.setName),
        setCode: input.setCode || "Unknown code",
        normalizedSetCode: normalize(input.setCode || "Unknown code"),
        tcgplayerUrl: input.tcgplayerUrl,
        canonicalTcgplayerUrl: canonicalProductUrl(input.tcgplayerUrl),
        imageUrl: input.imageUrl,
        metadataNeedsAttention: false,
        updatedAt: now,
      }).where(and(eq(cardPrintings.id, printing.id), eq(cardPrintings.ownerId, ctx.collectionOwnerId)));
      if (relatedLineIds.length) {
        await tx.update(recordLines).set({
          name: input.name,
          detail: `${input.setCode || "Unknown code"} · ${input.edition} · ${input.rarity}`,
          updatedAt: now,
        }).where(and(
          eq(recordLines.ownerId, ctx.collectionOwnerId),
          inArray(recordLines.id, relatedLineIds),
        ));
      }
    });
    return { id: target.id };
  }),

  updateCardSource: authenticatedProcedure.input(updateCardSourceSchema).mutation(async ({ ctx, input }) => {
    let metadata;
    try {
      metadata = await fetchLinkMetadata(input.tcgplayerUrl);
    } catch {
      throw new TRPCError({
        code: "BAD_GATEWAY",
        message: "TCGplayer details could not be fetched. Nothing was changed; check the link and retry.",
      });
    }
    const fetchedRarity = metadata.rarity?.trim();
    if (!fetchedRarity) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "The TCGplayer link did not return a rarity, so nothing was changed.",
      });
    }

    const ownerId = ctx.collectionOwnerId;
    const now = new Date();
    await db.transaction(async (tx) => {
      const [target] = await tx.select().from(cardTargets).where(and(
        eq(cardTargets.id, input.targetId),
        eq(cardTargets.ownerId, ownerId),
      )).for("update").limit(1);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Card Target not found." });

      const [printing] = await tx.select().from(cardPrintings).where(and(
        eq(cardPrintings.id, input.printingId),
        eq(cardPrintings.targetId, target.id),
        eq(cardPrintings.ownerId, ownerId),
      )).for("update").limit(1);
      if (!printing) throw new TRPCError({ code: "NOT_FOUND", message: "Card Printing not found." });

      const name = metadata.title?.trim() || target.name;
      const edition = metadata.edition || target.edition;
      const setName = metadata.setName?.trim() || printing.setName;
      const setCode = metadata.setCode?.trim() || printing.setCode;
      const imageUrl = metadata.imageUrl || printing.imageUrl || target.imageUrl;
      const normalizedName = normalize(name);
      const normalizedRarity = normalize(fetchedRarity);
      const normalizedEditionValue = normalizeEdition(edition);
      const normalizedSetName = normalizePrintingValue(setName);
      const normalizedSetCode = normalizePrintingValue(setCode);
      const requestedIdentity = {
        canonicalTcgplayerUrl: canonicalProductUrl(input.tcgplayerUrl),
        normalizedSetName,
        normalizedSetCode,
      };

      const [duplicateTarget] = await tx.select({ id: cardTargets.id }).from(cardTargets).where(and(
        eq(cardTargets.ownerId, ownerId),
        eq(cardTargets.normalizedName, normalizedName),
        eq(cardTargets.normalizedRarity, normalizedRarity),
        eq(cardTargets.normalizedEdition, normalizedEditionValue),
      )).limit(1);
      if (duplicateTarget && duplicateTarget.id !== target.id) {
        conflict("The fetched card already exists as another Target. Nothing was merged or changed.");
      }

      const siblingPrintings = await tx.select().from(cardPrintings).where(and(
        eq(cardPrintings.ownerId, ownerId),
        eq(cardPrintings.targetId, target.id),
      ));
      const printingCollision = siblingPrintings.some((candidate) => {
        if (candidate.id === printing.id) return false;
        const candidateIdentity = {
          canonicalTcgplayerUrl: candidate.canonicalTcgplayerUrl,
          normalizedSetName: candidate.normalizedSetName,
          normalizedSetCode: candidate.normalizedSetCode,
        };
        return compatiblePrintingIdentity(candidateIdentity, requestedIdentity)
          || conflictsWithPrintingIdentity(candidateIdentity, requestedIdentity);
      });
      if (printingCollision) {
        conflict("That link identifies another Printing already attached to this card. Nothing was merged or changed.");
      }

      const relatedCopies = await tx.select({ acquiredLineId: cardCopies.acquiredLineId })
        .from(cardCopies)
        .where(and(eq(cardCopies.ownerId, ownerId), eq(cardCopies.printingId, printing.id)));
      const relatedLineIds = Array.from(new Set(
        relatedCopies.map((copy) => copy.acquiredLineId).filter((id): id is string => Boolean(id)),
      ));

      await tx.update(cardTargets).set({
        name,
        normalizedName,
        rarity: fetchedRarity,
        normalizedRarity,
        edition,
        normalizedEdition: normalizedEditionValue,
        tcgplayerUrl: input.tcgplayerUrl,
        imageUrl,
        cardType: metadata.cardType || target.cardType,
        updatedAt: now,
      }).where(and(eq(cardTargets.id, target.id), eq(cardTargets.ownerId, ownerId)));
      await tx.update(cardPrintings).set({
        setName,
        normalizedSetName,
        setCode,
        normalizedSetCode,
        tcgplayerUrl: input.tcgplayerUrl,
        canonicalTcgplayerUrl: requestedIdentity.canonicalTcgplayerUrl,
        imageUrl,
        metadataNeedsAttention: metadata.setCode ? false : printing.metadataNeedsAttention,
        updatedAt: now,
      }).where(and(eq(cardPrintings.id, printing.id), eq(cardPrintings.ownerId, ownerId)));
      if (relatedLineIds.length) {
        await tx.update(recordLines).set({
          name,
          detail: `${setCode || "Unknown code"} · ${edition} · ${fetchedRarity}`,
          updatedAt: now,
        }).where(and(eq(recordLines.ownerId, ownerId), inArray(recordLines.id, relatedLineIds)));
      }
    });
    return { id: input.targetId };
  }),

  createPurchase: authenticatedProcedure.input(purchaseSchema).mutation(async ({ ctx, input }) => {
    const ownerId = ctx.collectionOwnerId;
    const recordId = id("record");
    const now = new Date();
    const identifiedCount = input.kind === "bulk"
      ? input.cards.reduce((sum, card) => sum + card.quantity, 0)
      : 0;
    if (input.kind === "bulk" && identifiedCount > input.totalCardCount) {
      conflict("Total cards in the lot cannot be less than the identified physical Copies.");
    }

    await db.transaction(async (tx) => {
      await insertRecord(tx, {
        id: recordId,
        ownerId,
        type: "purchase",
        status: "active",
        occurredOn: input.date,
        title: input.recordName,
        titleGenerated: false,
        source: input.source,
        listingUrl: input.listingUrl || null,
        amountPence: input.amountKnown ? input.totalPence : 0,
        amountKnown: input.amountKnown,
        notes: input.notes,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });

      if (input.kind === "card") {
        const lineId = id("line");
        const { printing } = await findOrCreatePrinting(tx, ownerId, input.card, now);
        await insertLine(tx, {
          id: lineId, ownerId, recordId, position: 0, kind: "card", name: input.card.name,
          quantity: input.card.quantity,
          allocationPence: ordinaryPurchaseLineAllocation({
            amountKnown: input.amountKnown,
            amountPence: input.totalPence,
          }),
          detail: `${input.card.setCode || "Unknown code"} · ${input.card.edition} · ${input.card.rarity}`,
          createdAt: now, updatedAt: now,
        });
        const copyIds = Array.from({ length: input.card.quantity }, () => id("copy"));
        const sortedCopyIds = [...copyIds].sort();
        const allocations = ordinaryPurchaseCopyAllocations({
          amountKnown: input.amountKnown,
          amountPence: input.totalPence,
          copyCount: input.card.quantity,
        });
        const allocationByCopyId = new Map(sortedCopyIds.map((copyId, index) => [copyId, allocations[index]!]));
        await tx.insert(cardCopies).values(copyIds.map((copyId) => ({
          id: copyId, ownerId, printingId: printing.id, acquiredRecordId: recordId,
          acquiredLineId: lineId, allocationPence: allocationByCopyId.get(copyId)!,
          status: "available" as const, condition: "Near Mint" as const, createdAt: now, updatedAt: now,
        })));
      } else if (input.kind === "sealed") {
        const lineId = id("line");
        let allocation: ReturnType<typeof sealedPurchaseUnitAllocations>;
        try {
          allocation = sealedPurchaseUnitAllocations({
            amountKnown: input.amountKnown,
            amountPence: input.totalPence,
            unitCount: input.product.quantity,
            overrides: input.product.unitAllocations,
          });
        } catch (error) {
          conflict(error instanceof Error ? error.message : "Invalid sealed-unit allocation.");
        }
        if (allocation.mode === "override" && !input.product.unitAllocationsReviewed) {
          conflict("Review and confirm the unequal sealed-unit costs before saving this Purchase.");
        }
        await insertLine(tx, {
          id: lineId, ownerId, recordId, position: 0, kind: "sealed", name: input.product.name,
          quantity: input.product.quantity, allocationPence: input.amountKnown ? input.totalPence : null,
          detail: input.product.edition, createdAt: now, updatedAt: now,
        });
        const canonicalUrl = canonicalProductUrl(input.product.tcgplayerUrl);
        const unitIds = Array.from({ length: input.product.quantity }, () => id("sealed"));
        const allocationByUnitId = new Map([...unitIds].sort().map((unitId, index) => [unitId, {
          allocationIndex: index,
          allocationPence: allocation.allocations[index]!,
        }]));
        await tx.insert(sealedUnits).values(unitIds.map((unitId) => ({
          id: unitId, ownerId, acquiredRecordId: recordId, acquiredLineId: lineId,
          ...allocationByUnitId.get(unitId)!, allocationMode: allocation.mode,
          name: input.product.name, edition: input.product.edition, tcgplayerUrl: input.product.tcgplayerUrl,
          canonicalTcgplayerUrl: canonicalUrl, imageUrl: input.product.imageUrl, status: "sealed" as const,
          createdAt: now, updatedAt: now,
        })));
      } else if (input.kind === "bulk") {
        const lotId = id("bulk");
        const lotLineId = id("line");
        const lotName = `Bulk lot · ${input.cards.length} card ${input.cards.length === 1 ? "type" : "types"}`;
        await insertLine(tx, {
          id: lotLineId, ownerId, recordId, position: 0, kind: "bulk", name: lotName,
          quantity: 1, detail: `${identifiedCount} identified of ${input.totalCardCount} total cards`,
          createdAt: now, updatedAt: now,
        });
        await tx.insert(bulkLots).values({
          id: lotId, ownerId, acquiredRecordId: recordId, acquiredLineId: lotLineId,
          name: lotName, totalQuantity: input.totalCardCount, itemizedQuantity: identifiedCount,
          status: identifiedCount >= input.totalCardCount ? "itemized" : "open", createdAt: now, updatedAt: now,
        });
        let allocationIndex = 0;
        for (const [position, card] of input.cards.entries()) {
          const lineId = id("line");
          const { printing } = await findOrCreatePrinting(tx, ownerId, card, now);
          const allocations = Array.from({ length: card.quantity }, (_, offset) => (
            input.amountKnown
              ? allocatePenceAt(input.totalPence, input.totalCardCount, allocationIndex + offset)
              : null
          ));
          await insertLine(tx, {
            id: lineId, ownerId, recordId, position: position + 1, kind: "card", name: card.name,
            quantity: card.quantity,
            allocationPence: input.amountKnown
              ? allocations.reduce<number>((sum, value) => sum + (value ?? 0), 0)
              : null,
            detail: `${card.setCode || "Unknown code"} · ${card.edition} · from ${lotName}`,
            createdAt: now, updatedAt: now,
          });
          await tx.insert(cardCopies).values(allocations.map((allocationPence, offset) => ({
            id: id("copy"), ownerId, printingId: printing.id, acquiredRecordId: recordId,
            acquiredLineId: lineId, bulkLotId: lotId, allocationIndex: allocationIndex + offset,
            allocationPence, status: "available" as const, condition: "Near Mint" as const, createdAt: now, updatedAt: now,
          })));
          allocationIndex += card.quantity;
        }
      } else {
        const lineId = id("line");
        const name = input.category === "other"
          ? input.otherName
          : input.category.charAt(0).toUpperCase() + input.category.slice(1);
        if (!name) conflict("Name the other supply or extra.");
        await insertLine(tx, {
          id: lineId, ownerId, recordId, position: 0, kind: "supply", name,
          quantity: input.quantity, allocationPence: input.amountKnown ? input.totalPence : null, detail: "Supply or extra",
          createdAt: now, updatedAt: now,
        });
        await tx.insert(supplyItems).values({
          id: id("supply"), ownerId, acquiredRecordId: recordId, acquiredLineId: lineId,
          name, category: input.category, quantity: input.quantity, status: "held",
          createdAt: now, updatedAt: now,
        });
      }
    });
    return { id: recordId };
  }),

  createOpening: authenticatedProcedure.input(openingSchema).mutation(async ({ ctx, input }) => {
    const ownerId = ctx.collectionOwnerId;
    const openingId = id("record");
    const now = new Date();
    await db.transaction(async (tx) => {
      const canonicalUrl = canonicalProductUrl(input.product.tcgplayerUrl);
      let sealed = input.useTrackedStock && input.sealedUnitId
        ? (await tx.select().from(sealedUnits).where(and(
            eq(sealedUnits.id, input.sealedUnitId), eq(sealedUnits.ownerId, ownerId),
            eq(sealedUnits.status, "sealed"), isNull(sealedUnits.openedRecordId),
          )).limit(1))[0]
        : undefined;
      if (input.useTrackedStock && !sealed) conflict("That sealed product is no longer available. Refresh and choose another unit.");

      if (!sealed) {
        const importedId = id("record");
        const importedLineId = id("line");
        const sealedId = id("sealed");
        const isGift = normalize(input.source) === "gift";
        await insertRecord(tx, {
          id: importedId, ownerId, type: "imported-acquisition", status: "active", occurredOn: input.date,
          title: compactRecordName(`Untracked ${input.product.name}`, "Untracked sealed product"), titleGenerated: true,
          source: input.source,
          amountPence: isGift || !input.amountKnown ? 0 : input.totalPence,
          amountKnown: isGift || input.amountKnown,
          notes: isGift ? "Gifted sealed product." : input.amountKnown ? "Recorded alongside a pack opening." : "Cost unknown; recorded alongside a pack opening.",
          revision: 1, createdAt: now, updatedAt: now,
        });
        await insertLine(tx, {
          id: importedLineId, ownerId, recordId: importedId, position: 0, kind: "sealed",
          name: input.product.name, quantity: 1,
          allocationPence: isGift || input.amountKnown ? (isGift ? 0 : input.totalPence) : null,
          detail: `${isGift ? "Gift · £0" : input.amountKnown ? `£${(input.totalPence / 100).toFixed(2)}` : "Cost unknown"} · ${input.product.edition}`,
          createdAt: now, updatedAt: now,
        });
        [sealed] = await tx.insert(sealedUnits).values({
          id: sealedId, ownerId, acquiredRecordId: importedId, acquiredLineId: importedLineId,
          allocationIndex: 0,
          allocationPence: isGift || input.amountKnown ? (isGift ? 0 : input.totalPence) : null,
          allocationMode: "equal",
          name: input.product.name, edition: input.product.edition, tcgplayerUrl: input.product.tcgplayerUrl,
          canonicalTcgplayerUrl: canonicalUrl, imageUrl: input.product.imageUrl, status: "sealed",
          createdAt: now, updatedAt: now,
        }).returning();
      }

      await insertRecord(tx, {
        id: openingId, ownerId, type: "pack-opening", status: "active", occurredOn: input.date,
        title: input.recordName, titleGenerated: false, source: input.source, amountPence: 0,
        amountKnown: true, notes: input.notes, revision: 1, createdAt: now, updatedAt: now,
      });
      for (const [position, pull] of input.pulls.entries()) {
        const lineId = id("line");
        const { printing } = await findOrCreatePrinting(tx, ownerId, pull, now);
        await insertLine(tx, {
          id: lineId, ownerId, recordId: openingId, position, kind: "card", name: pull.name,
          quantity: pull.quantity, detail: `${pull.setCode || "Unknown code"} · ${pull.edition} · ${pull.rarity} · pulled`,
          createdAt: now, updatedAt: now,
        });
        await tx.insert(cardCopies).values(Array.from({ length: pull.quantity }, () => ({
          id: id("copy"), ownerId, printingId: printing.id, acquiredRecordId: openingId,
          acquiredLineId: lineId, status: "available" as const, condition: "Near Mint" as const,
          createdAt: now, updatedAt: now,
        })));
      }
      const updated = await tx.update(sealedUnits).set({
        status: "opened", openedRecordId: openingId, updatedAt: now,
      }).where(and(
        eq(sealedUnits.id, sealed.id), eq(sealedUnits.ownerId, ownerId),
        eq(sealedUnits.status, "sealed"), isNull(sealedUnits.openedRecordId),
      )).returning({ id: sealedUnits.id });
      if (!updated.length) conflict("That sealed product was opened elsewhere. Refresh and try again.");
    });
    return { id: openingId };
  }),

  createSale: authenticatedProcedure.input(saleSchema).mutation(async ({ ctx, input }) => {
    const ownerId = ctx.collectionOwnerId;
    const uniqueCopyIds = Array.from(new Set(input.copyIds));
    if (uniqueCopyIds.length !== input.copyIds.length) {
      conflict("Each physical Copy can appear only once. The Sale has not been saved.");
    }
    const saleId = id("record");
    const now = new Date();
    const compositionSchemaReady = await hasEbayCompositionSchema();
    if (input.paidEbayReview && !compositionSchemaReady) {
      conflict("Paid eBay Sale review is not ready yet. Refresh after the approved Records migration has completed. The Sale has not been saved.");
    }
    const listingIds = await listingIdsForCopies(ownerId, uniqueCopyIds);
    const trackedListings = listingIds.length ? (await db.select().from(ebayListings).where(and(
      eq(ebayListings.ownerId, ownerId),
      inArray(ebayListings.id, listingIds),
    ))).filter((listing) => (
      !ebayListingStatusSummary(listing).relistAllowed
      && listing.id !== input.paidEbayReview?.listingId
    )) : [];
    if (trackedListings.length) await requireEbayExternalCapability(ctx.session);
    for (const listing of trackedListings) {
      try {
        await reconcileEbayListing({ listingId: listing.id, ownerId });
      } catch (error) {
        if (error instanceof EbayListingReconciliationError) {
          conflict(`${error.message} The Sale has not been saved.`);
        }
        throw error;
      }
    }
    await db.transaction(async (tx) => {
      let copies;
      try {
        copies = await lockReconciledCopies(tx, ownerId, input.copyIds);
      } catch (error) {
        if (error instanceof CopySelectionError) conflict(`${error.message} The Sale has not been saved.`);
        throw error;
      }
      let paidReviewLink: {
        copyId: string;
        listingId: string;
        orderLineId: string;
      } | null = null;
      if (input.paidEbayReview) {
        if (
          uniqueCopyIds.length !== 1
          || uniqueCopyIds[0] !== input.paidEbayReview.copyId
        ) {
          conflict("This paid eBay Sale review must contain only its exact physical Copy. The Sale has not been saved.");
        }
        if (normalize(input.source) !== "ebay") {
          conflict("This paid eBay Sale review must keep eBay as its source. The Sale has not been saved.");
        }
        const inspected = await lockPaidEbaySaleReviewIntent(
          tx,
          ownerId,
          input.paidEbayReview,
          copies[0],
        );
        if (!inspected.ok) conflict(`${inspected.message} The Sale has not been saved.`);
        paidReviewLink = inspected;
      }
      const lockedRelations = await lockListingsForCopies(
        tx,
        ownerId,
        input.copyIds,
        compositionSchemaReady,
      );
      const unresolvedListings = Array.from(new Map(
        lockedRelations
          .map((relation) => relation.listing)
          .filter((listing) => !ebayListingStatusSummary(listing).relistAllowed)
          .map((listing) => [listing.id, listing]),
      ).values());
      const unpaidOrUncertain = unresolvedListings.filter(
        (listing) => listing.saleState !== "paid",
      );
      if (unpaidOrUncertain.length) {
        conflict("One or more selected Copies still has a live, pending, or uncertain eBay listing. Resolve it before recording this Sale.");
      }
      if (unresolvedListings.length && normalize(input.source) !== "ebay") {
        conflict("This Sale matches a paid eBay listing. Set the Sale source to eBay so the listing and Record can be linked.");
      }
      let normalizedPaidLineIds: string[] | null = null;
      if (unresolvedListings.length && compositionSchemaReady) {
          const paidLines = await tx.select().from(ebayOrderLines).where(and(
            eq(ebayOrderLines.ownerId, ownerId),
            inArray(ebayOrderLines.listingId, unresolvedListings.map((listing) => listing.id)),
            eq(ebayOrderLines.paymentState, "paid"),
          )).for("update");
          const lineIds = paidLines.map((line) => line.id);
          const allocations = lineIds.length
            ? await tx.select().from(ebayOrderLineAllocations).where(and(
              eq(ebayOrderLineAllocations.ownerId, ownerId),
              inArray(ebayOrderLineAllocations.orderLineId, lineIds),
              isNull(ebayOrderLineAllocations.releasedAt),
            )).for("update")
            : [];
          const members = await tx.select().from(ebayListingMembers).where(and(
            eq(ebayListingMembers.ownerId, ownerId),
            inArray(
              ebayListingMembers.listingId,
              unresolvedListings.map((listing) => listing.id),
            ),
          )).for("update");
          const selectedCopyIds = new Set(uniqueCopyIds);
          const memberById = new Map(members.map((member) => [member.id, member]));
          for (const listing of unresolvedListings) {
            const listingLines = paidLines.filter((line) => line.listingId === listing.id);
            if (listingLines.length !== 1 || listingLines[0]!.quantityPurchased !== 1) {
              conflict("The paid eBay order does not have one exact order line for this Sale. Review it before continuing.");
            }
            const line = listingLines[0]!;
            const lineAllocations = allocations.filter(
              (allocation) => allocation.orderLineId === line.id,
            );
            const allocation = lineAllocations[0];
            const member = allocation ? memberById.get(allocation.listingMemberId) : null;
            const selectedMemberCopyIds = members
              .filter((candidate) => (
                candidate.listingId === listing.id
                && selectedCopyIds.has(candidate.copyId)
              ))
              .map((candidate) => candidate.copyId)
              .sort();
            const allocatedCopyIds = lineAllocations
              .map((candidate) => candidate.copyId)
              .sort();
            if (
              lineAllocations.length !== 1
              || !allocation
              || allocation.listingId !== listing.id
              || !selectedCopyIds.has(allocation.copyId)
              || !member
              || member.listingId !== listing.id
              || member.copyId !== allocation.copyId
              || selectedMemberCopyIds.length !== allocatedCopyIds.length
              || selectedMemberCopyIds.some(
                (copyId, index) => copyId !== allocatedCopyIds[index],
              )
            ) {
              conflict("The paid eBay order is not allocated to the exact selected Copy. Review it before continuing.");
            }
          }
        normalizedPaidLineIds = paidLines.map((line) => line.id);
      }
      const printingIds = Array.from(new Set(copies.map((copy) => copy.printingId)));
      const printingRows = await tx.select().from(cardPrintings).where(and(
        eq(cardPrintings.ownerId, ownerId), inArray(cardPrintings.id, printingIds),
      ));
      const targetIds = Array.from(new Set(printingRows.map((printing) => printing.targetId)));
      const targetRows = await tx.select().from(cardTargets).where(and(
        eq(cardTargets.ownerId, ownerId), inArray(cardTargets.id, targetIds),
      ));
      const printingById = new Map(printingRows.map((printing) => [printing.id, printing]));
      const targetById = new Map(targetRows.map((target) => [target.id, target]));
      const names = copies.map((copy) => {
        const printing = printingById.get(copy.printingId);
        return printing ? targetById.get(printing.targetId)?.name ?? "Card" : "Card";
      });
      await insertRecord(tx, {
        id: saleId, ownerId, type: "sale", status: "active", occurredOn: input.date,
        title: compactRecordName(input.recordName, generatedSaleRecordName(names)),
        titleGenerated: !input.recordName, source: input.source, amountPence: input.netProceedsPence,
        amountKnown: true, notes: input.notes, revision: 1, createdAt: now, updatedAt: now,
      });
      const grouped = new Map<string, typeof copies>();
      for (const copy of copies) {
        grouped.set(copy.printingId, [...(grouped.get(copy.printingId) ?? []), copy]);
      }
      let position = 0;
      for (const [printingId, group] of grouped) {
        const printing = printingById.get(printingId);
        const target = printing ? targetById.get(printing.targetId) : undefined;
        if (!printing || !target) conflict("A selected Copy has incomplete owner-scoped printing data.");
        const lineId = id("line");
        await insertLine(tx, {
          id: lineId, ownerId, recordId: saleId, position, kind: "card", name: target.name,
          quantity: group.length, detail: `${printing.setCode} · ${group[0].condition}`,
          createdAt: now, updatedAt: now,
        });
        const updated = await tx.update(cardCopies).set({
          status: "sold", soldRecordId: saleId, soldLineId: lineId, updatedAt: now,
        }).where(and(
          eq(cardCopies.ownerId, ownerId), inArray(cardCopies.id, group.map((copy) => copy.id)),
          eq(cardCopies.status, "available"),
        )).returning({ id: cardCopies.id });
        if (updated.length !== group.length) conflict("A selected Copy changed while the Sale was being saved.");
        await tx.insert(recordLineCopies).values(group.map((copy) => ({
          id: id("line-copy"), ownerId, recordId: saleId, lineId, copyId: copy.id,
          role: "sale" as const, createdAt: now,
        })));
        position += 1;
      }
      if (unresolvedListings.length || paidReviewLink) {
        const paidLineIds = Array.from(new Set([
          ...(normalizedPaidLineIds ?? []),
          ...(paidReviewLink ? [paidReviewLink.orderLineId] : []),
        ]));
        const exactListingIds = Array.from(new Set([
          ...unresolvedListings.map((listing) => listing.id),
          ...(paidReviewLink ? [paidReviewLink.listingId] : []),
        ]));
        const linkedListings = await tx.update(ebayListings).set({
          saleRecordId: saleId,
          status: "ended",
          updatedAt: now,
        }).where(and(
          eq(ebayListings.ownerId, ownerId),
          inArray(ebayListings.id, exactListingIds),
          eq(ebayListings.saleState, "paid"),
          isNull(ebayListings.saleRecordId),
        )).returning({ id: ebayListings.id });
        if (linkedListings.length !== exactListingIds.length) {
          conflict("A paid eBay listing changed while the Sale was being saved. Refresh Listings and try again.");
        }
        if (paidLineIds.length) {
          const linkedOrderLines = await tx.update(ebayOrderLines).set({
            saleRecordId: saleId,
            updatedAt: now,
          }).where(and(
            eq(ebayOrderLines.ownerId, ownerId),
            inArray(ebayOrderLines.id, paidLineIds),
            isNull(ebayOrderLines.saleRecordId),
          )).returning({ id: ebayOrderLines.id });
          if (linkedOrderLines.length !== paidLineIds.length) {
            conflict("The paid eBay order changed while the Sale was being saved. Refresh Listings and try again.");
          }
        }
      }
    });
    return { id: saleId };
  }),

  updateRecordDetails: authenticatedProcedure.input(updateRecordDetailsSchema).mutation(async ({ ctx, input }) => {
    const ownerId = ctx.collectionOwnerId;
    const now = new Date();
    await db.transaction(async (tx) => {
      const record = await lockRecord(tx, ownerId, input.recordId, input.expectedRevision);
      if (record.status === "void") conflict("Restore this Record before editing it.");
      const nextAmountKnown = input.update.amountKnown ?? record.amountKnown;
      const [lot] = await tx.select().from(bulkLots).where(and(
        eq(bulkLots.ownerId, ownerId), eq(bulkLots.acquiredRecordId, record.id),
      )).limit(1);
      // Validate the complete ordinary-card shape before the Record itself is
      // touched, so an unsupported crafted edit cannot partially write.
      if (record.type === "purchase" && !lot) {
        const syncedCardPurchase = await syncOrdinaryPurchaseAccounting(
          tx,
          ownerId,
          record.id,
          nextAmountKnown,
          input.update.amountPence,
          now,
        );
        if (!syncedCardPurchase) {
          const syncedSealedPurchase = await syncSealedPurchaseAccounting(
            tx,
            ownerId,
            record.id,
            nextAmountKnown,
            input.update.amountPence,
            now,
            input.update.sealedAllocationOverrideConfirmed,
          );
          if (!syncedSealedPurchase) {
            const lines = await tx.select().from(recordLines).where(and(
              eq(recordLines.ownerId, ownerId), eq(recordLines.recordId, record.id),
            )).for("update");
            if (lines.length !== 1) {
              conflict("A Purchase must have one allocation source. No changes were saved.");
            }
            await tx.update(recordLines).set({
              allocationPence: ordinaryPurchaseLineAllocation({
                amountKnown: nextAmountKnown,
                amountPence: input.update.amountPence,
              }),
              updatedAt: now,
            }).where(and(eq(recordLines.id, lines[0]!.id), eq(recordLines.ownerId, ownerId)));
          }
        }
      }
      await tx.update(recordEntries).set({
        title: input.update.title,
        titleGenerated: false,
        occurredOn: input.update.date,
        source: input.update.source,
        listingUrl: input.update.listingUrl || null,
        amountPence: nextAmountKnown ? input.update.amountPence : 0,
        amountKnown: nextAmountKnown,
        notes: input.update.notes,
        updatedAt: now,
      }).where(and(eq(recordEntries.id, record.id), eq(recordEntries.ownerId, ownerId)));

      if (lot && (record.amountPence !== input.update.amountPence || record.amountKnown !== nextAmountKnown)) {
        const copies = await tx.select().from(cardCopies).where(and(
          eq(cardCopies.ownerId, ownerId), eq(cardCopies.bulkLotId, lot.id),
        ));
        for (const copy of copies) {
          if (copy.allocationIndex === null) continue;
          await tx.update(cardCopies).set({
            allocationPence: nextAmountKnown
              ? allocatePenceAt(input.update.amountPence, lot.totalQuantity, copy.allocationIndex)
              : null,
            updatedAt: now,
          }).where(and(eq(cardCopies.id, copy.id), eq(cardCopies.ownerId, ownerId)));
        }
        const lines = await tx.select().from(recordLines).where(and(
          eq(recordLines.ownerId, ownerId), eq(recordLines.recordId, record.id), eq(recordLines.kind, "card"),
        ));
        for (const line of lines) {
          const lineCopies = copies.filter((copy) => copy.acquiredLineId === line.id);
          await tx.update(recordLines).set({
            allocationPence: nextAmountKnown
              ? lineCopies.reduce((sum, copy) => (
                  sum + (copy.allocationIndex === null
                    ? 0
                    : allocatePenceAt(input.update.amountPence, lot.totalQuantity, copy.allocationIndex))
                ), 0)
              : null,
            updatedAt: now,
          }).where(and(eq(recordLines.id, line.id), eq(recordLines.ownerId, ownerId)));
        }
      }
      if (record.type === "imported-acquisition") {
        const lines = await tx.select().from(recordLines).where(and(
          eq(recordLines.ownerId, ownerId), eq(recordLines.recordId, record.id),
        )).for("update");
        if (lines.length === 1) {
          await tx.update(recordLines).set({
            allocationPence: ordinaryPurchaseLineAllocation({ amountKnown: nextAmountKnown, amountPence: input.update.amountPence }),
            updatedAt: now,
          }).where(and(eq(recordLines.id, lines[0]!.id), eq(recordLines.ownerId, ownerId)));
        }
      }
      await bumpRecord(tx, ownerId, record.id, record.revision, now);
    });
    return { id: input.recordId };
  }),

  replaceRecordCards: authenticatedProcedure.input(replaceRecordCardsSchema).mutation(async ({ ctx, input }) => {
    const ownerId = ctx.collectionOwnerId;
    const now = new Date();
    await db.transaction(async (tx) => {
      const record = await lockRecord(tx, ownerId, input.recordId, input.expectedRevision);
      if (record.status === "void") conflict("Restore this Record before editing its items.");
      if (record.type === "sale") conflict("Use exact Copy selection to edit a Sale.");

      const existingLines = await tx.select().from(recordLines).where(and(
        eq(recordLines.ownerId, ownerId),
        eq(recordLines.recordId, record.id),
        eq(recordLines.kind, "card"),
      )).orderBy(asc(recordLines.position));
      const [bulkLot] = await tx.select().from(bulkLots).where(and(
        eq(bulkLots.ownerId, ownerId), eq(bulkLots.acquiredRecordId, record.id),
      )).limit(1);
      const allRecordLines = await tx.select().from(recordLines).where(and(
        eq(recordLines.ownerId, ownerId), eq(recordLines.recordId, record.id),
      )).orderBy(asc(recordLines.position));
      if (!existingLines.length && !bulkLot) {
        conflict("This Record does not contain editable card items.");
      }
      if (!input.cards.length && !bulkLot && record.type !== "pack-opening") {
        conflict("Keep at least one card item, or void the whole Record.");
      }

      const requestedCount = input.cards.reduce((sum, card) => sum + card.quantity, 0);
      if (bulkLot && requestedCount > bulkLot.totalQuantity) {
        conflict(
          `This Bulk Lot contains ${bulkLot.totalQuantity} cards in total. Reduce the identified quantities or update the lot total first.`,
        );
      }

      const existingLineById = new Map(existingLines.map((line) => [line.id, line]));
      const retainedExistingIds = new Set(
        input.cards.filter((card) => existingLineById.has(card.id)).map((card) => card.id),
      );
      const acquiredCopies = await tx.select().from(cardCopies).where(and(
        eq(cardCopies.ownerId, ownerId), eq(cardCopies.acquiredRecordId, record.id),
      )).orderBy(asc(cardCopies.id)).for("update");
      const copyIds = acquiredCopies.map((copy) => copy.id);
      const historyLinks = copyIds.length
        ? await tx.select().from(recordLineCopies).where(and(
            eq(recordLineCopies.ownerId, ownerId),
            eq(recordLineCopies.role, "sale"),
            inArray(recordLineCopies.copyId, copyIds),
          ))
        : [];
      const copyIdsWithSaleHistory = new Set(historyLinks.map((link) => link.copyId));
      const copiesByLine = new Map<string, typeof acquiredCopies>();
      for (const copy of acquiredCopies) {
        copiesByLine.set(copy.acquiredLineId, [...(copiesByLine.get(copy.acquiredLineId) ?? []), copy]);
      }
      if (record.type === "purchase" && !bulkLot) {
        const [onlyLine] = existingLines;
        const [requestedLine] = input.cards;
        const sourceCopies = onlyLine ? copiesByLine.get(onlyLine.id) ?? [] : [];
        if (
          allRecordLines.length !== 1
          || existingLines.length !== 1
          || !onlyLine
          || onlyLine.quantity < 1
          || sourceCopies.length !== onlyLine.quantity
          || sourceCopies.some((copy) => copy.acquiredLineId !== onlyLine.id)
          || input.cards.length !== 1
          || !requestedLine
          || requestedLine.id !== onlyLine.id
        ) {
          conflict("Ordinary card Purchases support one complete card line only. No changes were saved; use a Bulk Lot for multiple card types.");
        }
      }

      for (const line of existingLines.filter((item) => !retainedExistingIds.has(item.id))) {
        const lineCopies = copiesByLine.get(line.id) ?? [];
        if (lineCopies.some((copy) => copyIdsWithSaleHistory.has(copy.id))) {
          conflict(`“${line.name}” has later Sale history and cannot be deleted.`);
        }
      }
      for (const card of input.cards) {
        const existingLine = existingLineById.get(card.id);
        if (existingLine && card.quantity < (copiesByLine.get(existingLine.id) ?? []).length) {
          conflict("Choose the exact physical Copy from Manage copies instead of reducing this source quantity.");
        }
      }
      if (existingLines.some((line) => !retainedExistingIds.has(line.id) && (copiesByLine.get(line.id) ?? []).length)) {
        conflict("Choose the exact physical Copy from Manage copies instead of removing a source line.");
      }

      const existingPrintingIds = Array.from(new Set(acquiredCopies.map((copy) => copy.printingId)));
      const existingPrintings = existingPrintingIds.length
        ? await tx.select().from(cardPrintings).where(and(
            eq(cardPrintings.ownerId, ownerId), inArray(cardPrintings.id, existingPrintingIds),
          ))
        : [];
      const existingTargetIds = Array.from(new Set(existingPrintings.map((printing) => printing.targetId)));
      const existingTargets = existingTargetIds.length
        ? await tx.select().from(cardTargets).where(and(
            eq(cardTargets.ownerId, ownerId), inArray(cardTargets.id, existingTargetIds),
          ))
        : [];
      const printingById = new Map(existingPrintings.map((printing) => [printing.id, printing]));
      const targetById = new Map(existingTargets.map((target) => [target.id, target]));

      type PlannedCard = {
        input: z.infer<typeof cardInputSchema>;
        existingLine: (typeof existingLines)[number] | undefined;
        retainedCopies: typeof acquiredCopies;
        removeCopies: typeof acquiredCopies;
        addQuantity: number;
        printingId: string;
      };
      const plans: PlannedCard[] = [];
      for (const card of input.cards) {
        const existingLine = existingLineById.get(card.id);
        const currentCopies = existingLine ? copiesByLine.get(existingLine.id) ?? [] : [];
        const firstCopy = currentCopies[0];
        const currentPrinting = firstCopy ? printingById.get(firstCopy.printingId) : undefined;
        const currentTarget = currentPrinting ? targetById.get(currentPrinting.targetId) : undefined;
        const identityChanged = Boolean(existingLine) && (
          !currentTarget
          || !currentPrinting
          || normalize(currentTarget.name) !== normalize(card.name)
          || normalize(currentTarget.rarity) !== normalize(card.rarity)
          || normalizeEdition(currentTarget.edition) !== normalizeEdition(card.edition)
          || normalize(currentPrinting.setName) !== normalize(card.setName || "Unknown set")
          || normalize(currentPrinting.setCode) !== normalize(card.setCode || "Unknown code")
          || canonicalProductUrl(currentPrinting.tcgplayerUrl) !== canonicalProductUrl(card.tcgplayerUrl)
        );
        const hasSaleHistory = currentCopies.some((copy) => copyIdsWithSaleHistory.has(copy.id));
        if (identityChanged && hasSaleHistory) {
          conflict(`“${existingLine?.name ?? card.name}” has later Sale history, so its printing identity cannot be changed.`);
        }
        if (
          record.type === "purchase"
          && !bulkLot
          && existingLine
          && card.quantity !== currentCopies.length
          && hasSaleHistory
        ) {
          conflict(`“${existingLine.name}” has later Sale history, so its purchase allocation cannot be rebased.`);
        }

        const removeCount = Math.max(0, currentCopies.length - card.quantity);
        const removable = currentCopies
          .filter((copy) => copy.status === "available" && !copyIdsWithSaleHistory.has(copy.id))
          .slice(0, removeCount);
        if (removable.length !== removeCount) {
          conflict(`“${existingLine?.name ?? card.name}” has dependent Copies, so its quantity cannot be reduced that far.`);
        }
        const removedIds = new Set(removable.map((copy) => copy.id));
        const { printing } = identityChanged || !existingLine
          ? await findOrCreatePrinting(tx, ownerId, card, now)
          : { printing: currentPrinting! };
        plans.push({
          input: card,
          existingLine,
          retainedCopies: currentCopies.filter((copy) => !removedIds.has(copy.id)),
          removeCopies: removable,
          addQuantity: Math.max(0, card.quantity - currentCopies.length),
          printingId: printing.id,
        });
      }

      // Free the stable display positions before applying inserts/reordering so
      // the unique (Record, position) constraint never observes a transient clash.
      for (const [index, line] of existingLines.entries()) {
        await tx.update(recordLines).set({ position: -(index + 1), updatedAt: now }).where(and(
          eq(recordLines.id, line.id), eq(recordLines.ownerId, ownerId),
        ));
      }

      const removedLineIds = existingLines
        .filter((line) => !retainedExistingIds.has(line.id))
        .map((line) => line.id);
      const removedLineCopyIds = removedLineIds.flatMap((lineId) => (
        (copiesByLine.get(lineId) ?? []).map((copy) => copy.id)
      ));
      const reducedCopyIds = plans.flatMap((plan) => plan.removeCopies.map((copy) => copy.id));
      const copyIdsToDelete = [...removedLineCopyIds, ...reducedCopyIds];
      if (copyIdsToDelete.length) {
        await tx.delete(cardCopies).where(and(
          eq(cardCopies.ownerId, ownerId), inArray(cardCopies.id, copyIdsToDelete),
        ));
      }
      if (removedLineIds.length) {
        await tx.delete(recordLines).where(and(
          eq(recordLines.ownerId, ownerId), inArray(recordLines.id, removedLineIds),
        ));
      }

      const usedBulkIndexes = new Set(
        acquiredCopies
          .filter((copy) => copy.bulkLotId === bulkLot?.id && !copyIdsToDelete.includes(copy.id))
          .flatMap((copy) => copy.allocationIndex === null ? [] : [copy.allocationIndex]),
      );
      const takeBulkIndexes = (quantity: number) => {
        if (!bulkLot) return [];
        const available = Array.from({ length: bulkLot.totalQuantity }, (_, index) => index)
          .filter((index) => !usedBulkIndexes.has(index))
          .slice(0, quantity);
        if (available.length !== quantity) conflict("The Bulk Lot total has no unallocated card positions left.");
        for (const index of available) usedBulkIndexes.add(index);
        return available;
      };

      for (const [index, plan] of plans.entries()) {
        const lineId = plan.existingLine?.id ?? id("line");
        const addedBulkIndexes = takeBulkIndexes(plan.addQuantity);
        const addedCopies = Array.from({ length: plan.addQuantity }, (_, offset) => {
          const allocationIndex = bulkLot ? addedBulkIndexes[offset] : null;
          return {
            id: id("copy"), ownerId, printingId: plan.printingId, acquiredRecordId: record.id,
            acquiredLineId: lineId, bulkLotId: bulkLot?.id ?? null, allocationIndex,
            allocationPence: bulkLot && allocationIndex !== null && record.amountKnown
              ? allocatePenceAt(record.amountPence, bulkLot.totalQuantity, allocationIndex)
              : null,
            status: "available" as const, condition: "Near Mint" as const, createdAt: now, updatedAt: now,
          };
        });
        const resultingCopies = [
          ...plan.retainedCopies.map((copy) => ({ ...copy, printingId: plan.printingId })),
          ...addedCopies,
        ].sort((left, right) => left.id.localeCompare(right.id));
        const allocationPence = bulkLot
          ? record.amountKnown ? resultingCopies.reduce((sum, copy) => sum + (
              copy.allocationIndex === null
                ? 0
                : allocatePenceAt(record.amountPence, bulkLot.totalQuantity, copy.allocationIndex)
            ), 0) : null
          : record.type === "purchase"
            ? ordinaryPurchaseLineAllocation({ amountKnown: record.amountKnown, amountPence: record.amountPence })
            : null;
        const lineValues = {
          position: bulkLot ? index + 1 : index,
          name: plan.input.name,
          quantity: plan.input.quantity,
          allocationPence,
          detail: `${plan.input.setCode || "Unknown code"} · ${plan.input.edition} · ${plan.input.rarity}${record.type === "pack-opening" ? " · pulled" : ""}`,
          updatedAt: now,
        };
        // New physical Copies reference their source line, so create that parent
        // row before inserting the child card_copies rows.
        if (!plan.existingLine) {
          await insertLine(tx, {
            id: lineId, ownerId, recordId: record.id, kind: "card", ...lineValues, createdAt: now,
          });
        }
        if (addedCopies.length) await tx.insert(cardCopies).values(addedCopies);
        if (plan.retainedCopies.length) {
          await tx.update(cardCopies).set({ printingId: plan.printingId, updatedAt: now }).where(and(
            eq(cardCopies.ownerId, ownerId),
            inArray(cardCopies.id, plan.retainedCopies.map((copy) => copy.id)),
          ));
        }
        if (record.type === "purchase" && !bulkLot) {
          const allocations = ordinaryPurchaseCopyAllocations({
            amountKnown: record.amountKnown,
            amountPence: record.amountPence,
            copyCount: resultingCopies.length,
          });
          for (const [allocationIndex, copy] of resultingCopies.entries()) {
            await tx.update(cardCopies).set({
              allocationPence: allocations[allocationIndex]!,
              updatedAt: now,
            }).where(and(eq(cardCopies.id, copy.id), eq(cardCopies.ownerId, ownerId)));
          }
        }
        if (plan.existingLine) {
          await tx.update(recordLines).set(lineValues).where(and(
            eq(recordLines.id, lineId), eq(recordLines.ownerId, ownerId),
          ));
        }
      }

      if (bulkLot) {
        await tx.update(bulkLots).set({
          itemizedQuantity: requestedCount,
          status: requestedCount >= bulkLot.totalQuantity ? "itemized" : "open",
          updatedAt: now,
        }).where(and(eq(bulkLots.id, bulkLot.id), eq(bulkLots.ownerId, ownerId)));
        await tx.update(recordLines).set({
          detail: `${requestedCount} identified of ${bulkLot.totalQuantity} total cards`, updatedAt: now,
        }).where(and(
          eq(recordLines.id, bulkLot.acquiredLineId), eq(recordLines.ownerId, ownerId),
        ));
      }
      await bumpRecord(tx, ownerId, record.id, record.revision, now);
    });
    return { id: input.recordId };
  }),

  replaceSaleCopies: authenticatedProcedure.input(replaceSaleCopiesSchema).mutation(async ({ ctx, input }) => {
    const ownerId = ctx.collectionOwnerId;
    const now = new Date();
    const uniqueCopyIds = Array.from(new Set(input.copyIds));
    await db.transaction(async (tx) => {
      const record = await lockRecord(tx, ownerId, input.recordId, input.expectedRevision);
      if (record.type !== "sale") conflict("Only a Sale can edit sold Copies.");
      if (record.status === "void") conflict("Restore this Sale before editing its sold Copies.");

      const currentCopies = await tx.select().from(cardCopies).where(and(
        eq(cardCopies.ownerId, ownerId), eq(cardCopies.soldRecordId, record.id),
      )).for("update");
      const selectedCopies = await tx.select().from(cardCopies).where(and(
        eq(cardCopies.ownerId, ownerId), inArray(cardCopies.id, uniqueCopyIds),
      )).for("update");
      const currentIds = new Set(currentCopies.map((copy) => copy.id));
      if (
        selectedCopies.length !== uniqueCopyIds.length
        || selectedCopies.some((copy) => copy.status !== "available" && !currentIds.has(copy.id))
      ) {
        conflict("One or more selected Copies are no longer available.");
      }

      await tx.update(cardCopies).set({
        status: "available", soldRecordId: null, soldLineId: null, updatedAt: now,
      }).where(and(eq(cardCopies.ownerId, ownerId), eq(cardCopies.soldRecordId, record.id)));
      await tx.delete(recordLineCopies).where(and(
        eq(recordLineCopies.ownerId, ownerId), eq(recordLineCopies.recordId, record.id),
      ));
      await tx.delete(recordLines).where(and(
        eq(recordLines.ownerId, ownerId), eq(recordLines.recordId, record.id),
      ));

      const printingIds = Array.from(new Set(selectedCopies.map((copy) => copy.printingId)));
      const printingRows = await tx.select().from(cardPrintings).where(and(
        eq(cardPrintings.ownerId, ownerId), inArray(cardPrintings.id, printingIds),
      ));
      const targetIds = Array.from(new Set(printingRows.map((printing) => printing.targetId)));
      const targetRows = await tx.select().from(cardTargets).where(and(
        eq(cardTargets.ownerId, ownerId), inArray(cardTargets.id, targetIds),
      ));
      const printingById = new Map(printingRows.map((printing) => [printing.id, printing]));
      const targetById = new Map(targetRows.map((target) => [target.id, target]));
      const grouped = new Map<string, typeof selectedCopies>();
      for (const copy of selectedCopies) grouped.set(copy.printingId, [...(grouped.get(copy.printingId) ?? []), copy]);
      const names: string[] = [];
      let position = 0;
      for (const [printingId, group] of grouped) {
        const printing = printingById.get(printingId);
        const target = printing ? targetById.get(printing.targetId) : undefined;
        if (!printing || !target) conflict("A selected Copy has incomplete printing data.");
        names.push(target.name);
        const lineId = id("line");
        await insertLine(tx, {
          id: lineId, ownerId, recordId: record.id, position, kind: "card", name: target.name,
          quantity: group.length, detail: `${printing.setCode} · ${group[0].condition}`,
          createdAt: now, updatedAt: now,
        });
        await tx.update(cardCopies).set({
          status: "sold", soldRecordId: record.id, soldLineId: lineId, updatedAt: now,
        }).where(and(eq(cardCopies.ownerId, ownerId), inArray(cardCopies.id, group.map((copy) => copy.id))));
        await tx.insert(recordLineCopies).values(group.map((copy) => ({
          id: id("line-copy"), ownerId, recordId: record.id, lineId, copyId: copy.id,
          role: "sale" as const, createdAt: now,
        })));
        position += 1;
      }
      if (record.titleGenerated) {
        await tx.update(recordEntries).set({
          title: compactRecordName("", generatedSaleRecordName(names)), updatedAt: now,
        }).where(and(eq(recordEntries.id, record.id), eq(recordEntries.ownerId, ownerId)));
      }
      await bumpRecord(tx, ownerId, record.id, record.revision, now);
    });
    return { id: input.recordId };
  }),

  updateRecordLine: authenticatedProcedure.input(updateRecordLineSchema).mutation(async ({ ctx, input }) => {
    const ownerId = ctx.collectionOwnerId;
    const now = new Date();
    await db.transaction(async (tx) => {
      const record = await lockRecord(tx, ownerId, input.recordId, input.expectedRevision);
      if (record.status === "void") conflict("Restore this Record before editing its items.");
      const [line] = await tx.select().from(recordLines).where(and(
        eq(recordLines.id, input.lineId),
        eq(recordLines.ownerId, ownerId),
        eq(recordLines.recordId, record.id),
      )).for("update").limit(1);
      if (!line) throw new TRPCError({ code: "NOT_FOUND", message: "Record item not found." });
      if (line.kind === "card") conflict("Use the card editor for this item.");

      if (line.kind === "sealed") {
        const units = await tx.select().from(sealedUnits).where(and(
          eq(sealedUnits.ownerId, ownerId), eq(sealedUnits.acquiredLineId, line.id),
        )).for("update");
        if (
          !units.length
          || units.length !== line.quantity
          || units.some((unit) => unit.acquiredRecordId !== record.id)
        ) conflict("The sealed item data is incomplete.");
        const identityChanged = input.update.name !== line.name
          || Boolean(input.update.edition && units.some((unit) => unit.edition !== input.update.edition));
        if (units.some((unit) => unit.openedRecordId) && (
          identityChanged || input.update.quantity !== units.length
        )) {
          conflict(`“${line.name}” has already been opened, so its identity or quantity cannot change.`);
        }
        if (input.update.quantity < units.length) {
          const removeCount = units.length - input.update.quantity;
          const removable = units.filter((unit) => !unit.openedRecordId).slice(0, removeCount);
          if (removable.length !== removeCount) conflict("Opened units cannot be deleted.");
          await tx.delete(sealedUnits).where(and(
            eq(sealedUnits.ownerId, ownerId), inArray(sealedUnits.id, removable.map((unit) => unit.id)),
          ));
        } else if (input.update.quantity > units.length) {
          const base = units[0];
          await tx.insert(sealedUnits).values(Array.from(
            { length: input.update.quantity - units.length },
            () => ({
              id: id("sealed"), ownerId, acquiredRecordId: record.id, acquiredLineId: line.id,
              allocationIndex: null, allocationPence: null, allocationMode: "equal" as const,
              name: input.update.name, edition: input.update.edition ?? base.edition,
              tcgplayerUrl: base.tcgplayerUrl, canonicalTcgplayerUrl: base.canonicalTcgplayerUrl,
              imageUrl: base.imageUrl, status: "sealed" as const, createdAt: now, updatedAt: now,
            }),
          ));
        }
        await tx.update(sealedUnits).set({
          name: input.update.name,
          edition: input.update.edition,
          updatedAt: now,
        }).where(and(
          eq(sealedUnits.ownerId, ownerId), eq(sealedUnits.acquiredLineId, line.id),
        ));
        const allUnits = await tx.select().from(sealedUnits).where(and(
          eq(sealedUnits.ownerId, ownerId), eq(sealedUnits.acquiredLineId, line.id),
        )).orderBy(asc(sealedUnits.id)).for("update");
        if (input.update.quantity !== units.length || allUnits.some((unit) => unit.allocationIndex === null)) {
          const { allocations } = sealedPurchaseUnitAllocations({
            amountKnown: record.amountKnown,
            amountPence: record.amountPence,
            unitCount: allUnits.length,
          });
          for (const [index, unit] of allUnits.entries()) {
            await tx.update(sealedUnits).set({
              allocationIndex: index,
              allocationPence: allocations[index]!,
              allocationMode: "equal",
              updatedAt: now,
            }).where(and(eq(sealedUnits.id, unit.id), eq(sealedUnits.ownerId, ownerId)));
          }
          await tx.update(recordLines).set({
            allocationPence: record.amountKnown ? record.amountPence : null,
            updatedAt: now,
          }).where(and(eq(recordLines.id, line.id), eq(recordLines.ownerId, ownerId)));
        }
        await tx.update(recordLines).set({
          name: input.update.name,
          quantity: input.update.quantity,
          detail: input.update.edition ?? line.detail,
          updatedAt: now,
        }).where(and(eq(recordLines.id, line.id), eq(recordLines.ownerId, ownerId)));
      } else if (line.kind === "supply") {
        const [supply] = await tx.select().from(supplyItems).where(and(
          eq(supplyItems.ownerId, ownerId), eq(supplyItems.acquiredLineId, line.id),
        )).for("update").limit(1);
        if (!supply) conflict("The supply item data is incomplete.");
        const category = input.update.category ?? supply.category;
        await tx.update(supplyItems).set({
          name: input.update.name, category, quantity: input.update.quantity, updatedAt: now,
        }).where(and(eq(supplyItems.id, supply.id), eq(supplyItems.ownerId, ownerId)));
        await tx.update(recordLines).set({
          name: input.update.name,
          quantity: input.update.quantity,
          detail: category === "other"
            ? "Other supply or extra"
            : `${category.charAt(0).toUpperCase()}${category.slice(1)}`,
          updatedAt: now,
        }).where(and(eq(recordLines.id, line.id), eq(recordLines.ownerId, ownerId)));
      } else {
        const [lot] = await tx.select().from(bulkLots).where(and(
          eq(bulkLots.ownerId, ownerId), eq(bulkLots.acquiredLineId, line.id),
        )).for("update").limit(1);
        if (!lot) conflict("The Bulk Lot data is incomplete.");
        const nextTotal = input.update.totalQuantity ?? lot.totalQuantity;
        if (nextTotal < lot.itemizedQuantity) {
          conflict(`Total cards cannot be less than the ${lot.itemizedQuantity} identified Copies.`);
        }
        const lotCopies = await tx.select().from(cardCopies).where(and(
          eq(cardCopies.ownerId, ownerId), eq(cardCopies.bulkLotId, lot.id),
        )).for("update");
        if (nextTotal !== lot.totalQuantity && lotCopies.length) {
          const links = await tx.select().from(recordLineCopies).where(and(
            eq(recordLineCopies.ownerId, ownerId),
            eq(recordLineCopies.role, "sale"),
            inArray(recordLineCopies.copyId, lotCopies.map((copy) => copy.id)),
          ));
          if (links.length) {
            conflict("The lot total cannot change after one of its Copies has Sale history.");
          }
        }
        for (const copy of lotCopies) {
          if (copy.allocationIndex === null) continue;
          await tx.update(cardCopies).set({
            allocationPence: record.amountKnown
              ? allocatePenceAt(record.amountPence, nextTotal, copy.allocationIndex)
              : null,
            updatedAt: now,
          }).where(and(eq(cardCopies.id, copy.id), eq(cardCopies.ownerId, ownerId)));
        }
        const cardLines = await tx.select().from(recordLines).where(and(
          eq(recordLines.ownerId, ownerId),
          eq(recordLines.recordId, record.id),
          eq(recordLines.kind, "card"),
        ));
        for (const cardLine of cardLines) {
          const lineCopies = lotCopies.filter((copy) => copy.acquiredLineId === cardLine.id);
          await tx.update(recordLines).set({
            allocationPence: record.amountKnown
              ? lineCopies.reduce((sum, copy) => (
                  sum + (copy.allocationIndex === null
                    ? 0
                    : allocatePenceAt(record.amountPence, nextTotal, copy.allocationIndex))
                ), 0)
              : null,
            updatedAt: now,
          }).where(and(eq(recordLines.id, cardLine.id), eq(recordLines.ownerId, ownerId)));
        }
        await tx.update(bulkLots).set({
          name: input.update.name,
          totalQuantity: nextTotal,
          status: lot.itemizedQuantity >= nextTotal ? "itemized" : "open",
          updatedAt: now,
        }).where(and(eq(bulkLots.id, lot.id), eq(bulkLots.ownerId, ownerId)));
        await tx.update(recordLines).set({
          name: input.update.name,
          quantity: 1,
          detail: `${lot.itemizedQuantity} identified of ${nextTotal} total cards`,
          updatedAt: now,
        }).where(and(eq(recordLines.id, line.id), eq(recordLines.ownerId, ownerId)));
      }
      await bumpRecord(tx, ownerId, record.id, record.revision, now);
    });
    return { id: input.recordId };
  }),

  changeStatus: authenticatedProcedure.input(recordMutationIdentitySchema.extend({
    status: z.enum(["active", "void"]),
  })).mutation(async ({ ctx, input }) => {
    const ownerId = ctx.collectionOwnerId;
    const now = new Date();
    const compositionSchemaReady = await hasEbayCompositionSchema();
    const [saleRecord] = await db.select({ type: recordEntries.type }).from(recordEntries).where(and(
      eq(recordEntries.id, input.recordId),
      eq(recordEntries.ownerId, ownerId),
    )).limit(1);
    if (saleRecord?.type === "sale") {
      const directLink = await db.select({ id: ebayListings.id }).from(ebayListings).where(and(
        eq(ebayListings.ownerId, ownerId),
        eq(ebayListings.saleRecordId, input.recordId),
      )).limit(1);
      const orderLink = compositionSchemaReady
        ? await db.select({ id: ebayOrderLines.id }).from(ebayOrderLines).where(and(
            eq(ebayOrderLines.ownerId, ownerId),
            eq(ebayOrderLines.saleRecordId, input.recordId),
          )).limit(1)
        : [];
      if (directLink.length || orderLink.length) {
        await requireEbayExternalCapability(ctx.session);
      }
    }
    await db.transaction(async (tx) => {
      const record = await lockRecord(tx, ownerId, input.recordId, input.expectedRevision);
      if (record.status === input.status) conflict(`Record is already ${input.status}.`);

      if (record.type === "sale") {
        const links = await tx.select().from(recordLineCopies).where(and(
          eq(recordLineCopies.ownerId, ownerId), eq(recordLineCopies.recordId, record.id), eq(recordLineCopies.role, "sale"),
        ));
        const linkedEbayListings = await tx.select({ id: ebayListings.id }).from(ebayListings).where(and(
          eq(ebayListings.ownerId, ownerId),
          eq(ebayListings.saleRecordId, record.id),
        ));
        let orderLineListingIds: string[] = [];
        if (compositionSchemaReady) {
          orderLineListingIds = (await tx.select({ listingId: ebayOrderLines.listingId })
            .from(ebayOrderLines)
            .where(and(
              eq(ebayOrderLines.ownerId, ownerId),
              eq(ebayOrderLines.saleRecordId, record.id),
            ))).map((line) => line.listingId);
        }
        const linkedListingIds = new Set([
          ...linkedEbayListings.map((listing) => listing.id),
          ...orderLineListingIds,
        ]);
        const copyIds = links.map((link) => link.copyId);
        if (input.status === "void") {
          await tx.update(cardCopies).set({
            status: "available", soldRecordId: null, soldLineId: null, updatedAt: now,
          }).where(and(
            eq(cardCopies.ownerId, ownerId), eq(cardCopies.soldRecordId, record.id),
          ));
          if (linkedListingIds.size) {
            await tx.update(ebayListings).set({
              saleState: "needs_review",
              status: "active",
              updatedAt: now,
            }).where(and(
              eq(ebayListings.ownerId, ownerId),
              inArray(ebayListings.id, [...linkedListingIds]),
            ));
            if (compositionSchemaReady) {
              await tx.update(ebayOrderLines).set({
                needsReviewAt: now,
                paymentState: "needs_review",
                updatedAt: now,
              }).where(and(
                eq(ebayOrderLines.ownerId, ownerId),
                eq(ebayOrderLines.saleRecordId, record.id),
              ));
            }
          }
        } else if (copyIds.length) {
          const copies = await tx.select().from(cardCopies).where(and(
            eq(cardCopies.ownerId, ownerId), inArray(cardCopies.id, copyIds),
          )).for("update");
          if (copies.length !== copyIds.length || copies.some((copy) => copy.status !== "available" || copy.soldRecordId)) {
            conflict("A Copy from this Sale has since been used elsewhere, so the Sale cannot be restored.");
          }
          const lineByCopy = new Map(links.map((link) => [link.copyId, link.lineId]));
          for (const copy of copies) {
            await tx.update(cardCopies).set({
              status: "sold", soldRecordId: record.id, soldLineId: lineByCopy.get(copy.id), updatedAt: now,
            }).where(and(eq(cardCopies.id, copy.id), eq(cardCopies.ownerId, ownerId)));
          }
          if (linkedListingIds.size) {
            await tx.update(ebayListings).set({
              saleState: "paid",
              status: "ended",
              updatedAt: now,
            }).where(and(
              eq(ebayListings.ownerId, ownerId),
              inArray(ebayListings.id, [...linkedListingIds]),
            ));
            if (compositionSchemaReady) {
              await tx.update(ebayOrderLines).set({
                needsReviewAt: null,
                paymentState: "paid",
                updatedAt: now,
              }).where(and(
                eq(ebayOrderLines.ownerId, ownerId),
                eq(ebayOrderLines.saleRecordId, record.id),
              ));
            }
          }
        }
      } else if (record.type === "pack-opening") {
        const openingCopies = await tx.select().from(cardCopies).where(and(
          eq(cardCopies.ownerId, ownerId), eq(cardCopies.acquiredRecordId, record.id),
        )).for("update");
        const openedUnits = await tx.select().from(sealedUnits).where(and(
          eq(sealedUnits.ownerId, ownerId), eq(sealedUnits.openedRecordId, record.id),
        )).for("update");
        if (input.status === "void" && openingCopies.some((copy) => copy.soldRecordId)) {
          conflict("Void the dependent Sale before voiding this Pack Opening.");
        }
        if (input.status === "active" && (
          !openedUnits.length || openedUnits.some((unit) => unit.status !== "sealed")
        )) {
          conflict("Restore the sealed product's acquisition before restoring this Pack Opening.");
        }
        await tx.update(cardCopies).set({
          status: input.status === "void" ? "void" : "available", updatedAt: now,
        }).where(and(eq(cardCopies.ownerId, ownerId), eq(cardCopies.acquiredRecordId, record.id)));
        await tx.update(sealedUnits).set({
          status: input.status === "void" ? "sealed" : "opened", updatedAt: now,
        }).where(and(eq(sealedUnits.ownerId, ownerId), eq(sealedUnits.openedRecordId, record.id)));
      } else {
        const acquiredCopies = await tx.select().from(cardCopies).where(and(
          eq(cardCopies.ownerId, ownerId), eq(cardCopies.acquiredRecordId, record.id),
        )).for("update");
        const acquiredSealed = await tx.select().from(sealedUnits).where(and(
          eq(sealedUnits.ownerId, ownerId), eq(sealedUnits.acquiredRecordId, record.id),
        )).for("update");
        const openedRecordIds = Array.from(new Set(
          acquiredSealed.flatMap((unit) => unit.openedRecordId ? [unit.openedRecordId] : []),
        ));
        const activeOpenings = openedRecordIds.length
          ? await tx.select({ id: recordEntries.id }).from(recordEntries).where(and(
              eq(recordEntries.ownerId, ownerId),
              eq(recordEntries.status, "active"),
              inArray(recordEntries.id, openedRecordIds),
            ))
          : [];
        if (input.status === "void" && (
          acquiredCopies.some((copy) => copy.soldRecordId)
          || activeOpenings.length > 0
        )) {
          conflict("Void the dependent Sale or Pack Opening before voiding this acquisition.");
        }
        await tx.update(cardCopies).set({
          status: input.status === "void" ? "void" : "available", updatedAt: now,
        }).where(and(eq(cardCopies.ownerId, ownerId), eq(cardCopies.acquiredRecordId, record.id)));
        await tx.update(sealedUnits).set({
          status: input.status === "void" ? "void" : "sealed", updatedAt: now,
        }).where(and(eq(sealedUnits.ownerId, ownerId), eq(sealedUnits.acquiredRecordId, record.id)));
        await tx.update(supplyItems).set({
          status: input.status === "void" ? "void" : "held", updatedAt: now,
        }).where(and(eq(supplyItems.ownerId, ownerId), eq(supplyItems.acquiredRecordId, record.id)));
        const [lot] = await tx.select().from(bulkLots).where(and(
          eq(bulkLots.ownerId, ownerId), eq(bulkLots.acquiredRecordId, record.id),
        )).limit(1);
        if (lot) {
          await tx.update(bulkLots).set({
            status: input.status === "void"
              ? "void"
              : lot.itemizedQuantity >= lot.totalQuantity ? "itemized" : "open",
            updatedAt: now,
          }).where(and(eq(bulkLots.id, lot.id), eq(bulkLots.ownerId, ownerId)));
        }
      }
      await tx.update(recordEntries).set({
        status: input.status, revision: record.revision + 1, updatedAt: now,
      }).where(and(eq(recordEntries.id, record.id), eq(recordEntries.ownerId, ownerId)));
    });
    return { id: input.recordId };
  }),
});
