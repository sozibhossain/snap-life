import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const notificationMocks = vi.hoisted(() => ({
  permissionStatus: "granted",
  schedule: vi.fn(),
  cancel: vi.fn(),
  request: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
  },
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

vi.mock("expo-notifications", () => ({
  SchedulableTriggerInputTypes: { DAILY: "daily", WEEKLY: "weekly" },
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: async () => ({ status: notificationMocks.permissionStatus }),
  requestPermissionsAsync: notificationMocks.request,
  scheduleNotificationAsync: notificationMocks.schedule,
  cancelScheduledNotificationAsync: notificationMocks.cancel,
  setNotificationChannelAsync: vi.fn(),
}));

const { loadReminderSettings, updateReminderPreference } = await import(
  "../notificationPreferences"
);

beforeEach(() => {
  store.clear();
  notificationMocks.permissionStatus = "granted";
  notificationMocks.schedule.mockReset().mockResolvedValue("scheduled-1");
  notificationMocks.cancel.mockReset().mockResolvedValue(undefined);
  notificationMocks.request.mockReset().mockResolvedValue({ status: "granted" });
});

describe("notification preferences", () => {
  it("schedules and persists the daily supplement reminder", async () => {
    const result = await updateReminderPreference("user-1", "supplements", true);
    expect(result.ok).toBe(true);
    expect(notificationMocks.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: expect.objectContaining({ type: "daily", hour: 9, minute: 0 }),
      }),
    );
    expect((await loadReminderSettings("user-1")).supplements).toBe(true);
  });

  it("schedules the weekly report for Monday at 09:00", async () => {
    await updateReminderPreference("user-1", "reports", true);
    expect(notificationMocks.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: expect.objectContaining({
          type: "weekly",
          weekday: 2,
          hour: 9,
          minute: 0,
        }),
      }),
    );
  });

  it("keeps a reminder disabled when permission is denied", async () => {
    notificationMocks.permissionStatus = "denied";
    notificationMocks.request.mockResolvedValue({ status: "denied" });
    const result = await updateReminderPreference("user-1", "activity", true);
    expect(result).toMatchObject({ ok: false, reason: "permission_denied" });
    expect((await loadReminderSettings("user-1")).activity).toBe(false);
  });

  it("cancels the prior scheduled notification when disabled", async () => {
    await updateReminderPreference("user-1", "streak", true);
    const result = await updateReminderPreference("user-1", "streak", false);
    expect(result.ok).toBe(true);
    expect(notificationMocks.cancel).toHaveBeenCalledWith("scheduled-1");
    expect((await loadReminderSettings("user-1")).streak).toBe(false);
  });

  it("does not persist enabled state when scheduling fails", async () => {
    notificationMocks.schedule.mockRejectedValue(new Error("schedule failed"));
    const result = await updateReminderPreference("user-1", "achievements", true);
    expect(result).toMatchObject({ ok: false, reason: "schedule_failed" });
    expect((await loadReminderSettings("user-1")).achievements).toBe(false);
  });
});
