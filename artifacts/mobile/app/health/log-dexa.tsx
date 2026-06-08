/**
 * Log DEXA Scan — dual-site entry (Spine L1–L4 + Hip).
 *
 * A single DEXA appointment typically covers both sites. Users enter
 * their results exactly as they appear on the report: one T-score per
 * site. Classifications (Normal / Osteopenia / Osteoporosis) are shown
 * live using the WHO T-score thresholds so the user understands their
 * result as they type.
 *
 * Z-score and BMD have been removed from the required fields — they
 * are clinically important but rarely acted on by patients and create
 * friction for everyday self-tracking. They can be added back if
 * clinical export features are added later.
 */
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { classifyTScore, useHealth } from "@/context/HealthContext";
import { useColors } from "@/hooks/useColors";

// ─── First-time guide card ─────────────────────────────────────────────────────
// Shown when the user has no previous DEXA scans and hasn't dismissed it.

function FirstTimeDexaGuide({ colors, onDismiss }: {
  colors: ReturnType<typeof useColors>;
  onDismiss: () => void;
}) {
  return (
    <View style={[guide.card, { backgroundColor: colors.primary + "0E", borderColor: colors.primary + "30" }]}>
      {/* Header */}
      <View style={guide.headerRow}>
        <View style={[guide.iconWrap, { backgroundColor: colors.primary + "20" }]}>
          <Feather name="file-text" size={16} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[guide.title, { color: colors.foreground }]}>Reading your DEXA report</Text>
          <Text style={[guide.sub, { color: colors.mutedForeground }]}>Where to find your T-scores</Text>
        </View>
        <Pressable onPress={onDismiss} hitSlop={10}>
          <Feather name="x" size={16} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <View style={[guide.divider, { backgroundColor: colors.primary + "20" }]} />

      {/* Steps */}
      {[
        {
          icon: "search" as const,
          heading: "Look for T-scores",
          body: "Your DEXA report will list T-scores for each area measured. They are usually shown as negative numbers — for example −1.8 or −2.4.",
        },
        {
          icon: "layers" as const,
          heading: "Spine (Lumbar L1–L4)",
          body: "Find the row labelled 'Lumbar Spine', 'L1–L4', or 'Spine'. The T-score column is what you need.",
        },
        {
          icon: "activity" as const,
          heading: "Hip (Total Hip or Femoral Neck)",
          body: "Look for 'Total Hip', 'Femoral Neck', or 'Left/Right Hip'. Use the Total Hip value if both are shown.",
        },
        {
          icon: "info" as const,
          heading: "Fracture risk (optional)",
          body: "Some reports include a 10-year fracture risk percentage — usually labelled 'Major Osteoporotic Risk' and 'Hip Fracture Risk'. These are optional here.",
        },
      ].map((step, i) => (
        <View key={i} style={guide.step}>
          <View style={[guide.stepIcon, { backgroundColor: colors.primary + "18" }]}>
            <Feather name={step.icon} size={13} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[guide.stepHeading, { color: colors.foreground }]}>{step.heading}</Text>
            <Text style={[guide.stepBody, { color: colors.mutedForeground }]}>{step.body}</Text>
          </View>
        </View>
      ))}

      <Pressable onPress={onDismiss} style={[guide.dismissBtn, { borderColor: colors.primary + "35" }]}>
        <Text style={[guide.dismissText, { color: colors.primary }]}>Got it — show the form</Text>
      </Pressable>
    </View>
  );
}

const guide = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  iconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 14, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  divider: { height: 1 },
  step: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  stepIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", marginTop: 1 },
  stepHeading: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  stepBody: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  dismissBtn: { paddingVertical: 10, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  dismissText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});

// ─── Classification helpers ───────────────────────────────────────────────────

function classificationColor(
  c: "Normal" | "Osteopenia" | "Osteoporosis" | null,
  colors: ReturnType<typeof useColors>,
) {
  if (c === "Normal") return colors.success;
  if (c === "Osteopenia") return colors.warning;
  if (c === "Osteoporosis") return colors.destructive;
  return colors.mutedForeground;
}

function liveClassification(input: string): "Normal" | "Osteopenia" | "Osteoporosis" | null {
  if (!input.trim()) return null;
  const v = parseFloat(input);
  if (isNaN(v)) return null;
  return classifyTScore(v);
}

// ─── T-score gauge (visual scale −4 → 0) ─────────────────────────────────────

