import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import webpush from "web-push";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
}

const VAPID_KEYS_FILE_NAME = "vapid-keys.json";
const SUBSCRIPTIONS_FILE_NAME = "push-subscriptions.json";

export function vapidKeysFilePath(configDir: string): string {
  return join(configDir, VAPID_KEYS_FILE_NAME);
}

export function subscriptionsFilePath(configDir: string): string {
  return join(configDir, SUBSCRIPTIONS_FILE_NAME);
}

export type GenerateVapidKeysFn = () => VapidKeys;

function defaultGenerateVapidKeys(): VapidKeys {
  return webpush.generateVAPIDKeys();
}

// Generated once per install and persisted alongside this app's other
// runtime data (config.json, projects.json -- see config.ts's
// defaultConfigDir()), not re-derived on every start: every subscribed
// browser's PushSubscription is bound to the public key it subscribed
// against, so rotating keys on restart would silently orphan every existing
// subscription.
export async function loadOrCreateVapidKeys(
  configDir: string,
  generateVapidKeys: GenerateVapidKeysFn = defaultGenerateVapidKeys,
): Promise<VapidKeys> {
  const filePath = vapidKeysFilePath(configDir);
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<VapidKeys>;
    if (typeof parsed.publicKey === "string" && typeof parsed.privateKey === "string") {
      return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
    }
  } catch {
    // Missing or malformed -- fall through to generating a fresh pair.
  }
  const keys = generateVapidKeys();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(keys, null, 2), "utf-8");
  return keys;
}

async function loadSubscriptions(configDir: string): Promise<PushSubscriptionRecord[]> {
  try {
    const raw = await readFile(subscriptionsFilePath(configDir), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PushSubscriptionRecord[]) : [];
  } catch {
    return [];
  }
}

async function saveSubscriptions(configDir: string, subscriptions: PushSubscriptionRecord[]): Promise<void> {
  const filePath = subscriptionsFilePath(configDir);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(subscriptions, null, 2), "utf-8");
}

export const listPushSubscriptions = loadSubscriptions;

// Keyed by endpoint (unique per browser+device by construction, per the Push
// API spec) so re-subscribing the same browser (e.g. after clearing site
// data) replaces its old record instead of accumulating duplicates.
export async function addPushSubscription(configDir: string, subscription: PushSubscriptionRecord): Promise<void> {
  const subscriptions = await loadSubscriptions(configDir);
  const withoutExisting = subscriptions.filter((s) => s.endpoint !== subscription.endpoint);
  withoutExisting.push(subscription);
  await saveSubscriptions(configDir, withoutExisting);
}

export async function removePushSubscription(configDir: string, endpoint: string): Promise<void> {
  const subscriptions = await loadSubscriptions(configDir);
  await saveSubscriptions(
    configDir,
    subscriptions.filter((s) => s.endpoint !== endpoint),
  );
}

export interface VapidDetails {
  subject: string;
  publicKey: string;
  privateKey: string;
}

export type SendPushFn = (
  subscription: PushSubscriptionRecord,
  payload: string,
  vapidDetails: VapidDetails,
) => Promise<unknown>;

function defaultSendPush(
  subscription: PushSubscriptionRecord,
  payload: string,
  vapidDetails: VapidDetails,
): Promise<unknown> {
  return webpush.sendNotification(subscription, payload, { vapidDetails });
}

// A 404/410 from the push service means the browser unsubscribed or the
// subscription otherwise expired server-side -- keeping it around would
// just fail forever on every future bell, so it's dropped here instead of
// surfacing as a recurring error.
function isGoneStatus(error: unknown): boolean {
  const statusCode = (error as { statusCode?: number } | undefined)?.statusCode;
  return statusCode === 404 || statusCode === 410;
}

// Fans out to every registered subscription independently -- one browser's
// expired subscription (or any other per-subscription failure) never blocks
// delivery to the others.
export async function sendBellPush(
  configDir: string,
  vapidDetails: VapidDetails,
  payload: PushPayload,
  sendPush: SendPushFn = defaultSendPush,
): Promise<void> {
  const subscriptions = await loadSubscriptions(configDir);
  if (subscriptions.length === 0) return;

  const body = JSON.stringify(payload);
  const staleEndpoints: string[] = [];
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await sendPush(subscription, body, vapidDetails);
      } catch (error) {
        if (isGoneStatus(error)) staleEndpoints.push(subscription.endpoint);
      }
    }),
  );

  if (staleEndpoints.length > 0) {
    const remaining = subscriptions.filter((s) => !staleEndpoints.includes(s.endpoint));
    await saveSubscriptions(configDir, remaining);
  }
}

// Debounces repeated bell pushes for the same session -- the tmux `bell`
// hook (see tmux-bell-hook.ts) fires on every single BEL byte, and a busy
// command (progress bars, build output) can emit dozens per second; without
// this, every one would queue its own push to every subscribed device.
export class BellPushDebouncer {
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly lastSentAt = new Map<string, number>();

  constructor(cooldownMs: number, now: () => number = Date.now) {
    this.cooldownMs = cooldownMs;
    this.now = now;
  }

  shouldSend(sessionFullName: string): boolean {
    const now = this.now();
    const last = this.lastSentAt.get(sessionFullName);
    if (last !== undefined && now - last < this.cooldownMs) return false;
    this.lastSentAt.set(sessionFullName, now);
    return true;
  }
}
