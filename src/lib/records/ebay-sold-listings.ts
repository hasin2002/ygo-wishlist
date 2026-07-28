import { ebayCardCategory } from "../ebay-listing-options.ts";

/**
 * A focused completed-and-sold eBay search for one specific printing.
 * This is research only; it never changes a seller's active listings.
 */
export function ebaySoldListingsUrl({
  edition,
  name,
  rarity,
  setCode,
}: {
  edition: string;
  name: string;
  rarity: string;
  setCode: string;
}) {
  const params = new URLSearchParams({
    _nkw: [name, rarity, setCode, edition].filter(Boolean).join(" "),
    _sacat: ebayCardCategory.id,
    LH_Complete: "1",
    LH_Sold: "1",
  });
  return `https://www.ebay.co.uk/sch/i.html?${params}`;
}
