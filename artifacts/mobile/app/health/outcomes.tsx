import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
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
import { logInteractionEvent } from "@/lib/events";
import { enqueueSync, SyncPaths } from "@/lib/syncClient";

type ScoreKey =
  | "confidence"
  | "knowledge"
  | "mobility"
  | "exerciseParticipation"
  | "nutritionQuality"
  | "sleepQuality"
  | "stressLevel"
  | "qualityOfLife";

interface OutcomeEntry extends Record<ScoreKey, number> {
  id: string;
  recordedAt: number;
  fallsLast90Days: number;
  fracturesLast12Months: number;
}

const DIMENSIONS: Array<{
  key: ScoreKey;
  label: string;
  low: string;
  high: string;
}> = [
  {
    key: "confidence",
    label: "Confidence managing bone health",
    low: "Low",
    high: "High",
  },
  {
    key: "knowledge",
    label: "Bone-health knowledge",
    low: "Limited",
    high: "Strong",
  },
  {
    key: "mobility",
    label: "Mobility",
    low: "Very limited",
    high: "Excellent",
  },
  {
    key: "exerciseParticipation",
    label: "Exercise participation",
    low: "Rare",
    high: "Consistent",
  },
  {
    key: "nutritionQuality",
    label: "Nutrition quality",
    low: "Needs support",
    high: "Excellent",
  },
  {
    key: "sleepQuality",
    label: "Sleep quality",
    low: "Poor",
    high: "Excellent",
  },
  {
    key: "stressLevel",
    label: "Stress management",
    low: "Struggling",
    high: "Managing well",
  },
  {
    key: "qualityOfLife",
    label: "Overall quality of life",
    low: "Low",
    high: "Excellent",
  },
];

const initialScores = Object.fromEntries(
  DIMENSIONS.map((dimension) => [dimension.key, 3]),
) as Record<ScoreKey, number>;

export default function OutcomesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [scores, setScores] = useState(initialScores);
  const [falls, setFalls] = useState("0");
  const [fractures, setFractures] = useState("0");
  const [saving, setSaving] = useState(false);
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  async function save() {
    if (!user?.id || saving) return;
    setSaving(true);
    try {
      const now = Date.now();
      const entry: OutcomeEntry = {
        id: `outcome-${now}`,
        recordedAt: now,
        ...scores,
        fallsLast90Days: Math.max(
          0,
          Math.min(99, Number.parseInt(falls, 10) || 0),
        ),
        fracturesLast12Months: Math.max(
          0,
          Math.min(99, Number.parseInt(fractures, 10) || 0),
        ),
      };
      const key = `@snaplife/outcomes/v1:${user.id}`;
      const existingRaw = await AsyncStorage.getItem(key);
      const existing = existingRaw ? JSON.parse(existingRaw) : [];
      const next = [entry, ...(Array.isArray(existing) ? existing : [])].slice(
        0,
        60,
      );
      await AsyncStorage.setItem(key, JSON.stringify(next));
      await enqueueSync({
        appUserId: user.id,
        domain: "outcomes",
        modifier: entry.id,
        method: "POST",
        path: SyncPaths.outcomes(),
        body: { entryId: entry.id, entry, recordedAtMs: now },
      });
      logInteractionEvent({
        appUserId: user.id,
        kind: "outcome_checkin_completed",
        payload: { entryId: entry.id },
      });
      Alert.alert(
        "Check-in saved",
        "Your progress can now be compared over time.",
        [{ text: "Done", onPress: () => router.back() }],
      );
    } catch {
      Alert.alert("Couldn't save", "Please try again in a moment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 8, borderBottomColor: colors.border },
        ]}
      >
        <Pressable onPress={() => router.back()} accessibilityLabel="Back">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Progress check-in
        </Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          A short self-reported check-in. Your answers support your personal
          trends and, only with your consent, anonymised community outcomes.
        </Text>

        {DIMENSIONS.map((dimension) => (
          <Card key={dimension.key} variant="outlined" style={styles.scoreCard}>
            <Text style={[styles.label, { color: colors.foreground }]}>
              {dimension.label}
            </Text>
            <View style={styles.scoreRow}>
              {[1, 2, 3, 4, 5].map((value) => {
                const selected = scores[dimension.key] === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() =>
                      setScores((prev) => ({ ...prev, [dimension.key]: value }))
                    }
                    style={[
                      styles.scoreButton,
                      {
                        backgroundColor: selected
                          ? colors.primary
                          : colors.muted,
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={{ color: selected ? "#fff" : colors.foreground }}
                    >
                      {value}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.scaleLabels}>
              <Text
                style={[styles.scaleText, { color: colors.mutedForeground }]}
              >
                {dimension.low}
              </Text>
              <Text
                style={[styles.scaleText, { color: colors.mutedForeground }]}
              >
                {dimension.high}
              </Text>
            </View>
          </Card>
        ))}

        <Card variant="outlined" style={styles.scoreCard}>
          <Text style={[styles.label, { color: colors.foreground }]}>
            Safety outcomes
          </Text>
          <View style={styles.inputRow}>
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.inputLabel, { color: colors.mutedForeground }]}
              >
                Falls in last 90 days
              </Text>
              <TextInput
                value={falls}
                onChangeText={setFalls}
                keyboardType="number-pad"
                maxLength={2}
                style={[
                  styles.input,
                  { color: colors.foreground, borderColor: colors.border },
                ]}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.inputLabel, { color: colors.mutedForeground }]}
              >
                Fractures in last 12 months
              </Text>
              <TextInput
                value={fractures}
                onChangeText={setFractures}
                keyboardType="number-pad"
                maxLength={2}
                style={[
                  styles.input,
                  { color: colors.foreground, borderColor: colors.border },
                ]}
              />
            </View>
          </View>
        </Card>

        <Pressable
          onPress={save}
          disabled={saving}
          style={[
            styles.saveButton,
            { backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 },
          ]}
        >
          <Text style={styles.saveText}>
            {saving ? "Saving…" : "Save check-in"}
          </Text>
        </Pressable>
      </ScrollView>
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
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  content: { padding: 16, gap: 12 },
  intro: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
    marginBottom: 4,
  },
  scoreCard: { padding: 14 },
  label: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 12 },
  scoreRow: { flexDirection: "row", gap: 8 },
  scoreButton: {
    flex: 1,
    aspectRatio: 1,
    maxHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scaleLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 7,
  },
  scaleText: { fontSize: 10, fontFamily: "Inter_400Regular" },
  inputRow: { flexDirection: "row", gap: 12 },
  inputLabel: { fontSize: 11, minHeight: 30, fontFamily: "Inter_400Regular" },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginTop: 5,
  },
  saveButton: {
    minHeight: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  saveText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
});
