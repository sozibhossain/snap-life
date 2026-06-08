import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { QualitativeProgressStrip } from "@/components/QualitativeProgressStrip";
import { SectionHeader } from "@/components/SectionHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SnapShot } from "@/components/SnapShot";
import { useAuth } from "@/context/AuthContext";
import { useHealth, worstTScore } from "@/context/HealthContext";
import { useColors } from "@/hooks/useColors";

const TABS = ["Overview", "DEXA Scans", "Activity", "Nutrition", "Supplements"];

export default function HealthScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const {
    dexaScans,
    fraxResults,
    activityLogs,
    nutritionLogs,
    supplements,
    getLatestDexaScore,
    getFracturRisk,
    markSupplementTaken,
  } = useHealth();

  const [activeTab, setActiveTab] = useState(0);
  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  const latestScan = dexaScans[0];
  const fracturRisk = getFracturRisk();

  const riskColor =
    fracturRisk === "low"
      ? colors.success
      : fracturRisk === "moderate"
      ? colors.warning
      : colors.destructive;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={colors.gradients.insight}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.topBar,
          { paddingTop: topPadding + 10 },
          colors.shadows.sm,
        ]}
      >
        <Text style={styles.screenTitle}>
          Health Hub
        </Text>
        <Pressable
          onPress={() => router.push("/health/log-dexa")}
          accessibilityRole="button"
          accessibilityLabel="Log a new DEXA scan"
        >
          <View style={styles.addBtn}>
            <Feather name="plus" size={18} color="#fff" />
          </View>
        </Pressable>
      </LinearGradient>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.tabsScroll, { borderBottomColor: colors.border }]}
        contentContainerStyle={styles.tabsContent}
      >
        {TABS.map((tab, i) => (
          <Pressable key={tab} onPress={() => setActiveTab(i)} style={styles.tabItem}>
            <Text
              style={[
                styles.tabText,
                {
                  color: activeTab === i ? colors.primary : colors.mutedForeground,
                  fontFamily: activeTab === i ? "Inter_600SemiBold" : "Inter_400Regular",
                },
              ]}
            >
              {tab}
            </Text>
            {activeTab === i && (
              <View style={[styles.tabIndicator, { backgroundColor: colors.primary }]} />
            )}
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Platform.OS === "web" ? 34 + 84 : insets.bottom + 84 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 0 && (
          <View>
            {/* Combined Bone Density + FRAX card — both reference the same
                T-score, so we show the three density numbers up top and
                the fracture-risk verdict inline beneath, instead of two
                stacked cards saying overlapping things. */}
            <Card style={styles.overviewCard} variant="elevated">
              <View style={styles.overviewHeader}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                  Bone Density
                </Text>
                <Badge
                  label={fracturRisk === "low" ? "Low risk" : fracturRisk === "moderate" ? "Moderate risk" : "High risk"}
                  variant={fracturRisk === "low" ? "success" : fracturRisk === "moderate" ? "warning" : "danger"}
                />
              </View>
              <View style={styles.scoreRow}>
                <View style={styles.scoreItem}>
                  <Text style={[styles.bigScore, { color: riskColor }]}>
                    {latestScan ? ((worstTScore(latestScan) ?? 0).toFixed(1)) : "--"}
                  </Text>
                  <Text style={[styles.scoreLabel, { color: colors.mutedForeground }]}>
                    T-Score
                  </Text>
                </View>
                {latestScan?.zScore != null && (
                  <>
                    <View style={[styles.scoreDivider, { backgroundColor: colors.border }]} />
                    <View style={styles.scoreItem}>
                      <Text style={[styles.bigScore, { color: colors.primary }]}>
                        {latestScan.zScore.toFixed(1)}
                      </Text>
                      <Text style={[styles.scoreLabel, { color: colors.mutedForeground }]}>
                        Z-Score
                      </Text>
                    </View>
                  </>
                )}
                {latestScan?.bmd != null && (
                  <>
                    <View style={[styles.scoreDivider, { backgroundColor: colors.border }]} />
                    <View style={styles.scoreItem}>
                      <Text style={[styles.bigScore, { color: colors.accent }]}>
                        {latestScan.bmd.toFixed(2)}
                      </Text>
                      <Text style={[styles.scoreLabel, { color: colors.mutedForeground }]}>
                        BMD g/cm²
                      </Text>
                    </View>
                  </>
                )}
              </View>
              <View style={[styles.cardDivider, { backgroundColor: colors.border }]} />
              <Text style={[styles.riskText, { color: colors.mutedForeground }]}>
                Your 10-year fracture probability is{" "}
                <Text style={{ color: riskColor, fontFamily: "Inter_600SemiBold" }}>
                  {fracturRisk === "low" ? "below 10%" : fracturRisk === "moderate" ? "10-20%" : "above 20%"}
                </Text>
                {latestScan ? ` (last scan ${new Date(latestScan.date).toLocaleDateString("en-GB", {
                  day: "numeric", month: "short", year: "numeric",
                  ...(user?.timezone ? { timeZone: user.timezone } : {}),
                })}).` : "."} Consult your doctor for a full FRAX assessment.
              </Text>
            </Card>

            {/* Calm, qualitative summary balancing the number-heavy card
                above — pulls from the InsightsEngine and renders 2–3
                short observations as inline prose. */}
            <QualitativeProgressStrip />

            <SectionHeader title="Quick Actions" />
            <View style={styles.quickActionsGrid}>
              {[
                { label: "Log DEXA Scan",      icon: "activity"     as const, route: "/health/log-dexa",      color: colors.primary },
                { label: "Log Activity",       icon: "zap"          as const, route: "/health/activity",      color: colors.accent  },
                { label: "Log Nutrition",      icon: "coffee"       as const, route: "/health/nutrition",     color: colors.xpGold  },
                { label: "Movement Library",   icon: "play-circle"  as const, route: "/movement",             color: colors.success },
                { label: "Calculate FRAX",     icon: "shield"       as const, route: "/health/frax",          color: colors.navyLight },
                { label: "Bone Tracker",       icon: "trending-up"  as const, route: "/health/bone-tracker",  color: colors.navyLight },
              ].map((action) => (
                <Pressable
                  key={action.label}
                  style={[styles.quickAction, colors.shadows.sm]}
                  onPress={() => router.push(action.route as any)}
                >
                  <LinearGradient
                    colors={[colors.navy, colors.navyMid]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFillObject}
                  />
                  <View style={[styles.quickActionIcon, { backgroundColor: action.color + "22" }]}>
                    <Feather name={action.icon} size={19} color={action.color} />
                  </View>
                  <Text style={styles.quickActionLabel}>{action.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* SNAP Shot — bite-sized, swipeable bone-health tips. Lives on
                the Health Hub Overview (moved off the dashboard) so it sits
                with the rest of the educational content. */}
            <SectionHeader title="SNAP Shot" />
            <Text style={[styles.snapTagline, { color: colors.mutedForeground }]}>
              Bite-sized bone health tips
            </Text>
            <SnapShot />
          </View>
        )}

        {activeTab === 1 && (
          <View>
            {/* Action row — Log DEXA + Calculate FRAX side by side */}
            <View style={styles.nutritionActions}>
              <Pressable
                style={[styles.nutritionActionBtn, { backgroundColor: colors.primary }]}
                onPress={() => router.push("/health/log-dexa")}
              >
                <Feather name="plus" size={16} color="#fff" />
                <Text style={styles.logBtnText}>Log DEXA Scan</Text>
              </Pressable>
              <Pressable
                style={[styles.nutritionActionBtn, { backgroundColor: colors.navy }]}
                onPress={() => router.push("/health/frax")}
              >
                <Feather name="shield" size={16} color="#fff" />
                <Text style={styles.logBtnText}>Calculate FRAX</Text>
              </Pressable>
            </View>

            {dexaScans.map((scan) => (
              <Card key={scan.id} style={styles.scanCard} variant="outlined">
                <View style={styles.scanCardHeader}>
                  <View>
                    <Text style={[styles.scanSite, { color: colors.foreground }]}>
                      {scan.spineTScore != null || scan.hipTScore != null
                        ? "Spine + Hip"
                        : scan.site
                        ? scan.site.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())
                        : "DEXA Scan"}
                    </Text>
                    <Text style={[styles.scanDate, { color: colors.mutedForeground }]}>
                      {new Date(scan.date).toLocaleDateString("en-GB", {
                        day: "numeric", month: "long", year: "numeric",
                        ...(user?.timezone ? { timeZone: user.timezone } : {}),
                      })}
                    </Text>
                  </View>
                  {(() => {
                    const t = worstTScore(scan);
                    return t != null ? (
                      <Badge
                        label={`T: ${t.toFixed(1)}`}
                        variant={t >= -1 ? "success" : t >= -2.5 ? "warning" : "danger"}
                      />
                    ) : null;
                  })()}
                </View>
                <View style={styles.scanMetrics}>
                  {[
                    ...(scan.spineTScore != null ? [{ label: "Spine T", value: scan.spineTScore.toFixed(1) }] : []),
                    ...(scan.hipTScore != null ? [{ label: "Hip T", value: scan.hipTScore.toFixed(1) }] : []),
                    ...(scan.tScore != null ? [{ label: "T-Score", value: scan.tScore.toFixed(1) }] : []),
                    ...(scan.zScore != null ? [{ label: "Z-Score", value: scan.zScore.toFixed(1) }] : []),
                    ...(scan.bmd != null ? [{ label: "BMD", value: `${scan.bmd.toFixed(2)} g/cm²` }] : []),
                    ...(scan.bmi != null ? [{ label: "BMI", value: String(scan.bmi) }] : []),
                  ].map((m) => (
                    <View key={m.label} style={styles.scanMetric}>
                      <Text style={[styles.metricValue, { color: colors.foreground }]}>
                        {m.value}
                      </Text>
                      <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>
                        {m.label}
                      </Text>
                    </View>
                  ))}
                </View>
                {(scan.majorFractureRisk != null || scan.hipFractureRisk != null) && (
                  <View style={[styles.fracturePctRow, { backgroundColor: colors.muted, borderRadius: 10, marginTop: 10, padding: 10, flexDirection: "row", gap: 16 }]}>
                    {scan.majorFractureRisk != null && (
                      <View>
                        <Text style={[styles.metricValue, { color: colors.foreground }]}>{scan.majorFractureRisk}%</Text>
                        <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>Major fracture risk</Text>
                      </View>
                    )}
                    {scan.hipFractureRisk != null && (
                      <View>
                        <Text style={[styles.metricValue, { color: colors.foreground }]}>{scan.hipFractureRisk}%</Text>
                        <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>Hip fracture risk</Text>
                      </View>
                    )}
                  </View>
                )}
                {scan.notes && (
                  <Text style={[styles.scanNotes, { color: colors.mutedForeground }]}>
                    {scan.notes}
                  </Text>
                )}
              </Card>
            ))}

            {/* FRAX calculator history */}
            {fraxResults.length > 0 && (
              <Card style={styles.scanCard} variant="outlined">
                <View style={styles.scanCardHeader}>
                  <View>
                    <Text style={[styles.scanSite, { color: colors.foreground }]}>
                      FRAX Estimates
                    </Text>
                    <Text style={[styles.scanDate, { color: colors.mutedForeground }]}>
                      Saved fracture risk calculations
                    </Text>
                  </View>
                  <Pressable onPress={() => router.push("/health/frax")}>
                    <Text style={{ color: colors.primary, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>
                      Recalculate
                    </Text>
                  </Pressable>
                </View>
                {fraxResults.slice(0, 3).map((f) => (
                  <View
                    key={f.id}
                    style={[
                      styles.fracturePctRow,
                      {
                        backgroundColor: colors.muted,
                        borderRadius: 10,
                        marginTop: 8,
                        padding: 10,
                        flexDirection: "row",
                        gap: 16,
                        alignItems: "center",
                      },
                    ]}
                  >
                    <Text style={[styles.scanDate, { color: colors.mutedForeground, flex: 1 }]}>
                      {new Date(f.date).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        ...(user?.timezone ? { timeZone: user.timezone } : {}),
                      })}
                    </Text>
                    <View style={{ flexDirection: "row", gap: 16 }}>
                      <View style={{ alignItems: "center" }}>
                        <Text style={[styles.metricValue, { color: colors.foreground }]}>
                          {f.majorFractureRisk}%
                        </Text>
                        <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>
                          Major fx
                        </Text>
                      </View>
                      <View style={{ alignItems: "center" }}>
                        <Text style={[styles.metricValue, { color: colors.foreground }]}>
                          {f.hipFractureRisk}%
                        </Text>
                        <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>
                          Hip fx
                        </Text>
                      </View>
                    </View>
                  </View>
                ))}
              </Card>
            )}

            {dexaScans.length === 0 && fraxResults.length === 0 && (
              <View style={[styles.emptyState, { marginTop: 16 }]}>
                <Feather name="activity" size={40} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  No scans logged yet
                </Text>
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  Log your DEXA results or run the FRAX calculator to start tracking your bone health.
                </Text>
              </View>
            )}
          </View>
        )}

        {activeTab === 2 && (
          <View>
            <Pressable
              style={[styles.logBtn, { backgroundColor: colors.accent }]}
              onPress={() => router.push("/health/activity")}
            >
              <Feather name="plus" size={16} color="#fff" />
              <Text style={styles.logBtnText}>Log Today's Activity</Text>
            </Pressable>
            {activityLogs.map((log) => (
              <Card key={log.id} style={styles.scanCard} variant="outlined">
                <Text style={[styles.scanSite, { color: colors.foreground }]}>
                  {new Date(log.date).toLocaleDateString("en-GB", {
                    weekday: "long", day: "numeric", month: "short",
                    ...(user?.timezone ? { timeZone: user.timezone } : {}),
                  })}
                </Text>
                <View style={styles.activityMetrics}>
                  {[
                    { label: "Steps", value: log.steps.toLocaleString(), icon: "activity" as const, color: colors.primary },
                    { label: "Active Min", value: `${log.activeMinutes}m`, icon: "clock" as const, color: colors.accent },
                    { label: "Calories", value: `${log.calories} kcal`, icon: "zap" as const, color: colors.xpGold },
                    { label: "Distance", value: `${log.distance.toFixed(1)} km`, icon: "map-pin" as const, color: colors.success },
                  ].map((m) => (
                    <View key={m.label} style={styles.activityMetric}>
                      <Feather name={m.icon} size={14} color={m.color} />
                      <Text style={[styles.actMetricValue, { color: colors.foreground }]}>
                        {m.value}
                      </Text>
                      <Text style={[styles.actMetricLabel, { color: colors.mutedForeground }]}>
                        {m.label}
                      </Text>
                    </View>
                  ))}
                </View>
              </Card>
            ))}
          </View>
        )}

        {activeTab === 3 && (
          <View>
            <View style={styles.nutritionActions}>
              <Pressable
                style={[styles.nutritionActionBtn, { backgroundColor: colors.xpGold }]}
                onPress={() => router.push("/health/nutrition")}
              >
                <Feather name="plus" size={16} color="#fff" />
                <Text style={styles.logBtnText}>Log Nutrition</Text>
              </Pressable>
              <Pressable
                style={[styles.nutritionActionBtn, { backgroundColor: colors.primary }]}
                onPress={() => router.push("/health/meal-plan")}
              >
                <Feather name="book-open" size={16} color="#fff" />
                <Text style={styles.logBtnText}>Meal Plan</Text>
              </Pressable>
            </View>

            <View style={[styles.snapShotSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.snapShotHeader}>
                <View style={[styles.snapShotBadge, { backgroundColor: colors.primary + "18" }]}>
                  <Text style={[styles.snapShotBadgeText, { color: colors.primary }]}>SNAP Shot</Text>
                </View>
                <Text style={[styles.snapShotTitle, { color: colors.foreground }]}>
                  Bone-Healthy Food Tips
                </Text>
              </View>
            </View>
            <SnapShot />

            {nutritionLogs.length === 0 && (
              <View style={[styles.emptyState, { marginTop: 16 }]}>
                <Feather name="coffee" size={40} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  No logs yet
                </Text>
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  Track your daily calcium, Vitamin D, and protein intake
                </Text>
              </View>
            )}
          </View>
        )}

        {activeTab === 4 && (
          <View>
            {/* Tab header row */}
            <View style={styles.suppTabHeader}>
              <View>
                <Text style={[styles.suppTabTitle, { color: colors.foreground }]}>
                  Today's Intake
                </Text>
                <Text style={[styles.suppTabSub, { color: colors.mutedForeground }]}>
                  {supplements.filter((s) => s.taken).length}/{supplements.length} taken
                </Text>
              </View>
              <Pressable
                style={[styles.suppAddBtn, { backgroundColor: colors.primary }]}
                onPress={() => router.push("/health/add-supplement" as never)}
              >
                <Feather name="plus" size={14} color="#fff" />
                <Text style={styles.suppAddBtnText}>Add</Text>
              </Pressable>
            </View>

            {/* Supplements group */}
            {supplements.filter((s) => s.category === "supplement").length > 0 && (
              <>
                <View style={styles.suppGroupRow}>
                  <Feather name="sun" size={13} color={colors.primary} />
                  <Text style={[styles.suppGroupLabel, { color: colors.primary }]}>
                    Supplements
                  </Text>
                </View>
                {supplements
                  .filter((s) => s.category === "supplement")
                  .map((s) => (
                    <Card key={s.id} style={styles.suppCard} variant="outlined">
                      <View style={styles.suppRow}>
                        <Pressable
                          onPress={() => !s.taken && markSupplementTaken(s.id)}
                          style={[
                            styles.suppCheck,
                            {
                              backgroundColor: s.taken ? colors.primary : "transparent",
                              borderColor: s.taken ? colors.primary : colors.border,
                            },
                          ]}
                        >
                          {s.taken && <Feather name="check" size={14} color="#fff" />}
                        </Pressable>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.suppName, { color: colors.foreground }]}>
                            {s.name}
                          </Text>
                          <Text style={[styles.suppDose, { color: colors.mutedForeground }]}>
                            {s.dose} · {s.frequency}
                            {s.timing ? ` · ${s.timing}` : ""}
                          </Text>
                        </View>
                        {s.taken ? (
                          <Badge label={`Taken ${s.takenAt ?? ""}`} variant="success" size="sm" />
                        ) : (
                          <Badge label="Pending" variant="warning" size="sm" />
                        )}
                      </View>
                    </Card>
                  ))}
              </>
            )}

            {/* Medications group */}
            {supplements.filter((s) => s.category === "medication").length > 0 && (
              <>
                <View style={[styles.suppGroupRow, { marginTop: 8 }]}>
                  <Feather name="activity" size={13} color={colors.accent} />
                  <Text style={[styles.suppGroupLabel, { color: colors.accent }]}>
                    Medications
                  </Text>
                </View>
                {supplements
                  .filter((s) => s.category === "medication")
                  .map((s) => (
                    <Card key={s.id} style={styles.suppCard} variant="outlined">
                      <View style={styles.suppRow}>
                        <Pressable
                          onPress={() => !s.taken && markSupplementTaken(s.id)}
                          style={[
                            styles.suppCheck,
                            {
                              backgroundColor: s.taken ? colors.accent : "transparent",
                              borderColor: s.taken ? colors.accent : colors.border,
                            },
                          ]}
                        >
                          {s.taken && <Feather name="check" size={14} color="#fff" />}
                        </Pressable>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.suppName, { color: colors.foreground }]}>
                            {s.name}
                          </Text>
                          <Text style={[styles.suppDose, { color: colors.mutedForeground }]}>
                            {s.dose} · {s.frequency}
                            {s.timing ? ` · ${s.timing}` : ""}
                          </Text>
                        </View>
                        {s.taken ? (
                          <Badge label={`Taken ${s.takenAt ?? ""}`} variant="success" size="sm" />
                        ) : (
                          <Badge label="Pending" variant="warning" size="sm" />
                        )}
                      </View>
                    </Card>
                  ))}
              </>
            )}

            {/* Empty state */}
            {supplements.length === 0 && (
              <View style={[styles.emptyState, { marginTop: 16 }]}>
                <Feather name="plus-circle" size={40} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  No items yet
                </Text>
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  Add supplements or medications to track your daily intake
                </Text>
              </View>
            )}

            {/* See all / full screen link */}
            {supplements.length > 0 && (
              <Pressable
                style={[styles.seeAllBtn, { borderColor: colors.border }]}
                onPress={() => router.push("/health/supplements" as never)}
              >
                <Text style={[styles.seeAllText, { color: colors.primary }]}>
                  Open full intake log
                </Text>
                <Feather name="arrow-right" size={14} color={colors.primary} />
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  screenTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    letterSpacing: -0.2,
    flex: 1,
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  tabsScroll: { borderBottomWidth: 1, flexGrow: 0 },
  tabsContent: { paddingHorizontal: 16 },
  tabItem: { paddingHorizontal: 4, marginRight: 20, paddingVertical: 8 },
  tabText: { fontSize: 14 },
  tabIndicator: {
    height: 2,
    borderRadius: 1,
    marginTop: 4,
  },
  scrollContent: { paddingHorizontal: 16, paddingTop: 12 },
  overviewCard: { marginBottom: 12 },
  overviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  cardTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  cardDivider: { height: 1, marginVertical: 10 },
  scoreRow: { flexDirection: "row", alignItems: "center" },
  scoreItem: { flex: 1, alignItems: "center" },
  bigScore: { fontSize: 28, fontFamily: "Inter_700Bold" },
  scoreLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  scoreDivider: { width: 1, height: 40 },
  scanDate: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 8 },
  riskText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  snapTagline: {
    fontSize: 12, fontFamily: "Inter_400Regular", marginTop: -10, marginBottom: 8,
  },
  quickActionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  quickAction: {
    width: "47%",
    padding: 16,
    borderRadius: 14,
    alignItems: "center",
    gap: 8,
    overflow: "hidden",
  },
  quickActionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  quickActionLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff", textAlign: "center" },
  nutritionActions: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  nutritionActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  snapShotSection: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  snapShotHeader: { gap: 4 },
  snapShotBadge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  snapShotBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  snapShotTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  logBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  logBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  scanCard: { marginBottom: 12 },
  scanCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  scanSite: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  scanMetrics: { flexDirection: "row", gap: 16 },
  scanMetric: { alignItems: "center" },
  metricValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  metricLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  scanNotes: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 10,
    fontStyle: "italic",
  },
  activityMetrics: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 10 },
  activityMetric: { alignItems: "center", gap: 2 },
  actMetricValue: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  actMetricLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  emptyState: { alignItems: "center", paddingVertical: 48, gap: 12 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  suppTabHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
    marginTop: 4,
  },
  suppTabTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  suppTabSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  suppAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  suppAddBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
  suppGroupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  suppGroupLabel: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.3 },
  suppCard: { marginBottom: 8 },
  suppRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  suppCheck: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  suppName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  suppDose: { fontSize: 12, fontFamily: "Inter_400Regular" },
  seeAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  seeAllText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  fracturePctRow: {},
});
