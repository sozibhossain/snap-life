/**
 * FRAX Risk Calculator — step-by-step input flow that produces a
 * clinically-informed 10-year fracture risk estimate and optionally
 * saves the result into the Bone Tracker.
 *
 * Disclaimer: this tool provides an ESTIMATE only and is NOT a
 * medical diagnosis. The result is always shown with this disclaimer.
 */
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
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
import { calcFrax, type FraxInputs, worstTScore } from "@/context/HealthContext";
import { useHealth } from "@/context/HealthContext";
import { useColors } from "@/hooks/useColors";
import { isValidAssessmentDate } from "@/lib/assessmentUtils";

const TOTAL_STEPS = 3;

type YesNo = boolean;

function StepIndicator({ current, total, colors }: { current: number; total: number; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={si.row}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            si.dot,
            {
              backgroundColor: i <= current ? colors.primary : colors.border,
              width: i === current ? 24 : 8,
            },
          ]}
        />
      ))}
    </View>
  );
}
const si = StyleSheet.create({
  row: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", marginVertical: 16 },
  dot: { height: 8, borderRadius: 4 },
});

function Toggle({ label, sublabel, value, onChange, colors }: {
  label: string; sublabel?: string; value: YesNo; onChange: (v: YesNo) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      style={[tg.row, { backgroundColor: colors.card, borderColor: value ? colors.primary : colors.border }]}
      onPress={() => onChange(!value)}
    >
      <View style={{ flex: 1 }}>
        <Text style={[tg.label, { color: colors.foreground }]}>{label}</Text>
        {sublabel && <Text style={[tg.sub, { color: colors.mutedForeground }]}>{sublabel}</Text>}
      </View>
      <View style={[tg.pill, { backgroundColor: value ? colors.primary : colors.muted }]}>
        <View style={[tg.thumb, { transform: [{ translateX: value ? 18 : 2 }] }]} />
      </View>
    </Pressable>
  );
}
const tg = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1.5, gap: 12, marginBottom: 10 },
  label: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  pill: { width: 44, height: 26, borderRadius: 13, justifyContent: "center", overflow: "hidden" },
  thumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.15, shadowRadius: 2 },
});

function RiskBar({ value, max, color, colors }: { value: number; max: number; color: string; colors: ReturnType<typeof useColors> }) {
  const pct = Math.min(1, value / max);
  return (
    <View style={[rb.track, { backgroundColor: colors.muted }]}>
      <View style={[rb.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: color }]} />
    </View>
  );
}
const rb = StyleSheet.create({
  track: { height: 10, borderRadius: 5, overflow: "hidden", marginTop: 6 },
  fill: { height: "100%", borderRadius: 5 },
});

function riskLevel(pct: number): { label: string; color: string } {
  if (pct < 10) return { label: "Low", color: "#22c55e" };
  if (pct < 20) return { label: "Moderate", color: "#f59e0b" };
  return { label: "Higher", color: "#ef4444" };
}

