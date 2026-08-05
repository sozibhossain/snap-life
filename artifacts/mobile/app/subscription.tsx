import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { PurchasesPackage } from "react-native-purchases";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  PLUS_ENTITLEMENT_IDENTIFIER,
  PREMIUM_ENTITLEMENT_IDENTIFIER,
  SNAP_PLUS_PACKAGE_IDS,
  findPackage,
  useSubscription,
} from "@/lib/revenuecat";
import { openManageSubscription } from "@/lib/manageSubscription";
import { BillingIssueBanner } from "@/components/BillingIssueBanner";

// Plan keys map 1:1 to RevenueCat package identifiers via SNAP_PLUS_PACKAGE_IDS.
//   "premium"      → SNAP Premium (£14.99/mo after 1-month free trial)
//   "plus_monthly" → SNAP Plus   (£6.99/mo after 1-month free trial)
// Both plans include a RevenueCat IAP introductory offer (1 month free).
// Payment details are required upfront; no charge until trial ends.
// Annual plans removed — monthly only.
// Default selection is Plus ("no forced upgrade").
type PlanKey = "founder_premium" | "premium" | "plus_monthly";

const PAYWALL_SCREENSHOT_PRICES =
  __DEV__ || process.env.EXPO_PUBLIC_PAYWALL_SCREENSHOT_PRICES === "true";

function expectedPlanPrice(plan: PlanKey): string {
  if (plan === "founder_premium") return "£9.99";
  if (plan === "premium") return "£14.99";
  return "£6.99";
}

function displayPlanPrice(plan: PlanKey, pkg?: PurchasesPackage): string {
  return PAYWALL_SCREENSHOT_PRICES
    ? expectedPlanPrice(plan)
    : pkg?.product.priceString ?? expectedPlanPrice(plan);
}

// Comparison table — drives the spec's Plus-vs-Premium feature grid. Each
// row marks Plus and Premium independently. `tone` controls colour:
//   "yes" → ✔ in tier accent     "no"  → ✖ muted
//   "lite"→ short label muted    "full"→ short label in tier accent
type CompCellTone = "yes" | "no" | "lite" | "full";
interface CompCell { tone: CompCellTone; label?: string }
interface CompRow {
  feature: string;
  plus: CompCell;
  premium: CompCell;
}
const COMPARISON_TABLE: CompRow[] = [
  { feature: "Breathing Studio",      plus: { tone: "lite", label: "Basic" },   premium: { tone: "full", label: "Full" } },
  { feature: "Meditation Library",    plus: { tone: "no" },                     premium: { tone: "full", label: "Full" } },
  { feature: "Bone Health Tracking",  plus: { tone: "lite", label: "Basic" },   premium: { tone: "full", label: "Full" } },
  { feature: "My Insights",           plus: { tone: "no" },                     premium: { tone: "yes" } },
  { feature: "Daily Check-In",        plus: { tone: "yes" },                    premium: { tone: "yes" } },
  { feature: "Mood Insights",         plus: { tone: "lite", label: "Basic" },   premium: { tone: "full", label: "Advanced" } },
  { feature: "Guided Programs",       plus: { tone: "no" },                     premium: { tone: "yes" } },
  { feature: "Smart Recommendations", plus: { tone: "no" },                     premium: { tone: "yes" } },
  { feature: "Meal Plans",            plus: { tone: "lite", label: "Core" },    premium: { tone: "full", label: "Personalised" } },
  { feature: "Bone Buddy",            plus: { tone: "lite", label: "Standard" },premium: { tone: "full", label: "Advanced AI" } },
];

function formatExpiry(iso?: string | null, timezone?: string | null) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      ...(timezone ? { timeZone: timezone } : {}),
    });
  } catch {
    return "";
  }
}

function isFounderProductId(productId?: string | null): boolean {
  return !!productId && productId.toLowerCase().includes("founder");
}

function activeEntitlementProductId(entitlement: unknown): string | null {
  const ent = entitlement as
    | {
        productIdentifier?: string;
        productId?: string;
        product?: { identifier?: string };
      }
    | null
    | undefined;
  return ent?.productIdentifier ?? ent?.productId ?? ent?.product?.identifier ?? null;
}

