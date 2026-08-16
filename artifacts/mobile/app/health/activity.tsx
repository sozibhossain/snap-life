import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
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
import { useHealth } from "@/context/HealthContext";
import { useColors } from "@/hooks/useColors";

const EXERCISE_TYPES = [
  ["walking", "Walking"],
  ["resistance", "Resistance"],
  ["weight_bearing", "Weight-bearing"],
  ["balance", "Balance"],
  ["yoga", "Yoga"],
  ["pilates", "Pilates"],
  ["tai_chi", "Tai chi"],
  ["running", "Running"],
  ["dancing", "Dancing"],
  ["pickleball", "Pickleball"],
  ["tennis", "Tennis"],
  ["padel", "Padel"],
  ["badminton", "Badminton"],
  ["other", "Other"],
] as const;

export default function ActivityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { logActivity } = useHealth();

  const [steps, setSteps] = useState("");
  const [calories, setCalories] = useState("");
  const [activeMinutes, setActiveMinutes] = useState("");
  const [distance, setDistance] = useState("");
  const [exerciseTypes, setExerciseTypes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  async function handleSave() {
    const s = parseInt(steps);
    const c = parseInt(calories);
    const m = parseInt(activeMinutes);
    const d = parseFloat(distance);
    if (isNaN(s) || s < 0) { setError("Please enter valid steps"); return; }
    setError("");
    setIsLoading(true);
    try {
      await logActivity({
        date: new Date().toISOString().split("T")[0],
        steps: s,
        calories: isNaN(c) ? 0 : c,
        activeMinutes: isNaN(m) ? 0 : m,
        distance: isNaN(d) ? 0 : d,
        exerciseSessions: exerciseTypes.map((kind) => ({
          kind: kind as (typeof EXERCISE_TYPES)[number][0],
          durationMinutes: isNaN(m) ? 0 : m,
        })),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e) {
      setError("Failed to save. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  const fields = [
    { label: "Steps", value: steps, onChangeText: setSteps, placeholder: "8000", unit: "steps", icon: "activity" as const, color: colors.primary },
    { label: "Active Minutes", value: activeMinutes, onChangeText: setActiveMinutes, placeholder: "45", unit: "min", icon: "clock" as const, color: colors.accent },
    { label: "Calories Burned", value: calories, onChangeText: setCalories, placeholder: "320", unit: "kcal", icon: "zap" as const, color: colors.xpGold },
    { label: "Distance", value: distance, onChangeText: setDistance, placeholder: "5.5", unit: "km", icon: "map-pin" as const, color: colors.success },
  ];

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()}>
          <Feather name="x" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Log Activity</Text>
        <Pressable
          onPress={handleSave}
          disabled={isLoading}
          style={[styles.saveBtn, { backgroundColor: colors.accent, opacity: isLoading ? 0.7 : 1 }]}
        >
          <Text style={styles.saveBtnText}>{isLoading ? "Saving..." : "Save"}</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.today, { color: colors.mutedForeground }]}>
          {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
        </Text>

        {fields.map((field) => (
          <View key={field.label} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.fieldIcon, { backgroundColor: field.color + "18" }]}>
              <Feather name={field.icon} size={20} color={field.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                {field.label}
              </Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={[styles.fieldInput, { color: colors.foreground }]}
                  value={field.value}
                  onChangeText={field.onChangeText}
                  placeholder={field.placeholder}
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="decimal-pad"
                />
                <Text style={[styles.unit, { color: colors.mutedForeground }]}>
                  {field.unit}
                </Text>
              </View>
            </View>
          </View>
        ))}

        <View
          style={[
            styles.exerciseCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.exerciseTitle, { color: colors.foreground }]}>Exercise types</Text>
          <Text style={[styles.exerciseHint, { color: colors.mutedForeground }]}>Select all that apply to today's active minutes.</Text>
          <View style={styles.chipWrap}>
            {EXERCISE_TYPES.map(([value, label]) => {
              const selected = exerciseTypes.includes(value);
              return (
                <Pressable
                  key={value}
                  onPress={() =>
                    setExerciseTypes((current) =>
                      selected
                        ? current.filter((item) => item !== value)
                        : [...current, value],
                    )
                  }
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected ? colors.primary : "transparent",
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: selected ? "#fff" : colors.foreground }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {error.length > 0 && (
          <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
        )}

        <View style={[styles.tipCard, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "20" }]}>
          <Feather name="info" size={14} color={colors.primary} />
          <Text style={[styles.tipText, { color: colors.mutedForeground }]}>
            Weight-bearing activities like walking, dancing, and stair climbing are especially beneficial for bone density.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
  saveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  saveBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  content: { padding: 16, gap: 12 },
  today: { fontSize: 14, fontFamily: "Inter_500Medium", marginBottom: 4 },
  fieldCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  fieldIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 2 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  fieldInput: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    minWidth: 80,
    padding: 0,
  },
  unit: { fontSize: 14, fontFamily: "Inter_400Regular" },
  error: { fontSize: 13, fontFamily: "Inter_400Regular" },
  tipCard: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "flex-start",
  },
  tipText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },
  exerciseCard: { padding: 14, borderRadius: 14, borderWidth: 1, gap: 7 },
  exerciseTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  exerciseHint: { fontSize: 12, fontFamily: "Inter_400Regular" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
