/**
 * My Insights — dedicated data & analytics screen.
 *
 * Everything that used to live between Today's Focus and Quick Actions on the
 * home dashboard now lives here:
 *   - Bone Health Summary
 *   - Progress & Trends (T-score, FRAX, BMI sparklines)
 *   - Consistency (7-day dot grid across all habits)
 *   - Feel Good (behaviour-derived insight bullets)
 *   - SNAP Shot entry card
 */
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useHealth, classifyTScore, worstTScore } from "@/context/HealthContext";
import { useWellbeing } from "@/context/WellbeingContext";
import { useColors } from "@/hooks/useColors";
import { PremiumGate } from "@/components/PremiumGate";
import { MyBoneJourneyCard } from "@/components/MyBoneJourneyCard";
import { useSubscription } from "@/lib/revenuecat";
import {
  fetchWeeklyEventSummary,
  type WeeklyEventSummary,
} from "@/lib/events";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getLastNDayLabels(n: number): string[] {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const out: string[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(days[d.getDay()]);
  }
  return out;
}

function getLastNDateISOs(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(dateISOFromDate(d));
  }
  return out;
}

function dateISOFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

// ─── T-score gauge (visual scale −4 → 0) ──────────────────────────────────────

function TScoreGauge({ value, colors }: { value: number; colors: ReturnType<typeof useColors> }) {
  const MIN = -4; const MAX = 0;
  const pct = Math.max(0, Math.min(1, (value - MIN) / (MAX - MIN)));
  const cls = classifyTScore(value);
  const markerColor =
    cls === "Normal" ? colors.success :
    cls === "Osteopenia" ? colors.warning : colors.destructive;

  return (
    <View style={gauge.wrap}>
      <View style={gauge.track}>
        <View style={[gauge.zone, { flex: 1.5, backgroundColor: colors.destructive + "35" }]} />
        <View style={[gauge.zone, { flex: 1.5, backgroundColor: colors.warning + "35" }]} />
        <View style={[gauge.zone, { flex: 1, backgroundColor: colors.success + "35" }]} />
      </View>
      <View style={[gauge.markerWrap, { left: `${pct * 100}%` as any }]}>
        <View style={[gauge.marker, { backgroundColor: markerColor }]} />
      </View>
      <View style={gauge.labels}>
        <Text style={[gauge.labelTxt, { color: "rgba(255,255,255,0.35)" }]}>−4</Text>
        <Text style={[gauge.labelTxt, { color: "rgba(255,255,255,0.35)" }]}>−2.5</Text>
        <Text style={[gauge.labelTxt, { color: "rgba(255,255,255,0.35)" }]}>−1</Text>
        <Text style={[gauge.labelTxt, { color: "rgba(255,255,255,0.35)" }]}>0</Text>
      </View>
    </View>
  );
}
const gauge = StyleSheet.create({
  wrap: { gap: 3, marginTop: 2 },
  track: { height: 8, borderRadius: 4, flexDirection: "row", overflow: "hidden" },
  zone: {},
  markerWrap: { position: "absolute", top: 0, marginLeft: -1 },
  marker: { width: 2, height: 8, borderRadius: 1 },
  labels: { flexDirection: "row", justifyContent: "space-between" },
  labelTxt: { fontSize: 9, fontFamily: "Inter_400Regular" },
});

// ─── Bone Health Summary ──────────────────────────────────────────────────────

