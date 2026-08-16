/**
 * SNAP Foundations — Learn tab.
 *
 * Visual roadmap: a vertical journey path with nodes for each lesson. This
 * index lives inside the tab navigator so lesson details retain bottom nav.
 * Completed nodes show a checkmark, the active node pulses, locked nodes
 * are muted with a lock. The connector line is solid for completed
 * sections and faded for upcoming ones.
 *
 * Voice: warm, present, forward-looking — matching the Breathing Studio.
 */
import { Feather } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  LESSONS,
  LEARNING_CHANNELS,
  TOTAL_LEARN_XP,
  EMPTY_PROGRESS,
  LearnProgress,
  loadLearnProgress,
  unlockedLessonIds,
  isPremiumLesson,
} from "@/lib/learnContent";
import { useSubscription } from "@/lib/revenuecat";

// ── Pulsing ring for the active node ──────────────────────────────────────────

function PulseRing({ color }: { color: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  return (
    <Animated.View
      style={[
        styles.pulseRing,
        {
          borderColor: color,
          opacity: anim,
          transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] }) }],
        },
      ]}
    />
  );
}

// ── Individual roadmap node ────────────────────────────────────────────────────

interface NodeProps {
  lesson: typeof LESSONS[number];
  isCompleted: boolean;
  isUnlocked: boolean;
  isPremiumLocked: boolean;
  isFirst: boolean;
  isLast: boolean;
  prevCompleted: boolean;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}