export default function SubscriptionScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const router = useRouter();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const {
    offering,
    isSubscribed,
    entitlement,
    customerInfo,
    tier,
    tierLabel,
    trialDayLabel,
    trialDaysRemaining,
    trialEndsAt,
    isLoading,
    error,
    purchase,
    isPurchasing,
    purchaseError,
    restore,
    isRestoring,
    refresh,
  } = useSubscription();

  // Resolve the two monthly plan packages from the current RevenueCat offering.
  // Annual plans have been removed — only monthly packages are shown.
  const founderPkg = useMemo(
    () => findPackage(offering, SNAP_PLUS_PACKAGE_IDS.founderPremium),
    [offering],
  );
  const premiumPkg = useMemo(
    () => findPackage(offering, SNAP_PLUS_PACKAGE_IDS.premium),
    [offering],
  );
  const monthlyPkg = useMemo(
    () => findPackage(offering, SNAP_PLUS_PACKAGE_IDS.monthly),
    [offering],
  );

  // Default selection: Founder Premium when it exists in the current offering.
  const [selected, setSelected] = useState<PlanKey>("founder_premium");

  useEffect(() => {
    if (selected !== "founder_premium") return;
    if (isLoading || founderPkg) return;
    if (premiumPkg) {
      setSelected("premium");
      return;
    }
    if (monthlyPkg) setSelected("plus_monthly");
  }, [selected, isLoading, founderPkg, premiumPkg, monthlyPkg]);

  const [confirmPkg, setConfirmPkg] = useState<PurchasesPackage | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);

  const selectedPkg =
    selected === "founder_premium"
      ? founderPkg
      : selected === "premium"
      ? premiumPkg
      : monthlyPkg;
  // Both plans include a 1-month free trial (RC IAP introductory offer).
  // Payment details are required upfront by the App Store / Google Play;
  // no charge until the 30-day trial period ends.
  const selectedIsPremium = selected === "premium" || selected === "founder_premium";
  const showTrialCopy = true;
  const trialLabel = "1 month free";
  const planFriendlyName =
    selected === "founder_premium"
      ? "Founder Premium"
      : selected === "premium"
      ? "SNAP Premium"
      : "SNAP Plus";

  // First payment date displayed in the confirm modal — 30 days from today.
  const firstPaymentDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }, []);

  // Human-readable trial end date from the server/RC expiration.
  const trialEndDate = useMemo(
    () => formatExpiry(trialEndsAt, user?.timezone),
    [trialEndsAt, user?.timezone],
  );
  const activeProductId = activeEntitlementProductId(entitlement);
  const isServerOnlyGrant =
    isSubscribed &&
    !entitlement &&
    (tier === "plus" || tier === "premium");

  // Billing amount for an active subscriber derived from live RC package prices.
  const billingAmount = useMemo(() => {
    if (!isSubscribed) return null;
    if (!entitlement && (tier === "plus" || tier === "premium")) return null;
    if (tier === "premium") {
      return isFounderProductId(activeProductId)
        ? displayPlanPrice("founder_premium", founderPkg)
        : displayPlanPrice("premium", premiumPkg);
    }
    if (tier === "plus") return displayPlanPrice("plus_monthly", monthlyPkg);
    if (tier === "trial") {
      const onPremiumTrial =
        !!customerInfo?.entitlements?.active?.[PREMIUM_ENTITLEMENT_IDENTIFIER];
      return onPremiumTrial
        ? (isFounderProductId(activeProductId)
            ? displayPlanPrice("founder_premium", founderPkg)
            : displayPlanPrice("premium", premiumPkg))
        : displayPlanPrice("plus_monthly", monthlyPkg);
    }
    return null;
  }, [tier, isSubscribed, entitlement, activeProductId, founderPkg, premiumPkg, monthlyPkg, customerInfo]);

  // Billing platform label (used in info rows and manage note).
  const billingPlatform =
    Platform.OS === "ios"
      ? "Apple App Store"
      : Platform.OS === "android"
      ? "Google Play"
      : "your app store";
  const upgradePremiumPkg = founderPkg ?? premiumPkg;
  const upgradePremiumPlan: PlanKey = founderPkg ? "founder_premium" : "premium";
  const upgradePremiumName = founderPkg ? "Founder Premium" : "SNAP Premium";
  const upgradePremiumPrice =
    displayPlanPrice(upgradePremiumPlan, upgradePremiumPkg);

  function startCheckout() {
    if (!selectedPkg) return;
    setConfirmPkg(selectedPkg);
  }

  async function confirmPurchase() {
    if (!confirmPkg) return;
    try {
      await purchase(confirmPkg);
      setConfirmPkg(null);
      setSuccessOpen(true);
    } catch (e: any) {
      if (e?.userCancelled || e?.code === "PURCHASE_CANCELLED") {
        setConfirmPkg(null);
        return;
      }
      // Keep modal open so the user sees the error message below the button.
    }
  }

  function handleOpenManageSubscription() {
    Alert.alert(
      "Before you go",
      "Would you like to share some feedback first? It only takes a moment and helps us improve SNAP Life.",
      [
        {
          text: "Share feedback",
          onPress: () => router.push("/feedback" as any),
        },
        {
          text: "Manage subscription",
          style: "destructive",
          onPress: () =>
            openManageSubscription({
              managementUrl: customerInfo?.managementURL,
              purchaseStore: entitlement?.store,
            }),
        },
        { text: "Cancel", style: "cancel" },
      ],
    );
  }

  async function handleRestore() {
    try {
      const info = await restore();
      const isActive =
        !!info?.entitlements?.active?.[PREMIUM_ENTITLEMENT_IDENTIFIER] ||
        !!info?.entitlements?.active?.[PLUS_ENTITLEMENT_IDENTIFIER];
      if (isActive) {
        Alert.alert("Restored", "Your SNAP subscription has been restored.");
      } else {
        Alert.alert(
          "Nothing to restore",
          "We couldn't find an active SNAP subscription on this account.",
        );
      }
    } catch (e: any) {
      Alert.alert("Restore failed", e?.message ?? "Please try again in a moment.");
    }
  }

  // -- Render -----------------------------------------------------------

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Subscription</Text>
        <Pressable onPress={handleRestore} hitSlop={10} disabled={isRestoring}>
          <Text style={[styles.restoreLink, { color: colors.primary }]}>
            {isRestoring ? "..." : "Restore"}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Billing-issue grace banner — payment failed but access still
            granted until gracePeriodEndsAt. Same component as the
            dashboard so users see a consistent message everywhere. */}
        <BillingIssueBanner />

        {/* Active subscription state ------------------------------------ */}
        {isSubscribed ? (
          <>
            <View style={[styles.activeCard, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "40" }]}>
              {/* Header row */}
              <View style={styles.activeCardHeader}>
                <View style={[styles.activeIcon, { backgroundColor: tier === "trial" ? colors.accent : colors.primary }]}>
                  <Feather name={tier === "trial" ? "clock" : "check"} size={18} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.activeTitle, { color: colors.foreground }]}>
                    {tier === "trial" ? "Free Trial Active" : `SNAP ${tierLabel}`}
                  </Text>
                  {tier === "trial" && trialDayLabel && (
                    <Text style={[styles.trialDayText, { color: colors.accent }]}>
                      {trialDayLabel}
                      {trialDaysRemaining !== null ? `  ·  ${trialDaysRemaining} day${trialDaysRemaining === 1 ? "" : "s"} left` : ""}
                    </Text>
                  )}
                </View>
              </View>

              {/* Trial info block */}
              {tier === "trial" ? (
                <View style={[styles.infoBlock, { borderColor: colors.border }]}>
                  {trialEndDate ? (
                    <View style={styles.infoRow}>
                      <Feather name="calendar" size={13} color={colors.mutedForeground} />
                      <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Trial ends</Text>
                      <Text style={[styles.infoValue, { color: colors.foreground }]}>{trialEndDate}</Text>
                    </View>
                  ) : null}
                  {billingAmount ? (
                    <View style={styles.infoRow}>
                      <Feather name="credit-card" size={13} color={colors.mutedForeground} />
                      <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>First payment</Text>
                      <Text style={[styles.infoValue, { color: colors.foreground }]}>
                        {trialEndDate || firstPaymentDate} · {billingAmount}/mo
                      </Text>
                    </View>
                  ) : null}
                  <View style={[styles.noChargeRow, { backgroundColor: colors.primary + "15" }]}>
                    <Feather name="shield" size={12} color={colors.primary} />
                    <Text style={[styles.noChargeText, { color: colors.primary }]}>
                      No charge today · Cancel before your trial ends and you won't be billed
                    </Text>
                  </View>
                </View>
              ) : isServerOnlyGrant ? (
                <View style={[styles.infoBlock, { borderColor: colors.border }]}>
                  <View style={styles.infoRow}>
                    <Feather name="gift" size={13} color={colors.mutedForeground} />
                    <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Access</Text>
                    <Text style={[styles.infoValue, { color: colors.foreground }]}>No expiry</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Feather name="credit-card" size={13} color={colors.mutedForeground} />
                    <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Billing</Text>
                    <Text style={[styles.infoValue, { color: colors.foreground }]}>Promotional</Text>
                  </View>
                </View>
              ) : (
                /* Paid plan info block */
                <View style={[styles.infoBlock, { borderColor: colors.border }]}>
                  <View style={styles.infoRow}>
                    <Feather name="refresh-cw" size={13} color={colors.mutedForeground} />
                    <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>
                      {entitlement?.willRenew ? "Renews" : "Access until"}
                    </Text>
                    <Text style={[styles.infoValue, { color: colors.foreground }]}>
                      {formatExpiry(entitlement?.expirationDate, user?.timezone) || "—"}
                    </Text>
                  </View>
                  {billingAmount ? (
                    <View style={styles.infoRow}>
                      <Feather name="credit-card" size={13} color={colors.mutedForeground} />
                      <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Plan</Text>
                      <Text style={[styles.infoValue, { color: colors.foreground }]}>{billingAmount}/month</Text>
                    </View>
                  ) : null}
                  <View style={styles.infoRow}>
                    <Feather name="smartphone" size={13} color={colors.mutedForeground} />
                    <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Billing</Text>
                    <Text style={[styles.infoValue, { color: colors.foreground }]}>{billingPlatform}</Text>
                  </View>
                </View>
              )}

              {/* Manage button — only meaningful when there is a real store
                  entitlement (IAP trial or paid plan). Server-trial users
                  have nothing in the App Store / Play Store to manage. */}
              {entitlement ? (
                <>
                  <Pressable
                    style={[styles.manageBtn, { borderColor: colors.primary }]}
                    onPress={handleOpenManageSubscription}
                  >
                    <Feather name="external-link" size={14} color={colors.primary} />
                    <Text style={[styles.manageBtnText, { color: colors.primary }]}>Manage subscription</Text>
                  </Pressable>
                  <Text style={[styles.manageNote, { color: colors.mutedForeground }]}>
                    {entitlement.willRenew
                      ? `Cancellation and renewal are handled by ${billingPlatform}. Your access continues until the end of your billing period.`
                      : "Your subscription won't renew. Access continues until the date shown above."}
                  </Text>
                </>
              ) : (
                <Text style={[styles.manageNote, { color: colors.mutedForeground }]}>
                  {isServerOnlyGrant
                    ? "Your promotional access is active. No payment or renewal is required."
                    : "Add payment details before your trial ends to keep your access."}
                </Text>
              )}
            </View>

            {/* Upgrade to Premium — shown when on Plus or Trial so the user
                can move up without leaving the app. Downgrade/cancel still
                routes to the store (Apple/Google mandate this). */}
            {(tier === "plus" || tier === "trial") && (
              <View style={[styles.upgradeCard, { backgroundColor: colors.accent + "0D", borderColor: colors.accent + "35" }]}>
                <View style={styles.upgradeHeader}>
                  <View style={[styles.upgradeIconWrap, { backgroundColor: colors.accent + "20" }]}>
                    <Feather name="zap" size={15} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.upgradeTitle, { color: colors.foreground }]}>
                      {tier === "trial" ? "Choosing your plan?" : `Upgrade to ${upgradePremiumName}`}
                    </Text>
                    <Text style={[styles.upgradeSub, { color: colors.mutedForeground }]}>
                      {tier === "trial"
                        ? "Unlock the full experience before your trial ends."
                        : `Everything in Plus — personalised AI, guided programs & more.`}
                    </Text>
                  </View>
                </View>
                {[
                  "Advanced AI coaching — personalised to your journey",
                  "Full Meditation & Breathing Library",
                  "Guided Programs (9 Pathways)",
                  "Smart Recommendations & Insights",
                  "Personalised Meal Plans",
                ].map((b) => (
                  <View key={b} style={styles.upgradeBenefit}>
                    <Feather name="check" size={12} color={colors.accent} />
                    <Text style={[styles.upgradeBenefitText, { color: colors.mutedForeground }]}>{b}</Text>
                  </View>
                ))}
                <Pressable
                  style={[
                    styles.upgradeCta,
                    {
                      backgroundColor: colors.accent,
                      opacity: !upgradePremiumPkg || isPurchasing ? 0.6 : 1,
                    },
                  ]}
                  onPress={
                    upgradePremiumPkg
                      ? () => {
                          setSelected(upgradePremiumPlan);
                          setConfirmPkg(upgradePremiumPkg);
                        }
                      : undefined
                  }
                  disabled={!upgradePremiumPkg || isPurchasing}
                >
                  {isPurchasing ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.upgradeCtaText}>
                      {tier === "trial"
                        ? `Go ${upgradePremiumName} — ${upgradePremiumPrice}/mo after trial`
                        : `Upgrade — ${upgradePremiumPrice}/mo`}
                    </Text>
                  )}
                </Pressable>
              </View>
            )}

            {/* What's included — benefits reminder for active subscribers */}
            <View style={[styles.benefitsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.featuresHeading, { color: colors.foreground }]}>What's included</Text>
              {(tier === "premium" || tier === "trial"
                ? [
                    { icon: "check-circle" as const, text: "Daily Bone Health Check-In" },
                    { icon: "check-circle" as const, text: "Breathing Studio & Meditation Library (full)" },
                    { icon: "check-circle" as const, text: "Personalised AI Coaching (Bone Buddy Advanced)" },
                    { icon: "check-circle" as const, text: "Guided Programs — 9 Pathways" },
                    { icon: "check-circle" as const, text: "Smart Recommendations & DEXA Insights" },
                    { icon: "check-circle" as const, text: "Personalised Meal Plans" },
                    { icon: "check-circle" as const, text: "DEXA Scan & FRAX Tracking" },
                  ]
                : [
                    { icon: "check-circle" as const, text: "Daily Bone Health Check-In" },
                    { icon: "check-circle" as const, text: "Breathing Studio (basics)" },
                    { icon: "check-circle" as const, text: "Core Meal Plans" },
                    { icon: "check-circle" as const, text: "Bone Buddy AI (standard)" },
                    { icon: "check-circle" as const, text: "Basic Bone Health & DEXA Tracking" },
                  ]
              ).map(({ icon, text }) => (
                <View key={text} style={styles.benefitRow}>
                  <Feather name={icon} size={14} color={colors.primary} />
                  <Text style={[styles.benefitText, { color: colors.foreground }]}>{text}</Text>
                </View>
              ))}
            </View>
          </>
        ) : isLoading ? (
          <View style={styles.heroBlock}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
              Checking your subscription…
            </Text>
          </View>
        ) : (
          <View style={styles.heroBlock}>
            <View style={[styles.trialPill, { backgroundColor: colors.accent + "20" }]}>
              <Feather name="zap" size={13} color={colors.accent} />
              <Text style={[styles.trialPillText, { color: colors.accent }]}>
                {trialLabel} · full access · cancel anytime
              </Text>
            </View>
            <Text style={[styles.heroTitle, { color: colors.foreground }]}>
              Start your free month today
            </Text>
            <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
              Full access to every feature. No charge today — cancel before your first payment and you'll never be billed.
            </Text>
          </View>
        )}

        {/* Plan cards — Premium first (MOST POPULAR), Plus below (default).
              Both plans include a 1-month free trial. Annual plans removed. */}
        {!isSubscribed && !isLoading && (
          <View style={{ gap: 12 }}>
            {/* FOUNDER PREMIUM - full Premium access at founding member price */}
            <PlanCard
              variant="premium"
              selected={selected === "founder_premium"}
              onPress={() => setSelected("founder_premium")}
              disabled={!founderPkg && !isLoading}
              loading={isLoading && !founderPkg}
              colors={colors}
              title="Founder Premium"
              priceMain={displayPlanPrice("founder_premium", founderPkg)}
              priceSub="/month after free trial"
              note="Full Premium access at founding member pricing"
              badge="FOUNDERS"
            />

            {/* PREMIUM — full-featured plan */}
            <PlanCard
              variant="premium"
              selected={selected === "premium"}
              onPress={() => setSelected("premium")}
              loading={isLoading && !premiumPkg}
              colors={colors}
              title="SNAP Premium"
              priceMain={displayPlanPrice("premium", premiumPkg)}
              priceSub="/month after free trial"
              note="Everything in Plus — personalised AI coaching, guided programs, advanced insights"
              badge="MOST POPULAR"
            />

            {/* PLUS — entry monthly plan, default selection */}
            <PlanCard
              variant="plus"
              selected={selected === "plus_monthly"}
              onPress={() => setSelected("plus_monthly")}
              loading={isLoading && !monthlyPkg}
              colors={colors}
              title="SNAP Plus"
              priceMain={displayPlanPrice("plus_monthly", monthlyPkg)}
              priceSub="/month after free trial"
              note="Essential daily tools — breathing basics, check-ins and core meal plans"
            />
          </View>
        )}

        {/* Comparison table — Plus vs Premium feature grid (per spec). */}
        <View style={[styles.featuresCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.featuresHeading, { color: colors.foreground }]}>
            Compare plans
          </Text>
          <View style={[styles.compHeaderRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.compHeaderFeature, { color: colors.mutedForeground }]}>Feature</Text>
            <Text style={[styles.compHeaderTier, { color: colors.primary }]}>Plus</Text>
            <Text style={[styles.compHeaderTier, { color: colors.accent }]}>Premium</Text>
          </View>
          {COMPARISON_TABLE.map((row, i) => (
            <View
              key={row.feature}
              style={[
                styles.compRow,
                i < COMPARISON_TABLE.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.border,
                },
              ]}
            >
              <Text style={[styles.compFeature, { color: colors.foreground }]}>{row.feature}</Text>
              <View style={styles.compCell}>
                <CompCellView cell={row.plus} accent={colors.primary} mutedColor={colors.mutedForeground} />
              </View>
              <View style={styles.compCell}>
                <CompCellView cell={row.premium} accent={colors.accent} mutedColor={colors.mutedForeground} />
              </View>
            </View>
          ))}
        </View>

        {/* CTA ---------------------------------------------------------- */}
        {!isSubscribed && !isLoading && (
          <View style={styles.ctaBlock}>
            {Platform.OS === "web" ? (
              // Web Billing is out of scope for the PWA milestone. Replace
              // the purchase button with a friendly cross-promo so users
              // never tap a broken in-app purchase flow.
              <View
                style={[
                  styles.ctaBtn,
                  {
                    backgroundColor: colors.muted,
                    paddingVertical: 18,
                  },
                ]}
              >
                <Text
                  style={[styles.ctaBtnText, { color: colors.foreground }]}
                >
                  Subscribe in the SNAP Life mobile app
                </Text>
              </View>
            ) : (
              <>
                {error && (
                  <Text style={[styles.errorText, { color: colors.destructive }]}>
                    Couldn't load plans. Tap below to try again.
                  </Text>
                )}
                <Pressable
                  style={[
                    styles.ctaBtn,
                    {
                      backgroundColor: selectedIsPremium ? colors.accent : colors.primary,
                      opacity: !selectedPkg || isPurchasing ? 0.6 : 1,
                    },
                  ]}
                  onPress={selectedPkg ? startCheckout : refresh}
                  disabled={isPurchasing}
                >
                  {isPurchasing ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.ctaBtnText}>
                      {selectedPkg
                        ? `Start free trial — ${planFriendlyName}`
                        : "Reload plans"}
                    </Text>
                  )}
                </Pressable>
              </>
            )}
            <Text style={[styles.ctaNote, { color: colors.mutedForeground }]}>
              {Platform.OS === "web"
                ? "In-app purchases run through the App Store / Play Store. Open SNAP Life on your phone to start a trial — your account will sync automatically."
                : `No charge today · Payment details stored securely by ${Platform.OS === "ios" ? "Apple" : "Google"} · First payment ${firstPaymentDate} unless cancelled`}
            </Text>
          </View>
        )}

        <View style={[styles.footerRow, { borderColor: colors.border }]}>
          <Feather name="shield" size={15} color={colors.mutedForeground} />
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            GDPR compliant · Your data is always yours
          </Text>
        </View>

        <Pressable
          style={styles.helpLink}
          onPress={() => router.push("/settings/help" as any)}
          accessibilityRole="button"
        >
          <Feather name="help-circle" size={14} color={colors.mutedForeground} />
          <Text style={[styles.helpLinkText, { color: colors.mutedForeground }]}>
            Questions about billing? Visit Help & Support
          </Text>
        </Pressable>

        {customerInfo?.originalAppUserId && (
          <Text style={[styles.userIdText, { color: colors.mutedForeground }]}>
            Account: {customerInfo.originalAppUserId.slice(0, 12)}…
          </Text>
        )}
      </ScrollView>

      {/* Confirm purchase modal --------------------------------------- */}
      <Modal
        visible={!!confirmPkg}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmPkg(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View
              style={[
                styles.modalIcon,
                { backgroundColor: (selectedIsPremium ? colors.accent : colors.primary) + "18" },
              ]}
            >
              <Feather
                name="zap"
                size={20}
                color={selectedIsPremium ? colors.accent : colors.primary}
              />
            </View>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              Confirm your subscription
            </Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
              {confirmPkg
                ? `${planFriendlyName} — 1 month free, then ${confirmPkg.product.priceString}/month.\n\nNo charge today. First payment on ${firstPaymentDate}. Cancel anytime in your app store settings before that date and you won't be billed.`
                : ""}
            </Text>
            {purchaseError && (
              <Text style={[styles.modalError, { color: colors.destructive }]}>
                {purchaseError.message || "Purchase failed. Please try again."}
              </Text>
            )}
            <View style={styles.modalBtnRow}>
              <Pressable
                style={[styles.modalBtnSecondary, { borderColor: colors.border }]}
                onPress={() => setConfirmPkg(null)}
                disabled={isPurchasing}
              >
                <Text style={[styles.modalBtnSecondaryText, { color: colors.foreground }]}>
                  Not now
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalBtnPrimary,
                  {
                    backgroundColor: selectedIsPremium ? colors.accent : colors.primary,
                    opacity: isPurchasing ? 0.6 : 1,
                  },
                ]}
                onPress={confirmPurchase}
                disabled={isPurchasing}
              >
                {isPurchasing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalBtnPrimaryText}>Confirm</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Success modal ------------------------------------------------- */}
      <Modal
        visible={successOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSuccessOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.modalIcon, { backgroundColor: colors.primary }]}>
              <Feather name="check" size={20} color="#fff" />
            </View>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              Welcome to {planFriendlyName}
            </Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
              You're all set. Every feature is unlocked for your free month.
              {` First payment on ${firstPaymentDate} — cancel anytime before then.`}
            </Text>
            <Pressable
              style={[
                styles.modalBtnPrimary,
                { backgroundColor: colors.primary, alignSelf: "stretch", marginTop: 8 },
              ]}
              onPress={() => {
                setSuccessOpen(false);
                router.back();
              }}
            >
              <Text style={styles.modalBtnPrimaryText}>Start exploring</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// -- CompCellView -------------------------------------------------------
