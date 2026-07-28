import { EbayListingsWorkspace } from "@/components/records/ebay-listings-workspace";
import {
  parseEbayListingsRouteState,
  searchParamsFromPage,
} from "@/lib/records/ebay-listings-route-state";

type ListingsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ListingsPage({
  searchParams,
}: ListingsPageProps) {
  const state = parseEbayListingsRouteState(searchParamsFromPage(await searchParams));
  return <EbayListingsWorkspace initialState={state} />;
}
