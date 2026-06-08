/**
 * Lesson detail screen — SNAP Foundations.
 *
 * Layout:
 *   • Gradient header — lesson number, icon, title, duration, XP
 *   • Scrollable sections — each with accent bar + heading + body
 *   • "Your action today" card — one practical step
 *   • Disclaimer
 *   • Sticky footer — "Mark as complete" → triggers Bone Buddy celebration
 *
 * Voice: warm, present, intelligent — consistent with the Breathing Studio.
 */
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
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
import { useGamification } from "@/context/GamificationContext";
import { LessonCompleteModal } from "@/components/LessonCompleteModal";
import { useColors } from "@/hooks/useColors";
import {
  LESSONS,
  EMPTY_PROGRESS,
  LearnProgress,
  Lesson,
  loadLearnProgress,
  markLessonComplete,
} from "@/lib/learnContent";

export default function LessonScreen() {
  const { id }     = useLocalSearchParams<{ id: string }>();
  const colors     = useColors();
  const insets     = useSafeAreaInsets();
  const router     = useRouter();
  const { user }   = useAuth();
  const { addXP }  = useGamification();

  const lesson: Lesson | undefined = LESSONS.find((l) => l.id === id);

  const [progress,    setProgress]    = useState<LearnProgress>(EMPTY_PROGRESS);
  const [completing,  setCompleting]  = useState(false);
  const [showModal,   setShowModal]   = useState(false);
  const userId = user?.id ?? null;

  useEffect(() => {
    loadLearnProgress(userId).then(setProgress);
  }, [userId]);

  if (!lesson) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={{ color: colors.foreground, margin: 24 }}>Lesson not found.</Text>
      </View>
    );
  }

  const accentHex =
    lesson.accent === "primary"  ? colors.primary  :
    lesson.accent === "accent"   ? colors.accent    :
    lesson.accent === "success"  ? colors.success   :
    colors.xpGold;

  const isCompleted = progress.completedIds.includes(lesson.id);

  async function handleComplete() {
    if (completing || isCompleted) return;
    setCompleting(true);
    try {
      const updated = await markLessonComplete(userId, lesson!.id);
      await addXP(lesson!.xpReward);
      setProgress(updated);
      setShowModal(true);
    } finally {
      setCompleting(false);
    }
  }

  const topPad    = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* ── Gradient header ── */}
      <LinearGradient
        colors={[colors.navy, "#0D2530"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: topPad + 8 }]}
      >
        {/* Decorative depth circles */}
        <View style={[styles.hDeco1, { backgroundColor: accentHex + "14" }]} />
        <View style={[styles.hDeco2, { backgroundColor: accentHex + "08" }]} />

        {/* Back */}
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </Pressable>

        {/* Pathway + lesson number */}
        <View style={styles.headerMeta}>
          <View style={[styles.pathwayPill, { backgroundColor: accentHex + "22", borderColor: accentHex + "45" }]}>
            <Text style={[styles.pathwayPillText, { color: accentHex }]}>
              {lesson.pathway}
            </Text>
          </View>
          <Text style={styles.lessonCounter}>
            {lesson.index} of {LESSONS.length}
          </Text>
        </View>

        {/* Icon */}
        <View style={[styles.iconCircle, { backgroundColor: accentHex + "22", borderColor: accentHex + "40" }]}>
          <Feather name={lesson.icon as never} size={30} color={accentHex} />
        </View>

        <Text style={styles.title}>{lesson.title}</Text>
        <Text style={styles.tagline}>{lesson.tagline}</Text>

        {/* Duration + XP row */}
        <View style={styles.headerPills}>
          <View style={[styles.pill, { backgroundColor: "rgba(255,255,255,0.10)", borderColor: "rgba(255,255,255,0.15)" }]}>
            <Feather name="clock" size={12} color="rgba(255,255,255,0.65)" />
            <Text style={styles.pillTextMuted}>{lesson.duration} read</Text>
          </View>
          <View style={[styles.pill, { backgroundColor: colors.xpGold + "22", borderColor: colors.xpGold + "45" }]}>
            <Feather name="star" size={12} color={colors.xpGold} />
            <Text style={[styles.pillText, { color: colors.xpGold }]}>
              {lesson.xpReward} XP on completion
            </Text>
          </View>
        </View>
      </LinearGradient>

      {/* ── Scrollable content ── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + 140 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Sections */}
        {lesson.sections.map((section, idx) => (
          <View
            key={idx}
            style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={[styles.sectionAccentBar, { backgroundColor: accentHex }]} />
            <View style={styles.sectionBody}>
              <Text style={[styles.sectionHeading, { color: colors.foreground }]}>
                {section.heading}
              </Text>
              <Text style={[styles.sectionText, { color: colors.mutedForeground }]}>
                {section.body}
              </Text>
            </View>
          </View>
        ))}

        {/* Your action today card */}
        <View
          style={[
            styles.actionCard,
            { backgroundColor: accentHex + "12", borderColor: accentHex + "35" },
          ]}
        >
          <View style={[styles.actionIcon, { backgroundColor: accentHex + "22" }]}>
            <Feather name="check-circle" size={18} color={accentHex} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.actionLabel, { color: accentHex }]}>
              YOUR ACTION TODAY
            </Text>
            <Text style={[styles.actionText, { color: colors.foreground }]}>
              {lesson.keyAction}
            </Text>
          </View>
        </View>

        {/* Reflection closer */}
        <View style={[styles.reflectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="feather" size={16} color={colors.mutedForeground} />
          <Text style={[styles.reflectionText, { color: colors.mutedForeground }]}>
            Take a moment to notice how you feel right now. Awareness is where change begins.
          </Text>
        </View>

        {/* Disclaimer */}
        <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
          This content is for educational purposes and does not constitute medical
          advice. Always consult your healthcare team for personalised guidance.
        </Text>
      </ScrollView>

      {/* ── Sticky footer ── */}
      <View
        style={[
          styles.footer,
          {
            paddingBottom: bottomPad + 12,
            borderTopColor: colors.border,
            backgroundColor: colors.background,
          },
        ]}
      >
        {isCompleted ? (
          <>
            {/* Completion state */}
            <View
              style={[
                styles.completedBadge,
                { backgroundColor: colors.success + "15", borderColor: colors.success + "30" },
              ]}
            >
              <Feather name="check-circle" size={18} color={colors.success} />
              <Text style={[styles.completedText, { color: colors.success }]}>
                Lesson complete · +{lesson.xpReward} XP earned
              </Text>
            </View>

            {/* Feature CTA */}
            <Pressable
              style={[styles.ctaBtn, { backgroundColor: accentHex }]}
              onPress={() => router.push(lesson.ctaRoute as never)}
            >
              <Text style={styles.ctaBtnText}>{lesson.ctaLabel}</Text>
              <Feather name="arrow-right" size={16} color="#fff" />
            </Pressable>

            {/* Next lesson */}
            {LESSONS[lesson.index] && (
              <Pressable
                style={[styles.nextBtn, { borderColor: colors.border }]}
                onPress={() => router.replace(`/learn/${LESSONS[lesson.index].id}` as never)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.nextBtnLabel, { color: colors.mutedForeground }]}>
                    Up next in your journey
                  </Text>
                  <Text style={[styles.nextBtnTitle, { color: colors.foreground }]} numberOfLines={1}>
                    {LESSONS[lesson.index].title}
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>
            )}
          </>
        ) : (
          <Pressable
            style={[styles.completeBtn, { backgroundColor: colors.navy }]}
            onPress={handleComplete}
            disabled={completing}
          >
            {completing ? (
              <Text style={styles.completeBtnText}>Saving…</Text>
            ) : (
              <>
                <Feather name="check" size={18} color="#fff" />
                <Text style={styles.completeBtnText}>
                  Mark as complete · +{lesson.xpReward} XP
                </Text>
              </>
            )}
          </Pressable>
        )}
      </View>

      {/* ── Bone Buddy celebration ── */}
      <LessonCompleteModal
        visible={showModal}
        lesson={lesson}
        onClose={() => setShowModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 10,
    alignItems: "flex-start",
    overflow: "hidden",
  },
  hDeco1: { position: "absolute", width: 220, height: 220, borderRadius: 110, top: -70, right: -50 },
  hDeco2: { position: "absolute", width: 130, height: 130, borderRadius: 65, bottom: -30, right: 50 },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  headerMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%" },
  pathwayPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  pathwayPillText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  lessonCounter: { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.45)" },
  iconCircle: { width: 60, height: 60, borderRadius: 19, alignItems: "center", justifyContent: "center", borderWidth: 1, marginTop: 4 },
  title:   { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", lineHeight: 29, letterSpacing: -0.3 },
  tagline: { fontSize: 14, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.58)", lineHeight: 20 },
  headerPills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  pillText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  pillTextMuted: { fontSize: 12, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.65)" },

  // Content
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 12 },

  sectionCard: { borderRadius: 16, borderWidth: 1, flexDirection: "row", overflow: "hidden" },
  sectionAccentBar: { width: 4 },
  sectionBody: { flex: 1, padding: 16, gap: 6 },
  sectionHeading: { fontSize: 15, fontFamily: "Inter_700Bold", lineHeight: 21 },
  sectionText:    { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 23 },

  // Action card
  actionCard: { borderRadius: 16, borderWidth: 1, padding: 16, flexDirection: "row", alignItems: "flex-start", gap: 12 },
  actionIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 2 },
  actionLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.9 },
  actionText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },

  // Reflection
  reflectionCard: { borderRadius: 14, borderWidth: 1, padding: 14, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  reflectionText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20, fontStyle: "italic", flex: 1 },

  // Disclaimer
  disclaimer: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16, textAlign: "center", marginTop: 4, paddingHorizontal: 8 },

  // Footer
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  completedBadge: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1 },
  completedText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  ctaBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14 },
  ctaBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  nextBtn: { flexDirection: "row", alignItems: "center", paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, gap: 12 },
  nextBtnLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  nextBtnTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  completeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16, borderRadius: 14 },
  completeBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
});