// Renders a single Plus / Premium comparison cell (✔ / ✖ / labelled tone).
function CompCellView({
  cell,
  accent,
  mutedColor,
}: {
  cell: CompCell;
  accent: string;
  mutedColor: string;
}) {
  if (cell.tone === "yes") {
    return <Feather name="check" size={16} color={accent} />;
  }
  if (cell.tone === "no") {
    return <Feather name="x" size={16} color={mutedColor} />;
  }
  // "lite" → muted label, "full" → tier-accent label
  return (
    <Text
      style={{
        fontSize: 11,
        fontFamily: cell.tone === "full" ? "Inter_700Bold" : "Inter_500Medium",
        color: cell.tone === "full" ? accent : mutedColor,
        textAlign: "center",
      }}
      numberOfLines={1}
    >
      {cell.label}
    </Text>
  );
}

// -- PlanCard -----------------------------------------------------------

interface PlanCardProps {
  variant: "premium" | "plus";
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  title: string;
  priceMain: string;
  priceSub: string;
  note: string;
  badge?: string;
  comingSoon?: boolean;
  colors: ReturnType<typeof useColors>;
}

function PlanCard({
  variant,
  selected,
  onPress,
  disabled,
  loading,
  title,
  priceMain,
  priceSub,
  note,
  badge,
  comingSoon,
  colors,
}: PlanCardProps) {
  const accent = variant === "premium" ? colors.accent : colors.primary;
  const borderColor = selected ? accent : colors.border;
  const bg = selected ? accent + "0E" : colors.card;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || comingSoon}
      style={[
        styles.planCard,
        {
          backgroundColor: bg,
          borderColor,
          borderWidth: selected ? 2 : 1,
          opacity: disabled || comingSoon ? 0.6 : 1,
        },
      ]}
    >
      {badge && !comingSoon && (
        <View style={[styles.planBadge, { backgroundColor: accent }]}>
          <Text style={styles.planBadgeText}>{badge}</Text>
        </View>
      )}
      {comingSoon && (
        <View style={[styles.planBadge, { backgroundColor: colors.mutedForeground }]}>
          <Text style={styles.planBadgeText}>COMING SOON</Text>
        </View>
      )}
      <View style={styles.planTopRow}>
        <View style={[styles.radio, { borderColor: selected ? accent : colors.border }]}>
          {selected && <View style={[styles.radioDot, { backgroundColor: accent }]} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.planTitle, { color: colors.foreground }]}>{title}</Text>
          <Text style={[styles.planNote, { color: colors.mutedForeground }]}>{note}</Text>
        </View>
        <View style={styles.planPriceBlock}>
          {loading ? (
            <ActivityIndicator size="small" color={accent} />
          ) : (
            <>
              <Text style={[styles.planPriceMain, { color: accent }]}>{priceMain}</Text>
              <Text style={[styles.planPriceSub, { color: colors.mutedForeground }]}>{priceSub}</Text>
            </>
          )}
        </View>
      </View>
    </Pressable>
  );
}