export default function FraxScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const { addFraxResult, updateFraxResult, fraxResults, dexaScans } = useHealth();
  const editingResult = params.id ? fraxResults.find((item) => item.id === params.id) : undefined;

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [step, setStep] = useState(0);

  // Step 1: personal info
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [age, setAge] = useState("");
  const [sex, setSex] = useState<"female" | "male">("female");
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");

  // Step 2: risk factors
  const [previousFracture, setPreviousFracture] = useState(false);
  const [parentHipFracture, setParentHipFracture] = useState(false);
  const [smoking, setSmoking] = useState(false);
  const [alcohol, setAlcohol] = useState(false);
  const [glucocorticoids, setGlucocorticoids] = useState(false);
  const [rheumatoidArthritis, setRheumatoidArthritis] = useState(false);
  const [secondaryOsteoporosis, setSecondaryOsteoporosis] = useState(false);

  // Step 3: BMD
  const [useBmd, setUseBmd] = useState(false);
  const [tScoreInput, setTScoreInput] = useState(() => {
    if (!dexaScans[0]) return "";
    const w = worstTScore(dexaScans[0]);
    return w != null ? String(w) : "";
  });

  // Results
  const [result, setResult] = useState<{ major: number; hip: number } | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [error, setError] = useState("");

  useEffect(() => {
    if (!editingResult) return;
    const inputs = editingResult.inputs;
    setDate(editingResult.date);
    setAge(String(inputs.age));
    setSex(inputs.sex);
    setWeight(String(inputs.weight));
    setHeight(String(inputs.height));
    setPreviousFracture(inputs.previousFracture);
    setParentHipFracture(inputs.parentHipFracture);
    setSmoking(inputs.smoking);
    setAlcohol(inputs.alcohol);
    setGlucocorticoids(inputs.glucocorticoids);
    setRheumatoidArthritis(inputs.rheumatoidArthritis);
    setSecondaryOsteoporosis(inputs.secondaryOsteoporosis);
    setUseBmd(inputs.tScore != null);
    setTScoreInput(inputs.tScore?.toString() ?? "");
    setResult({ major: editingResult.majorFractureRisk, hip: editingResult.hipFractureRisk });
  }, [editingResult?.id]);

  function validateStep1() {
    const a = parseInt(age, 10);
    const w = parseFloat(weight);
    const h = parseFloat(height);
    if (!isValidAssessmentDate(date)) { setError("Please enter a valid assessment date in YYYY-MM-DD format."); return false; }
    if (isNaN(a) || a < 18 || a > 110) { setError("Please enter a valid age (18–110)"); return false; }
    if (isNaN(w) || w < 20 || w > 300) { setError("Please enter a valid weight in kg"); return false; }
    if (isNaN(h) || h < 100 || h > 250) { setError("Please enter a valid height in cm"); return false; }
    setError(""); return true;
  }

  function handleNext() {
    if (step === 0 && !validateStep1()) return;
    if (step === TOTAL_STEPS - 1) {
      compute(); return;
    }
    setStep((s) => s + 1);
  }

  function compute() {
    const inputs: FraxInputs = {
      age: parseInt(age, 10),
      sex,
      weight: parseFloat(weight),
      height: parseFloat(height),
      previousFracture,
      parentHipFracture,
      smoking,
      alcohol,
      glucocorticoids,
      rheumatoidArthritis,
      secondaryOsteoporosis,
      tScore: useBmd && tScoreInput ? parseFloat(tScoreInput) : undefined,
    };
    const r = calcFrax(inputs);
    setResult(r);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  async function handleSave() {
    if (!result) return;
    setIsSaving(true);
    try {
      const inputs: FraxInputs = {
        age: parseInt(age, 10),
        sex,
        weight: parseFloat(weight),
        height: parseFloat(height),
        previousFracture,
        parentHipFracture,
        smoking,
        alcohol,
        glucocorticoids,
        rheumatoidArthritis,
        secondaryOsteoporosis,
        tScore: useBmd && tScoreInput ? parseFloat(tScoreInput) : undefined,
      };
      const nextResult = {
        date,
        majorFractureRisk: result.major,
        hipFractureRisk: result.hip,
        inputs,
      };
      if (editingResult) await updateFraxResult(editingResult.id, nextResult);
      else await addFraxResult(nextResult);
      setSaved(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/health/bone-tracker" as never);
    } finally {
      setIsSaving(false);
    }
  }

  const majorLevel = result ? riskLevel(result.major) : null;
  const hipLevel = result ? riskLevel(result.hip) : null;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
    >
      {/* Header — navy → navyLight gradient, consistent with brand */}
      <LinearGradient
        colors={colors.gradients.insight}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: topPad + 8 }, colors.shadows.sm]}
      >
        <Pressable onPress={() => result ? setResult(null) : step > 0 ? setStep((s) => s - 1) : router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={22} color="rgba(255,255,255,0.85)" />
        </Pressable>
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleRow}>
            <View style={[styles.headerIconWrap, { backgroundColor: colors.primary + "20" }]}>
              <Feather name="shield" size={15} color={colors.primary} />
            </View>
            <Text style={styles.headerTitle}>{editingResult ? "Edit FRAX Result" : "FRAX Calculator"}</Text>
          </View>
          {!result && (
            <Text style={styles.headerSub}>Step {step + 1} of {TOTAL_STEPS} · 10-year fracture risk</Text>
          )}
          {result && (
            <Text style={styles.headerSub}>10-year fracture probability estimate</Text>
          )}
        </View>
        <View style={{ width: 22 }} />
      </LinearGradient>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {!result && <StepIndicator current={step} total={TOTAL_STEPS} colors={colors} />}

        {/* ── Results ── */}
        {result && (
          <View style={styles.resultsWrap}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Your 10-Year Fracture Risk
            </Text>
            <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>
              Based on the information you provided
            </Text>

            <LinearGradient
              colors={[colors.navy, colors.navyMid]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.riskCard, colors.shadows.lg]}
            >
              <View style={styles.riskRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.riskLabel}>
                    Major Osteoporotic Fracture
                  </Text>
                  <View style={styles.riskValueRow}>
                    <Text style={[styles.riskValue, { color: majorLevel!.color }]}>
                      {result.major}%
                    </Text>
                    <View style={[styles.riskBadge, { backgroundColor: majorLevel!.color + "22", borderColor: majorLevel!.color + "35", borderWidth: 1 }]}>
                      <Text style={[styles.riskBadgeText, { color: majorLevel!.color }]}>{majorLevel!.label}</Text>
                    </View>
                  </View>
                  <RiskBar value={result.major} max={40} color={majorLevel!.color} colors={colors} />
                </View>
              </View>

              <View style={styles.riskDivider} />

              <View style={styles.riskRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.riskLabel}>
                    Hip Fracture
                  </Text>
                  <View style={styles.riskValueRow}>
                    <Text style={[styles.riskValue, { color: hipLevel!.color }]}>
                      {result.hip}%
                    </Text>
                    <View style={[styles.riskBadge, { backgroundColor: hipLevel!.color + "22", borderColor: hipLevel!.color + "35", borderWidth: 1 }]}>
                      <Text style={[styles.riskBadgeText, { color: hipLevel!.color }]}>{hipLevel!.label}</Text>
                    </View>
                  </View>
                  <RiskBar value={result.hip} max={25} color={hipLevel!.color} colors={colors} />
                </View>
              </View>

              <View style={[styles.interpretRow, { backgroundColor: "rgba(255,255,255,0.07)", borderColor: "rgba(255,255,255,0.12)" }]}>
                <Feather name="info" size={13} color="rgba(255,255,255,0.55)" style={{ marginTop: 1 }} />
                <Text style={styles.interpretText}>
                  {result.major < 10
                    ? "Your estimated risk is low. Continue supporting your bone health with regular activity, good nutrition, and consistent supplementation."
                    : result.major < 20
                    ? "Your estimated risk is moderate. It may be worth discussing your bone health with your GP or specialist."
                    : "Your estimated risk is higher. We recommend speaking with your doctor or bone health specialist about next steps."}
                </Text>
              </View>

              <Text style={styles.disclaimerText}>
                This tool provides an estimate only - not a medical diagnosis.
                Always consult your GP or specialist for a full clinical
                assessment.{" "}
                <Text
                  style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }}
                  onPress={() => router.push("/settings/disclaimer" as never)}
                >
                  View disclaimer
                </Text>
              </Text>

              {!saved ? (
                <Pressable
                  style={[styles.saveBtn, { backgroundColor: majorLevel!.color, opacity: isSaving ? 0.7 : 1 }]}
                  onPress={handleSave}
                  disabled={isSaving}
                >
                  <Feather name="save" size={16} color="#fff" />
                  <Text style={styles.saveBtnText}>{isSaving ? "Saving…" : "Save and return to Bone Tracker"}</Text>
                </Pressable>
              ) : (
                <View style={styles.savedBadge}>
                  <Feather name="check-circle" size={16} color={colors.success} />
                  <Text style={[styles.savedText, { color: colors.success }]}>Saved to your Bone Tracker</Text>
                </View>
              )}
            </LinearGradient>

            <Pressable style={styles.recalcBtn} onPress={() => { setResult(null); setStep(0); setSaved(false); }}>
              <Text style={[styles.recalcText, { color: colors.primary }]}>Recalculate</Text>
            </Pressable>
          </View>
        )}

        {/* ── Step 1: Personal info ── */}
        {!result && step === 0 && (
          <View style={styles.stepWrap}>
            <Text style={[styles.stepTitle, { color: colors.foreground }]}>About you</Text>
            <Text style={[styles.stepSub, { color: colors.mutedForeground }]}>
              This helps calibrate your risk estimate
            </Text>

            <Text style={[styles.label, { color: colors.mutedForeground }]}>Assessment date</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.mutedForeground}
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>Age</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              value={age}
              onChangeText={setAge}
              placeholder="e.g. 62"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
            />

            <Text style={[styles.label, { color: colors.mutedForeground }]}>Biological sex</Text>
            <View style={styles.segRow}>
              {(["female", "male"] as const).map((s) => (
                <Pressable
                  key={s}
                  style={[
                    styles.segBtn,
                    { borderColor: sex === s ? colors.primary : colors.border, backgroundColor: sex === s ? colors.primary + "14" : colors.card },
                  ]}
                  onPress={() => setSex(s)}
                >
                  <Text style={[styles.segText, { color: sex === s ? colors.primary : colors.mutedForeground }]}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.inputRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Weight (kg)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                  value={weight}
                  onChangeText={setWeight}
                  placeholder="70"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Height (cm)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                  value={height}
                  onChangeText={setHeight}
                  placeholder="165"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            {error.length > 0 && (
              <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
            )}
          </View>
        )}

        {/* ── Step 2: Risk factors ── */}
        {!result && step === 1 && (
          <View style={styles.stepWrap}>
            <Text style={[styles.stepTitle, { color: colors.foreground }]}>Risk factors</Text>
            <Text style={[styles.stepSub, { color: colors.mutedForeground }]}>
              Toggle any that apply to you
            </Text>

            <Toggle label="Previous fracture" sublabel="Any fracture as an adult (age ≥ 50)" value={previousFracture} onChange={setPreviousFracture} colors={colors} />
            <Toggle label="Parent fractured hip" sublabel="Mother or father broke their hip" value={parentHipFracture} onChange={setParentHipFracture} colors={colors} />
            <Toggle label="Current smoking" value={smoking} onChange={setSmoking} colors={colors} />
            <Toggle label="Alcohol (3+ units/day)" sublabel="Regular heavy alcohol intake" value={alcohol} onChange={setAlcohol} colors={colors} />
            <Toggle label="Glucocorticoid use" sublabel="Oral steroids ≥ 3 months (e.g. prednisolone)" value={glucocorticoids} onChange={setGlucocorticoids} colors={colors} />
            <Toggle label="Rheumatoid arthritis" sublabel="Confirmed diagnosis" value={rheumatoidArthritis} onChange={setRheumatoidArthritis} colors={colors} />
            <Toggle label="Secondary osteoporosis" sublabel="E.g. type 1 diabetes, liver disease, COPD" value={secondaryOsteoporosis} onChange={setSecondaryOsteoporosis} colors={colors} />
          </View>
        )}

        {/* ── Step 3: BMD ── */}
        {!result && step === 2 && (
          <View style={styles.stepWrap}>
            <Text style={[styles.stepTitle, { color: colors.foreground }]}>Bone mineral density</Text>
            <Text style={[styles.stepSub, { color: colors.mutedForeground }]}>
              Adding your T-score gives a more accurate result
            </Text>

            <Toggle label="Include my T-score" sublabel="From a DEXA scan report" value={useBmd} onChange={setUseBmd} colors={colors} />

            {useBmd && (
              <>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>T-Score (femoral neck)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                  value={tScoreInput}
                  onChangeText={setTScoreInput}
                  placeholder="-2.4"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="numbers-and-punctuation"
                />
                {dexaScans[0] && !tScoreInput && (() => {
                  const w = worstTScore(dexaScans[0]);
                  return w != null ? (
                    <Pressable onPress={() => setTScoreInput(String(w))}>
                      <Text style={[styles.prefillHint, { color: colors.primary }]}>
                        Use latest scan ({w.toFixed(1)})
                      </Text>
                    </Pressable>
                  ) : null;
                })()}
              </>
            )}

            <View style={[styles.infoBox, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "25" }]}>
              <Feather name="info" size={14} color={colors.primary} />
              <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
                If you don't have a T-score, you can still get a useful estimate — just continue without it.
              </Text>
            </View>
          </View>
        )}

        {!result && (
          <Pressable
            onPress={() => router.push("/settings/disclaimer" as never)}
            style={[
              styles.legalNotice,
              {
                backgroundColor: colors.warning + "10",
                borderColor: colors.warning + "30",
              },
            ]}
          >
            <Feather name="alert-triangle" size={14} color={colors.warning} />
            <Text style={[styles.legalNoticeText, { color: colors.mutedForeground }]}>
              FRAX is provided for education and self-tracking only. It does not
              diagnose or replace clinical advice. View disclaimer.
            </Text>
          </Pressable>
        )}

        {/* ── Navigation ── */}
        {!result && (
          <Pressable
            style={[styles.nextBtn, { backgroundColor: colors.navy }]}
            onPress={handleNext}
          >
            <Text style={styles.nextBtnText}>
              {step < TOTAL_STEPS - 1 ? "Continue" : "Calculate"}
            </Text>
            <Feather name={step < TOTAL_STEPS - 1 ? "arrow-right" : "zap"} size={18} color="#fff" />
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  headerCenter: { flex: 1 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerIconWrap: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.65)", marginTop: 4 },
  content: { paddingHorizontal: 16, gap: 0 },
  stepWrap: { gap: 0 },
  stepTitle: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3, marginBottom: 4 },
  stepSub: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 20, lineHeight: 20 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 6, marginTop: 8 },
  input: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    marginBottom: 4,
  },
  inputRow: { flexDirection: "row", gap: 12 },
  segRow: { flexDirection: "row", gap: 10, marginBottom: 4 },
  segBtn: { flex: 1, padding: 12, borderRadius: 12, borderWidth: 1.5, alignItems: "center" },
  segText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  error: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  nextBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 24,
  },
  nextBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
  prefillHint: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 4 },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
  },
  infoText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  legalNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 18,
  },
  legalNoticeText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },

  // Results
  resultsWrap: { gap: 12 },
  sectionTitle: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  sectionSub: { fontSize: 14, fontFamily: "Inter_400Regular" },
  riskCard: {
    borderRadius: 20,
    padding: 18,
    gap: 0,
    overflow: "hidden",
  },
  riskRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 12 },
  riskLabel: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 4, color: "rgba(255,255,255,0.55)" },
  riskValueRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  riskValue: { fontSize: 34, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  riskBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  riskBadgeText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  riskDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.10)", marginHorizontal: -18 },
  interpretRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  interpretText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, color: "rgba(255,255,255,0.72)" },
  disclaimerText: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16, fontStyle: "italic", color: "rgba(255,255,255,0.35)", marginTop: 4 },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 4,
  },
  saveBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
  savedBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 12,
    borderRadius: 14,
    marginTop: 4,
  },
  savedText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  recalcBtn: { alignItems: "center", paddingVertical: 8 },
  recalcText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
