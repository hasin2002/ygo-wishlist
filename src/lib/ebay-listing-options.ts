export const ebayCardCategory = {
  id: "183454",
  label: "Collectible Card Games — Individual Cards",
} as const;

export const ebayListingLanguages = ["English", "Japanese", "Korean"] as const;

export const ebayDeliveryServices = [
  {
    code: "UK_RoyalMailSecondClassStandard",
    label: "Royal Mail 2nd Class Large Letter",
    suggestedCostPence: 155,
  },
  {
    code: "UK_RoyalMailTracked",
    label: "Royal Mail Tracked 48",
    suggestedCostPence: 285,
  },
  {
    code: "UK_RoyalMailFirstClassStandard",
    label: "Royal Mail 1st Class Large Letter",
    suggestedCostPence: 320,
  },
  {
    code: "UK_RoyalMailNextDay",
    label: "Royal Mail Tracked 24",
    suggestedCostPence: 380,
  },
  {
    code: "UK_RoyalMailSpecialDeliveryNextDay",
    label: "Royal Mail Special Delivery Guaranteed by 1pm",
    suggestedCostPence: 945,
  },
] as const;

export type EbayListingLanguage = typeof ebayListingLanguages[number];
export type EbayDeliveryServiceCode = typeof ebayDeliveryServices[number]["code"];

export type EbayListingItemSpecifics = {
  cardNumber: string;
  cardSize: string;
  features: string;
  game: string;
  manufacturer: string;
  rarity: string;
  setName: string;
};