function RoadmapNode({
  lesson,
  isCompleted,
  isUnlocked,
  isPremiumLocked,
  isFirst,
  isLast,
  prevCompleted,
  colors,
  onPress,
}: NodeProps) {
  const isActive  = isUnlocked && !isPremiumLocked && !isCompleted;
  const isLocked  = !isUnlocked || isPremiumLocked;

  const accentHex =
    lesson.accent === "primary"  ? colors.primary  :
    lesson.accent === "accent"   ? colors.accent    :
    lesson.accent === "success"  ? colors.success   :
    colors.xpGold;

  const nodeColor    = isCompleted ? colors.success : isActive ? accentHex : colors.muted;
  const lineBelowColor = isCompleted ? colors.success + "70" : colors.muted + "45";
  const lineAboveColor = prevCompleted  ? colors.success + "70" : colors.muted + "45";

  return (
    <View style={styles.nodeRow}>
      {/* ── Timeline column ── */}
      <View style={styles.timelineCol}>
        {/* Line above */}
        {!isFirst && (
          <View style={[styles.lineSegment, { backgroundColor: lineAboveColor }]} />
        )}

        {/* Node circle */}
        <View style={styles.nodeWrap}>
          {isActive && <PulseRing color={accentHex} />}
          <View
            style={[
              styles.nodeDot,
              {
                backgroundColor: isCompleted ? colors.success : isActive ? accentHex : "transparent",
                borderColor: isLocked ? colors.muted : nodeColor,
                borderWidth: isLocked ? 1.5 : 0,
              },
            ]}
          >
            {isCompleted ? (
              <Feather name="check" size={14} color="#fff" />
            ) : isActive ? (
              <Text style={styles.nodeIndex}>{lesson.index}</Text>
            ) : (
              <Feather name="lock" size={12} color={colors.mutedForeground} />
            )}
          </View>
        </View>

        {/* Line below */}
        {!isLast && (
          <View style={[styles.lineSegment, { backgroundColor: lineBelowColor }]} />
        )}
      </View>

      {/* ── Lesson card ── */}
      <Pressable
        disabled={!isUnlocked}
        onPress={onPress}
        style={({ pressed }) => [
          styles.lessonCard,
          {
            backgroundColor: colors.card,
            borderColor: isCompleted
              ? colors.success + "40"
              : isActive
              ? accentHex + "35"
              : colors.border,
            borderLeftColor: isLocked ? colors.border : accentHex,
            opacity: isLocked ? 0.50 : pressed ? 0.86 : 1,
            transform: [{ scale: pressed && !isLocked ? 0.985 : 1 }],
          },
        ]}
      >
        {/* Pathway label */}
        <Text style={[styles.pathwayLabel, { color: isLocked ? colors.mutedForeground : accentHex }]}>
          {lesson.pathway.toUpperCase()}
        </Text>

        {/* Title */}
        <Text
          style={[
            styles.lessonTitle,
            { color: isLocked ? colors.mutedForeground : colors.foreground },
          ]}
          numberOfLines={2}
        >
          {lesson.title}
        </Text>

        {isLocked ? (
          <Text style={[styles.lockedHint, { color: colors.mutedForeground }]}>
            {isPremiumLocked
              ? "Premium pathway — tap to view plans"
              : `Complete lesson ${lesson.index - 1} to unlock`}
          </Text>
        ) : (
          <Text style={[styles.lessonTagline, { color: colors.mutedForeground }]} numberOfLines={2}>
            {lesson.tagline}
          </Text>
        )}

        {/* Meta row */}
        <View style={styles.metaRow}>
          {/* Duration */}
          <View style={[styles.metaChip, { backgroundColor: colors.background }]}>
            <Feather name="clock" size={10} color={colors.mutedForeground} />
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
              {lesson.duration}
            </Text>
          </View>
          {/* XP */}
          <View style={[styles.metaChip, { backgroundColor: colors.xpGold + "15" }]}>
            <Feather name="star" size={10} color={colors.xpGold} />
            <Text style={[styles.metaText, { color: colors.xpGold }]}>
              {lesson.xpReward} XP
            </Text>
          </View>
          {/* Status */}
          {isCompleted && (
            <View style={[styles.metaChip, { backgroundColor: colors.success + "15" }]}>
              <Feather name="check" size={10} color={colors.success} />
              <Text style={[styles.metaText, { color: colors.success }]}>Done</Text>
            </View>
          )}
          {isActive && (
            <View style={[styles.metaChip, { backgroundColor: accentHex + "15" }]}>
              <Text style={[styles.metaText, { color: accentHex }]}>Up next</Text>
            </View>
          )}
          {isPremiumLocked && (
            <View style={[styles.metaChip, { backgroundColor: colors.accent + "15" }]}>
              <Feather name="star" size={10} color={colors.accent} />
              <Text style={[styles.metaText, { color: colors.accent }]}>Premium</Text>
            </View>
          )}
        </View>
      </Pressable>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function LearnScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { hasPremiumOrTrial } = useSubscription();

  const [progress, setProgress] = useState<LearnProgress>(EMPTY_PROGRESS);
  const userId = user?.id ?? null;
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  useFocusEffect(
    useCallback(() => {
      loadLearnProgress(userId).then(setProgress);
    }, [userId]),
  );

  const completedCount = progress.completedIds.length;
  const xpEarned = LESSONS
    .filter((l) => progress.completedIds.includes(l.id))
    .reduce((s, l) => s + l.xpReward, 0);
  const unlocked = unlockedLessonIds(progress.completedIds);
  const allDone  = completedCount === LESSONS.length;
  const pct      = completedCount === 0 ? 0 : Math.round((completedCount / LESSONS.length) * 100);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* White status-bar icons over the dark navy hero */}
      <StatusBar style="light" />

      {/* Deep navy hero backdrop */}
      <LinearGradient
        colors={["#0D2530", "#1C3A4A", colors.background]}
        locations={[0, 0.48, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[styles.heroBackdrop, { height: topPad + 240 }]}
        pointerEvents="none"
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: topPad + 20,
            paddingBottom: Platform.OS === "web" ? 34 + 84 : insets.bottom + 84,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={styles.headerBlock}>
          <View style={[styles.headerIcon, { backgroundColor: colors.accent + "22", borderColor: colors.accent + "45" }]}>
            <Feather name="book-open" size={22} color={colors.accent} />
          </View>
          <Text style={styles.screenTitle}>Learning Hub</Text>
          <Text style={styles.screenSub}>
            Guided lessons across the key pillars of healthy ageing. One lesson at a time — your pace, your journey.
          </Text>
        </View>

        {/* ── Progress card ── */}
        <View style={[styles.progressCard, { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.10)" }]}>
          <View style={styles.progressLeft}>
            <Text style={styles.progressBig}>{completedCount}</Text>
            <Text style={styles.progressOf}> / {LESSONS.length}</Text>
            <Text style={styles.progressLabel}>  lessons</Text>
          </View>
          {xpEarned > 0 ? (
            <View style={[styles.xpChip, { backgroundColor: colors.xpGold + "20", borderColor: colors.xpGold + "38" }]}>
              <Feather name="star" size={12} color={colors.xpGold} />
              <Text style={[styles.xpChipText, { color: colors.xpGold }]}>
                {xpEarned} / {TOTAL_LEARN_XP} XP
              </Text>
            </View>
          ) : (
            <View style={[styles.xpChip, { backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.12)" }]}>
              <Feather name="star" size={12} color="rgba(255,255,255,0.40)" />
              <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.40)" }}>
                {TOTAL_LEARN_XP} XP to earn
              </Text>
            </View>
          )}
        </View>

        {/* ── Progress bar ── */}
        <View style={[styles.progressBarTrack, { backgroundColor: "rgba(255,255,255,0.08)" }]}>
          {pct > 0 && (
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${pct}%`,
                  backgroundColor: allDone ? colors.success : colors.accent,
                },
              ]}
            />
          )}
        </View>

        {/* ── Roadmap ── */}
        <Text style={[styles.roadmapLabel, { color: "rgba(255,255,255,0.38)" }]}>
          YOUR JOURNEY
        </Text>

        {LEARNING_CHANNELS.slice().sort((a, b) => a.order - b.order).map((channel) => (
          <React.Fragment key={channel.id}>
            <View style={styles.channelHeader}>
              <Text style={styles.channelTitle}>{channel.title}</Text>
              <Text style={styles.channelSubtitle}>{channel.subtitle}</Text>
            </View>
            <View style={styles.roadmap}>
              {channel.lessons.map((lesson, idx) => {
                const isCompleted = progress.completedIds.includes(lesson.id);
                const isUnlocked = unlocked.has(lesson.id);
                const isPremiumLocked = isPremiumLesson(lesson) && !hasPremiumOrTrial;
                const prevCompleted = idx === 0
                  ? true
                  : progress.completedIds.includes(channel.lessons[idx - 1].id);

                return (
                  <RoadmapNode
                    key={lesson.id}
                    lesson={lesson}
                    isCompleted={isCompleted}
                    isUnlocked={isUnlocked}
                    isPremiumLocked={isPremiumLocked}
                    isFirst={idx === 0}
                    isLast={idx === channel.lessons.length - 1}
                    prevCompleted={prevCompleted}
                    colors={colors}
                    onPress={() => {
                      if (isPremiumLocked) {
                        Alert.alert(
                          "Premium Learning",
                          "Advanced SNAP pathways are available with Premium.",
                          [
                            { text: "Not now", style: "cancel" },
                            { text: "See plans", onPress: () => router.push("/subscription" as never) },
                          ],
                        );
                        return;
                      }
                      router.push(`/learn/${lesson.id}` as never);
                    }}
                  />
                );
              })}
            </View>
          </React.Fragment>
        ))}

        {/* ── Completion banner ── */}
        {allDone && (
          <LinearGradient
            colors={[colors.navy, "#0D2530"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.completionBanner}
          >
            <Feather name="award" size={36} color={colors.xpGold} />
            <Text style={styles.completionTitle}>Learning journey complete!</Text>
            <Text style={styles.completionSub}>
              You have earned {xpEarned} XP and built the knowledge to support your healthy ageing journey. This is where it truly begins.
            </Text>
          </LinearGradient>
        )}
      </ScrollView>
    </View>
  );
}

const NODE_SIZE  = 34;
const LINE_WIDTH = 2;

const styles = StyleSheet.create({
  root:        { flex: 1 },
  heroBackdrop:{ position: "absolute", left: 0, right: 0, top: 0 },
  scroll:      { flex: 1 },
  content:     { paddingHorizontal: 16, gap: 12 },

  // Header
  headerBlock: { gap: 6, marginBottom: 4 },
  headerIcon:  { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1, marginBottom: 4 },
  screenTitle: { fontSize: 26, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: -0.4, lineHeight: 32 },
  screenSub:   { fontSize: 14, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.58)", lineHeight: 21 },

  // Progress
  progressCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 14, borderWidth: 1 },
  progressLeft: { flexDirection: "row", alignItems: "baseline" },
  progressBig:  { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  progressOf:   { fontSize: 18, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.38)" },
  progressLabel:{ fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.48)" },
  xpChip:       { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  xpChipText:   { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  // Bar
  progressBarTrack: { height: 4, borderRadius: 2, marginHorizontal: 2, overflow: "hidden" },
  progressBarFill:  { height: 4, borderRadius: 2, minWidth: 8 },

  // Roadmap label
  roadmapLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1.2, marginTop: 4 },
  channelHeader: { gap: 2, marginTop: 2, marginBottom: 2 },
  channelTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  channelSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.58)" },

  // Roadmap container
  roadmap: { gap: 0 },

  // Node row
  nodeRow: { flexDirection: "row", alignItems: "stretch", gap: 14 },

  // Timeline
  timelineCol: { width: NODE_SIZE, alignItems: "center" },
  lineSegment: { flex: 1, width: LINE_WIDTH, minHeight: 12 },
  nodeWrap:    { width: NODE_SIZE, height: NODE_SIZE, alignItems: "center", justifyContent: "center" },
  pulseRing:   { position: "absolute", width: NODE_SIZE + 10, height: NODE_SIZE + 10, borderRadius: (NODE_SIZE + 10) / 2, borderWidth: 2 },
  nodeDot:     { width: NODE_SIZE, height: NODE_SIZE, borderRadius: NODE_SIZE / 2, alignItems: "center", justifyContent: "center" },
  nodeIndex:   { fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" },

  // Lesson card
  lessonCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderLeftWidth: 3,
    padding: 14,
    gap: 5,
    marginVertical: 4,
  },
  pathwayLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.9 },
  lessonTitle:  { fontSize: 15, fontFamily: "Inter_700Bold", lineHeight: 20 },
  lessonTagline:{ fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  lockedHint:   { fontSize: 12, fontFamily: "Inter_400Regular", fontStyle: "italic" },
  metaRow:      { flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 4 },
  metaChip:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 20 },
  metaText:     { fontSize: 10, fontFamily: "Inter_500Medium" },

  // Completion
  completionBanner: { borderRadius: 20, padding: 24, alignItems: "center", gap: 12, marginTop: 8 },
  completionTitle:  { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff", textAlign: "center" },
  completionSub:    { fontSize: 14, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.65)", textAlign: "center", lineHeight: 20 },
});
