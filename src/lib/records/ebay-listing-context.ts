import type {
  CardCopy,
  CardPrinting,
  RecordEntry,
  RecordsSnapshot,
  WishlistTarget,
} from "@/lib/records/types";

export type EbayListingContext = {
  copy: CardCopy;
  printing: CardPrinting;
  sourceRecord: RecordEntry;
  target: WishlistTarget;
};

export type EbayListingUnavailableReason =
  | "target-not-found"
  | "copy-not-found"
  | "printing-not-found"
  | "copy-target-mismatch"
  | "source-record-not-found"
  | "copy-sold"
  | "copy-void"
  | "source-record-void";

export type EbayListingContextResult =
  | ({ ok: true } & EbayListingContext)
  | {
      message: string;
      ok: false;
      reason: EbayListingUnavailableReason;
    };

function unavailable(
  reason: EbayListingUnavailableReason,
  message: string,
): EbayListingContextResult {
  return { message, ok: false, reason };
}

export function resolveEbayListingContext(
  snapshot: RecordsSnapshot,
  targetId: string,
  copyId: string,
): EbayListingContextResult {
  const target = snapshot.targets.find((item) => item.id === targetId);
  if (!target) {
    return unavailable("target-not-found", "That inventory card could not be found.");
  }

  const copy = snapshot.copies.find((item) => item.id === copyId);
  if (!copy) {
    return unavailable("copy-not-found", "That physical Copy could not be found.");
  }

  const printing = snapshot.printings.find((item) => item.id === copy.printingId);
  if (!printing) {
    return unavailable(
      "printing-not-found",
      "The printing details for this physical Copy are unavailable.",
    );
  }
  if (printing.targetId !== target.id) {
    return unavailable(
      "copy-target-mismatch",
      "That physical Copy does not belong to this inventory card.",
    );
  }

  const sourceRecord = snapshot.records.find((item) => item.id === copy.acquiredRecordId);
  if (!sourceRecord) {
    return unavailable(
      "source-record-not-found",
      "The source Record for this physical Copy is unavailable.",
    );
  }

  if (copy.status === "sold") {
    return unavailable("copy-sold", "This physical Copy has already been sold.");
  }
  if (copy.status === "void") {
    return unavailable(
      "copy-void",
      "Restore the source Record before listing this physical Copy.",
    );
  }
  if (sourceRecord.status === "void") {
    return unavailable(
      "source-record-void",
      "Restore the source Record before listing this physical Copy.",
    );
  }

  return { copy, ok: true, printing, sourceRecord, target };
}
