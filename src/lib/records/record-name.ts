const maxRecordNameLength = 80;

function normalizedName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function compactRecordName(value: string | null | undefined, fallback: string) {
  const name = normalizedName(value || "") || fallback;
  if (name.length <= maxRecordNameLength) return name;
  return `${name.slice(0, maxRecordNameLength - 1).trimEnd()}…`;
}

export function generatedSaleRecordName(cardNames: string[]) {
  const uniqueNames = Array.from(new Set(cardNames.map(normalizedName).filter(Boolean)));
  if (!uniqueNames.length) return "Card sale";
  if (uniqueNames.length === 1) return `Sold ${uniqueNames[0]}`;
  return `Sold ${uniqueNames[0]} + ${uniqueNames.length - 1} more`;
}
