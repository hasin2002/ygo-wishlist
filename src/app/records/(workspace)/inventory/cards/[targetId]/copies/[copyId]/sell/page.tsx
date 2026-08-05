import { redirect } from "next/navigation";

export default async function RecordsInventoryCardSellPage({ params }: { params: Promise<{ targetId: string }> }) {
  const { targetId } = await params;
  redirect(`/records/listings/new?target=${encodeURIComponent(targetId)}`);
}
