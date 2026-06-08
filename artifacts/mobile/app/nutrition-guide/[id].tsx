/**
 * Nutrition guide article — short, practical "how to" reads opened from the
 * Guides tab on the meal-plan screen.
 */

import { Feather } from "@expo/vector-icons";
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

import { Card } from "@/components/ui/Card";
import { useColors } from "@/hooks/useColors";
import { getGuideById } from "@/lib/nutritionData";

export default function NutritionGuideScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const guide = getGuideById(typeof id === "string" ? id : undefined);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  if (!guide) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Guide</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.empty}>
          <Feather name="alert-circle" size={36} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Guide not found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Guide</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.metaRow}>
          <Feather name="clock" size={12} color={colors.mutedForeground} />
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
            {guide.readMins} min read
          </Text>
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>{guide.title}</Text>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>{guide.intro}</Text>

        {guide.sections.map((section) => (
          <Card key={section.heading} variant="outlined" style={styles.sectionCard}>
            <Text style={[styles.sectionHeading, { color: colors.primary }]}>{section.heading}</Text>
            <Text style={[styles.sectionBody, { color: colors.foreground }]}>{section.body}</Text>
            {section.bullets && (
              <View style={styles.bulletList}>
                {section.bullets.map((b) => (
                  <View key={b} style={styles.bulletRow}>
                    <View style={[styles.bullet, { backgroundColor: colors.primary }]} />
                    <Text style={[styles.bulletText, { color: colors.foreground }]}>{b}</Text>
                  </View>
                ))}
              </View>
            )}
          </Card>
        ))}

        <View
          style={[
            styles.closing,
            { backgroundColor: colors.accent + "10", borderColor: colors.accent + "25" },
          ]}
        >
          <Feather name="heart" size={14} color={colors.accent} />
          <Text style={[styles.closingText, { color: colors.foreground }]}>{guide.closing}</Text>
        </View>
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
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  content: { padding: 16, gap: 14 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", lineHeight: 30 },
  intro: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  sectionCard: { gap: 8 },
  sectionHeading: { fontSize: 14, fontFamily: "Inter_700Bold" },
  sectionBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  bulletList: { gap: 8, marginTop: 4 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  bulletText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  closing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  closingText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 18 },
  empty: { alignItems: "center", paddingVertical: 80, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
});
