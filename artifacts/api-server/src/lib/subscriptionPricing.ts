/**
 * RevenueCat is the source of truth for subscription products, but the admin
 * MRR aggregate needs a quick price lookup that doesn't round-trip on every
 * request. We hard-code the SNAP Life products → monthly-equivalent price
 * (in pence) here. Update this map whenever a product is added or changed in
 * the RevenueCat dashboard.
 *
 * Pricing (effective current):
 *   SNAP Plus    → £4.99 / month (introductory 1-month free trial)
 *   SNAP Premium → £9.99 / month (introductory 1-month free trial)
 *
 * Annual plans have been removed. Only monthly products are offered.
 *
 * Convention:
 *   - All active product ids end in `_monthly`.
 *   - `monthlyCents` is in the smallest currency unit (pence for GBP).
 *   - Unknown products default to 0 so they don't pollute MRR; the admin
 *     metrics layer is a soft-fail surface (better to show £0 than 500).
 */
type Tier = "none" | "plus" | "premium";

interface ProductInfo {
  tier: Tier;
  /** Monthly price in pence (GBP). */
  monthlyCents: number;
}

const PRODUCT_TABLE: Record<string, ProductInfo> = {
  snaplife_plus_monthly: {
    tier: "plus",
    monthlyCents: 499,
  },
  snaplife_premium_monthly: {
    tier: "premium",
    monthlyCents: 999,
  },
};

export function tierFromProductId(
  productId: string | null | undefined,
): Tier {
  if (!productId) return "none";
  const info = PRODUCT_TABLE[productId];
  if (info) return info.tier;
  // Heuristic fallback so a forgotten table entry doesn't silently misclass
  // every Plus user as "none".
  if (productId.includes("premium")) return "premium";
  if (productId.includes("plus")) return "plus";
  return "none";
}

/**
 * Returns the monthly-equivalent price for one active subscriber in pence.
 * `periodType` is the RevenueCat periodType ("normal" | "trial" | "intro" |
 * etc) — only "normal" contributes to MRR; trials are free.
 */
export function monthlyPriceCents(
  productId: string | null | undefined,
  periodType: string | null | undefined,
): number {
  if (!productId) return 0;
  if (periodType && periodType !== "normal") return 0;
  const info = PRODUCT_TABLE[productId];
  return info?.monthlyCents ?? 0;
}
