/**
 * LearnPromptModal — shown once per app session when the user has not yet
 * started their SNAP Foundations journey and has not opted out of reminders.
 *
 * Appears as a bottom sheet over the home screen.
 * Options:
 *   • "Start exploring"      → navigates to Learn tab, marks journey begun.
 *   • "Not now"              → dismisses for this session only.
 *   • "Turn off reminders"   → persists "off" preference; never shows again.
 */
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  isLearnActivated,
  loadPromptPreference,
  setPromptPreference,
} from "@/lib/learnContent";

/**
 * Module-level set of user IDs that have already seen the modal this session.
 * Prevents the sheet re-appearing on every Home re-mount or tab switch.
 */
const shownThisSession = new Set<string>();

const BENEFITS = [
  { icon: "zap" as const,         text: "9 guided lessons — 5 to 10 minutes each" },
  { icon: "shield" as const,      text: "Understand calcium, movement, sleep and more" },
  { icon: "star" as const,        text: "Earn XP and unlock your next lesson as you go" },
  { icon: "arrow-right" as const, text: "Each lesson links directly to a SNAP feature" },
];

export function LearnPromptModal() {
  const { user } = useAuth();
  const colors   = useColors();
  const insets   = useSafeAreaInsets();
  const router   = useRouter();

  const [visible, setVisible] = useState(false);
  const userId = user?.id ?? null;

  // Ref so the async callback never closes over a stale userId.
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  useEffect(() => {
    if (!userId) return;
    if (shownThisSession.has(userId)) return;

    let cancelled = false;
    (async () => {
      const [activated, pref] = await Promise.all([
        isLearnActivated(userId),
        loadPromptPreference(userId),
      ]);
      if (cancelled || userIdRef.current !== userId) return;
      if (!activated && pref === "on") {
        shownThisSession.add(userId);
        setVisible(true);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  function handleClose() { setVisible(false); }

  async function handleTurnOff() {
    setVisible(false);
    await setPromptPreference(userId, "off");
  }

  function handleStart() {
    setVisible(false);
    router.push("/(tabs)/learn" as never);
  }

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      {/* Semi-transparent backdrop — tap to dismiss */}
      <Pressable style={styles.backdrop} onPress={handleClose}>
        {/* Sheet — stop tap propagation so the sheet itself doesn't close */}
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: colors.background, paddingBottom: bottomPad + 16 },
          ]}
          onPress={() => {}}
        >
          {/* Gradient header */}
          <LinearGradient
            colors={[colors.navy, "#0D2530"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.gradientHeader}
          >
            {/* Decorative depth circles */}
            <View style={[styles.circle1, { backgroundColor: colors.accent + "20" }]} />
            <View style={[styles.circle2, { backgroundColor: colors.primary + "12" }]} />

            {/* Icon */}
            <View
              style={[
                styles.iconWrap,
                { backgroundColor: colors.accent + "28", borderColor: colors.accent + "55" },
              ]}
            >
              <Feather name="book-open" size={28} color={colors.accent} />
            </View>

            <Text style={styles.sheetTitle}>Your journey starts here</Text>
            <Text style={styles.sheetSub}>
              Nine guided lessons to help you understand your body, discover
              SNAP's features, and build habits that support you for life.
            </Text>
          </LinearGradient>

          {/* Benefit rows */}
          <View
            style={[
              styles.benefitsCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {BENEFITS.map(({ icon, text }) => (
              <View key={text} style={styles.benefitRow}>
                <View
                  style={[
                    styles.benefitIcon,
                    { backgroundColor: colors.primary + "18" },
                  ]}
                >
                  <Feather name={icon} size={14} color={colors.primary} />
                </View>
                <Text style={[styles.benefitText, { color: colors.foreground }]}>
                  {text}
                </Text>
              </View>
            ))}
          </View>

          {/* Primary CTA */}
          <Pressable
            style={[styles.startBtn, { backgroundColor: colors.accent }]}
            onPress={handleStart}
          >
            <Feather name="book-open" size={18} color="#fff" />
            <Text style={styles.startBtnText}>Start exploring</Text>
            <Feather name="arrow-right" size={16} color="rgba(255,255,255,0.80)" />
          </Pressable>

          {/* Secondary row */}
          <View style={styles.secondaryRow}>
            <Pressable style={styles.secondaryBtn} onPress={handleClose}>
              <Text style={[styles.secondaryText, { color: colors.mutedForeground }]}>
                Not now
              </Text>
            </Pressable>
            <View style={[styles.secondaryDivider, { backgroundColor: colors.border }]} />
            <Pressable style={styles.secondaryBtn} onPress={handleTurnOff}>
              <Text style={[styles.secondaryText, { color: colors.mutedForeground }]}>
                Turn off reminders
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
  },
  gradientHeader: {
    padding: 24,
    paddingBottom: 28,
    gap: 12,
    alignItems: "flex-start",
    overflow: "hidden",
  },
  circle1: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    top: -50,
    right: -40,
  },
  circle2: {
    position: "absolute",
    width: 90,
    height: 90,
    borderRadius: 45,
    bottom: -20,
    right: 80,
  },
  iconWrap: {
    width: 54,
    height: 54,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    marginBottom: 4,
  },
  sheetTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    letterSpacing: -0.3,
    lineHeight: 28,
  },
  sheetSub: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.62)",
    lineHeight: 20,
  },
  benefitsCard: {
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  benefitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  benefitIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  benefitText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    flex: 1,
    lineHeight: 19,
  },
  startBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginHorizontal: 20,
    marginTop: 16,
    paddingVertical: 16,
    borderRadius: 16,
  },
  startBtnText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    flex: 1,
    textAlign: "center",
  },
  secondaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    marginHorizontal: 20,
  },
  secondaryBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
  },
  secondaryDivider: { width: 1, height: 18 },
  secondaryText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