function BoneHealthCard() {
  const colors = useColors();
  const router = useRouter();
  const { dexaScans, fraxResults } = useHealth();

  const latest     = dexaScans[0] ?? null;
  const latestFrax = fraxResults[0] ?? null;

  if (!latest && !latestFrax) return null;


  const majorRisk = latestFrax?.majorFractureRisk ?? latest?.majorFractureRisk;
  const hipRisk   = latestFrax?.hipFractureRisk   ?? latest?.hipFractureRisk;

  // Use worst T-score for trend comparison
  const latestWorst = latest ? worstTScore(latest) : null;

  // Per-site data for display
  const hasMultiSite = latest && (latest.spineTScore != null || latest.hipTScore != null);

  return (
    <Pressable
      onPress={() => router.push("/health/bone-tracker" as any)}
      style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.99 : 1 }] }]}
    >
      <LinearGradient colors={["#0D2530", "#1C3A4A"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={bh.card}>
        {/* Header */}
        <View style={bh.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={bh.eyebrow}>Bone Health Summary</Text>
            {!hasMultiSite && latestWorst != null && (
              <Text style={bh.title}>T-score {latestWorst.toFixed(1)}</Text>
            )}
          </View>
          <View style={{ gap: 6, alignItems: "flex-end" }}>
            <View style={[bh.badge, { backgroundColor: "rgba(255,255,255,0.10)", borderColor: "rgba(255,255,255,0.18)" }]}>
              <Text style={[bh.badgeText, { color: "rgba(255,255,255,0.78)" }]}>
                Latest record
              </Text>
            </View>
          </View>
        </View>

        {/* Multi-site T-score display */}
        {hasMultiSite && latest && (
          <View style={bh.siteGrid}>
            {latest.spineTScore != null && (
              <View style={bh.siteCell}>
                <Text style={bh.siteLabel}>SPINE (L1–L4)</Text>
                <Text style={bh.siteScore}>{latest.spineTScore.toFixed(1)}</Text>
                <Text style={[bh.siteCls, {
                  color: classifyTScore(latest.spineTScore) === "Normal" ? colors.success :
                    classifyTScore(latest.spineTScore) === "Osteopenia" ? colors.warning : colors.destructive,
                }]}>
                  {classifyTScore(latest.spineTScore)}
                </Text>
                <TScoreGauge value={latest.spineTScore} colors={colors} />
              </View>
            )}
            {latest.spineTScore != null && latest.hipTScore != null && (
              <View style={bh.siteDivider} />
            )}
            {latest.hipTScore != null && (
              <View style={bh.siteCell}>
                <Text style={bh.siteLabel}>HIP</Text>
                <Text style={bh.siteScore}>{latest.hipTScore.toFixed(1)}</Text>
                <Text style={[bh.siteCls, {
                  color: classifyTScore(latest.hipTScore) === "Normal" ? colors.success :
                    classifyTScore(latest.hipTScore) === "Osteopenia" ? colors.warning : colors.destructive,
                }]}>
                  {classifyTScore(latest.hipTScore)}
                </Text>
                <TScoreGauge value={latest.hipTScore} colors={colors} />
              </View>
            )}
          </View>
        )}

        {/* Fracture risk % cells */}
        {(majorRisk != null || hipRisk != null) && (
          <View style={bh.riskRow}>
            {majorRisk != null && (
              <View style={bh.riskCell}>
                <Text style={bh.riskValue}>{majorRisk}%</Text>
                <Text style={bh.riskSub}>Major fracture{"\n"}10-yr risk</Text>
              </View>
            )}
            {majorRisk != null && hipRisk != null && <View style={bh.riskDivider} />}
            {hipRisk != null && (
              <View style={bh.riskCell}>
                <Text style={bh.riskValue}>{hipRisk}%</Text>
                <Text style={bh.riskSub}>Hip fracture{"\n"}10-yr risk</Text>
              </View>
            )}
            {latest?.bmi != null && (
              <>
                <View style={bh.riskDivider} />
                <View style={bh.riskCell}>
                  <Text style={bh.riskValue}>{latest.bmi.toFixed(1)}</Text>
                  <Text style={bh.riskSub}>BMI</Text>
                </View>
              </>
            )}
          </View>
        )}

        <Text style={bh.insight}>
          These are your recorded values, shown without judging whether a change is clinically significant. Discuss interpretation with a qualified clinician.
        </Text>

        <View style={bh.footer}>
          <Text style={bh.footerLabel}>View Bone Tracker</Text>
          <Feather name="chevron-right" size={14} color="rgba(255,255,255,0.55)" />
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const bh = StyleSheet.create({
  card: { borderRadius: 20, padding: 20, gap: 14, overflow: "hidden" },
  topRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  eyebrow: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.5)", letterSpacing: 0.8, textTransform: "uppercase" },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: -0.4, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  badgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  statusText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  // Multi-site grid
  siteGrid: { flexDirection: "row", gap: 0 },
  siteCell: { flex: 1, gap: 4 },
  siteDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.10)", marginHorizontal: 14 },
  siteLabel: { fontSize: 9, fontFamily: "Inter_700Bold", color: "rgba(255,255,255,0.45)", letterSpacing: 0.8, textTransform: "uppercase" },
  siteScore: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: -0.5 },
  siteCls: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  // Fracture risk
  riskRow: { flexDirection: "row", alignItems: "center" },
  riskCell: { flex: 1, alignItems: "center" },
  riskValue: { fontSize: 26, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: -0.4 },
  riskSub: { fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.5)", textAlign: "center", marginTop: 2, lineHeight: 14 },
  riskDivider: { width: 1, height: 40, backgroundColor: "rgba(255,255,255,0.12)" },
  insight: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)", lineHeight: 19 },
  footer: { flexDirection: "row", alignItems: "center", gap: 4 },
  footerLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.5)" },
});

