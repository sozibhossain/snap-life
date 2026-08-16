/**
 * Bone Tracker — the Premium-gated, at-a-glance trend dashboard for
 * everything the Health Hub can log. Reachable from the "Bone Tracker"
 * Quick Action tile on the Health Hub overview.
 *
 * What it tracks (one tile/section per Health Hub Quick Action):
 *   - DEXA & FRAX:       latest T/Z/BMD + 7-day fracture-risk verdict,
 *                        plus a neutral per-site delta-vs-previous history.
 *   - Activity:          7-day total active minutes + steps with a tiny
 *                        per-day bar visualisation against a 30 min/day
 *                        guideline.
 *   - Nutrition:         7-day average calcium and vitamin D versus the
 *                        same daily goals used by the nutrition log
 *                        screen (1200 mg / 800 IU).
 *   - Supplements:       today's adherence (X / Y of the starter
 *                        checklist taken) with a deep-link into the
 *                        supplements tab.
 *   - Movement Library:  count of logged activity sessions this week
 *                        with a deep-link into the library.
 *
 * Each section also exposes a small "Log …" CTA that routes to the
 * matching existing logging / browsing screen so the user can act on
 * what they see.
 *
 * The whole body is wrapped in <PremiumGate>: Plus / Free users get
 * the soft-lock card with the spec upgrade copy; Premium / Trial
 * users see the live trends. This preserves the original gating
 * intent — the change is only that the *unlock surface* now lives
 * here instead of as a big inline block on the Health Hub.
 */

import { Feather } from "@expo/vector-icons";
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

import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useAuth } from "@/context/AuthContext";
import { useHealth, type DexaScan, classifyTScore, worstTScore } from "@/context/HealthContext";
import { useNutrition } from "@/context/NutritionContext";
import { useColors } from "@/hooks/useColors";

// Daily goals — kept in sync with app/health/nutrition.tsx so the
// percent-of-goal numbers here match what users see on the log screen.
const NUTRITION_GOALS = { calcium: 1200, vitaminD: 800 };

// Activity guideline used for the 7-day mini bars. Matches the
// "30 active min/day" framing surfaced elsewhere in the app.
const ACTIVITY_GOAL_MIN = 30;
const VITAMIN_K_GOAL_MCG = 100;

const DAY_MS = 86_400_000;

function formatSite(site: DexaScan["site"]): string {
  if (!site) return "";
  return site.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function formatScanDate(iso: string, timezone?: string | null) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(timezone ? { timeZone: timezone } : {}),
  });
}

/** Build a 7-element series ending today, oldest → newest, using
 *  LOCAL-day YYYY-MM-DD strings (not UTC). Must match the day-key
 *  format produced by `todayLocalISO()` in the bridge / HealthContext,
 *  otherwise around local-midnight in non-UTC timezones today's log
 *  silently falls outside the 7-day window. */
function localISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function supplementDailyUnits(
  supplements: ReturnType<typeof useHealth>["supplements"],
) {
  return supplements.reduce(
    (totals, item) => {
      if (!item.taken || item.category !== "supplement") return totals;
      const name = item.name.toLowerCase();
      const amount = item.doseAmount ?? 0;
      const multiplier = item.frequency === "twice daily" ? 2 : 1;
      const daily = amount * multiplier;

      if (name.includes("calcium") && item.unit === "mg") totals.calcium += daily;
      if ((name.includes("vitamin d") || name.includes("d3")) && item.unit === "IU") totals.vitaminD += daily;
      if (name.includes("magnesium") && item.unit === "mg") totals.magnesium += daily;
      if ((name.includes("vitamin k") || name.includes("k2")) && item.unit === "mcg") totals.vitaminK += daily;
      if ((name.includes("protein") || name.includes("collagen")) && item.unit === "g") totals.protein += daily;
      return totals;
    },
    { calcium: 0, vitaminD: 0, protein: 0, magnesium: 0, vitaminK: 0 },
  );
}

function last7Days(): string[] {
  const out: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    out.push(localISO(d));
  }
  return out;
}

// ─── T-score gauge (visual scale −4 → 0) ─────────────────────────────────────

function BtTScoreGauge({ value, colors }: { value: number; colors: ReturnType<typeof useColors> }) {
  const pct = Math.max(0, Math.min(1, (value - -4) / 4));
  const cls = classifyTScore(value);
  const markerColor =
    cls === "Normal" ? colors.success :
    cls === "Osteopenia" ? colors.warning : colors.destructive;
  return (
    <View style={{ gap: 2 }}>
      <View style={{ height: 6, borderRadius: 3, flexDirection: "row", overflow: "hidden" }}>
        <View style={{ flex: 1.5, backgroundColor: colors.destructive + "40" }} />
        <View style={{ flex: 1.5, backgroundColor: colors.warning + "40" }} />
        <View style={{ flex: 1, backgroundColor: colors.success + "40" }} />
      </View>
      <View style={{ position: "absolute", top: 0, left: `${pct * 100}%` as any, marginLeft: -1 }}>
        <View style={{ width: 2, height: 6, borderRadius: 1, backgroundColor: markerColor }} />
      </View>
    </View>
  );
}

// ─── Per-site score row (multi-site display) ──────────────────────────────────

function SiteScoreRow({ label, score, colors }: { label: string; score: number; colors: ReturnType<typeof useColors> }) {
  const cls = classifyTScore(score);
  const clsColor =
    cls === "Normal" ? colors.success :
    cls === "Osteopenia" ? colors.warning : colors.destructive;
  return (
    <View style={[ssr.row, { backgroundColor: colors.muted, borderColor: colors.border }]}>
      <View style={ssr.left}>
        <Text style={[ssr.label, { color: colors.mutedForeground }]}>{label}</Text>
        <BtTScoreGauge value={score} colors={colors} />
      </View>
      <View style={ssr.right}>
        <Text style={[ssr.score, { color: colors.foreground }]}>{score.toFixed(1)}</Text>
        <View style={[ssr.badge, { backgroundColor: clsColor + "18", borderColor: clsColor + "30" }]}>
          <Text style={[ssr.badgeText, { color: clsColor }]}>{cls}</Text>
        </View>
      </View>
    </View>
  );
}
const ssr = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  left: { flex: 1, gap: 6 },
  label: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  right: { alignItems: "flex-end", gap: 4 },
  score: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20, borderWidth: 1 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});

