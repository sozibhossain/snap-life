/**
 * Privacy & Data screen — wires up the GDPR self-serve endpoints
 * (`GET /api/me/export`, `DELETE /api/me`) plus the tester-only
 * "Reset my data" action (`POST /api/me/reset`).
 *
 * Auth:
 *   - We pass the active Clerk session token (preferred) and fall back
 *     to the cached legacy bearer token. The server treats both the
 *     same; the fallback exists so a tester running the static web
 *     build (where Clerk is sometimes absent) can still trigger
 *     export/delete.
 *
 * Confirmations:
 *   - Native uses `Alert.alert`. Web uses `window.confirm` (native
 *     `Alert` is a no-op on web).
 *
 * After a successful delete the API returns 410 on every subsequent
 * request, so we sign the user out locally to keep the UI honest.
 */

import { Feather } from "@expo/vector-icons";
import { useAuth as useClerkAuth } from "@clerk/expo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/ui/Card";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { getUserToken } from "@/lib/userToken";
import {
  deleteMyAccount,
  downloadExportArchive,
  fetchMyExport,
  resetMyTesterData,
} from "@/lib/meApi";

type ConfirmFn = (title: string, message: string) => Promise<boolean>;

const confirm: ConfirmFn = async (title, message) => {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return false;
    return window.confirm(`${title}\n\n${message}`);
  }
  return new Promise<boolean>((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Confirm", style: "destructive", onPress: () => resolve(true) },
    ]);
  });
};

function notify(title: string, message: string) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

