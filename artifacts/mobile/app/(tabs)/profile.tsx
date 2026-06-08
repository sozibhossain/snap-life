import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/ui/Card";
import { XPBar } from "@/components/ui/XPBar";
import { ReferFriendCard } from "@/components/ReferFriendCard";
import { useAuth } from "@/context/AuthContext";
import { useGamification } from "@/context/GamificationContext";
import { useColors } from "@/hooks/useColors";
import { useSubscription } from "@/lib/revenuecat";

const MENU_ITEMS = [
  { id: "subscription", label: "Subscription & Plan", icon: "star" as const, route: "/subscription", accent: true },
  { id: "edit", label: "Edit Profile", icon: "user" as const, route: "/settings/profile-edit", accent: false },
  { id: "notifications", label: "Notifications", icon: "bell" as const, route: "/settings/notifications", accent: false },
  { id: "privacy", label: "Privacy & Data", icon: "shield" as const, route: "/settings/privacy", accent: false },
  { id: "wearable", label: "Wearable Devices", icon: "watch" as const, route: "/settings/wearable", accent: false },
  { id: "rewards", label: "Rewards Shop", icon: "gift" as const, route: "/rewards", accent: false },
  { id: "feedback", label: "Send Feedback", icon: "message-circle" as const, route: "/feedback", accent: false },
  { id: "help", label: "Help & Support", icon: "help-circle" as const, route: "/settings/help", accent: false },
];

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { achievements, rewards } = useGamification();
  const { tier, tierLabel, trialDayLabel, trialDaysRemaining, trialEndsAt, trialEndedAt } = useSubscription();
  // Tier accent: trial = orange (urgency), premium = primary, plus = neutral.
  const tierAccent =
    tier === "trial"
      ? colors.accent
      : tier === "premium"
      ? colors.primary
      : tier === "plus"
      ? colors.primary
      : colors.mutedForeground;
  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const earned = achievements.filter((a) => a.earned);
  const redeemed = rewards.filter((r) => r.redeemed);

  function handleLogout() {
    if (Platform.OS === "web") {
      logout();
      return;
    }
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: logout },
    ]);
  }

  const conditionLabel =
    user?.condition === "osteoporosis"
      ? "Osteoporosis"
      : user?.condition === "osteopenia"
      ? "Osteopenia"
      : "Monitoring";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Bold gradient hero header — `calm` (deep teal → cyan) is the
          third brand-distinct accent in the rotation (Health Hub uses
          `insight` navy/cyan, Community uses `warmth` orange/peach, and
          Bone Buddy uses `insight`). The avatar + name + condition badge
          lift up into the gradient strip so Profile carries the same
          bold-header treatment as the other primary surfaces. */}
      <LinearGradient
        colors={colors.gradients.calm}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.heroBar,
          { paddingTop: topPadding + 14 },
          colors.shadows.sm,
        ]}
      >
        <Pressable
          style={styles.heroAvatar}
          onPress={() => router.push("/settings/profile-edit")}
          accessibilityRole="button"
          accessibilityLabel="Edit profile photo"
        >
          {user?.avatar ? (
            <Image
              source={{ uri: user.avatar }}
              style={styles.heroAvatarImage}
            />
          ) : (
            <Text style={styles.heroAvatarText}>
              {user?.name?.charAt(0) ?? "S"}
            </Text>
          )}
        </Pressable>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={styles.heroName} numberOfLines={1}>
            {user?.name ?? "There"}
          </Text>
          <Text style={styles.heroEmail} numberOfLines={1}>
            {user?.email ?? ""}
          </Text>
          {/* Age and location chips — shown only when set */}
          {(user?.age != null || user?.location) && (
            <View style={styles.heroMeta}>
              {(() => {
                const displayAge = user?.dateOfBirth
                  ? (() => {
                      const birth = new Date(user.dateOfBirth!);
                      if (isNaN(birth.getTime())) return user?.age;
                      const today = new Date();
                      let a = today.getFullYear() - birth.getFullYear();
                      const m = today.getMonth() - birth.getMonth();
                      if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) a--;
                      return a >= 0 && a < 130 ? a : user?.age;
                    })()
                  : user?.age;
                return displayAge != null ? (
                  <View style={styles.heroMetaChip}>
                    <Feather name="user" size={10} color="rgba(255,255,255,0.75)" />
                    <Text style={styles.heroMetaText}>{displayAge} yrs</Text>
                  </View>
                ) : null;
              })()}
              {user?.location ? (
                <View style={styles.heroMetaChip}>
                  <Feather name="map-pin" size={10} color="rgba(255,255,255,0.75)" />
                  <Text style={styles.heroMetaText} numberOfLines={1}>{user.location}</Text>
                </View>
              ) : null}
            </View>
          )}
          <View style={styles.heroBadge}>
            <View
              style={[
                styles.heroBadgeDot,
                {
                  backgroundColor:
                    user?.condition === "osteoporosis"
                      ? colors.destructive
                      : user?.condition === "osteopenia"
                      ? colors.warning
                      : colors.success,
                },
              ]}
            />
            <Text style={styles.heroBadgeText}>{conditionLabel}</Text>
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: Platform.OS === "web" ? 34 + 84 : insets.bottom + 84,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
      {user && (
        <Card style={styles.xpCard} variant="elevated">
          <XPBar xp={user.xp} xpToNext={user.xpToNextLevel} level={user.level} />
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {user.streakDays}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                Day Streak
              </Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {earned.length}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                Achievements
              </Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {user.totalPoints.toLocaleString()}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                Total XP
              </Text>
            </View>
          </View>
        </Card>
      )}

      {earned.length > 0 && (
        <View>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Recent Achievements
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.badgeRow}
          >
            {earned.map((a) => (
              <View key={a.id} style={[styles.badgeItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.badgeIcon, { backgroundColor: colors.success + "20" }]}>
                  <Feather name={a.icon as any} size={20} color={colors.success} />
                </View>
                <Text style={[styles.badgeName, { color: colors.foreground }]} numberOfLines={1}>
                  {a.title}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
        Account & Settings
      </Text>
      <Card variant="outlined" style={styles.menuCard}>
        {MENU_ITEMS.map((item, i) => {
          const iconColor = item.accent ? colors.accent : colors.primary;
          const iconBg = item.accent ? colors.accent + "14" : colors.primary + "14";
          return (
            <Pressable
              key={item.id}
              style={[
                styles.menuItem,
                i < MENU_ITEMS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
              ]}
              onPress={() => router.push(item.route as any)}
            >
              <View style={[styles.menuIcon, { backgroundColor: iconBg }]}>
                <Feather name={item.icon} size={16} color={iconColor} />
              </View>
              <Text style={[styles.menuLabel, { color: colors.foreground }]}>
                {item.label}
              </Text>
              {item.accent && (
                <View style={[styles.planChip, { backgroundColor: tierAccent }]}>
                  <Text style={styles.planChipText}>{tierLabel.toUpperCase()}</Text>
                </View>
              )}
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </Pressable>
          );
        })}
      </Card>

      {tier === "trial" ? (
        <Pressable
          style={[styles.trialBanner, { backgroundColor: colors.accent + "12", borderColor: colors.accent + "30" }]}
          onPress={() => router.push("/subscription")}
        >
          <View style={[styles.trialIconWrap, { backgroundColor: colors.accent + "20" }]}>
            <Feather name="clock" size={18} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.trialTitle, { color: colors.foreground }]}>
              {trialDayLabel ?? "Free trial active"}
              {trialDaysRemaining !== null ? `  ·  ${trialDaysRemaining}d left` : ""}
            </Text>
            <Text style={[styles.trialSub, { color: colors.mutedForeground }]}>
              {trialEndsAt
                ? `Full access until ${new Date(trialEndsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} — choose a plan to continue.`
                : "Full access included. Tap to choose your plan."}
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.accent} />
        </Pressable>
      ) : tier === "free" ? (
        <Pressable
          style={[styles.trialBanner, { backgroundColor: colors.accent + "12", borderColor: colors.accent + "30" }]}
          onPress={() => router.push("/subscription")}
        >
          <View style={[styles.trialIconWrap, { backgroundColor: colors.accent + "20" }]}>
            <Feather name={trialEndedAt ? "clock" : "star"} size={18} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.trialTitle, { color: colors.foreground }]}>
              {trialEndedAt ? "Your free trial has ended" : "Try SNAP Plus free for 30 days"}
            </Text>
            <Text style={[styles.trialSub, { color: colors.mutedForeground }]}>
              {trialEndedAt
                ? "Choose a plan to continue — flexible plans, cancel anytime."
                : "No charge today. Unlock AI coaching, meal plans and the full wellness studio."}
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.accent} />
        </Pressable>
      ) : tier === "plus" ? (
        <Pressable
          style={[styles.trialBanner, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}
          onPress={() => router.push("/subscription")}
        >
          <View style={[styles.trialIconWrap, { backgroundColor: colors.primary + "20" }]}>
            <Feather name="zap" size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.trialTitle, { color: colors.foreground }]}>
              Upgrade to SNAP Premium
            </Text>
            <Text style={[styles.trialSub, { color: colors.mutedForeground }]}>
              Advanced AI coaching, guided programs & full meditation library.
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.primary} />
        </Pressable>
      ) : (
        <Pressable
          style={[styles.trialBanner, { backgroundColor: colors.success + "12", borderColor: colors.success + "30" }]}
          onPress={() => router.push("/subscription")}
        >
          <View style={[styles.trialIconWrap, { backgroundColor: colors.success + "20" }]}>
            <Feather name="check" size={18} color={colors.success} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.trialTitle, { color: colors.foreground }]}>
              SNAP {tierLabel} — full access
            </Text>
            <Text style={[styles.trialSub, { color: colors.mutedForeground }]}>
              Manage or change your plan anytime.
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.success} />
        </Pressable>
      )}

      <ReferFriendCard />

      <Pressable
        style={[styles.logoutBtn, { borderColor: colors.border }]}
        onPress={handleLogout}
      >
        <Feather name="log-out" size={16} color={colors.destructive} />
        <Text style={[styles.logoutText, { color: colors.destructive }]}>
          Sign Out
        </Text>
      </Pressable>

      <Text style={[styles.version, { color: colors.mutedForeground }]}>
        SNAP Life v1.0.0
      </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 16 },

  // Gradient hero header (calm: deep teal → cyan)
  heroBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  heroAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  heroAvatarText: { color: "#fff", fontSize: 22, fontFamily: "Inter_700Bold" },
  heroAvatarImage: { width: 56, height: 56, borderRadius: 28 },
  heroName: {
    fontSize: 19,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    letterSpacing: -0.2,
  },
  heroEmail: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.78)",
    marginTop: 1,
  },
  heroMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  heroMetaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 20,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  heroMetaText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.85)",
  },
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  heroBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  heroBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.2,
  },

  xpCard: { marginBottom: 24 },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  statItem: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  statDivider: { width: 1, height: 30 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 12 },
  badgeRow: { gap: 10, paddingBottom: 16 },
  badgeItem: {
    width: 80,
    alignItems: "center",
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  badgeIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeName: { fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center" },
  menuCard: { marginBottom: 20 },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  menuIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  menuLabel: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  planChip: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    marginRight: 4,
  },
  planChipText: { color: "#fff", fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  trialBanner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 16,
    gap: 12,
  },
  trialIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  trialTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  trialSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  logoutText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  version: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
});
