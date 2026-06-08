import { describe, it, expect } from "vitest";
import {
  enqueue,
  pickReady,
  bumpFailure,
  removeById,
  replaceById,
  buildKey,
  BACKOFF_SCHEDULE_MS,
  DEFAULT_MAX_ATTEMPTS,
  type SyncQueueItem,
} from "../syncQueue";

let counter = 0;
const idGen = () => `id-${++counter}`;

function freshCounter() {
  counter = 0;
}

describe("syncQueue.enqueue", () => {
  it("appends a new item with attempts=0 and nextAttempt=now", () => {
    freshCounter();
    const out = enqueue(
      [],
      { domain: "profile", key: "profile", method: "PUT", path: "/sync/profile", body: { a: 1 } },
      100,
      idGen,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "id-1",
      domain: "profile",
      key: "profile",
      method: "PUT",
      path: "/sync/profile",
      attempts: 0,
      enqueuedAtMs: 100,
      nextAttemptAtMs: 100,
    });
  });

  it("coalesces a second enqueue under the same key (last-write-wins)", () => {
    freshCounter();
    const q1 = enqueue(
      [],
      { domain: "profile", key: "profile", method: "PUT", path: "/sync/profile", body: { v: 1 } },
      100,
      idGen,
    );
    const q2 = enqueue(
      q1,
      { domain: "profile", key: "profile", method: "PUT", path: "/sync/profile", body: { v: 2 } },
      200,
      idGen,
    );
    expect(q2).toHaveLength(1);
    expect(q2[0].id).toBe("id-2");
    expect(q2[0].body).toEqual({ v: 2 });
    expect(q2[0].enqueuedAtMs).toBe(200);
  });

  it("keeps distinct items for distinct keys (per-day or append-only)", () => {
    freshCounter();
    let q: SyncQueueItem[] = [];
    q = enqueue(
      q,
      { domain: "nutrition", key: "nutrition:2026-05-01", method: "PUT", path: "/sync/nutrition/2026-05-01", body: {} },
      100,
      idGen,
    );
    q = enqueue(
      q,
      { domain: "nutrition", key: "nutrition:2026-05-02", method: "PUT", path: "/sync/nutrition/2026-05-02", body: {} },
      100,
      idGen,
    );
    q = enqueue(
      q,
      { domain: "wellbeing", key: "wellbeing:entry-x", method: "POST", path: "/sync/wellbeing", body: {} },
      100,
      idGen,
    );
    expect(q).toHaveLength(3);
    expect(q.map((i) => i.key)).toEqual([
      "nutrition:2026-05-01",
      "nutrition:2026-05-02",
      "wellbeing:entry-x",
    ]);
  });
});

describe("syncQueue.pickReady", () => {
  it("returns only items whose nextAttemptAtMs has elapsed", () => {
    const queue: SyncQueueItem[] = [
      {
        id: "a",
        domain: "profile",
        key: "profile",
        method: "PUT",
        path: "/sync/profile",
        body: {},
        attempts: 0,
        enqueuedAtMs: 0,
        nextAttemptAtMs: 100,
      },
      {
        id: "b",
        domain: "nutrition",
        key: "nutrition:x",
        method: "PUT",
        path: "/sync/nutrition/x",
        body: {},
        attempts: 1,
        enqueuedAtMs: 0,
        nextAttemptAtMs: 5_000,
      },
    ];
    expect(pickReady(queue, 100).map((i) => i.id)).toEqual(["a"]);
    expect(pickReady(queue, 99).map((i) => i.id)).toEqual([]);
    expect(pickReady(queue, 5_000).map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("syncQueue.bumpFailure", () => {
  function makeItem(attempts: number): SyncQueueItem {
    return {
      id: "x",
      domain: "profile",
      key: "profile",
      method: "PUT",
      path: "/sync/profile",
      body: {},
      attempts,
      enqueuedAtMs: 0,
      nextAttemptAtMs: 0,
    };
  }

  it("first failure schedules the next attempt at now + 1s and increments attempts", () => {
    const out = bumpFailure(makeItem(0), 10_000);
    expect(out).not.toBeNull();
    expect(out!.attempts).toBe(1);
    expect(out!.nextAttemptAtMs).toBe(10_000 + BACKOFF_SCHEDULE_MS[0]);
  });

  it("steps through the backoff schedule", () => {
    expect(bumpFailure(makeItem(1), 0)!.nextAttemptAtMs).toBe(BACKOFF_SCHEDULE_MS[1]);
    expect(bumpFailure(makeItem(2), 0)!.nextAttemptAtMs).toBe(BACKOFF_SCHEDULE_MS[2]);
    expect(bumpFailure(makeItem(3), 0)!.nextAttemptAtMs).toBe(BACKOFF_SCHEDULE_MS[3]);
    expect(bumpFailure(makeItem(4), 0)!.nextAttemptAtMs).toBe(BACKOFF_SCHEDULE_MS[4]);
  });

  it("clamps the backoff at the last entry", () => {
    expect(bumpFailure(makeItem(99), 0, 1000)!.nextAttemptAtMs).toBe(
      BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1],
    );
  });

  it("returns null after the configured max attempts (drop)", () => {
    expect(bumpFailure(makeItem(DEFAULT_MAX_ATTEMPTS - 1), 0)).toBeNull();
  });

  it("respects a custom maxAttempts", () => {
    expect(bumpFailure(makeItem(2), 0, 3)).toBeNull();
    expect(bumpFailure(makeItem(1), 0, 3)).not.toBeNull();
  });
});

describe("syncQueue.removeById / replaceById", () => {
  const seed: SyncQueueItem[] = [
    { id: "a", domain: "profile", key: "profile", method: "PUT", path: "/sync/profile", body: {}, attempts: 0, enqueuedAtMs: 0, nextAttemptAtMs: 0 },
    { id: "b", domain: "nutrition", key: "nutrition:x", method: "PUT", path: "/sync/nutrition/x", body: {}, attempts: 0, enqueuedAtMs: 0, nextAttemptAtMs: 0 },
  ];

  it("removeById drops a single matching item and leaves the rest", () => {
    const out = removeById(seed, "a");
    expect(out.map((i) => i.id)).toEqual(["b"]);
  });

  it("replaceById swaps a single item without changing order", () => {
    const out = replaceById(seed, "b", { ...seed[1], attempts: 5, nextAttemptAtMs: 9_999 });
    expect(out[0].id).toBe("a");
    expect(out[1]).toMatchObject({ id: "b", attempts: 5, nextAttemptAtMs: 9_999 });
  });
});

describe("syncQueue.buildKey", () => {
  it("returns the bare domain when modifier is null", () => {
    expect(buildKey("profile", null)).toBe("profile");
  });
  it("returns `${domain}:${modifier}` otherwise", () => {
    expect(buildKey("nutrition", "2026-05-02")).toBe("nutrition:2026-05-02");
  });
});
