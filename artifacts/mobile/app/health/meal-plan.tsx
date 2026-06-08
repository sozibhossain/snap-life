
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { useAuth } from "@/context/AuthContext";
import { useHealth } from "@/context/HealthContext";
import { useNutrition } from "@/context/NutritionContext";
import { useColors } from "@/hooks/useColors";
import { fetchEngagementProfile } from "@/lib/engagementProfile";
import {
  GUIDES,
  RECIPES,
  type MealType,
  type Recipe,
} from "@/lib/nutritionData";
import {
  SMART_FOOD_CONTEXT_LABEL,
  getSmartFoodSuggestions,
  prioritiseSmartFood,
  type SmartFoodContext,
} from "@/lib/smartFood";
import type { BehaviouralStats } from "@/lib/behaviouralStats";

type TabKey = "today" | "favourites" | "guides";

const MEAL_ORDER: MealType[] = ["breakfast", "lunch", "dinner", "snack"];
const MEAL_ICONS: Record<MealType, keyof typeof Feather.glyphMap> = {
  breakfast: "coffee",
  lunch: "sun",
  dinner: "moon",
  snack: "star",
};

const PORTION_OPTIONS: { value: number; label: string }[] = [
  { value: 0.5, label: "½" },
  { value: 1, label: "1" },
  { value: 1.5, label: "1½" },
  { value: 2, label: "2" },
];
const DEFAULT_PORTION = 1;

