/**
 * Movement library — small list of calm, beginner-friendly routines.
 *
 * General-guidance disclaimer is shown at the top so the user (and the
 * App Store reviewer) is clear this is not clinical advice. Tapping a
 * routine routes to the detail view where the user can run through the
 * steps and tap "I did it" to log activity.
 */

import { Feather } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
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

import { Card } from "@/components/ui/Card";
import { useColors } from "@/hooks/useColors";
import { MOVEMENT_ROUTINES, type MovementRoutine } from "@/lib/movement";

export default function MovementLibraryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const accentFor = (a: MovementRoutine["accent"]) => colors[a];

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
            <Text style={[styles.title, { color: colors.foreground }]}>Movement</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Short, calm routines for steadier bones.
            </Text>
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          <Card
            variant="outlined"
            style={{
              ...styles.disclaimer,
              borderColor: colors.warning + "55",
              backgroundColor: colors.warning + "10",
            }}
          >
            <Feather name="info" size={14} color={colors.warning} />
            <Text style={[styles.disclaimerText, { color: colors.foreground }]}>
              <Text style={{ fontFamily: "Inter_700Bold" }}>General guidance, not clinical advice.</Text>
              {" "}If anything feels painful, stop and talk to your doctor or physiotherapist before continuing.
            </Text>
          </Card>

          {MOVEMENT_ROUTINES.map((r) => {
            const accent = accentFor(r.accent);
            return (
              <Pressable
                key={r.id}
                onPress={() => router.push(`/movement/${r.id}` as never)}
                accessibilityRole="button"
                accessibilityLabel={`${r.title}. ${r.tagline}. ${r.durationMin} minutes.`}
              >
                <Card variant="outlined" style={styles.routineCard}>
                  <View style={[styles.iconWrap, { backgroundColor: accent + "1F" }]}>
                    <Feather name={r.icon as never} size={20} color={accent} />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={[styles.routineTitle, { color: colors.foreground }]}>
                      {r.title}
                    </Text>
                    <Text style={[styles.routineSub, { color: colors.mutedForeground }]}>
                      {r.tagline}
                    </Text>
                    <View style={styles.metaRow}>
                      <View style={[styles.metaChip, { backgroundColor: accent + "14" }]}>
                        <Feather name="clock" size={10} color={accent} />
                        <Text style={[styles.metaText, { color: accent }]}>
                          {r.durationMin} min
                        </Text>
                      </View>
                      <Text
                        style={[styles.equipmentText, { color: colors.mutedForeground }]}
                        numberOfLines={1}
                      >
                        {r.equipment}
                      </Text>
                    </View>
                  </View>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </Card>
              </Pressable>
            );
          })}
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
  scroll: { padding: 16, gap: 12 },
  disclaimer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
  },
  disclaimerText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, flex: 1 },
  routineCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  routineTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  routineSub: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 99,
  },
  metaText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  equipmentText: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1 },
});
