/**
 * Movement routine detail.
 *
 * Renders a routine's steps as a calm, numbered list with optional
 * pacing details. The "I did it" CTA at the bottom logs an activity
 * entry (using `routine.durationMin` as activeMinutes) and routes back
 * to the library. The button locks once tapped to avoid double-logs.
 */

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card } from "@/components/ui/Card";
import { useHealth } from "@/context/HealthContext";
import { useColors } from "@/hooks/useColors";
import { findRoutine } from "@/lib/movement";
import { todayLocalISO } from "@/lib/weeklySnap";

export default function MovementDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { logActivity, todayActivity } = useHealth();

  const routine = useMemo(() => findRoutine(typeof id === "string" ? id : null), [id]);
  const [logging, setLogging] = useState(false);
  const [done, setDone] = useState(false);
  // Hard guard against rapid double-taps. State (`logging`/`done`) takes
  // a render to update, so a fast second press could enter `onDidIt`
  // again before the React state has flipped — this ref blocks it
  // synchronously.
  const inflightRef = React.useRef(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  if (!routine) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.container, { backgroundColor: colors.background, padding: 24 }]}>
          <Text style={[styles.title, { color: colors.foreground, marginTop: topPadding + 16 }]}>
            Routine not found
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={[styles.cta, { backgroundColor: colors.primary, marginTop: 16 }]}
          >
            <Text style={[styles.ctaText, { color: "#fff" }]}>Back</Text>
          </Pressable>
        </View>
      </>
    );
  }

  const accent = colors[routine.accent];

  const onDidIt = async () => {
    if (logging || done || inflightRef.current) return;
    inflightRef.current = true;
    setLogging(true);
    try {
      // Merge into today's activity log if one exists; otherwise create
      // a small new entry. Steps/calories/distance default conservatively
      // so we don't overstate effort the user didn't claim.
      const today = todayLocalISO();
      await logActivity({
        date: today,
        steps: todayActivity?.steps ?? 0,
        calories: (todayActivity?.calories ?? 0) + Math.max(15, routine.durationMin * 4),
        activeMinutes: (todayActivity?.activeMinutes ?? 0) + routine.durationMin,
        distance: todayActivity?.distance ?? 0,
      });
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
          () => {},
        );
      }
      setDone(true);
      // Briefly show the "Done" state, then route back so the user lands
      // on the library again.
      setTimeout(() => router.back(), 900);
    } finally {
      setLogging(false);
      // Note: we intentionally leave `inflightRef.current = true` so the
      // brief "Logged" window before navigation can't be double-fired.
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.topBar,
            { paddingTop: topPadding + 8, borderBottomColor: colors.border },
          ]}
        >
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
            <Feather name="chevron-left" size={22} color={colors.foreground} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {routine.title}
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {routine.tagline}
            </Text>
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.metaRow}>
            <View style={[styles.metaChip, { backgroundColor: accent + "18" }]}>
              <Feather name="clock" size={11} color={accent} />
              <Text style={[styles.metaText, { color: accent }]}>
                {routine.durationMin} min
              </Text>
            </View>
            <View style={[styles.metaChip, { backgroundColor: colors.muted }]}>
              <Feather name="package" size={11} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                {routine.equipment}
              </Text>
            </View>
          </View>

          <Card variant="outlined" style={styles.intentCard}>
            <Text style={[styles.intentText, { color: colors.foreground }]}>
              {routine.intent}
            </Text>
          </Card>

          <Card
            variant="outlined"
            style={{
              ...styles.disclaimer,
              borderColor: colors.warning + "55",
              backgroundColor: colors.warning + "10",
            }}
          >
            <Feather name="info" size={13} color={colors.warning} />
            <Text style={[styles.disclaimerText, { color: colors.foreground }]}>
              General guidance only — not clinical advice. Stop if anything hurts.
            </Text>
          </Card>

          {routine.steps.map((s, idx) => (
            <Card key={idx} variant="outlined" style={styles.stepCard}>
              <View style={[styles.stepNumber, { backgroundColor: accent + "1F" }]}>
                <Text style={[styles.stepNumberText, { color: accent }]}>{idx + 1}</Text>
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.stepText, { color: colors.foreground }]}>{s.text}</Text>
                {s.detail ? (
                  <Text style={[styles.stepDetail, { color: colors.mutedForeground }]}>
                    {s.detail}
                  </Text>
                ) : null}
              </View>
            </Card>
          ))}

          <Pressable
            onPress={onDidIt}
            disabled={logging || done}
            style={[
              styles.cta,
              {
                backgroundColor: done ? colors.success : accent,
                opacity: logging ? 0.8 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: logging || done }}
          >
            <Feather name={done ? "check" : "check-circle"} size={16} color="#fff" />
            <Text style={[styles.ctaText, { color: "#fff" }]}>
              {done ? "Logged" : logging ? "Saving…" : "I did it"}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    gap: 4,
  },
  backBtn: { padding: 6, marginRight: 4 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  scroll: { padding: 16, gap: 10 },
  metaRow: { flexDirection: "row", gap: 8, marginBottom: 4 },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 99,
  },
  metaText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  intentCard: { gap: 4 },
  intentText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  disclaimer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
  },
  disclaimerText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  stepCard: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  stepText: { fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 20 },
  stepDetail: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 8,
  },
  ctaText: { fontSize: 15, fontFamily: "Inter_700Bold" },
});