// ─── Site insights ────────────────────────────────────────────────────────────

function siteInsight(label: string, cls: "Normal" | "Osteopenia" | "Osteoporosis"): string {
  return `${label} latest recorded classification: ${cls}. A qualified healthcare professional can interpret this result in context.`;
}

export default function BoneTrackerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { targets } = useNutrition();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const {
    dexaScans,
    fraxResults,
    activityLogs,
    nutritionLogs,
    todayNutrition,
    todayPlanTotals,
    todayManualTotals,
    supplements,
    getFracturRisk,
  } = useHealth();

  const latestScan = dexaScans[0] ?? null;
  const fracturRisk = latestScan ? getFracturRisk() : null;
  const riskVariant: "success" | "warning" | "danger" | "default" =
    !fracturRisk
      ? "default"
      : fracturRisk === "low"
      ? "success"
      : fracturRisk === "moderate"
      ? "warning"
      : "danger";

  // Per-site DEXA trend: for each site the user has scanned, take the
  // most recent two entries and compute the delta. Gives a quick
  // numerical latest-versus-previous comparison without clinical interpretation.
  const dexaTrend = useMemo(() => {
    type TrendEntry = {
      label: string;
      score: number;
      delta: number | null;
      classification: "Normal" | "Osteopenia" | "Osteoporosis";
    };
    const trends: TrendEntry[] = [];
    const hasMultiSite = dexaScans.some(
      (s) => s.spineTScore != null || s.hipTScore != null,
    );
    if (hasMultiSite) {
      const spineScans = dexaScans.filter((s) => s.spineTScore != null);
      if (spineScans.length > 0) {
        const score = spineScans[0].spineTScore!;
        const prev = spineScans[1]?.spineTScore ?? null;
        trends.push({
          label: "Spine (L1–L4)",
          score,
          delta: prev != null ? score - prev : null,
          classification: classifyTScore(score),
        });
      }
      const hipScans = dexaScans.filter((s) => s.hipTScore != null);
      if (hipScans.length > 0) {
        const score = hipScans[0].hipTScore!;
        const prev = hipScans[1]?.hipTScore ?? null;
        trends.push({
          label: "Hip",
          score,
          delta: prev != null ? score - prev : null,
          classification: classifyTScore(score),
        });
      }
    } else {
      // Legacy single-site records
      const bySite = new Map<string, DexaScan[]>();
      for (const s of dexaScans) {
        if (!s.site) continue;
        const arr = bySite.get(s.site) ?? [];
        arr.push(s);
        bySite.set(s.site, arr);
      }
      for (const [site, scans] of Array.from(bySite.entries())) {
        const sorted = [...scans].sort((a, b) => b.date.localeCompare(a.date));
        const score = sorted[0].tScore ?? 0;
        const prev = sorted[1]?.tScore ?? null;
        trends.push({
          label: formatSite(site as DexaScan["site"]),
          score,
          delta: prev != null ? score - prev : null,
          classification: classifyTScore(score),
        });
      }
    }
    return trends;
  }, [dexaScans]);

  const days = useMemo(() => last7Days(), []);

  // 7-day activity series + totals.
  const activity7d = useMemo(() => {
    const byDate = new Map<string, number>();
    const stepsByDate = new Map<string, number>();
    for (const a of activityLogs) {
      byDate.set(a.date, (byDate.get(a.date) ?? 0) + (a.activeMinutes ?? 0));
      stepsByDate.set(a.date, (stepsByDate.get(a.date) ?? 0) + (a.steps ?? 0));
    }
    const minutes = days.map((d) => byDate.get(d) ?? 0);
    const steps = days.map((d) => stepsByDate.get(d) ?? 0);
    const totalMinutes = minutes.reduce((s, n) => s + n, 0);
    const totalSteps = steps.reduce((s, n) => s + n, 0);
    const daysOnGoal = minutes.filter((m) => m >= ACTIVITY_GOAL_MIN).length;
    const peak = Math.max(ACTIVITY_GOAL_MIN, ...minutes);
    return { minutes, totalMinutes, totalSteps, daysOnGoal, peak };
  }, [activityLogs, days]);

  // 7-day nutrition averages. logNutrition prepends (does not upsert)
  // so the same calendar date can have multiple entries — sum per
  // date FIRST, then average across the number of unique logged days,
  // otherwise multi-meal days would inflate the daily average.
  const nutrition7d = useMemo(() => {
    const inWindow = nutritionLogs.filter((n) => days.includes(n.date));
    const calciumByDate = new Map<string, number>();
    const vitDByDate = new Map<string, number>();
    for (const n of inWindow) {
      calciumByDate.set(n.date, (calciumByDate.get(n.date) ?? 0) + (n.calcium ?? 0));
      vitDByDate.set(n.date, (vitDByDate.get(n.date) ?? 0) + (n.vitaminD ?? 0));
    }
    const loggedDays = calciumByDate.size;
    const sum = (m: Map<string, number>) =>
      Array.from(m.values()).reduce((s, n) => s + n, 0);
    return {
      loggedDays,
      avgCalcium: loggedDays === 0 ? 0 : Math.round(sum(calciumByDate) / loggedDays),
      avgVitaminD: loggedDays === 0 ? 0 : Math.round(sum(vitDByDate) / loggedDays),
    };
  }, [nutritionLogs, days]);

  const suppTaken = supplements.filter((s) => s.taken).length;
  const suppTotal = supplements.length;
  const supplementTotals = useMemo(
    () => supplementDailyUnits(supplements),
    [supplements],
  );
  const boneHealthSummary = useMemo(
    () => [
      {
        label: "Calcium",
        food: Math.round(todayNutrition?.calcium ?? 0),
        supplement: Math.round(supplementTotals.calcium),
        goal: targets.calcium,
        unit: "mg",
        color: colors.primary,
      },
      {
        label: "Vitamin D",
        food: Math.round(todayNutrition?.vitaminD ?? 0),
        supplement: Math.round(supplementTotals.vitaminD),
        goal: targets.vitaminD,
        unit: "IU",
        color: colors.accent,
      },
      {
        label: "Protein",
        food: Math.round(todayNutrition?.protein ?? 0),
        supplement: Math.round(supplementTotals.protein),
        goal: targets.protein,
        unit: "g",
        color: colors.success,
      },
      {
        label: "Magnesium",
        food: Math.round(todayNutrition?.magnesium ?? 0),
        supplement: Math.round(supplementTotals.magnesium),
        goal: targets.magnesium,
        unit: "mg",
        color: colors.warning,
      },
      {
        label: "Vitamin K",
        food: 0,
        supplement: Math.round(supplementTotals.vitaminK),
        goal: VITAMIN_K_GOAL_MCG,
        unit: "mcg",
        color: colors.navyLight,
      },
    ],
    [
      colors.accent,
      colors.navyLight,
      colors.primary,
      colors.success,
      colors.warning,
      supplementTotals,
      targets,
      todayNutrition,
    ],
  );
  const boneHealthScore = Math.round(
    boneHealthSummary.reduce((sum, n) => sum + Math.min(1, (n.food + n.supplement) / n.goal), 0) /
      boneHealthSummary.length *
      100,
  );
  // Use the same calendar-day-aligned 7-day window as the Activity bars
  // above, so a session logged earlier today doesn't fall in/out of one
  // metric but not the other.
  const movement7d = useMemo(
    () => activityLogs.filter((a) => days.includes(a.date)).length,
    [activityLogs, days],
  );

  // Combined "Your tracker" snapshot — pulls the headline number from
  // each section below into a single at-a-glance card. Hidden when the
  // user hasn't entered any data yet (otherwise it would be five
  // greyed-out zeros, which is worse than the per-section empty
  // states). Once at least ONE source has data, render the snapshot
  // with each cell falling back to "—" if its source is empty.
  const hasAnyData =
    !!latestScan ||
    activity7d.totalMinutes > 0 ||
    nutrition7d.loggedDays > 0 ||
    suppTaken > 0;
  const calciumPct =
    nutrition7d.loggedDays === 0
      ? null
      : Math.round((nutrition7d.avgCalcium / NUTRITION_GOALS.calcium) * 100);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 8, borderBottomColor: colors.border },
        ]}
      >
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Bone Tracker
        </Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: bottomPad + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.lede, { color: colors.mutedForeground }]}>
          Your bone health, all in one place — DEXA & FRAX trends plus
          everything you log from the Health Hub.
        </Text>

        <Card variant="elevated" style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionTitleRow}>
              <View
                style={[
                  styles.sectionIcon,
                  { backgroundColor: colors.primary + "1A" },
                ]}
              >
                <Feather name="activity" size={16} color={colors.primary} />
              </View>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Bone Health Dashboard
              </Text>
            </View>
            <Badge
              label={`${boneHealthScore}%`}
              variant={boneHealthScore >= 80 ? "success" : boneHealthScore >= 50 ? "warning" : "default"}
              size="sm"
            />
          </View>

          {boneHealthSummary.map((item) => (
            <CombinedNutrientRow
              key={item.label}
              {...item}
              trackColor={colors.muted}
              textColor={colors.foreground}
              mutedColor={colors.mutedForeground}
            />
          ))}

          <View
            style={[
              styles.dashboardMedicationRow,
              {
                backgroundColor: colors.success + "10",
                borderColor: colors.success + "25",
              },
            ]}
          >
            <Feather
              name={suppTaken > 0 ? "check-circle" : "circle"}
              size={15}
              color={suppTaken > 0 ? colors.success : colors.mutedForeground}
            />
            <Text style={[styles.dashboardMedicationText, { color: colors.foreground }]}>
              Medication and supplement adherence: {suppTaken}/{suppTotal} taken today
            </Text>
          </View>
        </Card>

        {/* The tracker is intentionally available to every user, not
            gated behind Premium. The user's own logged data should
            always be visible to them — the previous PremiumGate
            wrapper here was making the snapshot card invisible to
            free / plus users. Premium-only intelligence (adaptive
            recommendations, deeper analytics) lives elsewhere in
            the app. */}
          {/* ───── Your tracker · combined snapshot ─────
              Aggregates the headline metric from every section below
              into one card so users with data see their full picture
              at a glance. Hidden until at least one source has data
              so first-time users aren't met with a wall of dashes. */}
          {hasAnyData && (
            <Card variant="elevated" style={styles.snapshotCard}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionTitleRow}>
                  <View
                    style={[
                      styles.sectionIcon,
                      { backgroundColor: colors.primary + "1A" },
                    ]}
                  >
                    <Feather name="bar-chart-2" size={16} color={colors.primary} />
                  </View>
                  <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                    Your tracker
                  </Text>
                </View>
                {fracturRisk && (
                  <Badge
                    label={`FRAX · ${fracturRisk}`}
                    variant={riskVariant}
                    size="sm"
                  />
                )}
              </View>

              <View style={styles.snapshotGrid}>
                <SnapshotCell
                  label="T-score"
                  value={latestScan ? ((worstTScore(latestScan) ?? 0).toFixed(1)) : "—"}
                  meta={
                    !latestScan ? "no scan yet" :
                    (latestScan.spineTScore != null || latestScan.hipTScore != null) ? "spine · hip" :
                    (latestScan.site ? formatSite(latestScan.site) : "")
                  }
                  color={colors.primary}
                  textColor={colors.foreground}
                  mutedColor={colors.mutedForeground}
                />
                <SnapshotCell
                  label="Active min"
                  value={
                    activity7d.totalMinutes > 0
                      ? String(activity7d.totalMinutes)
                      : "—"
                  }
                  meta={`${activity7d.daysOnGoal}/7 days on goal`}
                  color={colors.accent}
                  textColor={colors.foreground}
                  mutedColor={colors.mutedForeground}
                />
                <SnapshotCell
                  label="Calcium"
                  value={calciumPct == null ? "—" : `${calciumPct}%`}
                  meta={
                    nutrition7d.loggedDays === 0
                      ? "no logs"
                      : `avg of goal · ${nutrition7d.loggedDays}d`
                  }
                  color={colors.xpGold}
                  textColor={colors.foreground}
                  mutedColor={colors.mutedForeground}
                />
                <SnapshotCell
                  label="Supplements"
                  value={`${suppTaken}/${suppTotal}`}
                  meta="taken today"
                  color={colors.success}
                  textColor={colors.foreground}
                  mutedColor={colors.mutedForeground}
                />
              </View>

              <Text style={[styles.snapshotHelper, { color: colors.mutedForeground }]}>
                Tap any section below for the full breakdown.
              </Text>
            </Card>
          )}

          {/* ───── DEXA & FRAX ───── */}
          <Card variant="elevated" style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionTitleRow}>
                <View
                  style={[
                    styles.sectionIcon,
                    { backgroundColor: colors.primary + "1A" },
                  ]}
                >
                  <Feather name="activity" size={16} color={colors.primary} />
                </View>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                  DEXA & FRAX
                </Text>
              </View>
              <Pressable
                onPress={() => router.push("/health/log-dexa" as never)}
                style={styles.linkRow}
                hitSlop={6}
              >
                <Text style={[styles.linkText, { color: colors.primary }]}>
                  Log scan
                </Text>
                <Feather name="chevron-right" size={14} color={colors.primary} />
              </Pressable>
            </View>

            {!latestScan ? (
              <Text style={[styles.empty, { color: colors.mutedForeground }]}>
                No DEXA scans yet. Log your first scan to start tracking
                your T-score and fracture risk over time.
              </Text>
            ) : (
              <>
                {/* Multi-site display (new model) */}
                {(latestScan.spineTScore != null || latestScan.hipTScore != null) ? (
                  <View style={{ gap: 8 }}>
                    {latestScan.spineTScore != null && (
                      <SiteScoreRow label="Spine (L1–L4)" score={latestScan.spineTScore} colors={colors} />
                    )}
                    {latestScan.hipTScore != null && (
                      <SiteScoreRow label="Hip" score={latestScan.hipTScore} colors={colors} />
                    )}
                    {/* Per-site insight text */}
                    {latestScan.spineTScore != null && (
                      <Text style={[styles.snapshotHelper, { color: colors.mutedForeground, marginTop: 0 }]}>
                        {siteInsight("spine", classifyTScore(latestScan.spineTScore))}
                      </Text>
                    )}
                  </View>
                ) : (
                  /* Legacy single-site display */
                  <View style={styles.heroRow}>
                    <View style={styles.heroCell}>
                      <Text style={[styles.heroLabel, { color: colors.mutedForeground }]}>T-score</Text>
                      <Text style={[styles.heroValue, { color: colors.foreground }]}>
                        {(latestScan.tScore ?? 0).toFixed(1)}
                      </Text>
                    </View>
                    {latestScan.zScore != null && (
                      <>
                        <View style={[styles.divider, { backgroundColor: colors.border }]} />
                        <View style={styles.heroCell}>
                          <Text style={[styles.heroLabel, { color: colors.mutedForeground }]}>Z-score</Text>
                          <Text style={[styles.heroValue, { color: colors.foreground }]}>
                            {latestScan.zScore.toFixed(1)}
                          </Text>
                        </View>
                      </>
                    )}
                    {latestScan.bmd != null && (
                      <>
                        <View style={[styles.divider, { backgroundColor: colors.border }]} />
                        <View style={styles.heroCell}>
                          <Text style={[styles.heroLabel, { color: colors.mutedForeground }]}>BMD</Text>
                          <Text style={[styles.heroValue, { color: colors.foreground }]}>
                            {latestScan.bmd.toFixed(2)}
                          </Text>
                        </View>
                      </>
                    )}
                  </View>
                )}

                <View style={styles.fracturRow}>
                  <Text style={[styles.fracturLabel, { color: colors.mutedForeground }]}>
                    FRAX risk
                  </Text>
                  <Badge
                    label={fracturRisk ?? "unknown"}
                    variant={riskVariant}
                    size="sm"
                  />
                  <Text style={[styles.fracturMeta, { color: colors.mutedForeground }]}>
                    {latestScan.site ? `· ${formatSite(latestScan.site)} ` : ""}· {formatScanDate(latestScan.date, user?.timezone)}
                  </Text>
                </View>

                {/* Fracture risk % from DEXA report */}
                {(latestScan.majorFractureRisk != null || latestScan.hipFractureRisk != null) && (
                  <View style={[styles.riskPctRow, { backgroundColor: colors.muted, borderRadius: 12 }]}>
                    {latestScan.majorFractureRisk != null && (
                      <View style={styles.riskPctCell}>
                        <Text style={[styles.riskPctValue, { color: colors.foreground }]}>
                          {latestScan.majorFractureRisk}%
                        </Text>
                        <Text style={[styles.riskPctLabel, { color: colors.mutedForeground }]}>
                          Major fracture
                        </Text>
                      </View>
                    )}
                    {latestScan.majorFractureRisk != null && latestScan.hipFractureRisk != null && (
                      <View style={[styles.riskPctDivider, { backgroundColor: colors.border }]} />
                    )}
                    {latestScan.hipFractureRisk != null && (
                      <View style={styles.riskPctCell}>
                        <Text style={[styles.riskPctValue, { color: colors.foreground }]}>
                          {latestScan.hipFractureRisk}%
                        </Text>
                        <Text style={[styles.riskPctLabel, { color: colors.mutedForeground }]}>
                          Hip fracture
                        </Text>
                      </View>
                    )}
                    <Text style={[styles.riskPctHint, { color: colors.mutedForeground }]}>
                      10-yr probability from report
                    </Text>
                  </View>
                )}

                {/* FRAX saved results — up to 3 most recent, newest first */}
                {fraxResults.length > 0 && (
                  <View style={{ gap: 8 }}>
                    <Text style={[styles.trendHeading, { color: colors.mutedForeground, marginTop: 4 }]}>
                      FRAX calculator history
                    </Text>
                    {fraxResults.slice(0, 3).map((fr, idx) => {
                      const majorColor = colors.foreground;
                      return (
                        <View
                          key={fr.id}
                          style={[
                            styles.fraxResultRow,
                            {
                              backgroundColor: idx === 0 ? colors.primary + "0D" : colors.muted,
                              borderColor: idx === 0 ? colors.primary + "25" : colors.border,
                              borderWidth: 1,
                              borderRadius: 12,
                            },
                          ]}
                        >
                          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                            <Text style={[styles.fracturLabel, { color: colors.mutedForeground }]}>
                              {idx === 0 ? "Latest · " : ""}{formatScanDate(fr.date, user?.timezone)}
                            </Text>
                            {idx === 0 && (
                              <View style={[styles.fraxResultCells, { gap: 12 }]}>
                                <View style={styles.riskPctCell}>
                                  <Text style={[styles.riskPctValue, { color: majorColor, fontSize: 18 }]}>
                                    {fr.majorFractureRisk}%
                                  </Text>
                                  <Text style={[styles.riskPctLabel, { color: colors.mutedForeground }]}>Major fx</Text>
                                </View>
                                <View style={[styles.riskPctDivider, { backgroundColor: colors.border }]} />
                                <View style={styles.riskPctCell}>
                                  <Text style={[styles.riskPctValue, { color: colors.primary, fontSize: 18 }]}>
                                    {fr.hipFractureRisk}%
                                  </Text>
                                  <Text style={[styles.riskPctLabel, { color: colors.mutedForeground }]}>Hip fx</Text>
                                </View>
                              </View>
                            )}
                            {idx > 0 && (
                              <Text style={[styles.fracturLabel, { color: colors.foreground }]}>
                                Major {fr.majorFractureRisk}% · Hip {fr.hipFractureRisk}%
                              </Text>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Calculate FRAX CTA */}
                <Pressable
                  onPress={() => router.push("/health/frax" as never)}
                  style={[styles.fraxCta, { backgroundColor: colors.navy, borderRadius: 12 }]}
                >
                  <Feather name="zap" size={15} color="#fff" />
                  <Text style={styles.fraxCtaText}>
                    {fraxResults.length > 0 ? "Recalculate fracture risk" : "Calculate your fracture risk"}
                  </Text>
                  <Feather name="chevron-right" size={14} color="rgba(255,255,255,0.7)" />
                </Pressable>

                {dexaTrend.length > 0 && (
                  <View style={styles.trendList}>
                    <Text style={[styles.trendHeading, { color: colors.mutedForeground }]}>
                      T-score history by site
                    </Text>
                    {dexaTrend.map((t) => {
                      const comparison = t.delta == null
                        ? "first scan"
                        : t.delta > 0
                        ? `${Math.abs(t.delta).toFixed(1)} higher than previous`
                        : t.delta < 0
                        ? `${Math.abs(t.delta).toFixed(1)} lower than previous`
                        : "unchanged from previous";
                      return (
                        <View key={t.label} style={styles.trendRow}>
                          <Text style={[styles.trendSite, { color: colors.foreground }]}>
                            {t.label}
                          </Text>
                          <Text style={[styles.trendScore, { color: colors.foreground }]}>
                            {t.score.toFixed(1)}
                          </Text>
                          <View style={styles.trendDelta}>
                            <Feather name="minus" size={14} color={colors.mutedForeground} />
                            <Text style={[styles.trendDeltaText, { color: colors.mutedForeground }]}>
                              {comparison}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </>
            )}
          </Card>

          {/* ───── Activity ───── */}
          <Card variant="elevated" style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionTitleRow}>
                <View
                  style={[
                    styles.sectionIcon,
                    { backgroundColor: colors.accent + "1A" },
                  ]}
                >
                  <Feather name="zap" size={16} color={colors.accent} />
                </View>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                  Activity · last 7 days
                </Text>
              </View>
              <Pressable
                onPress={() => router.push("/health/activity" as never)}
                style={styles.linkRow}
                hitSlop={6}
              >
                <Text style={[styles.linkText, { color: colors.accent }]}>
                  Log activity
                </Text>
                <Feather name="chevron-right" size={14} color={colors.accent} />
              </Pressable>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statCell}>
                <Text style={[styles.statValue, { color: colors.foreground }]}>
                  {activity7d.totalMinutes}
                </Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                  active min
                </Text>
              </View>
              <View style={styles.statCell}>
                <Text style={[styles.statValue, { color: colors.foreground }]}>
                  {activity7d.totalSteps.toLocaleString("en-GB")}
                </Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                  steps
                </Text>
              </View>
              <View style={styles.statCell}>
                <Text style={[styles.statValue, { color: colors.foreground }]}>
                  {activity7d.daysOnGoal}/7
                </Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                  on goal
                </Text>
              </View>
            </View>

            <View style={styles.barChart}>
              {activity7d.minutes.map((m, i) => {
                const ratio = activity7d.peak === 0 ? 0 : m / activity7d.peak;
                const onGoal = m >= ACTIVITY_GOAL_MIN;
                return (
                  <View key={i} style={styles.barCell}>
                    <View
                      style={[
                        styles.barTrack,
                        { backgroundColor: colors.muted },
                      ]}
                    >
                      <View
                        style={[
                          styles.barFill,
                          {
                            height: `${Math.max(4, Math.round(ratio * 100))}%`,
                            backgroundColor: onGoal
                              ? colors.accent
                              : colors.accent + "55",
                          },
                        ]}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
            <Text style={[styles.helper, { color: colors.mutedForeground }]}>
              Goal: {ACTIVITY_GOAL_MIN} active minutes per day.
            </Text>
          </Card>

          {/* ───── Nutrition ───── */}
          <Card variant="elevated" style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionTitleRow}>
                <View
                  style={[
                    styles.sectionIcon,
                    { backgroundColor: colors.xpGold + "1A" },
                  ]}
                >
                  <Feather name="coffee" size={16} color={colors.xpGold} />
                </View>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                  Nutrition · last 7 days
                </Text>
              </View>
              <Pressable
                onPress={() => router.push("/health/nutrition" as never)}
                style={styles.linkRow}
                hitSlop={6}
              >
                <Text style={[styles.linkText, { color: colors.xpGold }]}>
                  Log nutrition
                </Text>
                <Feather name="chevron-right" size={14} color={colors.xpGold} />
              </Pressable>
            </View>

            {nutrition7d.loggedDays === 0 ? (
              <Text style={[styles.empty, { color: colors.mutedForeground }]}>
                No nutrition logged this week. Track calcium and vitamin D
                to keep your bone-builders on goal.
              </Text>
            ) : (
              <>
                <NutrientBar
                  label="Calcium"
                  value={nutrition7d.avgCalcium}
                  goal={NUTRITION_GOALS.calcium}
                  unit="mg"
                  color={colors.primary}
                  trackColor={colors.muted}
                  textColor={colors.foreground}
                  mutedColor={colors.mutedForeground}
                />
                <NutrientBar
                  label="Vitamin D"
                  value={nutrition7d.avgVitaminD}
                  goal={NUTRITION_GOALS.vitaminD}
                  unit="IU"
                  color={colors.accent}
                  trackColor={colors.muted}
                  textColor={colors.foreground}
                  mutedColor={colors.mutedForeground}
                />
                <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                  Daily average across {nutrition7d.loggedDays}{" "}
                  {nutrition7d.loggedDays === 1 ? "logged day" : "logged days"}.
                </Text>
                {(todayNutrition?.source === "meal_plan" ||
                  todayNutrition?.source === "manual+plan") && (
                  <View
                    style={[
                      styles.provenancePill,
                      {
                        backgroundColor: colors.success + "12",
                        borderColor: colors.success + "30",
                      },
                    ]}
                  >
                    <Feather name="check-circle" size={11} color={colors.success} />
                    <Text style={[styles.provenanceText, { color: colors.foreground }]}>
                      {/* Quantified split: "X mg from meal plan, Y mg added manually". 
                          Both numbers come from HealthContext convenience accessors. */}
                      {Math.round(todayPlanTotals.calcium)} mg calcium from meal plan
                      {todayManualTotals.calcium > 0
                        ? `, ${Math.round(todayManualTotals.calcium)} mg added manually`
                        : ""}
                      {todayPlanTotals.vitaminD > 0 || todayManualTotals.vitaminD > 0
                        ? ` · ${Math.round(todayPlanTotals.vitaminD)} IU vitamin D from meal plan${
                            todayManualTotals.vitaminD > 0
                              ? `, ${Math.round(todayManualTotals.vitaminD)} IU added manually`
                              : ""
                          }`
                        : ""}
                      .
                    </Text>
                  </View>
                )}
              </>
            )}
          </Card>

          {/* ───── Daily Intake ───── */}
          <Card variant="elevated" style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionTitleRow}>
                <View
                  style={[
                    styles.sectionIcon,
                    { backgroundColor: colors.success + "1A" },
                  ]}
                >
                  <Feather name="check-circle" size={16} color={colors.success} />
                </View>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                  Daily intake · today
                </Text>
              </View>
              <Pressable
                onPress={() => router.push("/health/supplements" as never)}
                style={styles.linkRow}
                hitSlop={6}
              >
                <Text style={[styles.linkText, { color: colors.success }]}>
                  Open
                </Text>
                <Feather name="chevron-right" size={14} color={colors.success} />
              </Pressable>
            </View>

            {/* Overall taken count */}
            <View style={styles.statsRow}>
              <View style={styles.statCell}>
                <Text style={[styles.statValue, { color: colors.foreground }]}>
                  {suppTaken}/{suppTotal}
                </Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
                  taken today
                </Text>
              </View>
              <View style={[styles.suppList, { flex: 2 }]}>
                {supplements.slice(0, 4).map((s) => (
                  <View key={s.id} style={styles.suppRow}>
                    <Feather
                      name={s.taken ? "check-circle" : "circle"}
                      size={14}
                      color={
                        s.taken
                          ? colors.success
                          : colors.mutedForeground
                      }
                    />
                    <Text
                      style={[
                        styles.suppName,
                        {
                          color: s.taken
                            ? colors.foreground
                            : colors.mutedForeground,
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {s.name}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Category breakdown — only shown when user has both */}
            {supplements.some((s) => s.category === "supplement") &&
              supplements.some((s) => s.category === "medication") && (
                <View style={styles.intakeSplit}>
                  <View
                    style={[
                      styles.intakeSplitCell,
                      {
                        backgroundColor: colors.primary + "0F",
                        borderColor: colors.primary + "25",
                      },
                    ]}
                  >
                    <Feather name="sun" size={12} color={colors.primary} />
                    <Text
                      style={[styles.intakeSplitLabel, { color: colors.mutedForeground }]}
                    >
                      Supplements
                    </Text>
                    <Text
                      style={[styles.intakeSplitCount, { color: colors.foreground }]}
                    >
                      {supplements.filter((s) => s.category === "supplement" && s.taken).length}/
                      {supplements.filter((s) => s.category === "supplement").length}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.intakeSplitCell,
                      {
                        backgroundColor: colors.accent + "0F",
                        borderColor: colors.accent + "25",
                      },
                    ]}
                  >
                    <Feather name="activity" size={12} color={colors.accent} />
                    <Text
                      style={[styles.intakeSplitLabel, { color: colors.mutedForeground }]}
                    >
                      Medications
                    </Text>
                    <Text
                      style={[styles.intakeSplitCount, { color: colors.foreground }]}
                    >
                      {supplements.filter((s) => s.category === "medication" && s.taken).length}/
                      {supplements.filter((s) => s.category === "medication").length}
                    </Text>
                  </View>
                </View>
              )}

            {/* Routine confidence indicator */}
            {suppTotal > 0 && (
              <View style={styles.routineRow}>
                <Text style={[styles.routineLabel, { color: colors.mutedForeground }]}>
                  Routine confidence
                </Text>
                <View style={[styles.routineTrack, { backgroundColor: colors.muted }]}>
                  <View
                    style={[
                      styles.routineFill,
                      {
                        width: `${Math.round((suppTaken / suppTotal) * 100)}%` as any,
                        backgroundColor:
                          suppTaken === suppTotal
                            ? colors.success
                            : colors.primary,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.routinePct, { color: colors.foreground }]}>
                  {Math.round((suppTaken / suppTotal) * 100)}%
                </Text>
              </View>
            )}

            {/* Add CTA if list is empty */}
            {suppTotal === 0 && (
              <Pressable
                onPress={() => router.push("/health/add-supplement" as never)}
                style={[
                  styles.intakeAddCta,
                  { borderColor: colors.success + "40", backgroundColor: colors.success + "08" },
                ]}
              >
                <Feather name="plus" size={14} color={colors.success} />
                <Text style={[styles.intakeAddCtaText, { color: colors.success }]}>
                  Add supplements or medications
                </Text>
              </Pressable>
            )}
          </Card>

          {/* ───── Movement Library ───── */}
          <Card variant="elevated" style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionTitleRow}>
                <View
                  style={[
                    styles.sectionIcon,
                    { backgroundColor: colors.navyLight + "1A" },
                  ]}
                >
                  <Feather name="play-circle" size={16} color={colors.navyLight} />
                </View>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                  Movement · this week
                </Text>
              </View>
              <Pressable
                onPress={() => router.push("/movement" as never)}
                style={styles.linkRow}
                hitSlop={6}
              >
                <Text style={[styles.linkText, { color: colors.navyLight }]}>
                  Browse library
                </Text>
                <Feather name="chevron-right" size={14} color={colors.navyLight} />
              </Pressable>
            </View>
            <Text style={[styles.movementText, { color: colors.foreground }]}>
              {movement7d === 0
                ? "No sessions logged this week — try a 5-minute routine from the library."
                : `${movement7d} session${movement7d === 1 ? "" : "s"} logged in the last 7 days.`}
            </Text>
          </Card>
      </ScrollView>
    </View>
  );
}

interface SnapshotCellProps {
  label: string;
  value: string;
  meta: string;
  color: string;
  textColor: string;
  mutedColor: string;
}

function SnapshotCell({
  label,
  value,
  meta,
  color,
  textColor,
  mutedColor,
}: SnapshotCellProps) {
  return (
    <View style={styles.snapshotCell}>
      <View style={[styles.snapshotAccent, { backgroundColor: color }]} />
      <Text style={[styles.snapshotLabel, { color: mutedColor }]}>{label}</Text>
      <Text style={[styles.snapshotValue, { color: textColor }]}>{value}</Text>
      <Text style={[styles.snapshotMeta, { color: mutedColor }]} numberOfLines={1}>
        {meta}
      </Text>
    </View>
  );
}

interface NutrientBarProps {
  label: string;
  value: number;
  goal: number;
  unit: string;
  color: string;
  trackColor: string;
  textColor: string;
  mutedColor: string;
}

function NutrientBar({
  label,
  value,
  goal,
  unit,
  color,
  trackColor,
  textColor,
  mutedColor,
}: NutrientBarProps) {
  const pct = goal > 0 ? Math.min(1, value / goal) : 0;
  const pctLabel = Math.round(pct * 100);
  return (
    <View style={styles.nutrientRow}>
      <View style={styles.nutrientHeader}>
        <Text style={[styles.nutrientLabel, { color: textColor }]}>{label}</Text>
        <Text style={[styles.nutrientMeta, { color: mutedColor }]}>
          {value.toLocaleString("en-GB")} / {goal.toLocaleString("en-GB")} {unit} · {pctLabel}%
        </Text>
      </View>
      <View style={[styles.nutrientTrack, { backgroundColor: trackColor }]}>
        <View
          style={[
            styles.nutrientFill,
            { width: `${Math.max(2, pctLabel)}%`, backgroundColor: color },
          ]}
        />
      </View>
    </View>
  );
}

interface CombinedNutrientRowProps {
  label: string;
  food: number;
  supplement: number;
  goal: number;
  unit: string;
  color: string;
  trackColor: string;
  textColor: string;
  mutedColor: string;
}

function CombinedNutrientRow({
  label,
  food,
  supplement,
  goal,
  unit,
  color,
  trackColor,
  textColor,
  mutedColor,
}: CombinedNutrientRowProps) {
  const total = food + supplement;
  const pct = goal > 0 ? Math.min(1, total / goal) : 0;
  const pctLabel = Math.round(pct * 100);
  const achieved = total >= goal;

  return (
    <View style={styles.combinedRow}>
      <View style={styles.combinedHeader}>
        <Text style={[styles.nutrientLabel, { color: textColor }]}>{label}</Text>
        <Text style={[styles.nutrientMeta, { color: mutedColor }]}>
          {total.toLocaleString("en-GB")} / {goal.toLocaleString("en-GB")} {unit}
        </Text>
      </View>
      <View style={[styles.nutrientTrack, { backgroundColor: trackColor }]}>
        <View
          style={[
            styles.nutrientFill,
            { width: `${Math.max(2, pctLabel)}%`, backgroundColor: achieved ? "#22c55e" : color },
          ]}
        />
      </View>
      <View style={styles.combinedSplit}>
        <Text style={[styles.combinedSplitText, { color: mutedColor }]}>
          Food {food.toLocaleString("en-GB")} {unit}
        </Text>
        <Text style={[styles.combinedSplitText, { color: mutedColor }]}>
          Supplement {supplement.toLocaleString("en-GB")} {unit}
        </Text>
        <Text style={[styles.combinedStatus, { color: achieved ? "#22c55e" : color }]}>
          {achieved ? "Target achieved" : `${pctLabel}%`}
        </Text>
      </View>
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
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },
  scrollContent: { padding: 16, gap: 12 },
  lede: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },

  section: { gap: 12 },

  // Combined snapshot card
  snapshotCard: { gap: 12 },
  snapshotGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  snapshotCell: {
    width: "47.5%",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: "transparent",
    gap: 2,
    position: "relative",
    overflow: "hidden",
  },
  snapshotAccent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },
  snapshotLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginLeft: 6,
  },
  snapshotValue: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    marginLeft: 6,
  },
  snapshotMeta: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginLeft: 6,
  },
  snapshotHelper: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },

  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  linkText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  empty: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },

  // DEXA hero
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  heroCell: { alignItems: "center", flex: 1 },
  heroLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginBottom: 2 },
  heroValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  divider: { width: 1, height: 32 },

  fracturRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  fracturLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  fracturMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },

  riskPctRow: { flexDirection: "row", alignItems: "center", padding: 12, gap: 0, flexWrap: "wrap", marginTop: 8 },
  riskPctCell: { flex: 1, alignItems: "center", paddingVertical: 4 },
  riskPctValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  riskPctLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2, textAlign: "center" },
  riskPctDivider: { width: 1, height: 36 },
  riskPctHint: { fontSize: 10, fontFamily: "Inter_400Regular", width: "100%", textAlign: "center", marginTop: 6 },
  fraxResultRow: { padding: 12, marginTop: 8, gap: 8 },
  fraxResultCells: { flexDirection: "row", alignItems: "center", gap: 0, marginTop: 4 },
  fraxCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 10,
  },
  fraxCtaText: { flex: 1, marginLeft: 8, fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },

  trendList: { gap: 6, marginTop: 4 },
  trendHeading: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  trendRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  trendSite: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  trendScore: { fontSize: 13, fontFamily: "Inter_700Bold", width: 36, textAlign: "right" },
  trendDelta: { flexDirection: "row", alignItems: "center", gap: 4, width: 110, justifyContent: "flex-end" },
  trendDeltaText: { fontSize: 12, fontFamily: "Inter_500Medium" },

  // Activity
  statsRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  statCell: { flex: 1 },
  statValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  barChart: {
    flexDirection: "row",
    gap: 6,
    height: 56,
    alignItems: "flex-end",
  },
  barCell: { flex: 1, height: "100%" },
  barTrack: {
    flex: 1,
    borderRadius: 4,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  barFill: { width: "100%", borderRadius: 4 },
  helper: { fontSize: 11, fontFamily: "Inter_400Regular" },
  provenancePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 4,
  },
  provenanceText: { flex: 1, fontSize: 11, fontFamily: "Inter_500Medium", lineHeight: 15 },

  // Nutrition
  nutrientRow: { gap: 4 },
  nutrientHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  nutrientLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  nutrientMeta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  nutrientTrack: { height: 8, borderRadius: 4, overflow: "hidden" },
  nutrientFill: { height: "100%", borderRadius: 4 },
  combinedRow: { gap: 5 },
  combinedHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  combinedSplit: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  combinedSplitText: { fontSize: 10, fontFamily: "Inter_400Regular" },
  combinedStatus: { marginLeft: "auto", fontSize: 10, fontFamily: "Inter_700Bold" },
  dashboardMedicationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 2,
  },
  dashboardMedicationText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    lineHeight: 17,
  },

  // Supplements / Daily intake
  suppList: { gap: 4 },
  suppRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  suppName: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  intakeSplit: { flexDirection: "row", gap: 8, marginTop: 4 },
  intakeSplitCell: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  intakeSplitLabel: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1 },
  intakeSplitCount: { fontSize: 13, fontFamily: "Inter_700Bold" },
  routineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
  },
  routineLabel: { fontSize: 11, fontFamily: "Inter_400Regular", width: 110 },
  routineTrack: { flex: 1, height: 5, borderRadius: 3, overflow: "hidden" },
  routineFill: { height: "100%", borderRadius: 3 },
  routinePct: { fontSize: 12, fontFamily: "Inter_700Bold", width: 32, textAlign: "right" },
  intakeAddCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  intakeAddCtaText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  // Movement
  movementText: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 19 },
});
