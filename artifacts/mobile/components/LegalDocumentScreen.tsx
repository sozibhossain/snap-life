import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
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
import type { LegalDocument } from "@/lib/legalDocuments";

export function LegalDocumentScreen({ document }: { document: LegalDocument }) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

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
          {document.title}
        </Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: bottomPad + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Card variant="outlined" style={styles.introCard}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            SNAP Life {document.title}
          </Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            Last updated: {document.lastUpdated}
          </Text>
          <Text style={[styles.intro, { color: colors.mutedForeground }]}>
            {document.intro}
          </Text>
        </Card>

        {document.sections.map((section) => (
          <Card key={section.title} variant="outlined" style={styles.card}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              {section.title}
            </Text>
            {section.body.map((paragraph) => (
              <Text
                key={paragraph}
                style={[styles.cardBody, { color: colors.mutedForeground }]}
              >
                {paragraph}
              </Text>
            ))}
          </Card>
        ))}
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
  headerTitle: {
    flex: 1,
    marginHorizontal: 12,
    textAlign: "center",
    fontSize: 17,
    fontFamily: "Inter_700Bold",
  },
  scroll: { padding: 16, gap: 12 },
  introCard: { padding: 16, gap: 8 },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  meta: { fontSize: 12, fontFamily: "Inter_500Medium" },
  intro: { fontSize: 13, lineHeight: 20, fontFamily: "Inter_400Regular" },
  card: { padding: 16, gap: 8 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  cardBody: { fontSize: 13, lineHeight: 20, fontFamily: "Inter_400Regular" },
});
