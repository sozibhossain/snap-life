/**
 * Recipe detail screen — opened from the meal plan or favourites list.
 *
 * Shows the full recipe (ingredients, steps, prep time, calories, nutrient
 * highlights) and lets the user favourite the recipe or swap that meal slot
 * if the recipe is currently in today's plan.
 */

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
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
import { useNutrition } from "@/context/NutritionContext";
import { useColors } from "@/hooks/useColors";
import { getRecipeById } from "@/lib/nutritionData";

export default function RecipeDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const recipe = getRecipeById(typeof id === "string" ? id : undefined);

  const { plan, isFavourite, toggleFavourite, swapMeal } = useNutrition();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  if (!recipe) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Recipe</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.empty}>
          <Feather name="alert-circle" size={36} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Recipe not found</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            This recipe is no longer available. Head back to your meal plan for fresh suggestions.
          </Text>
        </View>
      </View>
    );
  }

  const isInTodaysPlan = plan ? plan.recipes[recipe.mealType] === recipe.id : false;
  const fav = isFavourite(recipe.id);

  async function onFav() {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    await toggleFavourite(recipe!.id);
  }

  async function onSwap() {
    if (!isInTodaysPlan) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    await swapMeal(recipe!.mealType);
    router.back();
  }

  const dietBadges: { label: string }[] = [];
  if (recipe.vegetarian) dietBadges.push({ label: "Vegetarian" });
  if (recipe.dairyFree) dietBadges.push({ label: "Dairy-free" });
  if (recipe.glutenFree) dietBadges.push({ label: "Gluten-free" });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ---- Header ---- */}
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Recipe</Text>
        <Pressable onPress={onFav} hitSlop={10}>
          <Feather
            name="heart"
            size={22}
            color={fav ? colors.accent : colors.foreground}
          />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Title block */}
        <View style={{ gap: 8 }}>
          <View style={styles.tagRow}>
            <Badge label={recipe.mealType} size="sm" variant="default" />
            {dietBadges.map((b) => (
              <Badge key={b.label} label={b.label} size="sm" variant="success" />
            ))}
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>{recipe.name}</Text>
          <View style={styles.metaRow}>
            <View style={styles.metaPill}>
              <Feather name="clock" size={12} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                {recipe.prepMins} min
              </Text>
            </View>
            <View style={styles.metaPill}>
              <Feather name="zap" size={12} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                {recipe.calories} kcal
              </Text>
            </View>
          </View>
        </View>

        {/* Highlight */}
        <Card
          variant="outlined"
          style={{
            ...styles.highlight,
            backgroundColor: colors.primary + "10",
            borderColor: colors.primary + "25",
          }}
        >
          <Feather name="award" size={16} color={colors.primary} />
          <Text style={[styles.highlightText, { color: colors.foreground }]}>
            {recipe.highlight}
          </Text>
        </Card>

        {/* Nutrients */}
        <Card variant="elevated" style={styles.nutrientCard}>
          <Text style={[styles.sectionHeading, { color: colors.foreground }]}>Bone-supporting nutrients</Text>
          <View style={styles.nutGrid}>
            <Nut label="Calcium" value={`${recipe.calcium}mg`} color={colors.primary} />
            <Nut label="Vitamin D" value={`${recipe.vitD}IU`} color={colors.xpGold} />
            <Nut label="Protein" value={`${recipe.protein}g`} color={colors.accent} />
            <Nut label="Magnesium" value={`${recipe.magnesium}mg`} color={colors.success} />
          </View>
        </Card>

        {/* Ingredients */}
        <View>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Ingredients</Text>
          <Card variant="outlined" style={{ gap: 0 }}>
            {recipe.ingredients.map((ing, i) => (
              <View
                key={ing}
                style={[
                  styles.ingredientRow,
                  i < recipe.ingredients.length - 1 && {
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <View style={[styles.bullet, { backgroundColor: colors.primary }]} />
                <Text style={[styles.ingredientText, { color: colors.foreground }]}>{ing}</Text>
              </View>
            ))}
          </Card>
        </View>

        {/* Steps */}
        <View>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Method</Text>
          {recipe.steps.map((step, i) => (
            <View key={i} style={[styles.stepRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <View style={[styles.stepNum, { backgroundColor: colors.primary }]}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <Text style={[styles.stepText, { color: colors.foreground }]}>{step}</Text>
            </View>
          ))}
        </View>

        {/* Tags */}
        {recipe.tags.length > 0 && (
          <View style={styles.tagWrap}>
            {recipe.tags.map((t) => (
              <Badge key={t} label={t} size="sm" variant="accent" />
            ))}
          </View>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          <Pressable
            onPress={onFav}
            style={[styles.actionGhost, { borderColor: colors.border }]}
          >
            <Feather name="heart" size={14} color={fav ? colors.accent : colors.foreground} />
            <Text style={[styles.actionGhostText, { color: colors.foreground }]}>
              {fav ? "Saved" : "Save"}
            </Text>
          </Pressable>
          <Pressable
            onPress={onSwap}
            disabled={!isInTodaysPlan}
            style={[
              styles.actionPrimary,
              {
                backgroundColor: isInTodaysPlan ? colors.primary : colors.muted,
                opacity: isInTodaysPlan ? 1 : 0.7,
              },
            ]}
          >
            <Feather name="shuffle" size={14} color={isInTodaysPlan ? "#fff" : colors.mutedForeground} />
            <Text
              style={[
                styles.actionPrimaryText,
                { color: isInTodaysPlan ? "#fff" : colors.mutedForeground },
              ]}
            >
              Swap this meal
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function Nut({ label, value, color }: { label: string; value: string; color: string }) {
  const colors = useColors();
  return (
    <View style={styles.nutItem}>
      <Text style={[styles.nutValue, { color }]}>{value}</Text>
      <Text style={[styles.nutLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  content: { padding: 16, gap: 16 },
  tagRow: { flexDirection: "row", gap: 6 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  metaRow: { flexDirection: "row", gap: 12, marginTop: 2 },
  metaPill: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12, fontFamily: "Inter_500Medium" },

  highlight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
  },
  highlightText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 18 },

  nutrientCard: { gap: 12 },
  sectionHeading: { fontSize: 13, fontFamily: "Inter_700Bold" },
  nutGrid: { flexDirection: "row", flexWrap: "wrap" },
  nutItem: { width: "50%", paddingVertical: 6 },
  nutValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  nutLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },

  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 8 },
  ingredientRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 12 },
  bullet: { width: 6, height: 6, borderRadius: 3 },
  ingredientText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },

  stepRow: {
    flexDirection: "row",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    alignItems: "flex-start",
  },
  stepNum: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  stepNumText: { color: "#fff", fontSize: 12, fontFamily: "Inter_700Bold" },
  stepText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },

  tagWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },

  actions: { flexDirection: "row", gap: 10, marginTop: 6 },
  actionGhost: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1,
  },
  actionGhostText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  actionPrimary: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 12, borderRadius: 12,
  },
  actionPrimaryText: { fontSize: 13, fontFamily: "Inter_700Bold" },

  empty: { alignItems: "center", paddingVertical: 80, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 32, lineHeight: 19 },
});
