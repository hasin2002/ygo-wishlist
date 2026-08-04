import { LinkedOfferListing } from "@/components/records/linked-offer-listing";

export default async function NewLinkedListingPage({ searchParams }: { searchParams: Promise<{ target?: string; printing?: string; condition?: string }> }) {
  const { target, printing, condition } = await searchParams;
  return <LinkedOfferListing initialCondition={condition} initialPrintingId={printing} initialTargetId={target} />;
}
