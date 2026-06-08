/**
 * Wellness Hub — the primary navigation landing for Movement, Breathing
 * Studio, and Meditation Lounge. This screen acts as the "core pillar"
 * entry point so all three areas are one tap from the tab bar.
 *
 * Design language: deep navy header + navy gradient backdrop, matching
 * the Health Hub and Dashboard visual system.
 *
 * Data feeds:
 *  - useWellbeing → breathing + meditation session history, streak, weekCount
 *  - useHealth    → activity logs (movement history)
 *  - useAuth      → user name / timezone
 */
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
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
import { useAuth } from "@/context/AuthContext";
import { useHealth } from "@/context/HealthContext";
import { useWellbeing } from "@/context/WellbeingContext";
import { useColors } from "@/hooks/useColors";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function dateISOFromMs(ms: number) {
  return new Date(ms).toISOString().split("T")[0];
}

function getLastNDateISOs(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(d.toISOString().split("T")[0]);
  }
  return out;
}

function getLastNDayLabels(n: number): string[] {
  const days = ["S", "M", "T", "W", "T", "F", "S"];
  const out: string[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(days[d.getDay()]);
  }
  return out;
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

// ─── Section card definitions ─────────────────────────────────────────────────
// Gradients aligned to brand navy palette — orange accent for movement,
// primary teal for breathing, pure navy for meditation.

const SECTIONS = [
  {
    id: "breathing",
    title: "Breathing Studio",
    subtitle: "Regulate your nervous system, reduce cortisol.",
    cta: "Start a Session",
    route: "/breathing-studio",
    icon: "wind" as const,
    gradients: ["#0D2530", "#1A7A8A"] as [string, string],
    accent: "#3ABBD4",
    kind: "breathing" as const,
  },
  {
    id: "meditation",
    title: "Meditation Lounge",
    subtitle: "Stillness that helps you sleep, focus, and heal.",
    cta: "Begin Meditation",
    route: "/meditation",
    icon: "headphones" as const,
    gradients: ["#0D2530", "#2B7499"] as [string, string],
    accent: "#3ABBD4",
    kind: "meditation" as const,
  },
  {
    id: "movement",
    title: "Movement",
    subtitle: "Bones need load. Routines that deliver.",
    cta: "View Routines",
    route: "/movement",
    icon: "activity" as const,
    gradients: ["#0D2530", "#C45A20"] as [string, string],
    accent: "#F47530",
    kind: null as null,
  },
] as const;

// ─── Section card ─────────────────────────────────────────────────────────────

function SectionCard({
  section,
  lastSessionLabel,
  sessionCount,
  onPress,
}: {
  section: typeof SECTIONS[number];
  lastSessionLabel: string | null;
  sessionCount: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        sc.wrap,
        { transform: [{ scale: pressed ? 0.985 : 1 }] },
      ]}
    >
      <LinearGradient
        colors={section.gradients}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={sc.card}
      >
        {/* Top row: icon + session count badge */}
        <View style={sc.topRow}>
          <View style={[sc.iconWrap, { backgroundColor: section.accent + "25" }]}>
            <Feather name={section.icon} size={20} color={section.accent} />
          </View>
          {sessionCount > 0 && (
            <View style={[sc.countBadge, { backgroundColor: section.accent + "20", borderColor: section.accent + "35" }]}>
              <Text style={[sc.countText, { color: section.accent }]}>{sessionCount} this week</Text>
            </View>
          )}
        </View>

        {/* Title + subtitle */}
        <View style={sc.body}>
          <Text style={sc.title}>{section.title}</Text>
          <Text style={sc.subtitle}>{section.subtitle}</Text>
        </View>

        {/* Last session info */}
        <Text style={sc.lastSession}>
          {lastSessionLabel ? `Last: ${lastSessionLabel}` : "No sessions yet — start today"}
        </Text>

        {/* CTA */}
        <View style={[sc.ctaRow, { borderTopColor: "rgba(255,255,255,0.10)" }]}>
          <Text style={[sc.ctaText, { color: section.accent }]}>{section.cta}</Text>
          <View style={[sc.ctaPill, { backgroundColor: section.accent + "20", borderColor: section.accent + "35" }]}>
            <Feather name="arrow-right" size={13} color={section.accent} />
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const sc = StyleSheet.create({
  wrap: { borderRadius: 22, overflow: "hidden" },
  card: { borderRadius: 22, padding: 20, gap: 14 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconWrap: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  countBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  countText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  body: { gap: 4 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: -0.3 },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.72)", lineHeight: 20 },
  lastSession: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.45)" },
  ctaRow: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14 },
  ctaText: { fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1 },
  ctaPill: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center", borderWidth: 1 },
});

