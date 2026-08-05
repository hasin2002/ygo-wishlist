import { LinkedOfferListing } from "@/components/records/linked-offer-listing";

export default async function NewLinkedListingPage({ searchParams }: { searchParams: Promise<{ target?: string; printing?: string; condition?: string; resume?: string }> }) {
  const { target, printing, condition, resume } = await searchParams;
  return <LinkedOfferListing initialCondition={condition} initialPrintingId={printing} initialResumeFamilyId={resume} initialTargetId={target} />;
}
