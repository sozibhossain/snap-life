/**
 * Dashboard — SNAP Life home screen.
 *
 * Visual language:
 *  • Hero header:   deep navy (#0D2530 → #1C3A4A) with glass stats strip
 *  • Quick Actions: dark-to-accent gradient tiles (navy base + brand accent)
 *  • Bone Buddy:    navy→teal multi-stop banner with floating depth circles
 *  • My Insights:   full navy card (dark section for rhythm contrast)
 *  • Community:     warm card with brand-orange accent top bar
 *
 * All colours flow through useColors() / the design token system so dark
 * mode picks up correctly. The few hardcoded hex values (#0D2530, #4c1d95,
 * #9a3412) are intentional — they are deeper shades used only for the
 * dark gradient bases that don't need a light/dark variant.
 */
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BillingIssueBanner } from "@/components/BillingIssueBanner";
import { LearnPromptModal } from "@/components/LearnPromptModal";
import { TodaysFocusCard } from "@/components/TodaysFocusCard";
import { TrialEndedBanner } from "@/components/TrialEndedBanner";
import { TrialPromptCard } from "@/components/TrialPromptCard";
import { useAuth } from "@/context/AuthContext";
import { useHealth, worstTScore } from "@/context/HealthContext";
import { useColors } from "@/hooks/useColors";

// ─── Greeting helpers ─────────────────────────────────────────────────────────

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function getConditionLabel(condition?: string) {
  switch (condition) {
    case "osteoporosis": return "Managing osteoporosis";
    case "osteopenia":   return "Managing osteopenia";
    case "at_risk":      return "Monitoring bone health";
    case "healthy":      return "Maintaining bone strength";
    default:             return "Building healthy habits";
  }
}

// ─── Section label (coloured left-accent bar) ─────────────────────────────────

function SectionLabel({ title, color }: { title: string; color: string }) {
  return (
    <View style={sl.row}>
      <View style={[sl.bar, { backgroundColor: color }]} />
      <Text style={[sl.text, { color }]}>{title}</Text>
    </View>
  );
}
const sl = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  bar: { width: 3, height: 15, borderRadius: 2 },
  text: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1.3, textTransform: "uppercase" },
});

// ─── Quick Actions ──────────────────────────────────────────────────────────────
// Three equal tiles, brand colours only, clean card style.