// ─── Consistency ──────────────────────────────────────────────────────────────

function ConsistencyCard() {
  const colors = useColors();
  const { user } = useAuth();
  const { activityLogs, nutritionLogs, supplements, todayActivity, nutritionStreak } = useHealth();
  const { entries: wellbeingEntries, currentStreak: wellbeingStreak } = useWellbeing();
  const [weeklySummary, setWeeklySummary] = useState<WeeklyEventSummary>({
    counts: {},
    daily: {},
  });

  const DAYS = 7;
  const dayISOs   = useMemo(() => getLastNDateISOs(DAYS),   []);
  const dayLabels = useMemo(() => getLastNDayLabels(DAYS),  []);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setWeeklySummary({ counts: {}, daily: {} });
      return;
    }
    fetchWeeklyEventSummary(user.id).then((summary) => {
      if (!cancelled) setWeeklySummary(summary);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const activitySet  = useMemo(() => new Set(activityLogs.map((l) => l.date)),  [activityLogs]);
  const nutritionSet = useMemo(() => new Set(nutritionLogs.map((l) => l.date)), [nutritionLogs]);

  const breathingSet = useMemo(() => {
    const s = new Set<string>();
    wellbeingEntries.filter((e) => e.kind === "breathing").forEach((e) =>
      s.add(dateISOFromDate(new Date(e.completedAt)))
    );
    return s;
  }, [wellbeingEntries]);

  const meditationSet = useMemo(() => {
    const s = new Set<string>();
    wellbeingEntries.filter((e) => e.kind === "meditation").forEach((e) =>
      s.add(dateISOFromDate(new Date(e.completedAt)))
    );
    return s;
  }, [wellbeingEntries]);

  const supplementItems = supplements.filter((s) => s.category !== "medication");
  const medicationItems = supplements.filter((s) => s.category === "medication");
  const takenToday = supplementItems.filter((s) => s.taken).length;
  const totalSupps = supplementItems.length;
  const medicationTakenToday = medicationItems.filter((s) => s.taken).length;
  const stepsToday = todayActivity?.steps ?? 0;
  const stepsPct   = Math.min(1, stepsToday / 8000);
  const eventChecks = (...kinds: string[]) => {
    return dayISOs.map((date) =>
      kinds.some((kind) => (weeklySummary.daily[date]?.[kind] ?? 0) > 0),
    );
  };
  const rows: Array<{ label: string; color: string; checks: boolean[] }> = [
    { label: "Nutrition", color: colors.xpGold,  checks: dayISOs.map((d) => nutritionSet.has(d)) },
    { label: "Activity",  color: colors.primary,  checks: dayISOs.map((d) => activitySet.has(d))  },
    { label: "Breathing", color: "#22d3ee",        checks: dayISOs.map((d) => breathingSet.has(d)) },
    { label: "Meditate",  color: "#a78bfa",        checks: dayISOs.map((d) => meditationSet.has(d)) },
    { label: "Supplements", color: "#f59e0b", checks: eventChecks("supplement_taken") },
    { label: "Medication", color: "#ef4444", checks: eventChecks("medication_taken") },
  ];

  const hasAnyData =
    activityLogs.length > 0 ||
    nutritionLogs.length > 0 ||
    wellbeingEntries.length > 0 ||
    totalSupps > 0 ||
    medicationItems.length > 0;
  if (!hasAnyData) return null;

  return (
    <View style={[cc.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={cc.headerRow}>
        <View style={[cc.iconWrap, { backgroundColor: colors.accent + "18" }]}>
          <Feather name="calendar" size={16} color={colors.accent} />
        </View>
        <Text style={[cc.title, { color: colors.foreground }]}>Consistency</Text>
        {(nutritionStreak > 0 || wellbeingStreak > 0) && (
          <View style={[cc.streakBadge, { backgroundColor: colors.xpGold + "18", borderColor: colors.xpGold + "40" }]}>
            <Feather name="zap" size={11} color={colors.xpGold} />
            <Text style={[cc.streakText, { color: colors.xpGold }]}>
              {Math.max(nutritionStreak, wellbeingStreak)}d streak
            </Text>
          </View>
        )}
      </View>

      <View style={cc.gridWrap}>
        <View style={cc.labelRow}>
          <View style={cc.rowTag} />
          {dayLabels.map((l, i) => (
            <Text key={i} style={[cc.dayLabel, { color: colors.mutedForeground }]}>{l}</Text>
          ))}
        </View>
        {rows.map((row) => (
          <View key={row.label} style={cc.dataRow}>
            <Text style={[cc.rowTag, { color: colors.mutedForeground }]}>{row.label}</Text>
            {row.checks.map((checked, i) => (
              <View
                key={i}
                style={[cc.dot, {
                  backgroundColor: checked ? row.color : colors.muted,
                  borderColor: checked ? row.color + "60" : colors.border,
                }]}
              />
            ))}
          </View>
        ))}
      </View>

      <View style={[cc.statsRow, { borderTopColor: colors.border }]}>
        {stepsToday > 0 && (
          <View style={cc.statCell}>
            <Text style={[cc.statValue, { color: colors.foreground }]}>{stepsToday.toLocaleString()}</Text>
            <Text style={[cc.statLabel, { color: colors.mutedForeground }]}>steps today</Text>
            <View style={[cc.stepTrack, { backgroundColor: colors.muted }]}>
              <View style={[cc.stepFill, { width: `${Math.round(stepsPct * 100)}%`, backgroundColor: colors.primary }]} />
            </View>
          </View>
        )}
        {totalSupps > 0 && (
          <View style={cc.statCell}>
            <Text style={[cc.statValue, { color: colors.foreground }]}>{takenToday}/{totalSupps}</Text>
            <Text style={[cc.statLabel, { color: colors.mutedForeground }]}>supplements</Text>
          </View>
        )}
        {medicationItems.length > 0 && (
          <View style={cc.statCell}>
            <Text style={[cc.statValue, { color: colors.foreground }]}>
              {medicationTakenToday}/{medicationItems.length}
            </Text>
            <Text style={[cc.statLabel, { color: colors.mutedForeground }]}>medications</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const cc = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontFamily: "Inter_700Bold", flex: 1 },
  streakBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  streakText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  gridWrap: { gap: 8 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  dayLabel: { flex: 1, fontSize: 9, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  dataRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  rowTag: { width: 76, fontSize: 10, fontFamily: "Inter_500Medium" },
  dot: { flex: 1, aspectRatio: 1, borderRadius: 100, borderWidth: 1, maxWidth: 28 },
  statsRow: { flexDirection: "row", gap: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  statCell: { flex: 1, gap: 3 },
  statValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  stepTrack: { height: 4, borderRadius: 2, overflow: "hidden", marginTop: 4 },
  stepFill: { height: "100%", borderRadius: 2 },
});

// ─── Feel Good Insights ───────────────────────────────────────────────────────

function FeelGoodCard() {
  const colors = useColors();
  const { activityLogs, nutritionStreak, todayActivity, supplements } = useHealth();
  const { entries: wellbeingEntries, currentStreak: wellbeingStreak, weekCount: wellbeingWeek } = useWellbeing();

  const insights = useMemo(() => {
    const out: string[] = [];

    if (nutritionStreak >= 3)
      out.push(`You've logged your nutrition ${nutritionStreak} days in a row — great consistency.`);
    else if (nutritionStreak === 1)
      out.push("Nutrition logged today — one step closer to a great streak.");

    if (todayActivity && todayActivity.steps >= 8000)
      out.push(`Excellent step count today — ${todayActivity.steps.toLocaleString()} steps and counting.`);
    else if (todayActivity && todayActivity.steps >= 4000)
      out.push(`${todayActivity.steps.toLocaleString()} steps today — you're building momentum.`);

    const takenCount = supplements.filter((s) => s.taken).length;
    if (takenCount > 0 && takenCount === supplements.length && supplements.length > 0)
      out.push("All your supplements are checked off for today — well done.");
    else if (takenCount > 0 && supplements.length > 0)
      out.push(`${takenCount} of ${supplements.length} supplements taken today — stay on track.`);

    const thisWeekActivity = activityLogs.filter((l) => {
      const diffDays = Math.floor((Date.now() - new Date(l.date).getTime()) / 86400000);
      return diffDays <= 6;
    });
    if (thisWeekActivity.length >= 4)
      out.push("You've been active most days this week — that's exactly the kind of consistency that matters.");

    if (wellbeingStreak >= 3)
      out.push(`Your breathing and meditation streak is at ${wellbeingStreak} days — your nervous system will thank you.`);

    const lastEntry = wellbeingEntries[0];
    if (lastEntry?.kind === "breathing")
      out.push("Your breathing sessions are helping regulate your stress levels — keep it up.");
    else if (lastEntry?.kind === "meditation")
      out.push("Consistent meditation builds calm that compounds over time — great work today.");

    if (wellbeingWeek >= 5)
      out.push("You've been consistent with wellbeing sessions this week — that kind of balance matters.");

    if (out.length === 0)
      out.push("Every small step adds up. Today is a great day to build a healthy habit.");

    return out.slice(0, 4);
  }, [nutritionStreak, todayActivity, supplements, activityLogs, wellbeingStreak, wellbeingEntries, wellbeingWeek]);

  return (
    <View style={[fg.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={fg.headerRow}>
        <View style={[fg.iconWrap, { backgroundColor: colors.success + "18" }]}>
          <Feather name="sun" size={16} color={colors.success} />
        </View>
        <Text style={[fg.title, { color: colors.foreground }]}>Feel Good</Text>
      </View>
      {insights.map((insight, i) => (
        <View
          key={i}
          style={[
            fg.insightRow,
            i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 10 },
          ]}
        >
          <View style={[fg.dot, { backgroundColor: colors.success }]} />
          <Text style={[fg.insightText, { color: colors.foreground }]}>{insight}</Text>
        </View>
      ))}
    </View>
  );
}

const fg = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontFamily: "Inter_700Bold" },
  insightRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 7, flexShrink: 0 },
  insightText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
});

// ─── SNAP Shot entry card ─────────────────────────────────────────────────────

function SnapShotCard() {
  const colors = useColors();
  const router = useRouter();
  const { dexaScans, activityLogs, nutritionStreak, fraxResults } = useHealth();
  const { weekCount: wellbeingWeek, currentStreak: wellbeingStreak } = useWellbeing();

  const thisWeekActivity = activityLogs.filter((l) => {
    const diffDays = Math.floor((Date.now() - new Date(l.date).getTime()) / 86400000);
    return diffDays <= 6;
  });
  const avgSteps = thisWeekActivity.length > 0
    ? Math.round(thisWeekActivity.reduce((s, l) => s + l.steps, 0) / thisWeekActivity.length)
    : null;

  const latestFrax = fraxResults[0] ?? null;
  const fraxRiskLabel =
    latestFrax == null ? null :
    latestFrax.majorFractureRisk < 10 ? "Low fracture risk" :
    latestFrax.majorFractureRisk < 20 ? "Moderate fracture risk" :
    "Higher fracture risk";
  const fraxRiskColor =
    latestFrax == null ? colors.mutedForeground :
    latestFrax.majorFractureRisk < 10 ? colors.success :
    latestFrax.majorFractureRisk < 20 ? colors.warning :
    colors.destructive;

  return (
    <Pressable
      onPress={() => router.push("/snap-shot" as any)}
      style={({ pressed }) => [
        ss.card,
        { backgroundColor: colors.primary + "10", borderColor: colors.primary + "25" },
        { transform: [{ scale: pressed ? 0.99 : 1 }] },
      ]}
    >
      <View style={ss.headerRow}>
        <View style={[ss.badge, { backgroundColor: colors.primary + "18" }]}>
          <Text style={[ss.badgeText, { color: colors.primary }]}>SNAP Shot</Text>
        </View>
        <Text style={[ss.cta, { color: colors.primary }]}>View full summary →</Text>
      </View>
      <Text style={[ss.title, { color: colors.foreground }]}>Weekly Progress Highlight</Text>
      <View style={ss.pillRow}>
        {dexaScans.length > 0 && (
          <View style={[ss.pill, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="activity" size={12} color={colors.primary} />
            <Text style={[ss.pillText, { color: colors.foreground }]}>T-score {(worstTScore(dexaScans[0]) ?? 0).toFixed(1)}</Text>
          </View>
        )}
        {latestFrax != null && (
          <View style={[ss.pill, { backgroundColor: colors.card, borderColor: fraxRiskColor + "40" }]}>
            <Feather name="shield" size={12} color={fraxRiskColor} />
            <Text style={[ss.pillText, { color: fraxRiskColor }]}>{fraxRiskLabel}</Text>
          </View>
        )}
        {nutritionStreak > 0 && (
          <View style={[ss.pill, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="zap" size={12} color={colors.xpGold} />
            <Text style={[ss.pillText, { color: colors.foreground }]}>{nutritionStreak}d nutrition streak</Text>
          </View>
        )}
        {avgSteps != null && (
          <View style={[ss.pill, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="trending-up" size={12} color={colors.success} />
            <Text style={[ss.pillText, { color: colors.foreground }]}>~{avgSteps.toLocaleString()} avg steps</Text>
          </View>
        )}
        {wellbeingWeek > 0 && (
          <View style={[ss.pill, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="wind" size={12} color="#22d3ee" />
            <Text style={[ss.pillText, { color: colors.foreground }]}>
              {wellbeingWeek} wellness {wellbeingWeek === 1 ? "session" : "sessions"}
              {wellbeingStreak >= 2 ? ` · ${wellbeingStreak}d streak` : ""}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const ss = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  cta: { fontSize: 12, fontFamily: "Inter_500Medium" },
  title: { fontSize: 15, fontFamily: "Inter_700Bold" },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  pillText: { fontSize: 12, fontFamily: "Inter_500Medium" },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function InsightsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { hasPremiumOrTrial } = useSubscription();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 + 84 : insets.bottom + 84;

  return (
    <View style={[root.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Gradient backdrop */}
      <LinearGradient
        colors={[colors.navy + "55", colors.background]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[root.backdrop, { height: topPad + 200 }]}
        pointerEvents="none"
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[root.content, { paddingTop: topPad + 20, paddingBottom: botPad }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={root.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={root.backBtn}>
            <Feather name="chevron-left" size={22} color={colors.foreground} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[root.title, { color: colors.foreground }]}>My Insights</Text>
            <Text style={[root.subtitle, { color: colors.mutedForeground }]}>
              Your health data, trends, and weekly snapshot
            </Text>
          </View>
        </View>

        {/* Sections — Premium only */}
        {hasPremiumOrTrial ? (
          <>
            <BoneHealthCard />
            <MyBoneJourneyCard />
            <ConsistencyCard />
            <FeelGoodCard />
            <SnapShotCard />
          </>
        ) : (
          <PremiumGate
            feature="My Insights"
            description="Detailed health analytics, T-score trends, FRAX data, consistency tracking, and your weekly SNAP Shot are available on SNAP Premium."
          />
        )}
      </ScrollView>
    </View>
  );
}

const root = StyleSheet.create({
  container: { flex: 1 },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0 },
  content: { paddingHorizontal: 16, gap: 16 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  backBtn: { padding: 6 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.4 },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
});
