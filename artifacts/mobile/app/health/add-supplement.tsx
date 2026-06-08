import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  Alert,
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
import { useHealth } from "@/context/HealthContext";
import type { SupplementCategory, SupplementUnit, SupplementTiming } from "@/context/HealthContext";
import { useColors } from "@/hooks/useColors";

// ─── Catalogues ────────────────────────────────────────────────────────────

const SUPPLEMENT_ITEMS = [
  { name: "Vitamin D3", defaultUnit: "IU" as SupplementUnit, defaultDose: 2000 },
  { name: "Calcium Carbonate", defaultUnit: "mg" as SupplementUnit, defaultDose: 500 },
  { name: "Calcium Citrate", defaultUnit: "mg" as SupplementUnit, defaultDose: 500 },
  { name: "Magnesium", defaultUnit: "mg" as SupplementUnit, defaultDose: 200 },
  { name: "Vitamin K2", defaultUnit: "mcg" as SupplementUnit, defaultDose: 100 },
  { name: "Omega-3", defaultUnit: "mg" as SupplementUnit, defaultDose: 1000 },
  { name: "Collagen", defaultUnit: "g" as SupplementUnit, defaultDose: 10 },
  { name: "Multivitamin", defaultUnit: "mg" as SupplementUnit, defaultDose: 1 },
  { name: "Protein Powder", defaultUnit: "g" as SupplementUnit, defaultDose: 25 },
];

const MEDICATION_BONE = [
  { name: "Alendronic Acid", defaultUnit: "mg" as SupplementUnit, defaultDose: 70 },
  { name: "Risedronate", defaultUnit: "mg" as SupplementUnit, defaultDose: 35 },
  { name: "Ibandronate", defaultUnit: "mg" as SupplementUnit, defaultDose: 150 },
  { name: "Denosumab (Prolia)", defaultUnit: "mg" as SupplementUnit, defaultDose: 60 },
  { name: "Raloxifene", defaultUnit: "mg" as SupplementUnit, defaultDose: 60 },
  { name: "Teriparatide", defaultUnit: "mcg" as SupplementUnit, defaultDose: 20 },
  { name: "HRT (Oestrogen)", defaultUnit: "as prescribed" as SupplementUnit, defaultDose: 0 },
  { name: "Adcal-D3", defaultUnit: "mg" as SupplementUnit, defaultDose: 1500 },
];

const MEDICATION_GENERAL = [
  { name: "Ibuprofen", defaultUnit: "mg" as SupplementUnit, defaultDose: 400 },
  { name: "Naproxen", defaultUnit: "mg" as SupplementUnit, defaultDose: 500 },
  { name: "Paracetamol", defaultUnit: "mg" as SupplementUnit, defaultDose: 1000 },
  { name: "Statins", defaultUnit: "mg" as SupplementUnit, defaultDose: 20 },
  { name: "Blood Pressure Medication", defaultUnit: "as prescribed" as SupplementUnit, defaultDose: 0 },
  { name: "Thyroid Medication", defaultUnit: "mcg" as SupplementUnit, defaultDose: 50 },
  { name: "Anticoagulants", defaultUnit: "as prescribed" as SupplementUnit, defaultDose: 0 },
  { name: "Diabetes Medication", defaultUnit: "as prescribed" as SupplementUnit, defaultDose: 0 },
];

const UNITS: SupplementUnit[] = ["mg", "mcg", "IU", "g", "ml", "as prescribed"];
const FREQUENCIES = ["daily", "twice daily", "alternate days", "weekly", "as needed"];
const TIMINGS: SupplementTiming[] = ["morning", "afternoon", "evening", "bedtime"];

// ─── Sub-components ────────────────────────────────────────────────────────

