export type EbayImagePostOperation =
  | { archiveKey: string; kind: "upload-archived" }
  | { file: File; kind: "upload-file" }
  | { kind: "import-catalogue"; sourceUrl: string }
  | {
      inventoryCopyId: string;
      inventoryKey: string;
      kind: "import-inventory" | "stage-inventory";
    };

export class EbayImageOperationError extends Error {}

export type EbayImageOperationServices<Result> = {
  importCatalogue: (ownerId: string, copyId: string, sourceUrl: string) => Promise<Result>;
  importInventory: (ownerId: string, copyId: string, inventoryKey: string, inventoryCopyId: string) => Promise<Result>;
  stageInventory: (ownerId: string, copyId: string, inventoryKey: string, inventoryCopyId: string) => Promise<Result>;
  uploadArchived: (ownerId: string, copyId: string, archiveKey: string) => Promise<Result>;
  uploadFile: (ownerId: string, copyId: string, file: File) => Promise<Result>;
};

function text(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Rejects ambiguous requests before any permission or external-service work. */
export function parseEbayImagePostOperation(form: FormData): {
  copyId: string;
  operation: EbayImagePostOperation;
} {
  const copyId = text(form, "copyId");
  if (!copyId) throw new EbayImageOperationError("Choose the physical card copy for this listing.");

  const fileValue = form.get("image");
  const file = fileValue instanceof File ? fileValue : null;
  const archiveKey = text(form, "archiveKey");
  const sourceUrl = text(form, "sourceUrl");
  const inventoryKey = text(form, "inventoryKey");
  const inventoryCopyId = text(form, "inventoryCopyId");
  const stageOnlyValue = text(form, "stageOnly");
  if (stageOnlyValue && stageOnlyValue !== "true" && stageOnlyValue !== "false") {
    throw new EbayImageOperationError("Choose one valid listing-photo operation.");
  }
  const stageOnly = stageOnlyValue === "true";
  const operationCount = [Boolean(file), Boolean(archiveKey), Boolean(sourceUrl), Boolean(inventoryKey)]
    .filter(Boolean).length;
  if (operationCount !== 1) {
    throw new EbayImageOperationError("Choose exactly one listing-photo operation.");
  }
  if ((stageOnly || inventoryCopyId) && !inventoryKey) {
    throw new EbayImageOperationError("Saved-photo options require one saved inventory photo.");
  }
  if (archiveKey) return { copyId, operation: { archiveKey, kind: "upload-archived" } };
  if (sourceUrl) return { copyId, operation: { kind: "import-catalogue", sourceUrl } };
  if (inventoryKey) return {
    copyId,
    operation: {
      inventoryCopyId: inventoryCopyId || copyId,
      inventoryKey,
      kind: stageOnly ? "stage-inventory" : "import-inventory",
    },
  };
  if (!file) throw new EbayImageOperationError("Choose an image file to upload.");
  return { copyId, operation: { file, kind: "upload-file" } };
}

export async function executeEbayImagePostOperation<Result>(
  parsed: ReturnType<typeof parseEbayImagePostOperation>,
  ownerId: string,
  services: EbayImageOperationServices<Result>,
) {
  const { copyId, operation } = parsed;
  switch (operation.kind) {
    case "upload-archived":
      return services.uploadArchived(ownerId, copyId, operation.archiveKey);
    case "import-catalogue":
      return services.importCatalogue(ownerId, copyId, operation.sourceUrl);
    case "stage-inventory":
      return services.stageInventory(ownerId, copyId, operation.inventoryKey, operation.inventoryCopyId);
    case "import-inventory":
      return services.importInventory(ownerId, copyId, operation.inventoryKey, operation.inventoryCopyId);
    case "upload-file":
      return services.uploadFile(ownerId, copyId, operation.file);
  }
}
