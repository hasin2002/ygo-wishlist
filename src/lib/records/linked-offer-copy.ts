export type LinkedOfferCopyKind = "individual" | "x2" | "x3";

type CardCopyIdentity = {
  condition: string;
  edition: string;
  name: string;
  rarity: string;
  setCode: string;
  setName: string;
};

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function editionTitle(value: string) {
  if (/limited/i.test(value)) return "Limited Ed";
  if (/unlimited/i.test(value)) return "Unlimited Ed";
  return "1st Ed";
}

function conditionTitle(value: string) {
  if (value === "Near Mint") return "NM";
  if (value === "Lightly Played") return "LP";
  if (value === "Moderately Played") return "MP";
  if (value === "Heavily Played") return "HP";
  return value;
}

function shorterRarity(value: string) {
  const normalized = compact(value);
  if (/quarter century secret rare/i.test(normalized)) return "QCSR";
  if (/prismatic secret rare/i.test(normalized)) return "Prismatic Secret";
  if (/collector'?s rare/i.test(normalized)) return "Collector's Rare";
  return normalized;
}

function titleBase(identity: CardCopyIdentity, available: number) {
  const brand = "Yu-Gi-Oh!";
  const name = compact(identity.name);
  const setCode = compact(identity.setCode);
  const rarity = compact(identity.rarity);
  const edition = editionTitle(identity.edition);
  const condition = conditionTitle(identity.condition);
  const candidates = [
    [brand, name, setCode, rarity, edition, condition],
    [brand, name, setCode, rarity, edition],
    [brand, name, setCode, rarity],
    [name, setCode, rarity],
    [name, setCode, shorterRarity(rarity)],
    [name, setCode],
  ].map((parts) => compact(parts.filter(Boolean).join(" ")));
  const fitting = candidates.find((candidate) => candidate.length <= available);
  if (fitting) return fitting;

  const setCodeSuffix = setCode ? ` ${setCode}` : "";
  const nameLimit = Math.max(1, available - setCodeSuffix.length);
  const slicedName = name.slice(0, nameLimit);
  const wholeName = slicedName.length === name.length
    ? slicedName
    : slicedName.replace(/\s+\S*$/, "").trimEnd() || slicedName.trimEnd();
  return `${wholeName}${setCodeSuffix}`.slice(0, available).trimEnd();
}

export function linkedOfferTitle(kind: LinkedOfferCopyKind, identity: CardCopyIdentity) {
  const suffix = kind === "individual" ? "Single Card" : `${kind === "x2" ? 2 : 3}-Card Set`;
  const available = 80 - suffix.length - 3;
  return `${titleBase(identity, available)} - ${suffix}`;
}

export function linkedOfferDescription(kind: LinkedOfferCopyKind, identity: CardCopyIdentity) {
  const setSize = kind === "x2" ? 2 : kind === "x3" ? 3 : 1;
  const lines = [
    identity.name,
    "",
    `Set: ${identity.setName || "Not specified"}${identity.setCode ? ` (${identity.setCode})` : ""}`,
    `Rarity: ${identity.rarity || "Not specified"}`,
    `Edition: ${identity.edition || "Not specified"}`,
    `Condition: ${identity.condition || "Not specified"} on every Copy`,
  ];
  if (kind !== "individual") lines.push(`Set size: ${setSize} matching Copies`);
  lines.push(
    "",
    kind === "individual"
      ? "The exact physical Copy you receive may differ from the Copy shown in the photos. The card name, Printing, set code, rarity, edition, and stated condition will match this listing."
      : "The exact physical Copies you receive may differ from those shown in the photos. Every Copy will match the card name, Printing, set code, rarity, edition, and stated condition in this listing.",
    "",
    "If you have any questions or would like photos of the currently available Copies, please send me a message.",
  );
  return lines.join("\n");
}
