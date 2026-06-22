/**
 * Log Nutrition - food-only bone health tracking.
 *
 * Improvements in this version:
 *  - Total daily targets used by the Bone Health Dashboard
 *  - Safe upper limit education
 *  - IU ↔ mcg conversion shown for Vitamin D
 *  - Unit education per nutrient (expandable)
 *  - Food-only logging to prevent supplement double-counting
 *  - Unrealistic-value detection
 *  - "Why it matters" bone-health context per nutrient
 *  - Blended brand navy + warm-amber colour system
 */

import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { useHealth } from "@/context/HealthContext";
import { useNutrition } from "@/context/NutritionContext";
import { useColors } from "@/hooks/useColors";

// ─── Nutrient colour palette (brand navy + warm amber blend) ──────────────────
const NUTRIENT_COLORS = {
  calcium:   "#3ABBD4",   // brand primary teal — mineral/bone
  vitaminD:  "#F59E0B",   // warm amber - sunshine / vitamin D awareness
  protein:   "#22c55e",   // brand success green — muscle strength
  magnesium: "#FB923C",   // amber-orange blend
  calories:  "#F47530",   // brand accent orange — energy
};

// ─── Stepper button ───────────────────────────────────────────────────────────

function StepBtn({
  label, color, onPress, fill = false,
}: { label: string; color: string; onPress: () => void; fill?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={[
        sb.btn,
        fill
          ? { backgroundColor: color + "22", borderColor: color + "45" }
          : { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)" },
      ]}
      accessibilityRole="button"
    >
      <Text style={[sb.label, { color: fill ? color : "rgba(255,255,255,0.65)" }]}>{label}</Text>
    </Pressable>
  );
}
const sb = StyleSheet.create({
  btn:   { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 13, fontFamily: "Inter_700Bold" },
});

// ─── Nutrient field ───────────────────────────────────────────────────────────

interface NutrientFieldProps {
  icon:        React.ComponentProps<typeof Feather>["name"];
  label:       string;
  goalRange:   string;   // display e.g. "700–1,000 mg"
  goal:        number;   // personalised target for % calc
  unit:        string;
  color:       string;
  value:       string;
  onChange:    (v: string) => void;
  step:        number;
  safeMax:     number;   // General safe upper limit (0 = no limit shown)
  unitNote:    string;   // "mg = milligrams"
  conversion?: string;   // IU ↔ mcg e.g. "1,000 IU = 25 mcg"
  whyMatters:  string;
  isLast?:     boolean;
}

