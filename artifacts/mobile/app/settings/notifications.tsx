import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/ui/Card";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  loadPushState,
  optInToBoneBuddyPush,
  optOutOfBoneBuddyPush,
} from "@/lib/push";
import {
  loadWebPushState,
  optInToWebPush,
  optOutOfWebPush,
} from "@/lib/webPush";
import {
  DEFAULT_REMINDER_SETTINGS,
  loadReminderSettings,
  updateReminderPreference,
  type ReminderId,
} from "@/lib/notificationPreferences";

const NOTIFICATION_SETTINGS: Array<{
  id: ReminderId;
  label: string;
  description: string;
}> = [
  { id: "supplements", label: "Supplement Reminders", description: "Daily reminder at 9:00" },
  { id: "activity", label: "Activity Goals", description: "Daily movement check-in at 18:00" },
  { id: "challenges", label: "Challenge Updates", description: "Daily challenge reminder at 17:00" },
  { id: "achievements", label: "Achievement Updates", description: "Daily progress check at 20:00" },
  { id: "streak", label: "Streak Reminders", description: "Daily streak reminder at 19:30" },
  { id: "reports", label: "Health Reports", description: "Weekly summary every Monday at 9:00" },
];

/**
 * Friendly error copy keyed off the OptInOutcome failure reasons. Kept in
 * the screen so the language is tuned to this surface.
 */
const PUSH_ERROR_COPY: Record<string, { title: string; body: string }> = {
  no_device: {
    title: "Simulator detected",
    body: "Push notifications need a real device to receive Bone Buddy nudges.",
  },
  permission_denied: {
    title: "Notification permission off",
    body: "We need notification permission to send your daily nudge. You can change this in your device settings.",
  },
  token_unavailable: {
    title: "Couldn't get a push token",
    body: "Try again in a moment — your device may not be ready yet.",
  },
  register_failed: {
    title: "Couldn't register with SNAP Life",
    body: "Check your connection and try again.",
  },
  not_supported: {
    title: "Notifications not supported",
    body: "Your browser doesn't support push notifications. Try installing SNAP Life on Android or iOS 16.4+.",
  },
  sw_unavailable: {
    title: "Service worker not ready",
    body: "Make sure SNAP Life is installed to your home screen, then try again.",
  },
  vapid_unavailable: {
    title: "Push not configured",
    body: "Web push isn't fully set up yet — check back shortly.",
  },
  subscribe_failed: {
    title: "Couldn't subscribe",
    body: "The browser couldn't create a push subscription. Try again in a moment.",
  },
};

/**
 * In-app consent prompt shown before the native OS permission dialog.
 * Apple guideline 4.5.4 expects the app itself to ask for the user's
 * consent to notifications, not just rely on the bare system dialog —
 * this gives that explicit step, explains what the notification is
 * for, and lets the user decline without ever seeing the OS prompt.
 */