function QuickActions() {
  const colors = useColors();
  const router = useRouter();

  const actions = [
    { label: "Log DEXA",  icon: "activity"  as const, route: "/health/log-dexa",   color: colors.primary   },
    { label: "FRAX",      icon: "shield"    as const, route: "/health/frax",        color: "#A78BFA"        },
    { label: "Meal Plan", icon: "book-open" as const, route: "/health/meal-plan",   color: colors.accent    },
  ];

  return (
    <View style={qa.row}>
      {actions.map((action) => (
        <Pressable
          key={action.label}
          onPress={() => router.push(action.route as any)}
          style={({ pressed }) => [
            colors.shadows.md,
            { flex: 1, borderRadius: 16, transform: [{ scale: pressed ? 0.96 : 1 }] },
          ]}
        >
          <LinearGradient
            colors={[colors.navy, colors.navyMid]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={qa.tile}
          >
            <View style={[qa.iconWrap, { backgroundColor: action.color + "22" }]}>
              <Feather name={action.icon} size={20} color={action.color} />
            </View>
            <Text style={qa.label}>{action.label}</Text>
          </LinearGradient>
        </Pressable>
      ))}
    </View>
  );
}
const qa = StyleSheet.create({
  row:     { flexDirection: "row", gap: 10 },
  tile:    { borderRadius: 16, alignItems: "center", paddingVertical: 20, paddingHorizontal: 8, gap: 12 },
  iconWrap:{ width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  label:   { fontSize: 12, fontFamily: "Inter_600SemiBold", textAlign: "center", color: "#fff" },
});

// ─── My Insights Card (dark navy) ─────────────────────────────────────────────

function InsightsCard() {
  const colors = useColors();
  const router = useRouter();

  const items = [
    { icon: "bar-chart-2" as const, label: "Progress & Trends", color: colors.primary  },
    { icon: "calendar"    as const, label: "Consistency",        color: colors.xpGold    },
    { icon: "sun"         as const, label: "Feel Good Insights", color: colors.accent   },
    { icon: "camera"      as const, label: "SNAP Shot",          color: colors.primary  },
  ];

  return (
    <Pressable
      onPress={() => router.push("/insights" as any)}
      style={({ pressed }) => [colors.shadows.md, { borderRadius: 20, transform: [{ scale: pressed ? 0.99 : 1 }] }]}
    >
      <LinearGradient
        colors={[colors.navy, "#1a5068", colors.primary + "CC"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={ic.card}
      >

        <View style={ic.headerRow}>
          <View style={[ic.iconWrap, { backgroundColor: colors.primary + "35", borderColor: colors.primary + "55" }]}>
            <Feather name="trending-up" size={16} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={ic.title}>My Insights</Text>
            <Text style={ic.subtitle}>Trends, consistency & your SNAP Shot</Text>
          </View>
          <View style={[ic.chevronWrap, { backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.14)" }]}>
            <Feather name="chevron-right" size={16} color="rgba(255,255,255,0.65)" />
          </View>
        </View>

        <View style={ic.divider} />

        <View style={ic.pillRow}>
          {items.map((item) => (
            <View key={item.label} style={[ic.pill, { backgroundColor: item.color + "18", borderColor: item.color + "30" }]}>
              <Feather name={item.icon} size={11} color={item.color} />
              <Text style={[ic.pillText, { color: item.color }]}>{item.label}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>
    </Pressable>
  );
}
const ic = StyleSheet.create({
  card: { borderRadius: 20, padding: 18, gap: 14, overflow: "hidden" },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  title: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.55)", marginTop: 1 },
  chevronWrap: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.10)" },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  pillText: { fontSize: 11, fontFamily: "Inter_500Medium" },
});

// ─── Community Card (navy, consistent with page) ──────────────────────────────

function CommunityCard() {
  const colors = useColors();
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push("/community" as any)}
      style={({ pressed }) => [colors.shadows.md, { borderRadius: 18, transform: [{ scale: pressed ? 0.99 : 1 }] }]}
    >
      <LinearGradient
        colors={[colors.navy, colors.navyMid]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={comm.card}
      >
        <View style={[comm.iconWrap, { backgroundColor: colors.accent + "20", borderColor: colors.accent + "35" }]}>
          <Feather name="users" size={18} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={comm.title}>Community</Text>
          <Text style={comm.sub}>Challenges · Leaderboard</Text>
        </View>
        <View style={[comm.pill, { backgroundColor: colors.accent + "20", borderColor: colors.accent + "35" }]}>
          <Text style={[comm.pillText, { color: colors.accent }]}>Explore</Text>
          <Feather name="chevron-right" size={12} color={colors.accent} />
        </View>
      </LinearGradient>
    </Pressable>
  );
}
const comm = StyleSheet.create({
  card: { borderRadius: 18, paddingHorizontal: 18, paddingVertical: 16, flexDirection: "row", alignItems: "center", gap: 14 },
  iconWrap: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  title: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.55)", marginTop: 2 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  pillText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});

// ─── Bone Health Summary Card ─────────────────────────────────────────────────
// Dark navy gradient card — shows T-score, FRAX risk, and a feel-good insight.
// Taps through to the full Bone Tracker.

function BoneHealthCard() {
  const colors = useColors();
  const router = useRouter();
  const { dexaScans, fraxResults, getFracturRisk } = useHealth();

  const latestScan  = dexaScans[0]  ?? null;
  const latestFrax  = fraxResults[0] ?? null;
  const fracturRisk = getFracturRisk();
  const worstT      = latestScan ? worstTScore(latestScan) : null;

  // Multi-site display: show Spine and Hip separately when both are available.
  const hasBothSites =
    latestScan != null &&
    latestScan.spineTScore != null &&
    latestScan.hipTScore != null;

  // Best FRAX major risk: prefer FRAX calculator result, fall back to DEXA report field.
  const majorFxPct =
    latestFrax?.majorFractureRisk ??
    latestScan?.majorFractureRisk ??
    null;

  const riskColor =
    fracturRisk === "low"      ? colors.success :
    fracturRisk === "moderate" ? colors.warning  :
    fracturRisk === "high"     ? colors.destructive :
    colors.mutedForeground;

  const feelGoodMessage = useMemo(() => {
    if (!latestScan) {
      return "Log your first DEXA scan to unlock personalised bone health insights.";
    }
    if (fracturRisk === "low") {
      return "Your risk profile is looking positive — keep building on those healthy habits.";
    }
    if (fracturRisk === "moderate") {
      return "You're taking the right steps. Small daily habits compound into stronger bones.";
    }
    return "You're here, tracking, and that matters. Every logged day builds your health picture.";
  }, [latestScan, fracturRisk]);

  const scanDateStr = latestScan
    ? new Date(latestScan.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <Pressable
      onPress={() => router.push("/health/bone-tracker" as any)}
      style={({ pressed }) => [
        bh.wrap,
        colors.shadows.md,
        { transform: [{ scale: pressed ? 0.99 : 1 }] },
      ]}
    >
      <LinearGradient
        colors={[colors.navy, colors.navyMid]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={bh.card}
      >
        {/* Header row */}
        <View style={bh.headerRow}>
          <View style={[bh.iconWrap, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "30" }]}>
            <Feather name="activity" size={16} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={bh.title}>Bone Health</Text>
            <Text style={bh.subtitle}>
              {scanDateStr ? `Last scan: ${scanDateStr}` : "No scans logged yet"}
            </Text>
          </View>
          <View style={[bh.chevronWrap, { backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.14)" }]}>
            <Feather name="chevron-right" size={14} color="rgba(255,255,255,0.65)" />
          </View>
        </View>

        <View style={bh.divider} />

        {/* Stats strip — multi-site when spine + hip both available */}
        <View style={bh.statsRow}>
          {hasBothSites ? (
            <>
              {/* Spine T-score */}
              <View style={bh.stat}>
                <Text style={bh.statValue}>{latestScan!.spineTScore!.toFixed(1)}</Text>
                <Text style={bh.statLabel}>Spine T</Text>
              </View>
              <View style={bh.statDivider} />
              {/* Hip T-score */}
              <View style={bh.stat}>
                <Text style={bh.statValue}>{latestScan!.hipTScore!.toFixed(1)}</Text>
                <Text style={bh.statLabel}>Hip T</Text>
              </View>
              <View style={bh.statDivider} />
              {/* Qualitative FRAX risk */}
              <View style={bh.stat}>
                {fracturRisk ? (
                  <View style={[bh.riskBadge, { backgroundColor: riskColor + "20", borderColor: riskColor + "35" }]}>
                    <Text style={[bh.riskBadgeText, { color: riskColor }]}>
                      {fracturRisk.charAt(0).toUpperCase() + fracturRisk.slice(1)}
                    </Text>
                  </View>
                ) : (
                  <Text style={bh.statValue}>—</Text>
                )}
                <Text style={bh.statLabel}>FRAX Risk</Text>
              </View>
            </>
          ) : (
            <>
              {/* Single / legacy T-score */}
              <View style={bh.stat}>
                <Text style={bh.statValue}>{worstT != null ? worstT.toFixed(1) : "—"}</Text>
                <Text style={bh.statLabel}>T-Score</Text>
              </View>
              <View style={bh.statDivider} />
              {/* Qualitative FRAX risk */}
              <View style={bh.stat}>
                {fracturRisk ? (
                  <View style={[bh.riskBadge, { backgroundColor: riskColor + "20", borderColor: riskColor + "35" }]}>
                    <Text style={[bh.riskBadgeText, { color: riskColor }]}>
                      {fracturRisk.charAt(0).toUpperCase() + fracturRisk.slice(1)}
                    </Text>
                  </View>
                ) : (
                  <Text style={bh.statValue}>—</Text>
                )}
                <Text style={bh.statLabel}>FRAX Risk</Text>
              </View>
              <View style={bh.statDivider} />
              {/* Best available major fracture % */}
              <View style={bh.stat}>
                <Text style={bh.statValue}>
                  {majorFxPct != null ? `${majorFxPct}%` : "—"}
                </Text>
                <Text style={bh.statLabel}>Major Fx</Text>
              </View>
            </>
          )}
        </View>

        {/* Feel-good insight strip */}
        <View style={[bh.feelGood, { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.10)" }]}>
          <Feather name="sun" size={12} color={colors.xpGold} />
          <Text style={bh.feelGoodText} numberOfLines={2}>{feelGoodMessage}</Text>
        </View>
      </LinearGradient>
    </Pressable>
  );
}
const bh = StyleSheet.create({
  wrap:          { borderRadius: 20 },
  card:          { borderRadius: 20, padding: 18, gap: 14, overflow: "hidden" },
  headerRow:     { flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap:      { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  title:         { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  subtitle:      { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.55)", marginTop: 1 },
  chevronWrap:   { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  divider:       { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.10)" },
  statsRow:      { flexDirection: "row", alignItems: "center" },
  stat:          { flex: 1, alignItems: "center", gap: 4 },
  statDivider:   { width: StyleSheet.hairlineWidth, height: 36, backgroundColor: "rgba(255,255,255,0.10)" },
  statValue:     { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: -0.3 },
  statLabel:     { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: 0.5 },
  riskBadge:     { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  riskBadgeText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  feelGood:      { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 12, borderWidth: 1 },
  feelGoodText:  { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.65)", lineHeight: 17 },
});

// ─── Main Dashboard Screen ────────────────────────────────────────────────────

export default function DashboardScreen() {
  const colors   = useColors();
  const insets   = useSafeAreaInsets();
  const router   = useRouter();
  const { user } = useAuth();

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Learn prompt — shown once per session until user activates the journey */}
      <LearnPromptModal />

      {/* Deep navy hero gradient — fades into the page background */}
      <LinearGradient
        colors={["#0D2530", "#1C3A4A", colors.background]}
        locations={[0, 0.45, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[styles.heroBackdrop, { height: topPadding + 260 }]}
        pointerEvents="none"
      />

      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: topPadding + 16,
            paddingBottom: Platform.OS === "web" ? 34 + 84 : insets.bottom + 84,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 1. Header ── */}
        <View style={styles.header}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={styles.greeting}>{getGreeting()}</Text>
            <Text style={styles.name}>{user?.name?.split(" ")[0] ?? "there"} 👋</Text>
            {user?.condition && (
              <Text style={[styles.conditionLabel, { color: colors.primary }]}>
                {getConditionLabel(user.condition)}
              </Text>
            )}
            {user && (
              <Pressable
                onPress={() => router.push("/(tabs)/profile")}
                style={({ pressed }) => [styles.statsStrip, { opacity: pressed ? 0.80 : 1 }]}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
              >
                <View style={styles.statsCell}>
                  <Text style={styles.statsCellLabel}>LEVEL</Text>
                  <Text style={styles.statsCellValue}>{user.level}</Text>
                </View>
                <View style={styles.statsDivider} />
                <View style={styles.statsCell}>
                  <Text style={styles.statsCellLabel}>STREAK</Text>
                  <View style={styles.statsCellRow}>
                    <Feather name="zap" size={11} color={colors.xpGold} />
                    <Text style={styles.statsCellValue}>
                      {user.streakDays} {user.streakDays === 1 ? "day" : "days"}
                    </Text>
                  </View>
                </View>
                <View style={styles.statsDivider} />
                <View style={styles.statsCell}>
                  <Text style={styles.statsCellLabel}>XP</Text>
                  <Text style={styles.statsCellValue}>
                    {user.xp}
                    <Text style={styles.statsCellValueMuted}> / {user.xpToNextLevel}</Text>
                  </Text>
                </View>
              </Pressable>
            )}
          </View>

          {/* Avatar with cyan glow ring */}
          <Pressable
            onPress={() => router.push("/(tabs)/profile")}
            style={[styles.avatarRingWrap, { borderColor: colors.primary + "45" }]}
          >
            <LinearGradient
              colors={colors.gradients.primary}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.avatar}
            >
              <Text style={styles.avatarText}>{user?.name?.charAt(0) ?? "S"}</Text>
            </LinearGradient>
          </Pressable>
        </View>

        {/* ── Contextual banners ── */}
        <TrialPromptCard />
        <BillingIssueBanner />
        <TrialEndedBanner />

        {/* ── 2. Today's Focus ── */}
        <View style={styles.sectionWrap}>
          <SectionLabel title="Today's Focus" color={colors.primary} />
          <TodaysFocusCard />
        </View>

        {/* ── 3. Quick Actions ── */}
        <View style={styles.sectionWrap}>
          <SectionLabel title="Quick Actions" color={colors.accent} />
          <QuickActions />
        </View>

        {/* ── 4. Bone Health Summary ── */}
        <View style={styles.sectionWrap}>
          <SectionLabel title="Bone Health" color={colors.primary} />
          <BoneHealthCard />
        </View>

        {/* ── 5. My Insights (dark section) ── */}
        <View style={styles.sectionWrap}>
          <SectionLabel title="My Insights" color={colors.primary} />
          <InsightsCard />
        </View>

        {/* ── 6. Community ── */}
        <View style={styles.sectionWrap}>
          <SectionLabel title="Community" color={colors.accent} />
          <CommunityCard />
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  heroBackdrop: { position: "absolute", top: 0, left: 0, right: 0 },
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 20 },

  // ── Header ──
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  greeting: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.58)" },
  name: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.4, color: "#fff" },
  conditionLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2, marginBottom: 2 },

  // Stats glass strip (sits on the dark hero gradient)
  statsStrip: {
    flexDirection: "row", alignItems: "stretch", alignSelf: "flex-start",
    marginTop: 10, paddingHorizontal: 4, paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.16)",
  },
  statsCell: { paddingHorizontal: 10, paddingVertical: 2, alignItems: "flex-start", justifyContent: "center", gap: 2 },
  statsCellRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  statsCellLabel: { fontSize: 9, fontFamily: "Inter_600SemiBold", letterSpacing: 0.7, color: "rgba(255,255,255,0.48)" },
  statsCellValue: { fontSize: 13, fontFamily: "Inter_700Bold", letterSpacing: -0.1, color: "#fff" },
  statsCellValueMuted: { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.50)" },
  statsDivider: { width: StyleSheet.hairlineWidth, marginVertical: 4, backgroundColor: "rgba(255,255,255,0.16)" },

  // Avatar with glow ring
  avatarRingWrap: { borderRadius: 29, borderWidth: 2, padding: 3 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 20, fontFamily: "Inter_700Bold" },

  // Section wrappers
  sectionWrap: { gap: 10 },
});
