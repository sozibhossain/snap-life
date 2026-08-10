import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export type ReminderId =
  | "supplements"
  | "activity"
  | "challenges"
  | "achievements"
  | "streak"
  | "reports";

export type ReminderSettings = Record<ReminderId, boolean>;

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  supplements: false,
  activity: false,
  challenges: false,
  achievements: false,
  streak: false,
  reports: false,
};

interface StoredReminderState {
  settings: ReminderSettings;
  scheduledIds: Partial<Record<ReminderId, string>>;
}

const STORAGE_PREFIX = "@snaplife/reminders/v2:";
const CHANNEL_ID = "snap-reminders";

function keyFor(appUserId: string): string {
  return `${STORAGE_PREFIX}${appUserId}`;
}

function normalise(value: unknown): StoredReminderState {
  const input = value && typeof value === "object"
    ? value as Partial<StoredReminderState>
    : {};
  return {
    settings: {
      ...DEFAULT_REMINDER_SETTINGS,
      ...(input.settings ?? {}),
    },
    scheduledIds:
      input.scheduledIds && typeof input.scheduledIds === "object"
        ? input.scheduledIds
        : {},
  };
}

async function loadState(appUserId: string): Promise<StoredReminderState> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(appUserId));
    return normalise(raw ? JSON.parse(raw) : null);
  } catch {
    return normalise(null);
  }
}

async function saveState(appUserId: string, state: StoredReminderState) {
  await AsyncStorage.setItem(keyFor(appUserId), JSON.stringify(state));
}

export async function loadReminderSettings(
  appUserId: string | null | undefined,
): Promise<ReminderSettings> {
  if (!appUserId) return { ...DEFAULT_REMINDER_SETTINGS };
  return (await loadState(appUserId)).settings;
}

const CONTENT: Record<ReminderId, Notifications.NotificationContentInput> = {
  supplements: {
    title: "Supplement check-in",
    body: "A gentle reminder to take the supplements or medication you have scheduled today.",
    sound: "default",
    data: { route: "/health/supplements", kind: "supplements" },
  },
  activity: {
    title: "A little movement goes a long way",
    body: "Check your activity goal and add a few safe minutes of movement if you can.",
    sound: "default",
    data: { route: "/health/activity", kind: "activity" },
  },
  challenges: {
    title: "Your SNAP challenge",
    body: "Open SNAP Life to see what small action can move your challenge forward today.",
    sound: "default",
    data: { route: "/(tabs)", kind: "challenges" },
  },
  achievements: {
    title: "Your progress matters",
    body: "You may have a new SNAP achievement waiting. Take a look at your progress.",
    sound: "default",
    data: { route: "/(tabs)/profile", kind: "achievements" },
  },
  streak: {
    title: "Keep your gentle streak going",
    body: "One small check-in today is enough to keep your momentum moving.",
    sound: "default",
    data: { route: "/(tabs)", kind: "streak" },
  },
  reports: {
    title: "Your weekly SNAP summary is ready",
    body: "See your bone-health trends, consistency and progress from the last seven days.",
    sound: "default",
    data: { route: "/insights", kind: "reports" },
  },
};

function triggerFor(id: ReminderId): Notifications.NotificationTriggerInput {
  const daily = (hour: number, minute: number): Notifications.DailyTriggerInput => ({
    type: Notifications.SchedulableTriggerInputTypes.DAILY,
    hour,
    minute,
    ...(Platform.OS === "android" ? { channelId: CHANNEL_ID } : {}),
  });
  switch (id) {
    case "supplements": return daily(9, 0);
    case "activity": return daily(18, 0);
    case "challenges": return daily(17, 0);
    case "achievements": return daily(20, 0);
    case "streak": return daily(19, 30);
    case "reports":
      return {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: 2,
        hour: 9,
        minute: 0,
        ...(Platform.OS === "android" ? { channelId: CHANNEL_ID } : {}),
      };
  }
}

export type ReminderUpdateResult =
  | { ok: true; settings: ReminderSettings }
  | { ok: false; reason: "permission_denied" | "schedule_failed"; settings: ReminderSettings };

export async function updateReminderPreference(
  appUserId: string,
  id: ReminderId,
  enabled: boolean,
): Promise<ReminderUpdateResult> {
  const state = await loadState(appUserId);
  const previousId = state.scheduledIds[id];

  if (previousId && Platform.OS !== "web") {
    await Notifications.cancelScheduledNotificationAsync(previousId).catch(() => undefined);
    delete state.scheduledIds[id];
  }

  if (enabled && Platform.OS !== "web") {
    let permission = await Notifications.getPermissionsAsync();
    if (permission.status !== "granted") {
      permission = await Notifications.requestPermissionsAsync();
    }
    if (permission.status !== "granted") {
      state.settings[id] = false;
      await saveState(appUserId, state).catch(() => undefined);
      return { ok: false, reason: "permission_denied", settings: state.settings };
    }

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: "SNAP reminders",
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: "default",
        showBadge: true,
      });
    }

    try {
      state.scheduledIds[id] = await Notifications.scheduleNotificationAsync({
        content: CONTENT[id],
        trigger: triggerFor(id),
      });
    } catch {
      state.settings[id] = false;
      await saveState(appUserId, state).catch(() => undefined);
      return { ok: false, reason: "schedule_failed", settings: state.settings };
    }
  }

  state.settings[id] = enabled;
  await saveState(appUserId, state);
  return { ok: true, settings: state.settings };
}