function confirmNotificationIntent(title: string, message: string): Promise<boolean> {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return Promise.resolve(false);
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise<boolean>((resolve) => {
    Alert.alert(title, message, [
      { text: "Not now", style: "cancel", onPress: () => resolve(false) },
      { text: "Allow", onPress: () => resolve(true) },
    ]);
  });
}

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [settings, setSettings] = useState(DEFAULT_REMINDER_SETTINGS);
  const [pendingReminder, setPendingReminder] = useState<ReminderId | null>(null);

  // Bone Buddy daily nudge — backed by real Expo push registration (native)
  // or Web Push subscription (web/PWA).
  const [boneBuddyOptedIn, setBoneBuddyOptedIn] = useState(false);
  const [boneBuddyPending, setBoneBuddyPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (Platform.OS === "web") {
        const s = await loadWebPushState(user?.id);
        if (!cancelled) setBoneBuddyOptedIn(s.optedIn);
      } else {
        const s = await loadPushState(user?.id);
        if (!cancelled) setBoneBuddyOptedIn(s.optedIn);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    void loadReminderSettings(user?.id).then((saved) => {
      if (!cancelled) setSettings(saved);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  async function handleBoneBuddyToggle(next: boolean) {
    if (!user?.id) return;
    setBoneBuddyPending(true);
    try {
      if (Platform.OS === "web") {
        await handleWebPushToggle(next, user.id);
      } else {
        await handleNativePushToggle(next, user.id);
      }
    } finally {
      setBoneBuddyPending(false);
    }
  }

  async function handleWebPushToggle(next: boolean, userId: string) {
    if (next) {
      const allowed = await confirmNotificationIntent(
        "Turn on Bone Buddy nudges?",
        "SNAP Life will send one personalised check-in a day. Your browser will then ask you to confirm.",
      );
      if (!allowed) return;
      const result = await optInToWebPush(userId);
      if (result.ok) {
        setBoneBuddyOptedIn(true);
      } else {
        const copy = PUSH_ERROR_COPY[result.reason] ?? {
          title: "Couldn't turn that on",
          body: "Please try again shortly.",
        };
        console.warn(`${copy.title}: ${copy.body}`);
        setBoneBuddyOptedIn(false);
      }
    } else {
      await optOutOfWebPush(userId);
      setBoneBuddyOptedIn(false);
    }
  }

  async function handleNativePushToggle(next: boolean, userId: string) {
    if (next) {
      const allowed = await confirmNotificationIntent(
        "Turn on Bone Buddy nudges?",
        "SNAP Life will send one personalised check-in a day, never more. Your device will then ask you to confirm notification permission.",
      );
      if (!allowed) return;
      const result = await optInToBoneBuddyPush(userId);
      if (result.ok) {
        setBoneBuddyOptedIn(true);
      } else {
        const copy = PUSH_ERROR_COPY[result.reason] ?? {
          title: "Couldn't turn that on",
          body: "Please try again shortly.",
        };
        Alert.alert(copy.title, copy.body);
        setBoneBuddyOptedIn(false);
      }
    } else {
      await optOutOfBoneBuddyPush(userId);
      setBoneBuddyOptedIn(false);
    }
  }

  async function handleReminderToggle(id: ReminderId, next: boolean) {
    if (!user?.id || pendingReminder) return;
    if (next) {
      const label = NOTIFICATION_SETTINGS.find((n) => n.id === id)?.label ?? "This reminder";
      const allowed = await confirmNotificationIntent(
        `Turn on ${label}?`,
        Platform.OS === "web"
          ? "Your browser will then ask you to confirm."
          : "Your device will then ask you to confirm notification permission.",
      );
      if (!allowed) return;
    }
    setPendingReminder(id);
    const previous = settings;
    setSettings((current) => ({ ...current, [id]: next }));
    try {
      const result = await updateReminderPreference(user.id, id, next);
      setSettings(result.settings);
      if (!result.ok) {
        Alert.alert(
          result.reason === "permission_denied"
            ? "Notification permission off"
            : "Couldn't schedule reminder",
          result.reason === "permission_denied"
            ? "Allow notifications in iPhone Settings, then try again."
            : "Please try again in a moment.",
        );
      }
    } catch {
      setSettings(previous);
      Alert.alert("Couldn't save reminder", "Please try again in a moment.");
    } finally {
      setPendingReminder(null);
    }
  }

  const isPwaInstalled =
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true);

  const boneBuddyDesc =
    Platform.OS === "web"
      ? isPwaInstalled
        ? "One personalised check-in a day, delivered right to your browser."
        : "Install SNAP Life to your home screen first, then come back here to turn on daily nudges. Works on Android and iOS 16.4+."
      : "One personalised check-in a day, never more. Bone Buddy may message you when a small reset would help — quiet, calm, and turn-off-able anytime.";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Notifications</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 20 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          BONE BUDDY
        </Text>
        <Card variant="outlined" style={{ marginBottom: 24 }}>
          <View style={styles.row}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={[styles.label, { color: colors.foreground }]}>
                Daily Bone Buddy nudge
              </Text>
              <Text style={[styles.desc, { color: colors.mutedForeground }]}>
                {boneBuddyDesc}
              </Text>
            </View>
            <Switch
              value={boneBuddyOptedIn}
              disabled={boneBuddyPending}
              onValueChange={handleBoneBuddyToggle}
              trackColor={{ false: colors.muted, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
        </Card>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          OTHER REMINDERS
        </Text>
        <Card variant="outlined">
          {NOTIFICATION_SETTINGS.map((n, i) => (
            <View
              key={n.id}
              style={[
                styles.row,
                i < NOTIFICATION_SETTINGS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
              ]}
            >
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={[styles.label, { color: colors.foreground }]}>{n.label}</Text>
                <Text style={[styles.desc, { color: colors.mutedForeground }]}>{n.description}</Text>
              </View>
              <Switch
                value={settings[n.id]}
                disabled={pendingReminder !== null}
                onValueChange={(v) => void handleReminderToggle(n.id, v)}
                trackColor={{ false: colors.muted, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
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
  content: { padding: 16 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 4,
  },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 14, paddingHorizontal: 16 },
  label: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  desc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
});