function TScoreGauge({ value, colors }: { value: number; colors: ReturnType<typeof useColors> }) {
  const MIN = -4; const MAX = 0;
  const pct = Math.max(0, Math.min(1, (value - MIN) / (MAX - MIN)));
  const cls = classifyTScore(value);
  const markerColor = classificationColor(cls, colors);

  return (
    <View style={gaugeSt.wrap}>
      {/* Colour-zone track */}
      <View style={gaugeSt.track}>
        {/* Osteoporosis zone: -4 to -2.5 (37.5% width) */}
        <View style={[gaugeSt.zone, { flex: 1.5, backgroundColor: colors.destructive + "40" }]} />
        {/* Osteopenia zone: -2.5 to -1.0 (37.5%) */}
        <View style={[gaugeSt.zone, { flex: 1.5, backgroundColor: colors.warning + "40" }]} />
        {/* Normal zone: -1.0 to 0 (25%) */}
        <View style={[gaugeSt.zone, { flex: 1, backgroundColor: colors.success + "40", borderTopRightRadius: 4, borderBottomRightRadius: 4 }]} />
      </View>
      {/* Marker line */}
      <View style={[gaugeSt.markerWrap, { left: `${pct * 100}%` as any }]}>
        <View style={[gaugeSt.marker, { backgroundColor: markerColor }]} />
      </View>
      {/* Labels */}
      <View style={gaugeSt.labels}>
        <Text style={[gaugeSt.labelText, { color: colors.mutedForeground }]}>−4</Text>
        <Text style={[gaugeSt.labelText, { color: colors.mutedForeground }]}>−2.5</Text>
        <Text style={[gaugeSt.labelText, { color: colors.mutedForeground }]}>−1</Text>
        <Text style={[gaugeSt.labelText, { color: colors.mutedForeground }]}>0</Text>
      </View>
    </View>
  );
}
const gaugeSt = StyleSheet.create({
  wrap: { gap: 4, marginTop: 8 },
  track: { height: 10, borderRadius: 4, flexDirection: "row", overflow: "hidden" },
  zone: {},
  markerWrap: { position: "absolute", top: 0, marginLeft: -1 },
  marker: { width: 2, height: 10, borderRadius: 1 },
  labels: { flexDirection: "row", justifyContent: "space-between" },
  labelText: { fontSize: 10, fontFamily: "Inter_400Regular" },
});

// ─── Site input block ─────────────────────────────────────────────────────────

