function normalize(value: string) {
  return value.trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
}

/** One Records estimate per exact Printing and physical condition. */
export function cardPricingIdentityKey(card: {
  condition?: string | null;
  name: string;
  printingId?: string | null;
  setCode: string;
}) {
  const condition = normalize(card.condition || "Near Mint");
  return card.printingId
    ? `${card.printingId}::${condition}`
    : [normalize(card.name), normalize(card.setCode), condition].join("::");
}