// -- Styles -------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  restoreLink: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  content: { padding: 16, gap: 16 },

  heroBlock: { alignItems: "center", gap: 10, paddingVertical: 8 },
  trialPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
  },
  trialPillText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  heroTitle: { fontSize: 26, fontFamily: "Inter_700Bold", textAlign: "center", lineHeight: 34 },
  heroSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },

  activeCard: {
    borderRadius: 16, borderWidth: 1, padding: 18, gap: 12,
  },
  activeCardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  activeIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
  },
  activeTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  trialDayText: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  infoBlock: {
    borderRadius: 10, borderWidth: 1, overflow: "hidden", gap: 0,
  },
  infoRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "transparent",
  },
  infoLabel: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  infoValue: { fontSize: 12, fontFamily: "Inter_600SemiBold", textAlign: "right", flexShrink: 1 },
  noChargeRow: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  noChargeText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1, lineHeight: 17 },
  manageBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1,
  },
  manageBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  manageNote: {
    fontSize: 11, fontFamily: "Inter_400Regular",
    textAlign: "center", lineHeight: 16,
  },

  upgradeCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 10 },
  upgradeHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  upgradeIconWrap: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: "center", justifyContent: "center",
  },
  upgradeTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  upgradeSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 17 },
  upgradeBenefit: { flexDirection: "row", alignItems: "center", gap: 8 },
  upgradeBenefitText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  upgradeCta: {
    height: 46, borderRadius: 12,
    alignItems: "center", justifyContent: "center", marginTop: 2,
  },
  upgradeCtaText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },

  benefitsCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 8 },
  benefitRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  benefitText: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },

  planCard: {
    borderRadius: 16,
    padding: 16,
    paddingTop: 18,
    position: "relative",
  },
  planBadge: {
    position: "absolute",
    top: -10,
    right: 16,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  planBadgeText: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  planTopRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  planTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  planNote: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  planPriceBlock: { flexDirection: "row", alignItems: "flex-end", minWidth: 90, justifyContent: "flex-end" },
  planPriceMain: { fontSize: 18, fontFamily: "Inter_700Bold" },
  planPriceSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginBottom: 2, marginLeft: 1 },

  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },

  featuresCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 6 },
  featuresHeading: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 4 },
  compHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 8,
    borderBottomWidth: 1,
  },
  compHeaderFeature: { flex: 2, fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.3, textTransform: "uppercase" },
  compHeaderTier:    { flex: 1, fontSize: 11, fontFamily: "Inter_700Bold",    letterSpacing: 0.3, textTransform: "uppercase", textAlign: "center" },
  compRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  compFeature: { flex: 2, fontSize: 13, fontFamily: "Inter_500Medium" },
  compCell:    { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 22 },

  ctaBlock: { gap: 10 },
  ctaBtn: {
    height: 54, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  ctaBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
  ctaNote: {
    fontSize: 12, fontFamily: "Inter_400Regular",
    textAlign: "center", lineHeight: 18,
  },
  errorText: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center" },

  footerRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 14, borderRadius: 12, borderWidth: 1,
  },
  footerText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  helpLink: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 4,
  },
  helpLinkText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  userIdText: { fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: -8 },

  modalBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center", justifyContent: "center", padding: 20,
  },
  modalCard: {
    width: "100%", maxWidth: 380, borderRadius: 18, borderWidth: 1,
    padding: 22, gap: 12, alignItems: "center",
  },
  modalIcon: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
  },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  modalBody: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
  modalError: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center" },
  modalBtnRow: { flexDirection: "row", gap: 10, alignSelf: "stretch", marginTop: 4 },
  modalBtnSecondary: {
    flex: 1, height: 46, borderRadius: 12, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  modalBtnSecondaryText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  modalBtnPrimary: {
    flex: 1, height: 46, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  modalBtnPrimaryText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
});