function SiteInput({
  site,
  label,
  hint,
  value,
  onChange,
  colors,
}: {
  site: "spine" | "hip";
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const cls = liveClassification(value);
  const clsColor = classificationColor(cls, colors);
  const numeric = parseFloat(value);
  const hasValue = !isNaN(numeric);

  const accentColor = site === "spine" ? colors.primary : "#a78bfa";

  return (
    <View style={[siteInput.card, { backgroundColor: colors.card, borderColor: hasValue ? accentColor + "40" : colors.border }]}>
      <View style={siteInput.header}>
        <View style={[siteInput.iconWrap, { backgroundColor: accentColor + "18" }]}>
          <Feather name={site === "spine" ? "layers" : "activity"} size={14} color={accentColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[siteInput.label, { color: colors.foreground }]}>{label}</Text>
          <Text style={[siteInput.hint, { color: colors.mutedForeground }]}>{hint}</Text>
        </View>
        {cls && (
          <View style={[siteInput.badge, { backgroundColor: clsColor + "18", borderColor: clsColor + "35" }]}>
            <Text style={[siteInput.badgeText, { color: clsColor }]}>{cls}</Text>
          </View>
        )}
      </View>

      <View style={{ gap: 4 }}>
        <TextInput
          style={[siteInput.input, {
            backgroundColor: colors.background,
            borderColor: cls ? clsColor + "60" : colors.border,
            color: colors.foreground,
          }]}
          value={value}
          onChangeText={onChange}
          placeholder="e.g. −2.3"
          placeholderTextColor={colors.mutedForeground}
          keyboardType="numbers-and-punctuation"
          returnKeyType="done"
        />
        {hasValue && <TScoreGauge value={numeric} colors={colors} />}
      </View>
    </View>
  );
}
const siteInput = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1.5, padding: 14, gap: 12 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  iconWrap: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center", marginTop: 2 },
  label: { fontSize: 14, fontFamily: "Inter_700Bold" },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  input: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function LogDexaScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { addDexaScan, dexaScans } = useHealth();

  const isFirstScan = dexaScans.length === 0;
  const [showGuide, setShowGuide] = useState(true);

  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [spineTScore, setSpineTScore] = useState("");
  const [hipTScore, setHipTScore] = useState("");
  const [majorFractureRisk, setMajorFractureRisk] = useState("");
  const [hipFractureRisk, setHipFractureRisk] = useState("");
  const [bmi, setBmi] = useState("");
  const [notes, setNotes] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const spineVal = parseFloat(spineTScore);
  const hipVal = parseFloat(hipTScore);
  const hasSpine = !isNaN(spineVal);
  const hasHip = !isNaN(hipVal);

  async function handleSave() {
    if (!hasSpine && !hasHip) {
      setError("Please enter at least one T-score (Spine or Hip).");
      return;
    }

    const majorRisk = majorFractureRisk ? parseFloat(majorFractureRisk) : undefined;
    const hipRisk = hipFractureRisk ? parseFloat(hipFractureRisk) : undefined;
    const bmiVal = bmi ? parseFloat(bmi) : undefined;

    if (majorFractureRisk && (isNaN(majorRisk!) || majorRisk! < 0 || majorRisk! > 100)) {
      setError("Major fracture risk must be a percentage between 0 and 100.");
      return;
    }
    if (hipFractureRisk && (isNaN(hipRisk!) || hipRisk! < 0 || hipRisk! > 100)) {
      setError("Hip fracture risk must be a percentage between 0 and 100.");
      return;
    }
    if (bmi && isNaN(bmiVal!)) {
      setError("Please enter a valid BMI.");
      return;
    }

    setError("");
    setIsLoading(true);
    try {
      await addDexaScan({
        date,
        spineTScore: hasSpine ? spineVal : undefined,
        hipTScore: hasHip ? hipVal : undefined,
        majorFractureRisk: majorRisk,
        hipFractureRisk: hipRisk,
        bmi: bmiVal,
        notes: notes.trim() || undefined,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch {
      setError("Failed to save scan. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="x" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Log DEXA Scan</Text>
        <Pressable
          onPress={handleSave}
          disabled={isLoading}
          style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: isLoading ? 0.7 : 1 }]}
        >
          <Text style={styles.saveBtnText}>{isLoading ? "Saving…" : "Save"}</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 48 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── First-time guide ── */}
        {isFirstScan && showGuide && (
          <FirstTimeDexaGuide colors={colors} onDismiss={() => setShowGuide(false)} />
        )}

        {/* ── Intro ── */}
        <LinearGradient
          colors={[colors.primary + "14", colors.primary + "04"]}
          style={[styles.introCard, { borderColor: colors.primary + "20" }]}
        >
          <Feather name="info" size={14} color={colors.primary} />
          <Text style={[styles.introText, { color: colors.mutedForeground }]}>
            Enter the T-scores exactly as shown on your DEXA report. Your score compares your bone density to a healthy reference average — lower scores indicate lower bone density.
          </Text>
        </LinearGradient>

        {/* ── Scan Date ── */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Scan Date</Text>
          <TextInput
            style={[styles.dateInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.mutedForeground}
          />
        </View>

        {/* ── T-score Results ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>T-Score Results</Text>
            <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>Enter one or both</Text>
          </View>

          {/* Classification legend */}
          <View style={[styles.legend, { backgroundColor: colors.muted, borderRadius: 10 }]}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Normal ≥ −1.0</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: colors.warning }]} />
              <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Osteopenia −1.0 to −2.5</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: colors.destructive }]} />
              <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Osteoporosis ≤ −2.5</Text>
            </View>
          </View>

          <SiteInput
            site="spine"
            label="Spine (L1–L4)"
            hint="Lumbar spine measurement from your report"
            value={spineTScore}
            onChange={setSpineTScore}
            colors={colors}
          />
          <SiteInput
            site="hip"
            label="Hip (Total Hip)"
            hint="Femoral / total hip measurement from your report"
            value={hipTScore}
            onChange={setHipTScore}
            colors={colors}
          />
        </View>

        {/* ── 10-Year Fracture Risk (optional, from report) ── */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>10-Year Fracture Risk</Text>
          <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>
            Optional — enter percentages from your DEXA report if provided
          </Text>
          <View style={styles.inputRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Major Osteoporotic (%)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                value={majorFractureRisk}
                onChangeText={setMajorFractureRisk}
                placeholder="e.g. 12"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Hip Fracture (%)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                value={hipFractureRisk}
                onChangeText={setHipFractureRisk}
                placeholder="e.g. 4"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
        </View>

        {/* ── Additional (optional) ── */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Additional (Optional)</Text>
          <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>BMI</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            value={bmi}
            onChangeText={setBmi}
            placeholder="e.g. 24.5"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="decimal-pad"
          />
          <Text style={[styles.inputLabel, { color: colors.mutedForeground, marginTop: 8 }]}>Clinical Notes</Text>
          <TextInput
            style={[styles.textarea, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Any observations, doctor's recommendations…"
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={4}
          />
        </View>

        {error.length > 0 && (
          <View style={[styles.errorCard, { backgroundColor: colors.destructive + "12", borderColor: colors.destructive + "30" }]}>
            <Feather name="alert-circle" size={14} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  saveBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  content: { padding: 16, gap: 4 },

  introCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8,
  },
  introText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },

  section: { gap: 10, marginTop: 16 },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  sectionHint: { fontSize: 12, fontFamily: "Inter_400Regular" },

  legend: { padding: 10, gap: 5 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 7 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, fontFamily: "Inter_400Regular" },

  inputRow: { flexDirection: "row", gap: 12 },
  inputLabel: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 6 },
  input: {
    height: 48, borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 14, fontSize: 15,
    fontFamily: "Inter_400Regular", marginBottom: 4,
  },
  dateInput: {
    height: 48, borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 14, fontSize: 15, fontFamily: "Inter_400Regular",
  },
  textarea: {
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, fontFamily: "Inter_400Regular",
    minHeight: 100, textAlignVertical: "top",
  },
  errorCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    padding: 12, borderRadius: 12, borderWidth: 1, marginTop: 8,
  },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
});
