import { EbayListingDetail } from "@/components/records/ebay-listings-workspace";
import {
  parseEbayListingsRouteState,
  searchParamsFromPage,
} from "@/lib/records/ebay-listings-route-state";

type ListingDetailPageProps = {
  params: Promise<{ listingId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ListingDetailPage({
  params,
  searchParams,
}: ListingDetailPageProps) {
  const [{ listingId }, state] = await Promise.all([
    params,
    searchParams.then((values) => parseEbayListingsRouteState(searchParamsFromPage(values))),
  ]);
  return <EbayListingDetail initialState={state} listingId={listingId} />;
}
