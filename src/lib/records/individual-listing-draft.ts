import { inventoryCopySellHref, type InventoryListState } from "./inventory-route-state.ts";

type CopyReference = { id: string; printingId: string };
type PrintingReference = { id: string; targetId: string };
type TargetReference = { id: string };

/**
 * Resolve a saved individual-listing draft back to its own exact Copy route.
 * Returning a URL instead of its form data is intentional: Copy A's draft
 * must never be hydrated into Copy B's workspace.
 */
export function individualListingDraftResumeHref({
  copies,
  listState,
  previousCopyId,
  printings,
  targets,
}: {
  copies: CopyReference[];
  listState: InventoryListState;
  previousCopyId: string;
  printings: PrintingReference[];
  targets: TargetReference[];
}) {
  const copy = copies.find((candidate) => candidate.id === previousCopyId);
  const printing = copy ? printings.find((candidate) => candidate.id === copy.printingId) : null;
  const target = printing ? targets.find((candidate) => candidate.id === printing.targetId) : null;
  return target ? inventoryCopySellHref(target.id, previousCopyId, listState) : null;
}