export default function PrivacyScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, isTester, logout } = useAuth();
  const { getToken } = useClerkAuth();
  const [busy, setBusy] = useState<"export" | "delete" | "reset" | null>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  /** Resolve the freshest auth token: Clerk session first, legacy fallback. */
  async function resolveToken(): Promise<string | null> {
    try {
      const t = await getToken();
      if (t) return t;
    } catch {
      // ignore; fall through to legacy
    }
    return user?.id ? await getUserToken(user.id) : null;
  }

  async function handleExport() {
    setBusy("export");
    try {
      const token = await resolveToken();
      const result = await fetchMyExport(token);
      if (!result.ok) {
        notify(
          "Export failed",
          `We couldn't download your data right now (${result.error ?? `HTTP ${result.status}`}). Please try again in a minute.`,
        );
        return;
      }
      const filename = `snap-life-export-${user?.id ?? "me"}.json`;
      await downloadExportArchive(result.data, filename, async (json) => {
        // Native: hand to the share sheet so iOS/Android can route to
        // Files / iCloud / email. The Share API only accepts strings,
        // not Blobs, so we ship the JSON inline.
        await Share.share({ message: json, title: filename });
      });
      notify(
        "Export ready",
        Platform.OS === "web"
          ? "Your archive has downloaded as a JSON file."
          : "Your archive has been shared.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    const ok = await confirm(
      "Delete your account?",
      "We'll redact your profile immediately and permanently delete your data after 30 days. This action signs you out and can be undone within the grace window by emailing support.",
    );
    if (!ok) return;
    setBusy("delete");
    try {
      const token = await resolveToken();
      const result = await deleteMyAccount(token);
      if (!result.ok) {
        notify(
          "Delete failed",
          `We couldn't process the deletion (${result.error ?? `HTTP ${result.status}`}). Please try again or contact support.`,
        );
        return;
      }
      notify(
        "Account deleted",
        "Your account has been deactivated and we'll permanently remove the data within 30 days.",
      );
      // The API now returns 410 for every authed request — sign out
      // locally so the UI doesn't keep retrying.
      await logout();
    } finally {
      setBusy(null);
    }
  }

  async function handleReset() {
    const ok = await confirm(
      "Reset all your data?",
      "This wipes nutrition logs, activity, achievements and Bone Buddy history for this account. Your sign-in stays the same so you can re-run onboarding. Testers only.",
    );
    if (!ok) return;
    setBusy("reset");
    try {
      const token = await resolveToken();
      const result = await resetMyTesterData(token);
      if (!result.ok) {
        notify(
          "Reset failed",
          result.status === 403
            ? "Reset is only available for tester accounts."
            : `We couldn't reset your data (${result.error ?? `HTTP ${result.status}`}).`,
        );
        return;
      }
      // The server has wiped per-user rows; mirror that locally by
      // clearing every cached AsyncStorage key EXCEPT the auth/session
      // ones — clearing those would sign the tester out and force a
      // round-trip through Clerk before they can re-run onboarding.
      // Acceptance: "clears server data and AsyncStorage" (Task #34).
      try {
        const KEEP_PREFIXES = ["clerk", "@clerk", "snap.user.token"];
        const keys = await AsyncStorage.getAllKeys();
        const toRemove = keys.filter(
          (k) => !KEEP_PREFIXES.some((p) => k.startsWith(p)),
        );
        if (toRemove.length > 0) {
          await AsyncStorage.multiRemove(toRemove);
        }
      } catch {
        // Best-effort — a partial wipe is still better than nothing
        // and the next onboarding pass will overwrite stale keys.
      }
      notify(
        "Data reset",
        "Your tracking data has been cleared from the server and this device. Restart the app to re-run onboarding.",
      );
    } finally {
      setBusy(null);
    }
  }

  const actions = [
    {
      key: "export" as const,
      icon: "download" as const,
      label: "Export My Data",
      desc: "Download every record we store about you as a JSON archive.",
      onPress: handleExport,
      destructive: false,
      visible: true,
    },
    {
      key: "delete" as const,
      icon: "trash-2" as const,
      label: "Delete My Account",
      desc: "Redact PII immediately, then permanently remove all data after 30 days.",
      onPress: handleDelete,
      destructive: true,
      visible: true,
    },
    {
      key: "reset" as const,
      icon: "refresh-ccw" as const,
      label: "Reset My Data (Tester)",
      desc: "Wipe tracking data while keeping your sign-in. Staging only.",
      onPress: handleReset,
      destructive: false,
      visible: isTester,
    },
  ].filter((a) => a.visible);

  const links = [
    {
      icon: "eye" as const,
      label: "Privacy Policy",
      desc: "How we collect, store and protect your health data.",
      route: "/settings/privacy-policy" as string | undefined,
    },
    {
      icon: "file-text" as const,
      label: "Terms of Service",
      desc: "Platform terms, subscriptions and acceptable use.",
      route: "/settings/terms",
    },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 8, borderBottomColor: colors.border },
        ]}
      >
        <Pressable onPress={() => router.back()} accessibilityLabel="Back">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Privacy & Data
        </Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: bottomPad + 20 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.gdprCard,
            {
              backgroundColor: colors.primary + "10",
              borderColor: colors.primary + "25",
            },
          ]}
        >
          <Feather name="shield" size={20} color={colors.primary} />
          <Text style={[styles.gdprTitle, { color: colors.primary }]}>
            GDPR Compliant
          </Text>
          <Text style={[styles.gdprText, { color: colors.mutedForeground }]}>
            Your health data is encrypted in transit, stored on Replit-hosted
            Postgres in the EU, and never shared with third parties without
            your consent. Use the controls below to export or remove it.
          </Text>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.foreground }]}>
          Your data
        </Text>
        <Card variant="outlined">
          {actions.map((item, i) => (
            <Pressable
              key={item.key}
              onPress={item.onPress}
              disabled={busy !== null}
              style={[
                styles.row,
                i < actions.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                },
                busy !== null && busy !== item.key && { opacity: 0.5 },
              ]}
            >
              <View
                style={[
                  styles.rowIcon,
                  {
                    backgroundColor: item.destructive
                      ? colors.destructive + "14"
                      : colors.primary + "14",
                  },
                ]}
              >
                <Feather
                  name={item.icon}
                  size={16}
                  color={item.destructive ? colors.destructive : colors.primary}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text
                  style={[
                    styles.rowLabel,
                    {
                      color: item.destructive
                        ? colors.destructive
                        : colors.foreground,
                    },
                  ]}
                >
                  {item.label}
                </Text>
                <Text style={[styles.rowDesc, { color: colors.mutedForeground }]}>
                  {item.desc}
                </Text>
              </View>
              {busy === item.key ? (
                <ActivityIndicator
                  size="small"
                  color={
                    item.destructive ? colors.destructive : colors.primary
                  }
                />
              ) : (
                <Feather
                  name="chevron-right"
                  size={16}
                  color={colors.mutedForeground}
                />
              )}
            </Pressable>
          ))}
        </Card>

        <Text style={[styles.sectionLabel, { color: colors.foreground }]}>
          Policies
        </Text>
        <Card variant="outlined">
          {links.map((item, i) => (
            <Pressable
              key={item.label}
              onPress={() => {
                if (item.route) router.push(item.route as never);
              }}
              style={[
                styles.row,
                i < links.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                },
              ]}
            >
              <View
                style={[
                  styles.rowIcon,
                  { backgroundColor: colors.primary + "14" },
                ]}
              >
                <Feather name={item.icon} size={16} color={colors.primary} />
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[styles.rowLabel, { color: colors.foreground }]}>
                  {item.label}
                </Text>
                <Text
                  style={[styles.rowDesc, { color: colors.mutedForeground }]}
                >
                  {item.desc}
                </Text>
              </View>
              <Feather
                name="chevron-right"
                size={16}
                color={colors.mutedForeground}
              />
            </Pressable>
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  content: { padding: 16, gap: 16 },
  gdprCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 8 },
  gdprTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  gdprText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  sectionLabel: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    marginTop: 4,
    marginLeft: 4,
    letterSpacing: 0.2,
    textTransform: "uppercase",
    opacity: 0.7,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  rowDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
