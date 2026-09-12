export type CatalogueProduct = {
  productId: number;
  groupId: number;
  name: string;
  imageUrl: string | null;
  tcgplayerUrl: string;
  setCode: string;
  setName: string;
  rarity: string;
  searchText: string;
};

export function normalizeCatalogueText(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

const rarityAliases: [string, string[]][] = [
  ["Quarter Century Secret Rare", ["quarter century secret rare", "quarter century", "qcsr", "qcr"]],
  ["Prismatic Collector's Rare", ["prismatic collector s rare", "prismatic collectors rare", "pcr"]],
  ["Prismatic Ultimate Rare", ["prismatic ultimate rare", "pur"]],
  ["Prismatic Secret Rare", ["prismatic secret rare", "psr"]],
  ["Platinum Secret Rare", ["platinum secret rare", "platinum rare"]],
  ["Collector's Rare", ["collector s rare", "collectors rare", "cr"]],
  ["Ultimate Rare", ["ultimate rare", "utr"]],
  ["Starlight Rare", ["starlight rare", "starlight"]],
  ["Ghost Rare", ["ghost rare"]],
  ["Gold Secret Rare", ["gold secret rare"]],
  ["Gold Rare", ["gold rare"]],
  ["Secret Rare", ["secret rare", "scr"]],
  ["Ultra Rare", ["ultra rare", "ur"]],
  ["Super Rare", ["super rare", "sr"]],
  ["Common", ["common"]],
  ["Rare", ["rare"]],
];

export function parseCatalogueQuery(query: string) {
  let searchText = ` ${normalizeCatalogueText(query)} `;
  let detectedRarity: string | null = null;
  for (const [rarity, aliases] of rarityAliases) {
    const alias = aliases.find((candidate) => searchText.includes(` ${candidate} `)
      // These are also words in card names (Rare Metal Dragon, Common Charity).
      && (!(candidate === "rare" || candidate === "common") || searchText.endsWith(` ${candidate} `)));
    if (alias) {
      detectedRarity = rarity;
      searchText = searchText.replace(` ${alias} `, " ");
      break;
    }
  }
  searchText = searchText.trim().replace(/\s+/g, " ");
  return { searchText, detectedRarity, tokens: searchText.split(" ").filter(Boolean) };
}

type RawGroup = {groupId: number; name: string; abbreviation?: string | null};
/** Strict singles boundary: sealed products lack a physical printing number/rarity. */
export function normalizeCatalogueProduct(raw: unknown, group: RawGroup): CatalogueProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (!Number.isSafeInteger(value.productId) || Number(value.productId) <= 0 || value.categoryId !== 2 || value.groupId !== group.groupId || typeof value.name !== "string" || !value.name.trim()) return null;
  const fields = Array.isArray(value.extendedData) ? value.extendedData as Record<string, unknown>[] : [];
  const field = (name: string) => fields.find((item) => item.name === name)?.value;
  const setCode = field("Number");
  const rarity = field("Rarity");
  if (typeof setCode !== "string" || !setCode.trim() || typeof rarity !== "string" || !rarity.trim() || /^(n\/a|none|unknown)$/i.test(rarity.trim())) return null;
  const productId = Number(value.productId);
  let imageUrl: string | null = null;
  if (typeof value.imageUrl === "string") {
    try { const url = new URL(value.imageUrl); if (url.protocol === "https:" && (url.hostname === "tcgplayer-cdn.tcgplayer.com" || url.hostname === "product-images.tcgplayer.com")) imageUrl = url.href; } catch { /* Invalid artwork is optional. */ }
  }
  return {
    productId, groupId: group.groupId, name: value.name.trim(), imageUrl,
    tcgplayerUrl: `https://www.tcgplayer.com/product/${productId}`,
    setCode: setCode.trim(), setName: group.name, rarity: rarity.trim(),
    searchText: normalizeCatalogueText(`${value.name} ${setCode} ${String(setCode).replace(/[^a-z0-9]/gi, "")} ${group.name} ${group.abbreviation ?? ""}`),
  };
}