export default function MealPlanScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const {
    preferences,
    plan,
    targets,
    totals,
    supplements,
    favourites,
    isFavourite,
    toggleFavourite,
    setPreferences,
    regenerate,
    swapMeal,
    recipeFor,
  } = useNutrition();
  const { todayNutrition, markMealEaten } = useHealth();
  // Use the nullable references directly as effect deps so a render
  // where `todayNutrition` is null doesn't keep flipping the
  // identity of an inline `?? {}` fallback (which would re-run the
  // sync effect on every render).
  const persistedCompleted = todayNutrition?.mealsCompleted;
  const persistedPortions = todayNutrition?.mealPortions;
  const mealsCompleted = persistedCompleted ?? {};

  const [activeTab, setActiveTab] = useState<TabKey>("today");
  const [smartContext, setSmartContext] = useState<SmartFoodContext>("home");
  // Per-slot portion the user has selected on the stepper. For ticked
  // slots this mirrors what's stored on the log so refreshes /
  // navigation away-and-back keep the right portion highlighted. For
  // unticked slots it tracks the user's pending choice (defaulting to
  // 1) without yet writing anything to the log.
  const [portions, setPortions] = useState<Record<MealType, number>>({
    breakfast: DEFAULT_PORTION,
    lunch: DEFAULT_PORTION,
    dinner: DEFAULT_PORTION,
    snack: DEFAULT_PORTION,
  });

  // Sync the stepper to the persisted log whenever it changes:
  //   - A ticked slot mirrors the portion that was applied (so refresh
  //     / nav-away keeps the right pill highlighted).
  //   - An un-ticked slot snaps back to the default 1× pill so the
  //     next "I ate this" tap applies a sensible default rather than
  //     silently re-using whatever the user picked the previous time
  //     (which surprised users — they expected un-eating to reset).
  useEffect(() => {
    setPortions((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const slot of MEAL_ORDER) {
        const stored = persistedPortions?.[slot];
        const desired = persistedCompleted?.[slot]
          ? typeof stored === "number"
            ? stored
            : DEFAULT_PORTION
          : DEFAULT_PORTION;
        if (next[slot] !== desired) {
          next[slot] = desired;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [persistedCompleted, persistedPortions]);

  const todayLabel = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const mealColors: Record<MealType, string> = {
    breakfast: colors.xpGold,
    lunch: colors.primary,
    dinner: colors.accent,
    snack: colors.success,
  };

  const targetMetrics = [
    { key: "calcium", label: "Calcium", value: totals.calcium, target: targets.calcium, unit: "mg", color: colors.primary },
    { key: "vitaminD", label: "Vitamin D", value: totals.vitaminD, target: targets.vitaminD, unit: "IU", color: colors.xpGold },
    { key: "protein", label: "Protein", value: totals.protein, target: targets.protein, unit: "g", color: colors.accent },
    { key: "magnesium", label: "Magnesium", value: totals.magnesium, target: targets.magnesium, unit: "mg", color: colors.success },
  ] as const;

  function openRecipe(id: string) {
    router.push(`/recipe/${id}` as any);
  }

  function openGuide(id: string) {
    router.push(`/nutrition-guide/${id}` as any);
  }

  async function onRegenerate() {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    await regenerate();
  }

  async function onSwap(mealType: MealType) {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    await swapMeal(mealType);
  }

  function contributionFor(recipe: Recipe) {
    return {
      calcium: recipe.calcium,
      vitaminD: recipe.vitD,
      protein: recipe.protein,
      magnesium: recipe.magnesium,
      calories: recipe.calories,
      recipeName: recipe.name,
    };
  }

  async function onMarkEaten(mealType: MealType, recipe: Recipe) {
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
    }
    await markMealEaten(
      mealType,
      contributionFor(recipe),
      portions[mealType] ?? DEFAULT_PORTION,
    );
  }

  async function onPortionChange(
    mealType: MealType,
    recipe: Recipe,
    portion: number,
  ) {
    const isEaten = !!mealsCompleted[mealType];
    const currentPortion = portions[mealType];
    if (isEaten && currentPortion === portion) return;
    setPortions((p) => ({ ...p, [mealType]: portion }));
    if (!isEaten) return;
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    await markMealEaten(mealType, contributionFor(recipe), portion);
  }

  async function onTogglePref(key: keyof typeof preferences) {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    await setPreferences({ ...preferences, [key]: !preferences[key] });
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ---- Header --------------------------------------------------- */}
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Meal Plan</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>{todayLabel}</Text>
        </View>
        <View style={[styles.aiChip, { backgroundColor: colors.primary + "18" }]}>
          <Feather name="cpu" size={12} color={colors.primary} />
          <Text style={[styles.aiChipText, { color: colors.primary }]}>Personalised</Text>
        </View>
      </View>

      {/* ---- Top tabs ------------------------------------------------- */}
      <View style={[styles.tabRow, { borderBottomColor: colors.border }]}>
        {(["today", "favourites", "guides"] as TabKey[]).map((tab) => (
          <Pressable key={tab} style={styles.tabBtn} onPress={() => setActiveTab(tab)}>
            <Text
              style={[
                styles.tabBtnText,
                {
                  color: activeTab === tab ? colors.primary : colors.mutedForeground,
                  fontFamily: activeTab === tab ? "Inter_600SemiBold" : "Inter_400Regular",
                },
              ]}
            >
              {tab === "today" ? "Today" : tab === "favourites" ? "Favourites" : "Guides"}
            </Text>
            {activeTab === tab && (
              <View style={[styles.tabUnderline, { backgroundColor: colors.primary }]} />
            )}
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ============ TODAY ============ */}
        {activeTab === "today" && (
          <>
            {/* "Logged today" running totals strip — shows what's actually
                been credited to today's NutritionLog (via meal-plan ticks
                or manual entries on the Log Nutrition screen). Distinct
                from the "daily targets" card below, which compares
                static plan recipes to targets. */}
            <Card variant="outlined" style={styles.loggedStripCard}>
              <View style={styles.loggedStripHeader}>
                <Feather name="check-circle" size={13} color={colors.success} />
                <Text style={[styles.loggedStripTitle, { color: colors.foreground }]}>
                  Logged today
                </Text>
                <Text style={[styles.loggedStripSub, { color: colors.mutedForeground }]}>
                  from meal plan + manual
                </Text>
              </View>
              <View style={styles.loggedStripRow}>
                <View style={styles.loggedStripCell}>
                  <Text style={[styles.loggedStripValue, { color: colors.primary }]}>
                    {Math.round(todayNutrition?.calcium ?? 0)}
                    <Text style={[styles.loggedStripUnit, { color: colors.mutedForeground }]}> mg Ca</Text>
                  </Text>
                </View>
                <View style={styles.loggedStripCell}>
                  <Text style={[styles.loggedStripValue, { color: colors.xpGold }]}>
                    {Math.round(todayNutrition?.vitaminD ?? 0)}
                    <Text style={[styles.loggedStripUnit, { color: colors.mutedForeground }]}> IU D</Text>
                  </Text>
                </View>
                <View style={styles.loggedStripCell}>
                  <Text style={[styles.loggedStripValue, { color: colors.accent }]}>
                    {Math.round(todayNutrition?.protein ?? 0)}
                    <Text style={[styles.loggedStripUnit, { color: colors.mutedForeground }]}> g Pro</Text>
                  </Text>
                </View>
                <View style={styles.loggedStripCell}>
                  <Text style={[styles.loggedStripValue, { color: colors.success }]}>
                    {Math.round(todayNutrition?.magnesium ?? 0)}
                    <Text style={[styles.loggedStripUnit, { color: colors.mutedForeground }]}> mg Mg</Text>
                  </Text>
                </View>
              </View>
            </Card>

            {/* Targets vs progress */}
            <Card variant="elevated" style={styles.targetsCard}>
              <View style={styles.targetsHeader}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                  Your daily targets
                </Text>
                <Pressable
                  onPress={onRegenerate}
                  style={[styles.regenBtn, { backgroundColor: colors.primary + "18" }]}
                  hitSlop={6}
                >
                  <Feather name="refresh-cw" size={12} color={colors.primary} />
                  <Text style={[styles.regenBtnText, { color: colors.primary }]}>Regenerate</Text>
                </Pressable>
              </View>
              <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                Tailored to your age, profile and bone-health risk band.
              </Text>
              <View style={styles.targetGrid}>
                {targetMetrics.map((m) => {
                  const pct = Math.min(1, m.target > 0 ? m.value / m.target : 0);
                  return (
                    <View key={m.key} style={styles.targetItem}>
                      <View style={styles.targetTop}>
                        <Text style={[styles.targetLabel, { color: colors.mutedForeground }]}>{m.label}</Text>
                        <Text style={[styles.targetValue, { color: m.color }]}>
                          {Math.round(m.value)}
                          <Text style={[styles.targetUnit, { color: colors.mutedForeground }]}>
                            {" "}/ {m.target}{m.unit}
                          </Text>
                        </Text>
                      </View>
                      <View style={[styles.barTrack, { backgroundColor: colors.muted }]}>
                        <View
                          style={[
                            styles.barFill,
                            { backgroundColor: m.color, width: `${Math.round(pct * 100)}%` as any },
                          ]}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            </Card>

            {/* Smart Food — "What can I eat today?" — quick context-aware
                bone-friendly ideas for moments when planning feels heavy. */}
            <SmartFoodModule
              context={smartContext}
              onContextChange={setSmartContext}
              vegetarian={preferences.vegetarian}
              dairyFree={preferences.dairyFree}
              glutenFree={preferences.glutenFree}
            />

            {/* Dietary filter chips */}
            <Card variant="outlined" style={styles.prefsCard}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Dietary preferences</Text>
              <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                We'll only suggest meals that match.
              </Text>
              <View style={styles.chipRow}>
                <PreferenceChip
                  label="Vegetarian"
                  icon="feather"
                  active={preferences.vegetarian}
                  onPress={() => onTogglePref("vegetarian")}
                />
                <PreferenceChip
                  label="Dairy-free"
                  icon="droplet"
                  active={preferences.dairyFree}
                  onPress={() => onTogglePref("dairyFree")}
                />
                <PreferenceChip
                  label="Gluten-free"
                  icon="circle"
                  active={preferences.glutenFree}
                  onPress={() => onTogglePref("glutenFree")}
                />
              </View>
              <Text style={[styles.chipsHint, { color: colors.mutedForeground }]}>
                Combine any — we'll only suggest meals that match every one you tap.
              </Text>
            </Card>

            {/* Today's meals */}
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Today's meals</Text>
            {plan ? (
              MEAL_ORDER.map((mealType) => {
                const recipe = recipeFor(mealType);
                if (!recipe) return null;
                return (
                  <MealRow
                    key={mealType}
                    mealType={mealType}
                    recipe={recipe}
                    accent={mealColors[mealType]}
                    onOpen={() => openRecipe(recipe.id)}
                    onSwap={() => onSwap(mealType)}
                    onFav={() => toggleFavourite(recipe.id)}
                    isFav={isFavourite(recipe.id)}
                    isEaten={!!mealsCompleted[mealType]}
                    onMarkEaten={() => onMarkEaten(mealType, recipe)}
                    portion={portions[mealType] ?? DEFAULT_PORTION}
                    onPortionChange={(p) => onPortionChange(mealType, recipe, p)}
                  />
                );
              })
            ) : (
              <Card variant="outlined" style={{ alignItems: "center", paddingVertical: 32 }}>
                <Feather name="coffee" size={28} color={colors.mutedForeground} />
                <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", marginTop: 8 }}>
                  Building your day…
                </Text>
              </Card>
            )}

            {/* Supplement suggestions */}
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Supplement guidance
            </Text>
            <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>
              Supportive — not medical advice. Speak to your GP or pharmacist before starting anything new.
            </Text>
            {supplements.map((s) => (
              <Card key={s.id} variant="outlined" style={styles.supCard}>
                <View style={styles.supHead}>
                  <View style={[styles.supIcon, { backgroundColor: colors.primary + "18" }]}>
                    <Feather name="shield" size={14} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.supName, { color: colors.foreground }]}>{s.name}</Text>
                    {s.hint && (
                      <Text style={[styles.supHint, { color: colors.mutedForeground }]}>{s.hint}</Text>
                    )}
                  </View>
                </View>
                <Text style={[styles.supReason, { color: colors.mutedForeground }]}>{s.reason}</Text>
              </Card>
            ))}

            {/* Reinforcement line */}
            <View style={[styles.reinforce, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "25" }]}>
              <Feather name="trending-up" size={16} color={colors.primary} />
              <Text style={[styles.reinforceText, { color: colors.foreground }]}>
                Consistent nutrition supports stronger bones over time.
              </Text>
            </View>
          </>
        )}

        {/* ============ FAVOURITES ============ */}
        {activeTab === "favourites" && (
          <FavouritesTab
            favourites={favourites}
            onOpen={openRecipe}
            onUnfav={toggleFavourite}
          />
        )}

        {/* ============ GUIDES ============ */}
        {activeTab === "guides" && (
          <View style={{ gap: 12 }}>
            <Text style={[styles.sectionSub, { color: colors.mutedForeground, marginBottom: 4 }]}>
              Short, practical reads to make bone-friendly eating second nature.
            </Text>
            {GUIDES.map((g) => (
              <Pressable key={g.id} onPress={() => openGuide(g.id)}>
                <Card variant="outlined" style={styles.guideCard}>
                  <View style={[styles.guideIcon, { backgroundColor: colors.accent + "18" }]}>
                    <Feather name="book-open" size={16} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.guideTitle, { color: colors.foreground }]}>{g.title}</Text>
                    <Text style={[styles.guideSummary, { color: colors.mutedForeground }]}>
                      {g.summary}
                    </Text>
                    <Text style={[styles.guideMeta, { color: colors.mutedForeground }]}>
                      {g.readMins} min read
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </Card>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ---- Subcomponents ---------------------------------------------------------

function SmartFoodModule({
  context,
  onContextChange,
  vegetarian,
  dairyFree,
  glutenFree,
}: {
  context: SmartFoodContext;
  onContextChange: (c: SmartFoodContext) => void;
  vegetarian: boolean;
  dairyFree: boolean;
  glutenFree: boolean;
}) {
  const colors = useColors();
  const { user } = useAuth();

  // Fetch the user's behavioural snapshot once per mount / per user so
  // we can re-rank suggestions by what bone nutrients they're actually
  // running short of (low calcium / vitD / protein on the past 7 days
  // of `nutrition_logs`). Endpoint is auth-gated only — not Premium —
  // because behavioural facts about a user belong to that user, and a
  // calmer Smart Food order is a baseline experience, not an upsell.
  // No data → suggestions fall back to the curated order untouched.
  const [behavioural, setBehavioural] = useState<BehaviouralStats | null>(null);
  useEffect(() => {
    if (!user?.id) {
      setBehavioural(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const p = await fetchEngagementProfile(user.id);
      if (!cancelled) setBehavioural(p?.behavioural ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const suggestions = React.useMemo(
    () =>
      prioritiseSmartFood(
        getSmartFoodSuggestions(context, {
          vegetarian,
          dairyFree,
          glutenFree,
        }),
        behavioural,
      ),
    [context, vegetarian, dairyFree, glutenFree, behavioural],
  );

  const contexts: SmartFoodContext[] = ["home", "on_the_go", "eating_out"];
  const contextIcon: Record<SmartFoodContext, keyof typeof Feather.glyphMap> = {
    home: "home",
    on_the_go: "briefcase",
    eating_out: "coffee",
  };

  return (
    <Card variant="outlined" style={styles.smartCard}>
      <View style={styles.smartHeader}>
        <View style={[styles.smartHeaderIcon, { backgroundColor: colors.accent + "18" }]}>
          <Feather name="zap" size={14} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            What can I eat today?
          </Text>
          <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
            Bone-friendly picks for the moment you're in.
          </Text>
        </View>
      </View>

      <View style={styles.smartChipRow}>
        {contexts.map((c) => {
          const active = c === context;
          return (
            <Pressable
              key={c}
              onPress={() => {
                if (Platform.OS !== "web") {
                  Haptics.selectionAsync().catch(() => {});
                }
                onContextChange(c);
              }}
              style={[
                styles.smartChip,
                {
                  backgroundColor: active ? colors.accent : colors.muted,
                  borderColor: active ? colors.accent : colors.border,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={SMART_FOOD_CONTEXT_LABEL[c]}
              accessibilityState={{ selected: active }}
            >
              <Feather
                name={contextIcon[c]}
                size={12}
                color={active ? "#fff" : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.smartChipText,
                  { color: active ? "#fff" : colors.foreground },
                ]}
              >
                {SMART_FOOD_CONTEXT_LABEL[c]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.smartList}>
        {suggestions.map((s) => (
          <View
            key={s.id}
            style={[styles.smartItem, { borderColor: colors.border }]}
          >
            <View
              style={[styles.smartBullet, { backgroundColor: colors.accent + "22" }]}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.smartTitle, { color: colors.foreground }]}>
                {s.title}
              </Text>
              <Text style={[styles.smartWhy, { color: colors.mutedForeground }]}>
                {s.why}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

function PreferenceChip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.prefChip,
        {
          backgroundColor: active ? colors.primary : colors.muted,
          borderColor: active ? colors.primary : colors.border,
        },
      ]}
    >
      <Feather
        name={active ? "check" : icon}
        size={12}
        color={active ? "#fff" : colors.mutedForeground}
      />
      <Text
        style={[
          styles.prefChipText,
          { color: active ? "#fff" : colors.foreground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function MealRow({
  mealType,
  recipe,
  accent,
  onOpen,
  onSwap,
  onFav,
  isFav,
  isEaten,
  onMarkEaten,
  portion,
  onPortionChange,
}: {
  mealType: MealType;
  recipe: Recipe;
  accent: string;
  onOpen: () => void;
  onSwap: () => void;
  onFav: () => void;
  isFav: boolean;
  isEaten: boolean;
  onMarkEaten: () => void;
  portion: number;
  onPortionChange: (portion: number) => void;
}) {
  const colors = useColors();
  // The card is intentionally NOT a single outer Pressable: nesting the heart
  // / swap / view-recipe pressables inside one would swallow inner taps on
  // React Native Web. Instead each interactive element owns its own touch
  // area as a sibling of the others.
  return (
    <View
      style={[
        styles.mealCard,
        { backgroundColor: colors.card, borderColor: colors.border },
        isEaten && { borderColor: colors.success + "60" },
      ]}
    >
      <View style={styles.mealTop}>
        <Pressable onPress={onOpen} style={styles.mealHeaderTap}>
          <View style={[styles.mealIcon, { backgroundColor: accent + "18" }]}>
            <Feather name={MEAL_ICONS[mealType]} size={16} color={accent} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <View style={styles.mealKindRow}>
              <Text style={[styles.mealKind, { color: accent }]}>
                {mealType.toUpperCase()}
              </Text>
              {isEaten && (
                <View style={[styles.eatenChip, { backgroundColor: colors.success + "1A" }]}>
                  <Feather name="check" size={10} color={colors.success} />
                  <Text style={[styles.eatenChipText, { color: colors.success }]}>
                    {portionLabel(portion)} eaten
                  </Text>
                </View>
              )}
            </View>
            <Text style={[styles.mealName, { color: colors.foreground }]} numberOfLines={2}>
              {recipe.name}
            </Text>
            <View style={styles.mealMetaRow}>
              <Feather name="clock" size={11} color={colors.mutedForeground} />
              <Text style={[styles.mealMeta, { color: colors.mutedForeground }]}>
                {recipe.prepMins} min
              </Text>
              <Text style={[styles.mealMetaDot, { color: colors.mutedForeground }]}>•</Text>
              <Text style={[styles.mealMeta, { color: colors.mutedForeground }]}>
                {recipe.calories} kcal
              </Text>
            </View>
          </View>
        </Pressable>
        <Pressable
          onPress={onFav}
          hitSlop={10}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={isFav ? "Remove from favourites" : "Save to favourites"}
        >
          <Feather
            name="heart"
            size={18}
            color={isFav ? colors.accent : colors.mutedForeground}
          />
        </Pressable>
      </View>

      <Pressable onPress={onOpen}>
        <Text style={[styles.mealHighlight, { color: colors.mutedForeground }]} numberOfLines={2}>
          {recipe.highlight}
        </Text>
      </Pressable>

      <View style={styles.mealNutRow}>
        <NutPill label="Ca" value={`${recipe.calcium}mg`} color={colors.primary} />
        <NutPill label="D" value={`${recipe.vitD}IU`} color={colors.xpGold} />
        <NutPill label="Protein" value={`${recipe.protein}g`} color={colors.accent} />
      </View>

      {/* Portion stepper — multiplies the contribution credited when
          "I ate this" is tapped. If the meal is already marked eaten,
          changing this re-applies in place via the bridge so totals
          shift to the new portion without drifting. */}
      <View style={styles.portionRow}>
        <Text style={[styles.portionLabel, { color: colors.mutedForeground }]}>
          Portion
        </Text>
        <View style={styles.portionStepper}>
          {PORTION_OPTIONS.map((opt) => {
            const active = opt.value === portion;
            return (
              <Pressable
                key={opt.value}
                onPress={() => onPortionChange(opt.value)}
                hitSlop={4}
                style={[
                  styles.portionPill,
                  {
                    backgroundColor: active ? accent : "transparent",
                    borderColor: active ? accent : colors.border,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${opt.label} portion of ${mealType}`}
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[
                    styles.portionPillText,
                    { color: active ? "#fff" : colors.foreground },
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.mealActions}>
        <Pressable
          onPress={onMarkEaten}
          style={[
            styles.eatenBtn,
            isEaten
              ? { backgroundColor: colors.success, borderColor: colors.success }
              : { backgroundColor: "transparent", borderColor: colors.success },
          ]}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={
            isEaten ? `Mark ${mealType} as not eaten` : `Mark ${mealType} as eaten`
          }
        >
          <Feather
            name={isEaten ? "check-circle" : "circle"}
            size={12}
            color={isEaten ? "#fff" : colors.success}
          />
          <Text
            style={[
              styles.eatenBtnText,
              { color: isEaten ? "#fff" : colors.success },
            ]}
          >
            {isEaten ? "Eaten" : "I ate this"}
          </Text>
        </Pressable>
        <Pressable
          onPress={onSwap}
          style={[styles.swapBtn, { borderColor: colors.border }]}
          hitSlop={6}
        >
          <Feather name="shuffle" size={12} color={colors.foreground} />
          <Text style={[styles.swapBtnText, { color: colors.foreground }]}>Swap</Text>
        </Pressable>
        <Pressable
          onPress={onOpen}
          style={[styles.viewBtn, { backgroundColor: accent }]}
          hitSlop={6}
        >
          <Text style={styles.viewBtnText}>View</Text>
          <Feather name="arrow-right" size={12} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

/** Pretty label for the portion stepper / eaten chip. Mirrors the
 *  values in PORTION_OPTIONS but tolerates any positive number so we
 *  can render legacy logs that may have a portion not in the option
 *  set without crashing. */
function portionLabel(p: number): string {
  if (p === 0.5) return "½";
  if (p === 1) return "1";
  if (p === 1.5) return "1½";
  if (p === 2) return "2";
  return String(p);
}

function NutPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={[styles.nutPill, { backgroundColor: color + "12" }]}>
      <Text style={[styles.nutPillVal, { color }]}>{value}</Text>
      <Text style={[styles.nutPillLabel, { color }]}>{label}</Text>
    </View>
  );
}

function FavouritesTab({
  favourites,
  onOpen,
  onUnfav,
}: {
  favourites: string[];
  onOpen: (id: string) => void;
  onUnfav: (id: string) => void;
}) {
  const colors = useColors();
  const recipes = favourites
    .map((id) => RECIPES.find((r) => r.id === id))
    .filter((r): r is Recipe => !!r);

  if (recipes.length === 0) {
    return (
      <View style={styles.empty}>
        <Feather name="heart" size={36} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No favourites yet</Text>
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          Tap the heart on any recipe to save it for later.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {recipes.map((recipe) => (
        <Card key={recipe.id} variant="outlined" style={styles.favCard}>
          <Pressable onPress={() => onOpen(recipe.id)} style={styles.favTap}>
            <Badge label={recipe.mealType} size="sm" variant="default" />
            <Text style={[styles.favName, { color: colors.foreground }]}>{recipe.name}</Text>
            <Text style={[styles.favMeta, { color: colors.mutedForeground }]}>
              {recipe.prepMins} min · {recipe.calories} kcal
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onUnfav(recipe.id)}
            hitSlop={10}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Remove from favourites"
          >
            <Feather name="heart" size={18} color={colors.accent} />
          </Pressable>
        </Card>
      ))}
    </View>
  );
}

// ---- Styles ----------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  aiChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  aiChipText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  tabRow: { flexDirection: "row", borderBottomWidth: 1, paddingHorizontal: 16 },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 12 },
  tabBtnText: { fontSize: 14 },
  tabUnderline: { position: "absolute", bottom: 0, left: 0, right: 0, height: 2, borderRadius: 1 },
  content: { padding: 16, gap: 14 },

  cardTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  cardSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4 },

  loggedStripCard: { gap: 8 },
  loggedStripHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  loggedStripTitle: { fontSize: 13, fontWeight: "700" },
  loggedStripSub: { fontSize: 11, marginLeft: "auto" },
  loggedStripRow: { flexDirection: "row", justifyContent: "space-between" },
  loggedStripCell: { flex: 1, alignItems: "center" },
  loggedStripValue: { fontSize: 16, fontWeight: "800" },
  loggedStripUnit: { fontSize: 10, fontWeight: "500" },
  targetsCard: { gap: 4 },
  targetsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  regenBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  regenBtnText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  targetGrid: { gap: 12, marginTop: 14 },
  targetItem: { gap: 6 },
  targetTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  targetLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  targetValue: { fontSize: 14, fontFamily: "Inter_700Bold" },
  targetUnit: { fontSize: 11, fontFamily: "Inter_400Regular" },
  barTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3 },

  prefsCard: { gap: 4 },
  chipRow: { flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" },
  prefChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  prefChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  chipsHint: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 8 },

  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 4 },
  sectionSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: -8 },

  mealCard: { borderRadius: 16, padding: 14, borderWidth: 1, gap: 10 },
  mealTop: { flexDirection: "row", alignItems: "center" },
  mealHeaderTap: { flex: 1, flexDirection: "row", alignItems: "center" },
  mealIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  mealKindRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  mealKind: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  eatenChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  eatenChipText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
  mealName: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  mealMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  mealMeta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  mealMetaDot: { fontSize: 11 },
  iconBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  mealHighlight: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  mealNutRow: { flexDirection: "row", gap: 8 },
  nutPill: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
  },
  nutPillVal: { fontSize: 12, fontFamily: "Inter_700Bold" },
  nutPillLabel: { fontSize: 10, fontFamily: "Inter_500Medium" },
  portionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 2,
  },
  portionLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  portionStepper: {
    flexDirection: "row",
    gap: 6,
    flex: 1,
  },
  portionPill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  portionPillText: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  mealActions: { flexDirection: "row", gap: 8, marginTop: 4 },
  swapBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  swapBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  eatenBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  eatenBtnText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  viewBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
  },
  viewBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_700Bold" },

  supCard: { gap: 8 },
  supHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  supIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  supName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  supHint: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  supReason: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },

  reinforce: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  reinforceText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },

  guideCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  guideIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  guideTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  guideSummary: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 17 },
  guideMeta: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 4 },

  empty: { alignItems: "center", paddingVertical: 56, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 24, lineHeight: 19 },

  favCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  favTap: { flex: 1 },
  favName: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 6 },
  favMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  smartCard: { gap: 12 },
  smartHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  smartHeaderIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  smartChipRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  smartChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  smartChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  smartList: { gap: 10, marginTop: 2 },
  smartItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  smartBullet: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  smartTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", lineHeight: 18 },
  smartWhy: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
    marginTop: 2,
  },
});