function NutrientField(p: NutrientFieldProps) {
  const [open, setOpen] = useState(false);
  const current = parseFloat(p.value) || 0;
  const pct     = Math.min(100, Math.round((current / p.goal) * 100));
  const overSafe = p.safeMax > 0 && current > p.safeMax;

  function clamp(v: number) { return v < 0 ? 0 : Math.round(v); }
  function tap(delta: number) {
    if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
    const next = clamp(current + delta);
    p.onChange(next === 0 ? "" : String(next));
  }

  return (
    <View style={[nf.block, !p.isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.09)" }]}>

      {/* Header row — tap to expand info */}
      <Pressable onPress={() => setOpen((v) => !v)} style={nf.header}>
        <View style={[nf.iconWrap, { backgroundColor: p.color + "22" }]}>
          <Feather name={p.icon} size={15} color={p.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={nf.name}>{p.label}</Text>
          <Text style={nf.goalText}>{p.goalRange}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {pct > 0 && (
            <View style={[nf.pctBadge, { backgroundColor: p.color + "18", borderColor: p.color + "35" }]}>
              <Text style={[nf.pctText, { color: p.color }]}>{pct}%</Text>
            </View>
          )}
          <Feather name={open ? "chevron-up" : "info" } size={14} color="rgba(255,255,255,0.35)" />
        </View>
      </Pressable>

      {/* Expandable education panel */}
      {open && (
        <View style={[nf.infoBox, { borderColor: p.color + "30", backgroundColor: p.color + "0D" }]}>
          <Text style={nf.whyText}>{p.whyMatters}</Text>
          <View style={nf.infoDivider} />
          <Text style={nf.unitNote}>{p.unitNote}</Text>
          {p.conversion && (
            <Text style={nf.conversionNote}>{p.conversion}</Text>
          )}
          {p.safeMax > 0 && (
            <Text style={nf.safeNote}>
              Safe upper limit: {p.safeMax.toLocaleString()} {p.unit}/day.
            </Text>
          )}
          <Text style={[nf.gpNote, { color: p.color + "BB" }]}>
            If you are prescribed supplements, your dose may differ. Always follow your healthcare professional's advice.
          </Text>
        </View>
      )}

      {/* Large value input */}
      <View style={[nf.valueWrap, { borderColor: overSafe ? "#ef4444" : p.color + "30" }]}>
        <TextInput
          style={[nf.valueInput, { color: p.color }]}
          value={p.value}
          onChangeText={(v) => p.onChange(v.replace(/[^0-9.]/g, ""))}
          placeholder="0"
          placeholderTextColor={p.color + "45"}
          keyboardType="decimal-pad"
          returnKeyType="done"
          textAlign="center"
        />
        <Text style={[nf.valueUnit, { color: p.color + "99" }]}>{p.unit}</Text>
      </View>

      {/* Over-safe-limit warning */}
      {overSafe && (
        <View style={nf.warningBox}>
          <Feather name="alert-triangle" size={13} color="#F59E0B" />
          <Text style={nf.warningText}>
            This is above the general safe upper limit of {p.safeMax.toLocaleString()} {p.unit}/day. If you are taking supplements, please speak with your healthcare professional before exceeding this amount.
          </Text>
        </View>
      )}

      {/* Steppers */}
      <View style={nf.stepRow}>
        <StepBtn label={`−${p.step}`} color={p.color} onPress={() => tap(-p.step)} />
        <StepBtn label={`+${p.step}`} color={p.color} onPress={() => tap(p.step)} fill />
      </View>
    </View>
  );
}

const nf = StyleSheet.create({
  block:       { paddingHorizontal: 16, paddingVertical: 16, gap: 12 },
  header:      { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap:    { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  name:        { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  goalText:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.45)", marginTop: 2 },
  pctBadge:    { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  pctText:     { fontSize: 12, fontFamily: "Inter_700Bold" },

  infoBox:     { borderRadius: 12, borderWidth: 1, padding: 12, gap: 6 },
  whyText:     { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff", lineHeight: 18 },
  infoDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.12)" },
  unitNote:    { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.65)", lineHeight: 17 },
  conversionNote:{ fontSize: 12, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.75)", lineHeight: 17 },
  safeNote:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.50)", lineHeight: 16 },
  gpNote:      { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },

  valueWrap:   {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.20)", borderRadius: 14, borderWidth: 1,
    paddingVertical: 12, paddingHorizontal: 16, gap: 6,
  },
  valueInput:  { fontSize: 36, fontFamily: "Inter_700Bold", minWidth: 80, padding: 0 },
  valueUnit:   { fontSize: 14, fontFamily: "Inter_500Medium", paddingTop: 10 },

  warningBox:  {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: "rgba(245,158,11,0.10)", borderRadius: 10, borderWidth: 1,
    borderColor: "rgba(245,158,11,0.30)", padding: 10,
  },
  warningText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.80)", lineHeight: 17 },

  stepRow:     { flexDirection: "row", gap: 10 },
});

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function NutritionScreen() {
  const colors     = useColors();
  const insets     = useSafeAreaInsets();
  const router     = useRouter();
  const { todayNutrition, upsertTodayNutrition } = useHealth();
  const { targets } = useNutrition();

  const topPad    = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  // Fallback goals. deriveTargets provides personalised total daily targets.
  const GOALS = useMemo(() => ({
    calcium:   targets?.calcium   || 700,
    vitaminD:  targets?.vitaminD  || 400,
    protein:   targets?.protein   || 45,
    magnesium: targets?.magnesium || 270,
    calories:  targets?.calories  || 2000,
  }), [targets]);

  const [calcium,   setCalcium]   = useState("");
  const [vitaminD,  setVitaminD]  = useState("");
  const [protein,   setProtein]   = useState("");
  const [magnesium, setMagnesium] = useState("");
  const [calories,  setCalories]  = useState("");

  const [prefillId, setPrefillId] = useState<string | null>(null);
  useEffect(() => {
    const id = todayNutrition?.id ?? "_empty_";
    if (id === prefillId) return;
    setCalcium  (todayNutrition?.calcium   ? String(Math.round(todayNutrition.calcium))   : "");
    setVitaminD (todayNutrition?.vitaminD  ? String(Math.round(todayNutrition.vitaminD))  : "");
    setProtein  (todayNutrition?.protein   ? String(Math.round(todayNutrition.protein))   : "");
    setMagnesium(todayNutrition?.magnesium ? String(Math.round(todayNutrition.magnesium)) : "");
    setCalories (todayNutrition?.calories  ? String(Math.round(todayNutrition.calories))  : "");
    setPrefillId(id);
  }, [todayNutrition, prefillId]);

  const [isLoading, setIsLoading] = useState(false);
  const [error,     setError]     = useState("");

  const ca   = parseFloat(calcium)   || 0;
  const vd   = parseFloat(vitaminD)  || 0;
  const pr   = parseFloat(protein)   || 0;
  const mg   = parseFloat(magnesium) || 0;
  const kcal = parseFloat(calories)  || 0;

  const planContributed =
    todayNutrition?.source === "meal_plan" || todayNutrition?.source === "manual+plan";

  async function handleSave() {
    if (!calcium && !vitaminD && !protein && !magnesium && !calories) {
      setError("Please enter at least one value");
      return;
    }
    setError("");
    setIsLoading(true);
    try {
      await upsertTodayNutrition({
        calcium: ca, vitaminD: vd, protein: pr, magnesium: mg, calories: kcal,
        source: planContributed ? "manual+plan" : "manual",
      });
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
      router.back();
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* ── Header (warmth gradient — orange-amber blend) ── */}
      <LinearGradient
        colors={colors.gradients.warmth}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: topPad + 10 }, colors.shadows.sm]}
      >
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </Pressable>
        <View style={{ flex: 1, marginHorizontal: 12 }}>
          <Text style={styles.headerTitle}>Log Nutrition</Text>
          <Text style={styles.headerSub}>
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
          </Text>
        </View>
        <Pressable
          onPress={handleSave}
          disabled={isLoading}
          style={[styles.saveBtn, { opacity: isLoading ? 0.6 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Save today's nutrition"
        >
          <Text style={styles.saveBtnText}>{isLoading ? "Saving…" : "Save"}</Text>
        </Pressable>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Meal plan provenance */}
        {planContributed && (
          <View style={[styles.notice, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
            <Feather name="check-circle" size={14} color={colors.primary} />
            <Text style={[styles.noticeText, { color: colors.foreground }]}>
              Today's totals include your meal plan. Edit any field to override.
            </Text>
          </View>
        )}

        {/* ── Progress summary ── */}
        <LinearGradient
          colors={[colors.navy, colors.navyMid]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.card, colors.shadows.md]}
        >
          <View style={styles.cardHeader}>
            <View style={[styles.cardIcon, { backgroundColor: NUTRIENT_COLORS.vitaminD + "22" }]}>
              <Feather name="pie-chart" size={14} color={NUTRIENT_COLORS.vitaminD} />
            </View>
            <Text style={styles.cardTitle}>Today's Progress</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.ringRow}>
            <ProgressRing size={64} progress={ca / GOALS.calcium}   color={NUTRIENT_COLORS.calcium}   label={`${Math.round(ca)}`}  sublabel="Ca mg"     />
            <ProgressRing size={64} progress={vd / GOALS.vitaminD}  color={NUTRIENT_COLORS.vitaminD}  label={`${Math.round(vd)}`}  sublabel="D IU"      />
            <ProgressRing size={64} progress={pr / GOALS.protein}   color={NUTRIENT_COLORS.protein}   label={`${Math.round(pr)}`}  sublabel="Protein g" />
            <ProgressRing size={64} progress={mg / GOALS.magnesium} color={NUTRIENT_COLORS.magnesium} label={`${Math.round(mg)}`}  sublabel="Mg mg"     />
          </View>
        </LinearGradient>

        {/* Food-only examples */}
        <LinearGradient
          colors={[colors.navy, colors.navyMid]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.card, colors.shadows.md]}
        >
          <View style={styles.cardHeader}>
            <View style={[styles.cardIcon, { backgroundColor: NUTRIENT_COLORS.vitaminD + "22" }]}>
              <Feather name="coffee" size={14} color={NUTRIENT_COLORS.vitaminD} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Log food intake only</Text>
              <Text style={styles.cardSubtitle}>
                Use Supplement & Medication Tracker for tablets, capsules, prescriptions, shakes, and collagen.
              </Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.foodExamples}>
            {[
              "Milk",
              "Yogurt",
              "Cheese",
              "Sardines",
              "Salmon",
              "Tofu",
              "Eggs",
              "Protein meal",
              "Vegetables",
              "Fortified foods",
            ].map((item) => (
              <View key={item} style={styles.foodPill}>
                <Text style={styles.foodPillText}>{item}</Text>
              </View>
            ))}
          </View>
        </LinearGradient>

        {/* ── Bone-health nutrients ── */}
        <LinearGradient
          colors={[colors.navy, colors.navyMid]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.card, colors.shadows.md]}
        >
          <View style={styles.cardHeader}>
            <View style={[styles.cardIcon, { backgroundColor: NUTRIENT_COLORS.calcium + "22" }]}>
              <Feather name="droplet" size={14} color={NUTRIENT_COLORS.calcium} />
            </View>
            <Text style={styles.cardTitle}>Bone-Health Nutrients</Text>
            <View style={[styles.tapHint, { borderColor: "rgba(255,255,255,0.14)" }]}>
              <Feather name="info" size={11} color="rgba(255,255,255,0.40)" />
              <Text style={styles.tapHintText}>tap name for guidance</Text>
            </View>
          </View>
          <View style={styles.divider} />

          <NutrientField
            icon="droplet"
            label="Calcium"
            goalRange={`Goal: ${GOALS.calcium.toLocaleString()} mg/day`}
            goal={GOALS.calcium}
            unit="mg"
            color={NUTRIENT_COLORS.calcium}
            value={calcium}
            onChange={setCalcium}
            step={100}
            safeMax={2500}
            unitNote="mg = milligrams. Log calcium from food here; supplements are tracked separately."
            whyMatters="Calcium builds and maintains bone mineral density - the foundation of fracture prevention."
          />
          <NutrientField
            icon="sun"
            label="Vitamin D"
            goalRange={`Goal: ${GOALS.vitaminD.toLocaleString()} IU/day · ${Math.round(GOALS.vitaminD / 40)} mcg`}
            goal={GOALS.vitaminD}
            unit="IU"
            color={NUTRIENT_COLORS.vitaminD}
            value={vitaminD}
            onChange={setVitaminD}
            step={200}
            safeMax={4000}
            unitNote="IU = International Units. Vitamin D is measured in IU or micrograms (mcg / μg)."
            conversion="400 IU = 10 mcg · 800 IU = 20 mcg · 1,000 IU = 25 mcg · 4,000 IU = 100 mcg"
            whyMatters="Vitamin D helps your body absorb calcium and supports muscle function, balance, and bone strength."
          />
          <NutrientField
            icon="box"
            label="Protein"
            goalRange={`Goal: ${GOALS.protein} g/day`}
            goal={GOALS.protein}
            unit="g"
            color={NUTRIENT_COLORS.protein}
            value={protein}
            onChange={setProtein}
            step={10}
            safeMax={0}
            unitNote="g = grams. Protein intake is measured in grams per day."
            whyMatters="Adequate protein supports muscle mass and strength - essential for fall and fracture prevention."
          />
          <NutrientField
            icon="zap"
            label="Magnesium"
            goalRange={`Goal: ${GOALS.magnesium} mg/day`}
            goal={GOALS.magnesium}
            unit="mg"
            color={NUTRIENT_COLORS.magnesium}
            value={magnesium}
            onChange={setMagnesium}
            step={50}
            safeMax={400}
            unitNote="mg = milligrams. The safe upper limit applies to magnesium from supplements; dietary magnesium has no upper limit."
            whyMatters="Magnesium works with calcium and vitamin D to maintain healthy bones and muscle function."
            isLast
          />
        </LinearGradient>

        {/* ── Calories ── */}
        <LinearGradient
          colors={[colors.navy, colors.navyMid]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.card, colors.shadows.md]}
        >
          <View style={styles.cardHeader}>
            <View style={[styles.cardIcon, { backgroundColor: NUTRIENT_COLORS.calories + "22" }]}>
              <Feather name="activity" size={14} color={NUTRIENT_COLORS.calories} />
            </View>
            <Text style={styles.cardTitle}>Energy</Text>
          </View>
          <View style={styles.divider} />

          <NutrientField
            icon="activity"
            label="Total Calories"
            goalRange={`Goal: ${GOALS.calories.toLocaleString()} kcal/day`}
            goal={GOALS.calories}
            unit="kcal"
            color={NUTRIENT_COLORS.calories}
            value={calories}
            onChange={setCalories}
            step={100}
            safeMax={0}
            unitNote="kcal = kilocalories. The measure of food energy."
            whyMatters="Adequate energy intake helps maintain a healthy weight and supports bone-protective physical activity."
            isLast
          />
        </LinearGradient>

        {/* Guidance footnote */}
        <View style={[styles.footNote, { borderColor: colors.border }]}>
          <Feather name="shield" size={12} color={colors.mutedForeground} />
          <Text style={[styles.footText, { color: colors.mutedForeground }]}>
            Goals are total daily targets. This screen records food only; supplements and medication are tracked separately so SNAP can combine both sources without double-counting. Always follow your healthcare professional's specific advice.
          </Text>
        </View>

        {error.length > 0 && (
          <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 14,
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: -0.2 },
  headerSub:   { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.72)", marginTop: 2 },
  saveBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.22)", borderWidth: 1, borderColor: "rgba(255,255,255,0.30)",
  },
  saveBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },

  content: { padding: 16, gap: 14 },

  notice: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 12, borderRadius: 12, borderWidth: 1,
  },
  noticeText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 17 },

  card: { borderRadius: 18, overflow: "hidden" },

  cardHeader: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12,
  },
  cardIcon:  { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  cardTitle:    { flex: 1, fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  cardSubtitle: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.50)", marginTop: 2 },
  tapHint:   { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3 },
  tapHintText:{ fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.40)" },
  divider:   { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.10)" },
  ringRow:   { flexDirection: "row", justifyContent: "space-around", paddingHorizontal: 12, paddingVertical: 16 },

  foodExamples: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  foodPill: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  foodPillText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "rgba(255,255,255,0.86)",
  },

  // Footer
  footNote: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    borderWidth: 1, borderRadius: 12, padding: 12,
  },
  footText:  { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
});
