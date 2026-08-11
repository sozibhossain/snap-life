import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: async (key: string) => {
      store.delete(key);
    },
  },
}));

vi.mock("../serverIdentity", () => ({
  getApiBaseUrl: () => "https://api.example.test",
}));

vi.mock("../userToken", () => ({
  authHeader: async () => ({ Authorization: "Bearer test-token" }),
}));

const { flushInteractionEvents, logInteractionEvent } = await import("../events");
const queueKey = "@snaplife/interactionEvents/v2:user-1";

beforeEach(() => {
  store.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("durable interaction event queue", () => {
  it("persists a failed event and sends it after a later retry", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    logInteractionEvent({ appUserId: "user-1", kind: "lesson_completed" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(store.has(queueKey)).toBe(true));

    const queued = JSON.parse(store.get(queueKey)!) as Array<{
      nextAttemptAtMs: number;
      body: { clientEventId: string };
    }>;
    expect(queued).toHaveLength(1);
    expect(queued[0]!.body.clientEventId.length).toBeGreaterThan(8);
    queued[0]!.nextAttemptAtMs = 0;
    store.set(queueKey, JSON.stringify(queued));

    await flushInteractionEvents("user-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.has(queueKey)).toBe(false);
  });

  it("removes an event after immediate successful delivery", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    logInteractionEvent({
      appUserId: "user-1",
      kind: "medication_taken",
      payload: { itemId: "med-1" },
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(store.has(queueKey)).toBe(false));
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(sent).toMatchObject({ kind: "medication_taken", payload: { itemId: "med-1" } });
    expect(sent.clientEventId).toEqual(expect.any(String));
  });

  it("discards a permanently invalid event instead of retrying forever", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "bad request" }), { status: 400 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    logInteractionEvent({ appUserId: "user-1", kind: "nutrition_logged" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(store.has(queueKey)).toBe(false));
  });
});
