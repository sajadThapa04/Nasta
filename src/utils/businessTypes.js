// constants/businessTypes.js
export const BUSINESS_TYPE_GROUPS = {
  "Food & Drink": [
    "restaurant", "cafe", "bar", "bistro"
  ],
  Accommodation: [
    "hotel", "lodge", "home_stay", "luxury_villa"
  ],
  Retail: ["liquor-store"],
  Other: ["other"]
};

export const ALL_BUSINESS_TYPES = Object.values(BUSINESS_TYPE_GROUPS).flat();

export const getReadableBusinessTypeList = () => {
  return Object.entries(BUSINESS_TYPE_GROUPS).map(([category, types]) => `${category}: ${types.join(", ")}`).join("; ");
};