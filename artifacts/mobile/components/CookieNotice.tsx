/**
 * Web-only cookie/storage notice banner.
 *
 * Native builds don't render anything (App Store onboarding handles
 * this through the privacy nutrition labels + first-run permission
 * prompts). On web, the PWA stores per-user data in localStorage,
 * AsyncStorage's web shim, and partitioned service-worker caches —
 * EU GDPR + UK GDPR + ePrivacy require we surface that to the user
 * before the first meaningful interaction. The banner also doubles as
 * the CCPA "notice at collection" entry point for California users
 * (links into the Privacy Policy where the Do Not Sell statement
 * lives) and the LGPD/PIPEDA equivalents.
 *
 * Storage:
 *   - Dismissal is recorded in localStorage under
 *     `@snaplife/cookieNotice/v1` so the banner doesn't reappear.
 *   - We never set tracking cookies — purely first-party storage
 *     for sign-in state and offline cache.
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

const STORAGE_KEY = "@snaplife/cookieNotice/v1";
const ACCESSIBLE_ACTION_COLOR = "#08758E";

function readDismissed(): boolean {
  if (Platform.OS !== "web") return true;
  try {
    return typeof window !== "undefined" &&
      window.localStorage?.getItem(STORAGE_KEY) === "dismissed";
  } catch {
    return true;
  }
}

function writeDismissed(): void {
  if (Platform.OS !== "web") return;
  try {
    window.localStorage?.setItem(STORAGE_KEY, "dismissed");
  } catch {
    // Private browsing / quota — silent fallback. The banner will
    // reappear next session, which is the expected GDPR fallback.
  }
}

export function CookieNotice(): React.ReactElement | null {
  const colors = useColors();
  const router = useRouter();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    setVisible(!readDismissed());
  }, []);

  if (Platform.OS !== "web" || !visible) return null;

  function dismiss() {
    writeDismissed();
    setVisible(false);
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
        colors.shadows.lg,
      ]}
    >
      <View style={styles.row}>
        <View style={[styles.iconWrap, { backgroundColor: colors.primary + "18" }]}>
          <Feather name="shield" size={16} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            We use first-party storage only
          </Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            SNAP Life keeps your sign-in and offline cache in your browser.
            We don&apos;t set tracking cookies, don&apos;t sell your data,
            and never share your health data for advertising. EU/UK,
            California, Brazil, Canadian and Australian users have full
            access, deletion and portability rights — see the{" "}
            <Text
              style={[styles.link, { color: colors.primary }]}
              onPress={() => router.push("/settings/privacy-policy")}
            >
              Privacy Policy
            </Text>
            .
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Dismiss cookie notice"
          onPress={dismiss}
          style={[styles.dismiss, { backgroundColor: ACCESSIBLE_ACTION_COLOR }]}
        >
          <Text style={styles.dismissText}>Got it</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    zIndex: 1000,
    maxWidth: 720,
    alignSelf: "center",
  },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 4 },
  body: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  link: { fontFamily: "Inter_600SemiBold", textDecorationLine: "underline" },
  dismiss: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    alignSelf: "center",
  },
  dismissText: { color: "#fff", fontSize: 13, fontFamily: "Inter_700Bold" },
});

export default CookieNotice;
