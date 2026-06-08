/**
 * LessonCompleteModal — Bone Buddy celebration overlay.
 *
 * Appears when a user marks a lesson complete. Shows:
 *   • Animated Bone Buddy icon (gradient circle + award)
 *   • XP earned chip
 *   • Lesson-specific completion message (warm, personal)
 *   • "Try [feature]" CTA → navigates to the lesson's linked screen
 *   • "Next lesson" shortcut (if one exists)
 *
 * The Bone Buddy avatar is a gradient circle expressing celebration —
 * a visual suggestion for the character icon to be developed.
 */
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { Lesson, LESSONS } from "@/lib/learnContent";

interface LessonCompleteModalProps {
  visible: boolean;
  lesson: Lesson | null;
  onClose: () => void;
}

function BoneBuddyAvatar({ colors }: { colors: ReturnType<typeof useColors> }) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.00, duration: 900, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  return (
    <Animated.View style={[styles.avatarWrap, { transform: [{ scale: pulse }] }]}>
      {/* Outer glow ring */}
      <View style={[styles.avatarGlow, { backgroundColor: colors.xpGold + "25" }]} />
      {/* Gradient circle — Bone Buddy's signature look */}
      <LinearGradient
        colors={[colors.navy, colors.primary]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.avatarCircle}
      >
        {/* Inner accent circle */}
        <View style={[styles.avatarInner, { backgroundColor: colors.xpGold + "18" }]}>
          <Feather name="award" size={38} color={colors.xpGold} />
        </View>
      </LinearGradient>
      {/* "BB" badge */}
      <View style={[styles.bbBadge, { backgroundColor: colors.accent, borderColor: colors.background }]}>
        <Text style={styles.bbText}>BB</Text>
      </View>
    </Animated.View>
  );
}

export function LessonCompleteModal({
  visible,
  lesson,
  onClose,
}: LessonCompleteModalProps) {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const router  = useRouter();

  const slideIn = useRef(new Animated.Value(60)).current;
  const fadeIn  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      slideIn.setValue(60);
      fadeIn.setValue(0);
      Animated.parallel([
        Animated.spring(slideIn, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }),
        Animated.timing(fadeIn,  { toValue: 1, duration: 280, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  if (!lesson) return null;

  const nextLesson = LESSONS[lesson.index]; // index is 1-based → next
  const bottomPad  = Platform.OS === "web" ? 34 : insets.bottom;

  const accentHex =
    lesson.accent === "primary"  ? colors.primary  :
    lesson.accent === "accent"   ? colors.accent    :
    lesson.accent === "success"  ? colors.success   :
    colors.xpGold;

  function handleCta() {
    onClose();
    setTimeout(() => router.push(lesson!.ctaRoute as never), 320);
  }

  function handleNext() {
    onClose();
    if (nextLesson) {
      setTimeout(() => router.replace(`/learn/${nextLesson.id}` as never), 320);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              paddingBottom: bottomPad + 16,
              transform: [{ translateY: slideIn }],
              opacity: fadeIn,
            },
          ]}
        >
          {/* Gradient top strip */}
          <LinearGradient
            colors={[colors.navy, "#0D2530"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.topStrip}
          >
            {/* Decorative circles */}
            <View style={[styles.deco1, { backgroundColor: accentHex + "18" }]} />
            <View style={[styles.deco2, { backgroundColor: colors.xpGold + "10" }]} />

            {/* Close button */}
            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
              <Feather name="x" size={20} color="rgba(255,255,255,0.55)" />
            </Pressable>

            {/* Bone Buddy avatar */}
            <BoneBuddyAvatar colors={colors} />

            {/* "Bone Buddy" label */}
            <View style={[styles.bbLabel, { backgroundColor: colors.accent + "20", borderColor: colors.accent + "40" }]}>
              <Text style={[styles.bbLabelText, { color: colors.accent }]}>
                Bone Buddy says
              </Text>
            </View>

            {/* Completion heading */}
            <Text style={styles.heading}>
              Lesson {lesson.index} complete 🎉
            </Text>

            {/* XP chip */}
            <View style={[styles.xpChip, { backgroundColor: colors.xpGold + "22", borderColor: colors.xpGold + "45" }]}>
              <Feather name="star" size={14} color={colors.xpGold} />
              <Text style={[styles.xpChipText, { color: colors.xpGold }]}>
                +{lesson.xpReward} XP earned
              </Text>
            </View>
          </LinearGradient>

          {/* Completion message */}
          <View style={[styles.messageCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.message, { color: colors.foreground }]}>
              {lesson.completionMessage}
            </Text>
          </View>

          {/* Pathway label */}
          <Text style={[styles.pathwayLabel, { color: colors.mutedForeground }]}>
            {lesson.pathway} · Foundations Journey
          </Text>

          {/* Primary CTA */}
          <Pressable
            style={[styles.ctaBtn, { backgroundColor: accentHex }]}
            onPress={handleCta}
          >
            <Text style={styles.ctaBtnText}>{lesson.ctaLabel}</Text>
            <Feather name="arrow-right" size={16} color="#fff" />
          </Pressable>

          {/* Next lesson or close */}
          {nextLesson ? (
            <Pressable
              style={[styles.nextBtn, { borderColor: colors.border }]}
              onPress={handleNext}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.nextLabel, { color: colors.mutedForeground }]}>
                  Up next in your journey
                </Text>
                <Text style={[styles.nextTitle, { color: colors.foreground }]} numberOfLines={1}>
                  {nextLesson.title}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          ) : (
            <Pressable style={styles.doneBtn} onPress={onClose}>
              <Text style={[styles.doneBtnText, { color: colors.mutedForeground }]}>
                Back to my journey
              </Text>
            </Pressable>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
  },

  // Gradient top
  topStrip: {
    padding: 24,
    paddingTop: 20,
    alignItems: "center",
    gap: 10,
    overflow: "hidden",
  },
  deco1: { position: "absolute", width: 180, height: 180, borderRadius: 90, top: -60, right: -40 },
  deco2: { position: "absolute", width: 100, height: 100, borderRadius: 50, bottom: -20, left: 20 },
  closeBtn: { position: "absolute", top: 16, right: 16, width: 32, height: 32, alignItems: "center", justifyContent: "center" },

  // Avatar
  avatarWrap: { alignItems: "center", justifyContent: "center", marginBottom: 4 },
  avatarGlow: { position: "absolute", width: 110, height: 110, borderRadius: 55 },
  avatarCircle: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center" },
  avatarInner: { width: 70, height: 70, borderRadius: 35, alignItems: "center", justifyContent: "center" },
  bbBadge: { position: "absolute", bottom: 0, right: -4, width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  bbText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#fff" },

  // Labels
  bbLabel: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  bbLabelText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  heading: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: -0.3, textAlign: "center" },
  xpChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  xpChipText: { fontSize: 14, fontFamily: "Inter_700Bold" },

  // Message
  messageCard: { marginHorizontal: 20, marginTop: 16, padding: 16, borderRadius: 16, borderWidth: 1 },
  message: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 23, textAlign: "center" },

  // Pathway
  pathwayLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center", marginTop: 10, letterSpacing: 0.3 },

  // CTAs
  ctaBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginHorizontal: 20, marginTop: 14, paddingVertical: 15, borderRadius: 16 },
  ctaBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  nextBtn: { flexDirection: "row", alignItems: "center", marginHorizontal: 20, marginTop: 8, padding: 14, borderRadius: 14, borderWidth: 1, gap: 12 },
  nextLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  nextTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  doneBtn: { alignItems: "center", marginTop: 16, paddingVertical: 8 },
  doneBtnText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