// ─── Weekly dots ──────────────────────────────────────────────────────────────

function WeekDots({
  label,
  accent,
  checks,
}: {
  label: string;
  accent: string;
  checks: boolean[];
}) {
  return (
    <View style={wd.row}>
      <Text style={wd.label}>{label}</Text>
      <View style={wd.dots}>
        {checks.map((on, i) => (
          <View
            key={i}
            style={[
              wd.dot,
              {
                backgroundColor: on ? accent : "rgba(255,255,255,0.06)",
                borderColor: on ? accent + "55" : "rgba(255,255,255,0.10)",
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}
const wd = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  label: { width: 60, fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.50)" },
  dots: { flex: 1, flexDirection: "row", gap: 6, justifyContent: "space-between" },
  dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1 },
});

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function WellnessScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { entries, currentStreak, weekCount } = useWellbeing();
  const { activityLogs } = useHealth();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 + 84 : insets.bottom + 84;

  // ── Derived data ──────────────────────────────────────────────────────────

  const DAYS = 7;
  const dayISOs   = useMemo(() => getLastNDateISOs(DAYS),  []);
  const dayLabels = useMemo(() => getLastNDayLabels(DAYS), []);

  const breathingDates = useMemo(() => {
    const s = new Set<string>();
    entries.filter((e) => e.kind === "breathing").forEach((e) => s.add(dateISOFromMs(e.completedAt)));
    return s;
  }, [entries]);

  const meditationDates = useMemo(() => {
    const s = new Set<string>();
    entries.filter((e) => e.kind === "meditation").forEach((e) => s.add(dateISOFromMs(e.completedAt)));
    return s;
  }, [entries]);

  const movementDates = useMemo(() => {
    const s = new Set<string>(activityLogs.map((l) => l.date));
    return s;
  }, [activityLogs]);

  const breathingWeek = useMemo(
    () => entries.filter((e) => e.kind === "breathing" && Date.now() - e.completedAt <= 7 * 86400000).length,
    [entries],
  );
  const meditationWeek = useMemo(
    () => entries.filter((e) => e.kind === "meditation" && Date.now() - e.completedAt <= 7 * 86400000).length,
    [entries],
  );
  const movementWeek = useMemo(
    () => activityLogs.filter((l) => Date.now() - new Date(l.date).getTime() <= 7 * 86400000).length,
    [activityLogs],
  );

  const lastBreathing = useMemo(() => {
    const e = entries.find((e) => e.kind === "breathing");
    if (!e) return null;
    return `${e.sessionName} · ${formatDuration(e.durationSec)}`;
  }, [entries]);

  const lastMeditation = useMemo(() => {
    const e = entries.find((e) => e.kind === "meditation");
    if (!e) return null;
    return `${e.sessionName} · ${formatDuration(e.durationSec)}`;
  }, [entries]);

  const lastMovement = useMemo(() => {
    const l = activityLogs[0];
    if (!l) return null;
    const d = new Date(l.date).toLocaleDateString("en-GB", {
      weekday: "short", day: "numeric", month: "short",
      ...(user?.timezone ? { timeZone: user.timezone } : {}),
    });
    return `${l.steps.toLocaleString()} steps · ${d}`;
  }, [activityLogs, user?.timezone]);

  const recentSessions = useMemo(() => entries.slice(0, 6), [entries]);

  const sessionLastLabels = {
    movement:   lastMovement,
    breathing:  lastBreathing,
    meditation: lastMeditation,
  };

  const sessionWeekCounts = {
    movement:   movementWeek,
    breathing:  breathingWeek,
    meditation: meditationWeek,
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Deep navy hero gradient backdrop — matches Dashboard + Health Hub */}
      <LinearGradient
        colors={["#0D2530", "#1C3A4A", colors.background]}
        locations={[0, 0.4, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[styles.backdrop, { height: topPad + 260 }]}
        pointerEvents="none"
      />

      {/* ── Header bar (insight gradient, matching Health Hub) ── */}
      <LinearGradient
        colors={colors.gradients.insight}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.topBar, { paddingTop: topPad + 10 }, colors.shadows.sm]}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.screenTitle}>Wellness</Text>
          <Text style={styles.screenSub}>Breathing · Meditation · Movement</Text>
        </View>
        {currentStreak > 0 && (
          <View style={[styles.streakPill, { backgroundColor: "rgba(255,255,255,0.14)", borderColor: "rgba(255,255,255,0.22)" }]}>
            <Feather name="zap" size={13} color={colors.xpGold} />
            <Text style={styles.streakText}>{currentStreak}d streak</Text>
          </View>
        )}
      </LinearGradient>

      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: botPad }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Section Cards ── */}
        <View style={styles.sectionWrap}>
          <SectionLabel title="Your Pillars" color={colors.accent} />
          {SECTIONS.map((section) => (
            <SectionCard
              key={section.id}
              section={section}
              lastSessionLabel={sessionLastLabels[section.id as keyof typeof sessionLastLabels]}
              sessionCount={sessionWeekCounts[section.id as keyof typeof sessionWeekCounts]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                router.push(section.route as any);
              }}
            />
          ))}
        </View>

        {/* ── This Week ── */}
        <View style={styles.sectionWrap}>
          <SectionLabel title="This Week" color={colors.navyLight} />
          <Pressable
            onPress={() => router.push("/health/bone-tracker" as any)}
            style={({ pressed }) => [
              colors.shadows.md,
              { borderRadius: 20, transform: [{ scale: pressed ? 0.99 : 1 }] },
            ]}
          >
            <LinearGradient
              colors={[colors.navy, colors.navyMid]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.weekCard}
            >
              {/* Card header */}
              <View style={styles.weekCardHeader}>
                <View style={[styles.weekCardIcon, { backgroundColor: colors.navyLight + "30", borderColor: colors.navyLight + "45" }]}>
                  <Feather name="calendar" size={15} color={colors.primary} />
                </View>
                <Text style={styles.weekCardTitle}>This Week</Text>
                <View style={[styles.weekCountBadge, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "35" }]}>
                  <Text style={[styles.weekCountText, { color: colors.primary }]}>
                    {weekCount + movementWeek} sessions
                  </Text>
                </View>
              </View>

              <View style={styles.weekDivider} />

              {/* Day column headers */}
              <View style={styles.dayLabelRow}>
                <View style={{ width: 66 }} />
                {dayLabels.map((l, i) => (
                  <Text key={i} style={styles.dayLabel}>{l}</Text>
                ))}
              </View>

              <WeekDots
                label="Move"
                accent="#F47530"
                checks={dayISOs.map((d) => movementDates.has(d))}
              />
              <WeekDots
                label="Breathe"
                accent="#3ABBD4"
                checks={dayISOs.map((d) => breathingDates.has(d))}
              />
              <WeekDots
                label="Meditate"
                accent="#3ABBD4"
                checks={dayISOs.map((d) => meditationDates.has(d))}
              />

              {/* Balance stats */}
              {(breathingWeek > 0 || meditationWeek > 0 || movementWeek > 0) && (
                <View style={styles.balanceRow}>
                  <View style={styles.balanceCell}>
                    <Text style={[styles.balanceNum, { color: "#F47530" }]}>{movementWeek}</Text>
                    <Text style={styles.balanceLabel}>Move</Text>
                  </View>
                  <View style={styles.balanceDivider} />
                  <View style={styles.balanceCell}>
                    <Text style={[styles.balanceNum, { color: "#3ABBD4" }]}>{breathingWeek}</Text>
                    <Text style={styles.balanceLabel}>Breathe</Text>
                  </View>
                  <View style={styles.balanceDivider} />
                  <View style={styles.balanceCell}>
                    <Text style={[styles.balanceNum, { color: "#3ABBD4" }]}>{meditationWeek}</Text>
                    <Text style={styles.balanceLabel}>Meditate</Text>
                  </View>
                </View>
              )}
            </LinearGradient>
          </Pressable>
        </View>

        {/* ── Recent Sessions ── */}
        {recentSessions.length > 0 && (
          <View style={styles.sectionWrap}>
            <SectionLabel title="Recent Sessions" color={colors.primary} />
            <LinearGradient
              colors={[colors.navy, colors.navyMid]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.recentCard, colors.shadows.md]}
            >
              <View style={styles.recentCardHeader}>
                <View style={[styles.weekCardIcon, { backgroundColor: colors.accent + "22", borderColor: colors.accent + "35" }]}>
                  <Feather name="clock" size={15} color={colors.accent} />
                </View>
                <Text style={styles.weekCardTitle}>Recent Sessions</Text>
              </View>

              <View style={styles.weekDivider} />

              {recentSessions.map((e, i) => {
                const isBreathing = e.kind === "breathing";
                const accent = isBreathing ? "#3ABBD4" : colors.primary;
                const icon   = isBreathing ? "wind" : "headphones";
                const d = new Date(e.completedAt).toLocaleDateString("en-GB", {
                  weekday: "short", day: "numeric", month: "short",
                  ...(user?.timezone ? { timeZone: user.timezone } : {}),
                });
                return (
                  <View
                    key={e.id}
                    style={[
                      styles.sessionRow,
                      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(255,255,255,0.08)", paddingTop: 10 },
                    ]}
                  >
                    <View style={[styles.sessionIcon, { backgroundColor: accent + "22" }]}>
                      <Feather name={icon} size={14} color={accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sessionName} numberOfLines={1}>{e.sessionName}</Text>
                      <Text style={styles.sessionMeta}>{formatDuration(e.durationSec)} · {d}</Text>
                    </View>
                    <View style={[styles.moodBadge, { backgroundColor: accent + "18", borderColor: accent + "30" }]}>
                      <Text style={[styles.moodText, { color: accent }]}>
                        {e.mood.replace("_", " ")}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </LinearGradient>
          </View>
        )}

        {/* ── Empty state ── */}
        {recentSessions.length === 0 && movementWeek === 0 && (
          <View style={[styles.emptyCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <View style={[styles.emptyIconWrap, { backgroundColor: colors.primary + "14" }]}>
              <Feather name="sun" size={24} color={colors.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Ready when you are</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Tap any section above to start your first session. Everything you do here
              feeds back into your SNAP insights.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0 },
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 0, paddingTop: 16 },

  // Header bar
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingBottom: 14,
  },
  screenTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  screenSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.58)", marginTop: 2 },
  streakPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
  },
  streakText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },

  // Section wrapper (SectionLabel + cards, with gap)
  sectionWrap: { gap: 12, marginBottom: 20 },

  // "This Week" dark card
  weekCard: { borderRadius: 20, padding: 18, gap: 12, overflow: "hidden" },
  weekCardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  weekCardIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  weekCardTitle: { flex: 1, fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  weekCountBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  weekCountText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  weekDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.10)" },
  dayLabelRow: { flexDirection: "row", alignItems: "center" },
  dayLabel: { flex: 1, textAlign: "center", fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.40)" },
  balanceRow: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.10)",
    paddingTop: 12,
    marginTop: 4,
  },
  balanceCell: { flex: 1, alignItems: "center", gap: 3 },
  balanceDivider: { width: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.10)", alignSelf: "stretch" },
  balanceNum: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  balanceLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: 0.5 },

  // Recent sessions dark card
  recentCard: { borderRadius: 20, padding: 18, gap: 12, overflow: "hidden" },
  recentCardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  sessionRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  sessionIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  sessionName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  sessionMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.50)", marginTop: 1 },
  moodBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  moodText: { fontSize: 11, fontFamily: "Inter_500Medium" },

  // Empty state
  emptyCard: {
    borderRadius: 20, borderWidth: 1, padding: 28,
    alignItems: "center", gap: 12,
  },
  emptyIconWrap: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21 },
});