function PillBtn({
  label,
  selected,
  onPress,
  color,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  color: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.pill,
        {
          backgroundColor: selected ? color + "20" : colors.muted,
          borderColor: selected ? color : "transparent",
          borderWidth: 1.5,
        },
      ]}
    >
      <Text
        style={[
          styles.pillText,
          { color: selected ? color : colors.mutedForeground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ItemChip({
  name,
  selected,
  onPress,
  color,
}: {
  name: string;
  selected: boolean;
  onPress: () => void;
  color: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.itemChip,
        {
          backgroundColor: selected ? color + "18" : colors.card,
          borderColor: selected ? color : colors.border,
          borderWidth: selected ? 2 : 1,
        },
      ]}
    >
      {selected && (
        <Feather name="check" size={13} color={color} style={{ marginRight: 4 }} />
      )}
      <Text style={[styles.itemChipText, { color: selected ? color : colors.foreground }]}>
        {name}
      </Text>
    </Pressable>
  );
}

// ─── Screen ────────────────────────────────────────────────────────────────

export default function AddSupplementScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { addSupplement } = useHealth();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  // Step 1 state
  const [step, setStep] = useState<1 | 2>(1);
  const [category, setCategory] = useState<SupplementCategory>("supplement");
  const [selectedName, setSelectedName] = useState("");
  const [customName, setCustomName] = useState("");

  // Step 2 state
  const [doseText, setDoseText] = useState("");
  const [unit, setUnit] = useState<SupplementUnit>("mg");
  const [frequency, setFrequency] = useState("daily");
  const [timing, setTiming] = useState<SupplementTiming | "">("");

  const activeName = selectedName === "__custom__" ? customName.trim() : selectedName;
  const isBone = category === "medication";
  const accentColor = isBone ? colors.accent : colors.primary;

  function selectItem(name: string, defaultUnit: SupplementUnit, defaultDose: number) {
    setSelectedName(name);
    setUnit(defaultUnit);
    setDoseText(defaultDose > 0 ? String(defaultDose) : "");
    setCustomName("");
  }

  function goToStep2() {
    if (!activeName) {
      Alert.alert("Select an item", "Please choose from the list or enter a custom name.");
      return;
    }
    setStep(2);
  }

  async function handleSave() {
    if (!activeName) return;
    const doseAmount = parseFloat(doseText) || undefined;
    const dose =
      unit === "as prescribed"
        ? "As prescribed"
        : doseAmount
        ? `${doseAmount}${unit}`
        : unit;

    await addSupplement({
      name: activeName,
      dose,
      doseAmount,
      unit,
      frequency,
      timing: timing || undefined,
      category,
      isCustom: selectedName === "__custom__",
    });

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }

  const itemsToShow =
    category === "supplement"
      ? SUPPLEMENT_ITEMS
      : [...MEDICATION_BONE, ...MEDICATION_GENERAL];

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 8,
            borderBottomColor: colors.border,
            backgroundColor: colors.card,
          },
        ]}
      >
        <Pressable onPress={() => (step === 1 ? router.back() : setStep(1))} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            {step === 1 ? "Add to Daily Intake" : "Set Dose & Schedule"}
          </Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            Step {step} of 2
          </Text>
        </View>
        {/* Step dots */}
        <View style={styles.stepDots}>
          <View style={[styles.dot, { backgroundColor: accentColor }]} />
          <View
            style={[
              styles.dot,
              { backgroundColor: step === 2 ? accentColor : colors.muted },
            ]}
          />
        </View>
      </View>

      {/* ─── Step 1 ─── */}
      {step === 1 && (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 20 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Category toggle */}
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            WHAT ARE YOU ADDING?
          </Text>
          <View style={styles.categoryRow}>
            <Pressable
              style={[
                styles.categoryCard,
                {
                  backgroundColor:
                    category === "supplement" ? colors.primary + "14" : colors.card,
                  borderColor:
                    category === "supplement" ? colors.primary : colors.border,
                  flex: 1,
                },
              ]}
              onPress={() => {
                setCategory("supplement");
                setSelectedName("");
                setCustomName("");
              }}
            >
              <View
                style={[
                  styles.categoryIcon,
                  {
                    backgroundColor:
                      category === "supplement"
                        ? colors.primary + "20"
                        : colors.muted,
                  },
                ]}
              >
                <Feather
                  name="sun"
                  size={20}
                  color={
                    category === "supplement" ? colors.primary : colors.mutedForeground
                  }
                />
              </View>
              <Text
                style={[
                  styles.categoryLabel,
                  {
                    color:
                      category === "supplement"
                        ? colors.primary
                        : colors.foreground,
                  },
                ]}
              >
                Supplement
              </Text>
              <Text style={[styles.categorySub, { color: colors.mutedForeground }]}>
                Vitamins & minerals
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.categoryCard,
                {
                  backgroundColor:
                    category === "medication" ? colors.accent + "14" : colors.card,
                  borderColor:
                    category === "medication" ? colors.accent : colors.border,
                  flex: 1,
                },
              ]}
              onPress={() => {
                setCategory("medication");
                setSelectedName("");
                setCustomName("");
              }}
            >
              <View
                style={[
                  styles.categoryIcon,
                  {
                    backgroundColor:
                      category === "medication"
                        ? colors.accent + "20"
                        : colors.muted,
                  },
                ]}
              >
                <Feather
                  name="activity"
                  size={20}
                  color={
                    category === "medication" ? colors.accent : colors.mutedForeground
                  }
                />
              </View>
              <Text
                style={[
                  styles.categoryLabel,
                  {
                    color:
                      category === "medication"
                        ? colors.accent
                        : colors.foreground,
                  },
                ]}
              >
                Medication
              </Text>
              <Text style={[styles.categorySub, { color: colors.mutedForeground }]}>
                Prescribed drugs
              </Text>
            </Pressable>
          </View>

          {/* Item list */}
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 20 }]}>
            {category === "supplement" ? "COMMON SUPPLEMENTS" : "COMMON MEDICATIONS"}
          </Text>

          {category === "medication" && (
            <>
              <Text style={[styles.groupHeading, { color: colors.foreground }]}>
                Bone Health
              </Text>
              <View style={styles.chipGrid}>
                {MEDICATION_BONE.map((m) => (
                  <ItemChip
                    key={m.name}
                    name={m.name}
                    selected={selectedName === m.name}
                    onPress={() => selectItem(m.name, m.defaultUnit, m.defaultDose)}
                    color={colors.accent}
                  />
                ))}
              </View>
              <Text style={[styles.groupHeading, { color: colors.foreground, marginTop: 12 }]}>
                General Support
              </Text>
              <View style={styles.chipGrid}>
                {MEDICATION_GENERAL.map((m) => (
                  <ItemChip
                    key={m.name}
                    name={m.name}
                    selected={selectedName === m.name}
                    onPress={() => selectItem(m.name, m.defaultUnit, m.defaultDose)}
                    color={colors.accent}
                  />
                ))}
              </View>
            </>
          )}

          {category === "supplement" && (
            <View style={styles.chipGrid}>
              {SUPPLEMENT_ITEMS.map((s) => (
                <ItemChip
                  key={s.name}
                  name={s.name}
                  selected={selectedName === s.name}
                  onPress={() => selectItem(s.name, s.defaultUnit, s.defaultDose)}
                  color={colors.primary}
                />
              ))}
            </View>
          )}

          {/* Custom entry */}
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 20 }]}>
            NOT LISTED? ADD YOUR OWN
          </Text>
          <View
            style={[
              styles.customInputRow,
              {
                borderColor:
                  selectedName === "__custom__" ? accentColor : colors.border,
                backgroundColor: colors.card,
              },
            ]}
          >
            <Feather name="edit-2" size={15} color={colors.mutedForeground} style={{ marginRight: 8 }} />
            <TextInput
              style={[styles.customInput, { color: colors.foreground }]}
              placeholder="Type name here…"
              placeholderTextColor={colors.mutedForeground}
              value={customName}
              onChangeText={(t) => {
                setCustomName(t);
                if (t.trim()) setSelectedName("__custom__");
                else if (selectedName === "__custom__") setSelectedName("");
              }}
            />
            {customName.length > 0 && (
              <Pressable
                onPress={() => {
                  setCustomName("");
                  if (selectedName === "__custom__") setSelectedName("");
                }}
              >
                <Feather name="x" size={16} color={colors.mutedForeground} />
              </Pressable>
            )}
          </View>

          {/* Safety note for medications */}
          {category === "medication" && (
            <View
              style={[
                styles.safetyNote,
                { backgroundColor: colors.accent + "0F", borderColor: colors.accent + "30" },
              ]}
            >
              <Feather name="info" size={14} color={colors.accent} />
              <Text style={[styles.safetyText, { color: colors.mutedForeground }]}>
                This is a tracking tool only. Always follow your healthcare provider's
                instructions regarding dosage and timing.
              </Text>
            </View>
          )}

          <Pressable
            style={[
              styles.nextBtn,
              { backgroundColor: activeName ? accentColor : colors.muted },
            ]}
            onPress={goToStep2}
            disabled={!activeName}
          >
            <Text style={[styles.nextBtnText, { color: activeName ? "#fff" : colors.mutedForeground }]}>
              Next — Set Dose
            </Text>
            <Feather
              name="arrow-right"
              size={16}
              color={activeName ? "#fff" : colors.mutedForeground}
            />
          </Pressable>
        </ScrollView>
      )}

      {/* ─── Step 2 ─── */}
      {step === 2 && (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 20 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Selected item summary */}
          <View
            style={[
              styles.selectedBadge,
              { backgroundColor: accentColor + "14", borderColor: accentColor + "30" },
            ]}
          >
            <Feather
              name={category === "supplement" ? "sun" : "activity"}
              size={14}
              color={accentColor}
            />
            <Text style={[styles.selectedBadgeText, { color: accentColor }]}>
              {activeName}
            </Text>
          </View>

          {/* Dose amount */}
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            DOSE AMOUNT
          </Text>
          <View
            style={[
              styles.doseRow,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <TextInput
              style={[styles.doseInput, { color: colors.foreground }]}
              placeholder={unit === "as prescribed" ? "—" : "Enter amount"}
              placeholderTextColor={colors.mutedForeground}
              keyboardType="decimal-pad"
              value={doseText}
              onChangeText={setDoseText}
              editable={unit !== "as prescribed"}
            />
            <Text style={[styles.doseUnitLabel, { color: colors.mutedForeground }]}>
              {unit}
            </Text>
          </View>

          {/* Unit */}
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 18 }]}>
            UNIT
          </Text>
          <View style={styles.pillRow}>
            {UNITS.map((u) => (
              <PillBtn
                key={u}
                label={u}
                selected={unit === u}
                onPress={() => {
                  setUnit(u);
                  if (u === "as prescribed") setDoseText("");
                }}
                color={accentColor}
              />
            ))}
          </View>

          {/* Frequency */}
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 18 }]}>
            HOW OFTEN?
          </Text>
          <View style={styles.pillRow}>
            {FREQUENCIES.map((f) => (
              <PillBtn
                key={f}
                label={f}
                selected={frequency === f}
                onPress={() => setFrequency(f)}
                color={accentColor}
              />
            ))}
          </View>

          {/* Timing (optional) */}
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 18 }]}>
            BEST TIME TO TAKE{" "}
            <Text style={{ fontFamily: "Inter_400Regular" }}>(optional)</Text>
          </Text>
          <View style={styles.pillRow}>
            {TIMINGS.map((t) => (
              <PillBtn
                key={t}
                label={t}
                selected={timing === t}
                onPress={() => setTiming(timing === t ? "" : t)}
                color={accentColor}
              />
            ))}
          </View>

          {/* Contextual tip */}
          {activeName.toLowerCase().includes("calcium") && (
            <View
              style={[
                styles.safetyNote,
                { backgroundColor: colors.primary + "0F", borderColor: colors.primary + "30", marginTop: 16 },
              ]}
            >
              <Feather name="info" size={14} color={colors.primary} />
              <Text style={[styles.safetyText, { color: colors.mutedForeground }]}>
                Calcium is best absorbed when taken with food. Space doses 2–3 hours
                apart if taking more than 500 mg per day.
              </Text>
            </View>
          )}
          {activeName.toLowerCase().includes("vitamin d") && (
            <View
              style={[
                styles.safetyNote,
                { backgroundColor: colors.primary + "0F", borderColor: colors.primary + "30", marginTop: 16 },
              ]}
            >
              <Feather name="info" size={14} color={colors.primary} />
              <Text style={[styles.safetyText, { color: colors.mutedForeground }]}>
                Vitamin D3 is fat-soluble — take it with a meal containing healthy
                fats for best absorption. It works alongside Vitamin K2 to direct
                calcium to your bones.
              </Text>
            </View>
          )}

          <Pressable
            style={[styles.nextBtn, { backgroundColor: accentColor, marginTop: 24 }]}
            onPress={handleSave}
          >
            <Feather name="plus-circle" size={16} color="#fff" />
            <Text style={[styles.nextBtnText, { color: "#fff" }]}>
              Add to Today's Intake
            </Text>
          </Pressable>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  stepDots: { flexDirection: "row", gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  content: { padding: 16, gap: 4 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.6,
    marginBottom: 10,
    marginTop: 4,
  },
  categoryRow: { flexDirection: "row", gap: 10 },
  categoryCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: "center",
    gap: 8,
  },
  categoryIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryLabel: { fontSize: 15, fontFamily: "Inter_700Bold" },
  categorySub: { fontSize: 11, fontFamily: "Inter_400Regular" },
  groupHeading: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 8, marginTop: 4 },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  itemChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  itemChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  customInputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 4,
  },
  customInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  safetyNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 16,
  },
  safetyText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  nextBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    borderRadius: 13,
    marginTop: 24,
  },
  nextBtnText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  selectedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 18,
  },
  selectedBadgeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  doseRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  doseInput: { flex: 1, fontSize: 24, fontFamily: "Inter_700Bold", paddingVertical: 10 },
  doseUnitLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  pillText: { fontSize: 13, fontFamily: "Inter_500Medium" },
});
