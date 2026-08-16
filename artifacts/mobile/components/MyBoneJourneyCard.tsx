import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";
import { useHealth } from "@/context/HealthContext";
import { useColors } from "@/hooks/useColors";

interface JourneyPoint {
  id: string;
  date: string;
  value: number;
}

function isJourneyPoint(point: { id: string; date: string; value?: number }): point is JourneyPoint {
  return typeof point.value === "number"
    && Number.isFinite(point.value)
    && Number.isFinite(Date.parse(point.date));
}

type DexaMeasure = "spine" | "hip";

function prettyDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function neutralComparison(points: JourneyPoint[], decimals: number, unit: string): string | null {
  if (points.length < 2) return null;
  const previous = points[points.length - 2];
  const latest = points[points.length - 1];
  const delta = latest.value - previous.value;
  const direction = delta > 0 ? "higher" : delta < 0 ? "lower" : "unchanged";
  if (direction === "unchanged") return `Latest is unchanged from the previous result (${latest.value.toFixed(decimals)}${unit}).`;
  return `Latest is ${direction} than the previous result by ${Math.abs(delta).toFixed(decimals)}${unit}.`;
}

function MeasureTabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; color: string }>;
  onChange: (value: T) => void;
}) {
  const colors = useColors();
  return (
    <View style={[styles.tabs, { backgroundColor: colors.muted }]}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          onPress={() => onChange(option.value)}
          style={[styles.tab, value === option.value && { backgroundColor: colors.card }]}
        >
          <View style={[styles.legendDot, { backgroundColor: option.color }]} />
          <Text style={[styles.tabText, { color: value === option.value ? colors.foreground : colors.mutedForeground }]}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function JourneyChart({
  points,
  color,
  unit,
  decimals,
  emptyText,
}: {
  points: JourneyPoint[];
  color: string;
  unit: string;
  decimals: number;
  emptyText: string;
}) {
  const colors = useColors();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => setSelectedId(null), [points]);

  if (points.length === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.muted }]}>
        <Feather name="minus-circle" size={18} color={colors.mutedForeground} />
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{emptyText}</Text>
      </View>
    );
  }

  const chartWidth = Math.max(300, points.length * 58);
  const chartHeight = 154;
  const left = 34;
  const right = 18;
  const top = 16;
  const bottom = 30;
  const values = points.map((point) => point.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max((rawMax - rawMin) * 0.18, unit === "%" ? 1 : 0.2);
  const minValue = rawMin - padding;
  const maxValue = rawMax + padding;
  const range = maxValue - minValue || 1;
  const timestamps = points.map((point) => Date.parse(point.date));
  const firstTime = Math.min(...timestamps);
  const lastTime = Math.max(...timestamps);
  const timeRange = lastTime - firstTime;
  const coords = points.map((point, index) => {
    const timestamp = timestamps[index];
    const x = points.length === 1
      ? chartWidth / 2
      : left + ((timestamp - firstTime) / (timeRange || 1)) * (chartWidth - left - right);
    const y = top + ((maxValue - point.value) / range) * (chartHeight - top - bottom);
    return { ...point, x, y };
  });
  const selected = points.find((point) => point.id === selectedId) ?? points[points.length - 1];
  const comparison = neutralComparison(points, decimals, unit);

  return (
    <View style={{ gap: 8 }}>
      <View style={[styles.selected, { backgroundColor: color + "12", borderColor: color + "35" }]}>
        <Text style={[styles.selectedDate, { color: colors.mutedForeground }]}>{prettyDate(selected.date)}</Text>
        <Text style={[styles.selectedValue, { color }]}>{selected.value.toFixed(decimals)}{unit}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={points.length > 6} contentContainerStyle={{ minWidth: "100%" }}>
        <Svg width={chartWidth} height={chartHeight} accessibilityLabel="Longitudinal health chart">
          {[0, 0.5, 1].map((fraction) => {
            const y = top + fraction * (chartHeight - top - bottom);
            return <Line key={fraction} x1={left} x2={chartWidth - right} y1={y} y2={y} stroke={colors.border} strokeWidth={1} />;
          })}
          <SvgText x={2} y={top + 4} fontSize={9} fill={colors.mutedForeground}>{maxValue.toFixed(decimals)}</SvgText>
          <SvgText x={2} y={chartHeight - bottom + 3} fontSize={9} fill={colors.mutedForeground}>{minValue.toFixed(decimals)}</SvgText>
          {coords.length > 1 && (
            <Polyline
              points={coords.map((point) => `${point.x},${point.y}`).join(" ")}
              fill="none"
              stroke={color}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {coords.map((point) => (
            <React.Fragment key={point.id}>
              <Circle
                cx={point.x}
                cy={point.y}
                r={14}
                fill="transparent"
                onPress={() => setSelectedId(point.id)}
              />
              <Circle
                cx={point.x}
                cy={point.y}
                r={selected.id === point.id ? 7 : 5}
                fill={selected.id === point.id ? color : colors.card}
                stroke={color}
                strokeWidth={2.5}
                onPress={() => setSelectedId(point.id)}
              />
            </React.Fragment>
          ))}
          <SvgText x={left} y={chartHeight - 8} fontSize={9} fill={colors.mutedForeground} textAnchor="start">{prettyDate(points[0].date)}</SvgText>
          {points.length > 1 && (
            <SvgText x={chartWidth - right} y={chartHeight - 8} fontSize={9} fill={colors.mutedForeground} textAnchor="end">{prettyDate(points[points.length - 1].date)}</SvgText>
          )}
        </Svg>
      </ScrollView>
      {comparison && <Text style={[styles.comparison, { color: colors.mutedForeground }]}>{comparison}</Text>}
      <Text style={[styles.chartNote, { color: colors.mutedForeground }]}>Points are recorded results only. Missing dates are not estimated.</Text>
    </View>
  );
}

export function MyBoneJourneyCard() {
  const colors = useColors();
  const router = useRouter();
  const { dexaScans, fraxResults } = useHealth();
  const [dexaMeasure, setDexaMeasure] = useState<DexaMeasure>("spine");

  const dexaPoints = useMemo(() => dexaScans
    .map((scan) => ({
      id: scan.id,
      date: scan.date,
      value: dexaMeasure === "spine"
        ? scan.spineTScore ?? (scan.site === "lumbar_spine" ? scan.tScore : undefined)
        : scan.hipTScore ?? (
          scan.site === "total_hip" || scan.site === "femoral_neck"
            ? scan.tScore
            : undefined
        ),
    }))
    .filter(isJourneyPoint)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date)), [dexaScans, dexaMeasure]);

  const fraxMajorPoints = useMemo(() => fraxResults
    .map((result) => ({
      id: result.id,
      date: result.date,
      value: result.majorFractureRisk,
    }))
    .filter(isJourneyPoint)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date)), [fraxResults]);
  const fraxHipPoints = useMemo(() => fraxResults
    .map((result) => ({
      id: result.id,
      date: result.date,
      value: result.hipFractureRisk,
    }))
    .filter(isJourneyPoint)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date)), [fraxResults]);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: colors.primary + "18" }]}>
          <Feather name="bar-chart-2" size={17} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>My Bone Journey</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Your recorded results over time</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>DEXA T-scores</Text>
        <MeasureTabs
          value={dexaMeasure}
          onChange={setDexaMeasure}
          options={[
            { value: "spine", label: "Lumbar spine", color: colors.primary },
            { value: "hip", label: "Total hip", color: "#8b5cf6" },
          ]}
        />
        <JourneyChart
          points={dexaPoints}
          color={dexaMeasure === "spine" ? colors.primary : "#8b5cf6"}
          unit=""
          decimals={1}
          emptyText={`No ${dexaMeasure === "spine" ? "lumbar spine" : "total hip"} T-score has been recorded yet.`}
        />
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>FRAX 10-year risk</Text>
        <Text style={[styles.measureLabel, { color: colors.mutedForeground }]}>Major osteoporotic fracture risk</Text>
        <JourneyChart
          points={fraxMajorPoints}
          color={colors.accent}
          unit="%"
          decimals={1}
          emptyText="No saved major-fracture FRAX result is available yet."
        />
        <Text style={[styles.measureLabel, { color: colors.mutedForeground }]}>Hip fracture risk</Text>
        <JourneyChart
          points={fraxHipPoints}
          color="#f59e0b"
          unit="%"
          decimals={1}
          emptyText="No saved hip-fracture FRAX result is available yet."
        />
      </View>

      <View style={[styles.privacy, { backgroundColor: colors.muted }]}>
        <Feather name="lock" size={14} color={colors.mutedForeground} />
        <Text style={[styles.privacyText, { color: colors.mutedForeground }]}>Only your saved DEXA and FRAX records are shown. You control editing, export and deletion.</Text>
      </View>
      <View style={styles.actions}>
        <Pressable onPress={() => router.push("/health" as never)} style={styles.action}>
          <Text style={[styles.actionText, { color: colors.primary }]}>Manage records</Text>
          <Feather name="chevron-right" size={14} color={colors.primary} />
        </Pressable>
        <Pressable onPress={() => router.push("/settings/privacy" as never)} style={styles.action}>
          <Text style={[styles.actionText, { color: colors.primary }]}>Privacy & export</Text>
          <Feather name="chevron-right" size={14} color={colors.primary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 16, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  measureLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  tabs: { flexDirection: "row", padding: 3, borderRadius: 10 },
  tab: { flex: 1, minHeight: 34, borderRadius: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 6 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  tabText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  selected: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  selectedDate: { fontSize: 12, fontFamily: "Inter_500Medium" },
  selectedValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  comparison: { fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 17 },
  chartNote: { fontSize: 10, fontFamily: "Inter_400Regular", lineHeight: 14 },
  empty: { minHeight: 92, borderRadius: 12, alignItems: "center", justifyContent: "center", gap: 8, padding: 16 },
  emptyText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, textAlign: "center" },
  divider: { height: 1 },
  privacy: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 10 },
  privacyText: { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
  actions: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 10 },
  action: { flexDirection: "row", alignItems: "center", gap: 3 },
  actionText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
