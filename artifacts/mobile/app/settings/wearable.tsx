import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/ui/Card";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { logInteractionEvent } from "@/lib/events";

const PLANNED_DEVICES = [
  { id: "apple", name: "Apple Health", icon: "heart" as const },
  { id: "fitbit", name: "Fitbit", icon: "watch" as const },
  { id: "garmin", name: "Garmin Connect", icon: "navigation" as const },
];

export default function WearableScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const [notified, setNotified] = useState(false);

  function handleNotifyMe() {
    if (notified) return;
    setNotified(true);
    logInteractionEvent({
      appUserId: user?.id,
      kind: "wearables_interest",
      payload: { surface: "settings_wearable" },
    });
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Wearable Devices</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 20 }]}
        showsVerticalScrollIndicator={false}
      >
        <Card style={styles.heroCard} variant="elevated">
          <LinearGradient
            colors={colors.gradients.calm as [string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroGradient}
          >
            <View style={styles.heroIconWrap}>
              <Feather name="watch" size={28} color="#fff" />
            </View>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>Coming soon</Text>
            </View>
            <Text style={styles.heroTitle}>Wearable sync is on the way</Text>
            <Text style={styles.heroBody}>
              Soon you'll be able to connect your wearable so steps, activity,
              and movement flow into SNAP Life automatically. We're working on
              support for the devices below — no setup needed today.
            </Text>
          </LinearGradient>
        </Card>

        <View style={styles.plannedHeader}>
          <Text style={[styles.plannedTitle, { color: colors.foreground }]}>Planned integrations</Text>
        </View>

        {PLANNED_DEVICES.map((d) => (
          <Card key={d.id} style={styles.deviceCard} variant="outlined">
            <View style={styles.deviceRow}>
              <View style={[styles.deviceIcon, { backgroundColor: colors.primary + "14" }]}>
                <Feather name={d.icon} size={22} color={colors.primary} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.deviceName, { color: colors.foreground }]}>{d.name}</Text>
                <Text style={[styles.deviceDesc, { color: colors.mutedForeground }]}>
                  Sync coming soon
                </Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: colors.muted }]}>
                <Text style={[styles.statusPillText, { color: colors.mutedForeground }]}>
                  Soon
                </Text>
              </View>
            </View>
          </Card>
        ))}

        <Pressable
          onPress={handleNotifyMe}
          disabled={notified}
          style={[
            styles.notifyBtn,
            { backgroundColor: notified ? colors.muted : colors.primary },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Notify me when wearables are ready"
        >
          <Feather
            name={notified ? "check" : "bell"}
            size={16}
            color={notified ? colors.mutedForeground : "#fff"}
          />
          <Text
            style={[
              styles.notifyBtnText,
              { color: notified ? colors.mutedForeground : "#fff" },
            ]}
          >
            {notified ? "We'll let you know" : "Notify me when ready"}
          </Text>
        </Pressable>
        <Text style={[styles.notifyFootnote, { color: colors.mutedForeground }]}>
          You'll see an in-app message as soon as wearable sync is live.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  content: { padding: 16, gap: 14 },
  heroCard: { padding: 0, overflow: "hidden" },
  heroGradient: { padding: 20, gap: 10 },
  heroIconWrap: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center", justifyContent: "center",
  },
  heroBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.22)",
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },
  heroBadgeText: { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
  heroTitle: { color: "#fff", fontSize: 18, fontFamily: "Inter_700Bold" },
  heroBody: { color: "rgba(255,255,255,0.92)", fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
  plannedHeader: { paddingTop: 4, paddingHorizontal: 4 },
  plannedTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", letterSpacing: 0.3, textTransform: "uppercase" },
  deviceCard: { padding: 14 },
  deviceRow: { flexDirection: "row", alignItems: "center" },
  deviceIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  deviceName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  deviceDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusPillText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.3 },
  notifyBtn: {
    marginTop: 6, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 14,
  },
  notifyBtnText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  notifyFootnote: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: -4 },
});
