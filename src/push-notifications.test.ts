import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadOrCreateVapidKeys,
  addPushSubscription,
  removePushSubscription,
  listPushSubscriptions,
  sendBellPush,
  BellPushDebouncer,
  vapidKeysFilePath,
  type VapidKeys,
  type PushSubscriptionRecord,
} from "./push-notifications.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tmux-web-push-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const SUBSCRIPTION_A: PushSubscriptionRecord = {
  endpoint: "https://push.example.com/a",
  keys: { p256dh: "p256dh-a", auth: "auth-a" },
};

const SUBSCRIPTION_B: PushSubscriptionRecord = {
  endpoint: "https://push.example.com/b",
  keys: { p256dh: "p256dh-b", auth: "auth-b" },
};

test("loadOrCreateVapidKeys generates and persists a key pair on first call", async () => {
  await withTempDir(async (dir) => {
    let generateCalls = 0;
    const generate = () => {
      generateCalls++;
      return { publicKey: "pub", privateKey: "priv" };
    };

    const keys = await loadOrCreateVapidKeys(dir, generate);

    assert.deepEqual(keys, { publicKey: "pub", privateKey: "priv" });
    assert.equal(generateCalls, 1);
    const onDisk = JSON.parse(await readFile(vapidKeysFilePath(dir), "utf-8")) as VapidKeys;
    assert.deepEqual(onDisk, { publicKey: "pub", privateKey: "priv" });
  });
});

test("loadOrCreateVapidKeys returns the persisted pair on subsequent calls, without regenerating", async () => {
  await withTempDir(async (dir) => {
    let generateCalls = 0;
    const generate = () => {
      generateCalls++;
      return { publicKey: `pub-${generateCalls}`, privateKey: `priv-${generateCalls}` };
    };

    const first = await loadOrCreateVapidKeys(dir, generate);
    const second = await loadOrCreateVapidKeys(dir, generate);

    assert.deepEqual(second, first);
    assert.equal(generateCalls, 1);
  });
});

test("addPushSubscription then listPushSubscriptions round-trips a subscription", async () => {
  await withTempDir(async (dir) => {
    await addPushSubscription(dir, SUBSCRIPTION_A);

    const subscriptions = await listPushSubscriptions(dir);

    assert.deepEqual(subscriptions, [SUBSCRIPTION_A]);
  });
});

test("addPushSubscription replaces an existing record with the same endpoint instead of duplicating it", async () => {
  await withTempDir(async (dir) => {
    await addPushSubscription(dir, SUBSCRIPTION_A);
    const updated: PushSubscriptionRecord = { ...SUBSCRIPTION_A, keys: { p256dh: "new", auth: "new" } };
    await addPushSubscription(dir, updated);

    const subscriptions = await listPushSubscriptions(dir);

    assert.deepEqual(subscriptions, [updated]);
  });
});

test("removePushSubscription removes only the matching endpoint", async () => {
  await withTempDir(async (dir) => {
    await addPushSubscription(dir, SUBSCRIPTION_A);
    await addPushSubscription(dir, SUBSCRIPTION_B);

    await removePushSubscription(dir, SUBSCRIPTION_A.endpoint);

    const subscriptions = await listPushSubscriptions(dir);
    assert.deepEqual(subscriptions, [SUBSCRIPTION_B]);
  });
});

test("listPushSubscriptions returns an empty array when nothing has ever subscribed", async () => {
  await withTempDir(async (dir) => {
    const subscriptions = await listPushSubscriptions(dir);
    assert.deepEqual(subscriptions, []);
  });
});

const VAPID_DETAILS = { subject: "mailto:test@localhost", publicKey: "pub", privateKey: "priv" };

test("sendBellPush sends to every subscription independently", async () => {
  await withTempDir(async (dir) => {
    await addPushSubscription(dir, SUBSCRIPTION_A);
    await addPushSubscription(dir, SUBSCRIPTION_B);

    const calls: Array<{ endpoint: string; payload: string }> = [];
    const sendPush = async (subscription: PushSubscriptionRecord, payload: string) => {
      calls.push({ endpoint: subscription.endpoint, payload });
    };

    await sendBellPush(dir, VAPID_DETAILS, { title: "🔔 feature-x needs you", body: "tmux-web" }, sendPush);

    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls.map((c) => c.endpoint).sort(),
      [SUBSCRIPTION_A.endpoint, SUBSCRIPTION_B.endpoint],
    );
    assert.deepEqual(JSON.parse(calls[0].payload), { title: "🔔 feature-x needs you", body: "tmux-web" });
  });
});

test("sendBellPush is a no-op when there are no subscriptions", async () => {
  await withTempDir(async (dir) => {
    let sendPushCalled = false;
    const sendPush = async () => {
      sendPushCalled = true;
    };

    await sendBellPush(dir, VAPID_DETAILS, { title: "t", body: "b" }, sendPush);

    assert.equal(sendPushCalled, false);
  });
});

test("sendBellPush drops a subscription that comes back 410 Gone, but keeps the others", async () => {
  await withTempDir(async (dir) => {
    await addPushSubscription(dir, SUBSCRIPTION_A);
    await addPushSubscription(dir, SUBSCRIPTION_B);

    const sendPush = async (subscription: PushSubscriptionRecord) => {
      if (subscription.endpoint === SUBSCRIPTION_A.endpoint) {
        throw Object.assign(new Error("gone"), { statusCode: 410 });
      }
    };

    await sendBellPush(dir, VAPID_DETAILS, { title: "t", body: "b" }, sendPush);

    const remaining = await listPushSubscriptions(dir);
    assert.deepEqual(remaining, [SUBSCRIPTION_B]);
  });
});

test("sendBellPush keeps a subscription that fails with a non-gone error", async () => {
  await withTempDir(async (dir) => {
    await addPushSubscription(dir, SUBSCRIPTION_A);

    const sendPush = async () => {
      throw new Error("temporary network error");
    };

    await sendBellPush(dir, VAPID_DETAILS, { title: "t", body: "b" }, sendPush);

    const remaining = await listPushSubscriptions(dir);
    assert.deepEqual(remaining, [SUBSCRIPTION_A]);
  });
});

test("BellPushDebouncer allows the first send for a session and blocks a second one within the cooldown", () => {
  let now = 1_000;
  const debouncer = new BellPushDebouncer(30_000, () => now);

  assert.equal(debouncer.shouldSend("proj__feature-x"), true);
  now += 5_000;
  assert.equal(debouncer.shouldSend("proj__feature-x"), false);
});

test("BellPushDebouncer allows a send again once the cooldown has elapsed", () => {
  let now = 1_000;
  const debouncer = new BellPushDebouncer(30_000, () => now);

  assert.equal(debouncer.shouldSend("proj__feature-x"), true);
  now += 30_000;
  assert.equal(debouncer.shouldSend("proj__feature-x"), true);
});

test("BellPushDebouncer tracks cooldowns independently per session", () => {
  let now = 1_000;
  const debouncer = new BellPushDebouncer(30_000, () => now);

  assert.equal(debouncer.shouldSend("proj__feature-x"), true);
  assert.equal(debouncer.shouldSend("proj__feature-y"), true);
});
