import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
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

import { Card } from "@/components/ui/Card";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

const GENDERS = ["Woman", "Man", "Non-binary", "Prefer not to say"];
const CONDITIONS = [
  "Rheumatoid arthritis",
  "Coeliac disease",
  "Thyroid condition",
  "Diabetes",
  "Menopause",
  "Chronic kidney disease",
  "Long-term steroid use",
];
const FRACTURE_LOCATIONS = [
  "Hip",
  "Spine",
  "Wrist",
  "Shoulder",
  "Pelvis",
  "Other",
];

function ChoiceChips({
  values,
  selected,
  onToggle,
  single = false,
}: {
  values: string[];
  selected: string[];
  onToggle: (value: string) => void;
  single?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={styles.chips}>
      {values.map((value) => {
        const active = selected.includes(value);
        return (
          <Pressable
            key={value}
            accessibilityRole={single ? "radio" : "checkbox"}
            accessibilityState={{ checked: active }}
            onPress={() => onToggle(value)}
            style={[
              styles.chip,
              {
                borderColor: active ? colors.primary : colors.border,
                backgroundColor: active ? colors.primary : "transparent",
              },
            ]}
          >
            <Text
              style={[
                styles.chipText,
                { color: active ? "#fff" : colors.foreground },
              ]}
            >
              {value}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function HealthProfileDetailsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, updateUser } = useAuth();
  const [gender, setGender] = useState(user?.gender ?? "");
  const [diagnosisYear, setDiagnosisYear] = useState(
    user?.diagnosisYear?.toString() ?? "",
  );
  const [conditions, setConditions] = useState(
    user?.coexistingConditions ?? [],
  );
  const [fractureLocations, setFractureLocations] = useState(
    user?.fractureHistory?.map((item) => item.location) ?? [],
  );
  const [fractureYear, setFractureYear] = useState(
    user?.fractureHistory?.[0]?.year?.toString() ?? "",
  );
  const [saving, setSaving] = useState(false);

  const toggle = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    value: string,
  ) =>
    setter((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );

  async function save() {
    const diagnosis = diagnosisYear ? Number(diagnosisYear) : undefined;
    const fracture = fractureYear ? Number(fractureYear) : undefined;
    const currentYear = new Date().getFullYear();
    if (diagnosis && (diagnosis < 1900 || diagnosis > currentYear)) {
      Alert.alert(
        "Check diagnosis year",
        `Enter a year between 1900 and ${currentYear}.`,
      );
      return;
    }
    if (fracture && (fracture < 1900 || fracture > currentYear)) {
      Alert.alert(
        "Check fracture year",
        `Enter a year between 1900 and ${currentYear}.`,
      );
      return;
    }
    setSaving(true);
    try {
      await updateUser({
        gender: gender || undefined,
        diagnosisYear: diagnosis,
        coexistingConditions: conditions,
        fractureHistory: fractureLocations.map((location) => ({
          location,
          year: fracture,
        })),
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch {
      Alert.alert("Could not save", "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const top = Platform.OS === "web" ? 67 : insets.top;
  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View
        style={[
          styles.header,
          {
            paddingTop: top + 8,
            borderBottomColor: colors.border,
            backgroundColor: colors.card,
          },
        ]}
      >
        <Pressable onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Health profile details
        </Text>
        <Pressable
          disabled={saving}
          onPress={save}
          style={[
            styles.save,
            { backgroundColor: colors.primary, opacity: saving ? 0.65 : 1 },
          ]}
        >
          <Text style={styles.saveText}>{saving ? "Saving…" : "Save"}</Text>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          These optional details improve anonymised community comparisons. You
          control sharing separately in Privacy settings.
        </Text>
        <Card variant="outlined" style={styles.card}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Gender
          </Text>
          <ChoiceChips
            values={GENDERS}
            selected={gender ? [gender] : []}
            single
            onToggle={(value) => setGender(gender === value ? "" : value)}
          />
        </Card>
        <Card variant="outlined" style={styles.card}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Diagnosis
          </Text>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            Year diagnosed (optional)
          </Text>
          <TextInput
            value={diagnosisYear}
            onChangeText={setDiagnosisYear}
            keyboardType="number-pad"
            maxLength={4}
            placeholder="e.g. 2021"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.foreground },
            ]}
          />
        </Card>
        <Card variant="outlined" style={styles.card}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Related health factors
          </Text>
          <ChoiceChips
            values={CONDITIONS}
            selected={conditions}
            onToggle={(value) => toggle(setConditions, value)}
          />
        </Card>
        <Card variant="outlined" style={styles.card}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Previous fractures
          </Text>
          <ChoiceChips
            values={FRACTURE_LOCATIONS}
            selected={fractureLocations}
            onToggle={(value) => toggle(setFractureLocations, value)}
          />
          {fractureLocations.length > 0 && (
            <>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>
                Approximate year (optional)
              </Text>
              <TextInput
                value={fractureYear}
                onChangeText={setFractureYear}
                keyboardType="number-pad"
                maxLength={4}
                placeholder="e.g. 2019"
                placeholderTextColor={colors.mutedForeground}
                style={[
                  styles.input,
                  { borderColor: colors.border, color: colors.foreground },
                ]}
              />
            </>
          )}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { flex: 1, fontSize: 17, fontFamily: "Inter_700Bold" },
  save: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  saveText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
  content: { padding: 16, gap: 12 },
  intro: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
  card: { gap: 10 },
  title: { fontSize: 15, fontFamily: "Inter_700Bold" },
  label: { fontSize: 12, fontFamily: "Inter_500Medium" },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  chipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
