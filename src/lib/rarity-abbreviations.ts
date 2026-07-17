export const rarityAbbreviations = [
  { abbreviation: "CMN", rarity: "Common" },
  { abbreviation: "SP", rarity: "Short Print" },
  { abbreviation: "SSP", rarity: "Super Short Print" },
  { abbreviation: "R", rarity: "Rare" },
  { abbreviation: "SR", rarity: "Super Rare" },
  { abbreviation: "UR", rarity: "Ultra Rare" },
  { abbreviation: "OFUR", rarity: "Overframe Ultra Rare" },
  { abbreviation: "SCR", rarity: "Secret Rare" },
  { abbreviation: "ULTR", rarity: "Ultimate Rare" },
  { abbreviation: "GHR", rarity: "Ghost Rare" },
  { abbreviation: "GR", rarity: "Gold Rare" },
  { abbreviation: "GSR", rarity: "Gold Secret Rare" },
  { abbreviation: "PGR", rarity: "Premium Gold Rare" },
  { abbreviation: "PLR", rarity: "Platinum Rare" },
  { abbreviation: "PLSR", rarity: "Platinum Secret Rare" },
  { abbreviation: "CR", rarity: "Collector's Rare" },
  { abbreviation: "SLR", rarity: "Starlight Rare" },
  { abbreviation: "OFSLR", rarity: "Overframe Starlight Rare" },
  { abbreviation: "QCSR", rarity: "Quarter Century Secret Rare" },
  { abbreviation: "PSCR", rarity: "Prismatic Secret Rare" },
  { abbreviation: "PR", rarity: "Parallel Rare" },
  { abbreviation: "DTNPR", rarity: "Duel Terminal Normal Parallel Rare" },
  { abbreviation: "DTRPR", rarity: "Duel Terminal Rare Parallel Rare" },
  { abbreviation: "DTSPR", rarity: "Duel Terminal Super Parallel Rare" },
  { abbreviation: "DTUPR", rarity: "Duel Terminal Ultra Parallel Rare" },
  { abbreviation: "DTSCR", rarity: "Duel Terminal Secret Parallel Rare" },
  { abbreviation: "MSR", rarity: "Mosaic Rare" },
  { abbreviation: "SFR", rarity: "Starfoil Rare" },
  { abbreviation: "SHFR", rarity: "Shatterfoil Rare" },
  { abbreviation: "PHR", rarity: "Pharaoh's Rare" },
  { abbreviation: "MLR", rarity: "Millennium Rare" },
  { abbreviation: "EXSR", rarity: "Extra Secret Rare" },
  { abbreviation: "20SCR", rarity: "20th Secret Rare" },
  { abbreviation: "10KSR", rarity: "10000 Secret Rare" },
] as const;

export const rarityNames = rarityAbbreviations.map((entry) => entry.rarity);

function normalizeRarity(value: string) {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const rarityAbbreviationLookup = new Map(
  rarityAbbreviations.map((entry) => [
    normalizeRarity(entry.rarity),
    entry.abbreviation,
  ]),
);

rarityAbbreviationLookup.set("overframe startlight rare", "OFSLR");

export function rarityAbbreviation(rarity: string | null | undefined) {
  const cleanRarity = rarity?.trim();

  if (!cleanRarity) {
    return null;
  }

  const normalized = normalizeRarity(cleanRarity);
  const exactMatch = rarityAbbreviationLookup.get(normalized);

  if (exactMatch) {
    return exactMatch;
  }

  if (/^[a-z0-9]{1,6}$/i.test(cleanRarity)) {
    return cleanRarity.toUpperCase();
  }

  const generated = cleanRarity
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((word) => (/^\d/.test(word) ? word.replace(/\D/g, "") : word.charAt(0)))
    .join("")
    .toUpperCase();

  return generated.slice(0, 6) || null;
}
