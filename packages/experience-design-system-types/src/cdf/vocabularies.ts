export const CDF_PROPERTY_TYPES = ['string', 'richtext', 'media', 'link', 'enum', 'token', 'boolean'] as const;
export type CDFPropertyType = (typeof CDF_PROPERTY_TYPES)[number];

export const CDF_PROPERTY_CATEGORIES = ['content', 'design', 'state'] as const;
export type CDFPropertyCategory = (typeof CDF_PROPERTY_CATEGORIES)[number];
