/**
 * AdminReviewPanel
 *
 * A floating tester shortcut panel that appears in staging builds (or dev
 * mode) for admin and tester accounts. Lets QA navigate to any screen in one
 * tap without going through the full user journey each time.
 *
 * Gate: EXPO_PUBLIC_SNAP_ENV === "staging" || __DEV__
 *       AND (isAdmin || isTester)
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

const IS_QA_BUILD =
  process.env.EXPO_PUBLIC_SNAP_ENV === "staging" || __DEV__;

// ─── Nav link data ────────────────────────────────────────────────────────────

interface NavItem {
  label: string;
  path: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  color?: string;
}

const TABS: NavItem[] = [
  { label: "Home",       path: "/(tabs)",           icon: "home" },
  { label: "Health",     path: "/(tabs)/health",    icon: "activity" },
  { label: "Coach",      path: "/(tabs)/coach",     icon: "cpu" },
  { label: "Wellness",   path: "/(tabs)/wellness",  icon: "wind" },
  { label: "Learn",      path: "/(tabs)/learn",     icon: "book-open" },
  { label: "Community",  path: "/(tabs)/community", icon: "users" },
  { label: "Profile",    path: "/(tabs)/profile",   icon: "user" },
];

const QUICK_LINKS: NavItem[] = [
  { label: "Log DEXA Scan",     path: "/health/log-dexa",         icon: "layers" },
  { label: "Log Activity",      path: "/health/activity",         icon: "trending-up" },
  { label: "Log Nutrition",     path: "/health/nutrition",        icon: "droplet" },
  { label: "Supplements",       path: "/health/supplements",      icon: "package" },
  { label: "Meal Plan",         path: "/health/meal-plan",        icon: "coffee" },
  { label: "Breathing Studio",  path: "/breathing-studio",        icon: "wind" },
  { label: "Meditation",        path: "/meditation",              icon: "moon" },
  { label: "Movement Library",  path: "/movement/index",          icon: "zap" },
  { label: "Insights",          path: "/insights",                icon: "bar-chart-2" },
  { label: "SNAP Shot",         path: "/snap-shot",               icon: "camera" },
  { label: "Rewards",           path: "/rewards",                 icon: "award" },
];

const TESTING_LINKS: NavItem[] = [
  { label: "Subscription / Paywall", path: "/subscription",  icon: "star",           color: "#F47530" },
  { label: "Re-run Onboarding",      path: "/onboarding",    icon: "refresh-cw",     color: "#F47530" },
  { label: "Feedback",               path: "/feedback",      icon: "message-circle", color: "#F47530" },
  { label: "Wearable Settings",      path: "/settings/wearable",      icon: "watch",  color: "#F47530" },
  { label: "Notification Settings",  path: "/settings/notifications", icon: "bell",   color: "#F47530" },
  { label: "Privacy Settings",       path: "/settings/privacy",       icon: "lock",   color: "#F47530" },
];

// ─── Section ──────────────────────────────────────────────────────────────────

function Section({
  title,
  items,
  onNav,
  colors,
}: {
  title: string;
  items: NavItem[];
  onNav: (path: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
        {title}
      </Text>
      <View style={styles.grid}>
        {items.map((item) => (
          <Pressable
            key={item.path}
            style={[styles.gridItem, { backgroundColor: colors.background, borderColor: colors.border }]}
            onPress={() => onNav(item.path)}
          >
            <Feather name={item.icon} size={16} color={item.color ?? colors.primary} />
            <Text style={[styles.gridLabel, { color: colors.foreground }]} numberOfLines={2}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AdminReviewPanel() {
  const { isAdmin, isTester } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!IS_QA_BUILD) return null;
  if (!isAdmin && !isTester) return null;

  function navigate(path: string) {
    setOpen(false);
    // Small delay so the modal closes first
    setTimeout(() => router.push(path as never), 150);
  }

  const badgeColor = process.env.EXPO_PUBLIC_SNAP_ENV === "staging" ? "#D97706" : "#6366F1";

  return (
    <>
      {/* Floating FAB */}
      <Pressable
        style={[
          styles.fab,
          {
            backgroundColor: badgeColor,
            bottom: insets.bottom + 96,
          },
        ]}
        onPress={() => setOpen(true)}
        accessibilityLabel="Open Admin Review Panel"
        hitSlop={8}
      >
        <Feather name="tool" size={18} color="#fff" />
      </Pressable>

      {/* Panel modal */}
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)} />
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 },
          ]}
        >
          {/* Header */}
          <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
          <View style={styles.sheetHeader}>
            <View style={[styles.headerBadge, { backgroundColor: badgeColor + "18" }]}>
              <Feather name="tool" size={14} color={badgeColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
                Admin Review Mode
              </Text>
              <Text style={[styles.sheetSub, { color: colors.mutedForeground }]}>
                {process.env.EXPO_PUBLIC_SNAP_ENV === "staging"
                  ? "Staging environment — jump to any screen"
                  : "Dev mode — jump to any screen"}
              </Text>
            </View>
            <Pressable onPress={() => setOpen(false)} hitSlop={12}>
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Section title="Main Tabs"     items={TABS}          onNav={navigate} colors={colors} />
            <Section title="Log & Track"   items={QUICK_LINKS}   onNav={navigate} colors={colors} />
            <Section title="Test Flows"    items={TESTING_LINKS} onNav={navigate} colors={colors} />

            {/* Info row */}
            <View style={[styles.infoRow, { backgroundColor: badgeColor + "12", borderColor: badgeColor + "28" }]}>
              <Feather name="info" size={13} color={badgeColor} />
              <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
                This panel is only visible to admin and tester accounts. It never appears in the live app.
              </Text>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9998,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "88%",
    paddingTop: 12,
    paddingHorizontal: 20,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  headerBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    marginBottom: 1,
  },
  sheetSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  scrollContent: {
    gap: 20,
    paddingBottom: 8,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  gridItem: {
    width: "30.5%",
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    gap: 6,
  },
  gridLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    lineHeight: 14,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
});
