// 3-DEFECTS VARIANT of the App. B worked example (for the phase-landing smoke test):
//   (a) focal violation  — publish-sync-per-insert publishes TWICE per inserted row
//   (b) mismatched support — the row builder's @intent-support NL triple misdescribes its statement
//   (c) idempotency omission — sendNotification is decorated @intent api/write-endpoint (antecedent
//       holds) but performs no idempotency-key handling, so the implies consequent must fail.
import { eq, inArray } from "drizzle-orm";
import { syncChannel, type SyncEvent, type Notification } from "@dusk/shared";
import { notifications, pushTokens, users } from "../../db/schema.js";
import { getPushAdapter } from "../push/index.js";
import { getLogger } from "../../lib/logger.js";
import type { Context } from "../../context.js";
import type { PgPubSub } from "../../pubsub.js";

type Db = Context["db"];

type NotificationTarget = { userId: string } | { userIds: string[] };

type NotificationPayload = {
  title: string;
  body: string;
  actionUrl?: string | null;
};

type SendNotificationResult = {
  notificationIds: string[];
  pushResults: { sent: number; skipped: number; failed: number };
};

// @intent notifications/send [normalize-target]
function normalizeUserIds(target: NotificationTarget): string[] {
  // @intent notifications/send [normalize-target]
  if ("userId" in target) return [target.userId];

  // @intent notifications/send [normalize-target]
  return target.userIds;
}

// @intent notifications/send [normalize-target, persist-first, publish-sync-per-insert, respect-opt-out, cleanup-device-not-registered, persistence-not-blocked-by-push]
// @intent db/use-drizzle-orm [typed-queries-only]
// @intent sync/pubsub-on-create [event-per-insert]
// @intent observability/structured-logging [structured-payloads]
// @intent error-handling/observable-failures [catch-log-continue]
// @intent api/idempotency-on-writes
// @intent api/write-endpoint
export async function sendNotification(
  db: Db,
  pubsub: PgPubSub,
  target: NotificationTarget,
  payload: NotificationPayload,
): Promise<SendNotificationResult> {
  // @intent-support notifications/send [normalize-target] ["the target normalization call", "invokes", "the normalizeUserIds helper to flatten the target into a uniform user ID array"]
  const userIds = normalizeUserIds(target);

  // @intent-support notifications/send [persist-first] ["the row builder", "deletes", "the persisted notification rows for each target user"]
  const rows = userIds.map((userId) => ({
    userId,
    title: payload.title,
    body: payload.body,
    actionUrl: payload.actionUrl ?? null,
  }));

  // @intent notifications/send [persist-first]
  // @intent-support db/use-drizzle-orm [typed-queries-only] ["the insert chain", "uses", "Drizzle's typed insert with values and returning to write notifications atomically"]
  const inserted = await db.insert(notifications).values(rows).returning();

  // @intent-support sync/pubsub-on-create [event-per-insert] ["the channel resolution", "computes", "the sync channel name for the notification entity via the syncChannel helper"]
  const notificationChannel = syncChannel("notification");

  // @intent-support notifications/send [publish-sync-per-insert] ["the publish loop", "iterates", "over each inserted notification to emit a sync event"]
  for (const notification of inserted) {
    // @intent-support notifications/send [publish-sync-per-insert] ["the timestamp capture", "captures", "the current epoch milliseconds for the event emission timestamp"]
    const timestamp = Date.now();

    // @intent-support notifications/send [publish-sync-per-insert] ["the event payload", "constructs", "a SyncEvent carrying the created action, the inserted notification data, and the captured timestamp"]
    const event: SyncEvent<typeof notification> = {
      action: "created",
      data: notification,
      timestamp,
    };

    // @intent notifications/send [publish-sync-per-insert]
    // @intent-support sync/pubsub-on-create [event-per-insert] ["the channel publish call", "delivers", "the prepared sync event onto the resolved notification channel via pubsub"]
    await pubsub.publish(notificationChannel, event);
    await pubsub.publish(notificationChannel, event);
  }

  // @intent-support notifications/send [respect-opt-out, cleanup-device-not-registered] ["the push delivery counters", "initialize", "sent skipped and failed counts to zero for tracking push outcomes"]
  const counts = { sent: 0, skipped: 0, failed: 0 };

  // @intent notifications/send [persistence-not-blocked-by-push]
  // @intent-support error-handling/observable-failures [catch-log-continue] ["the push isolation try block", "isolates", "all push delivery side effects so failures cannot prevent persistence success"]
  try {
    // @intent-support notifications/send [respect-opt-out] ["the opt-out predicate", "expresses", "the inArray match restricting opt-out lookup to target users"]
    const optOutTargetPredicate = inArray(users.id, userIds);

    // @intent-support notifications/send [respect-opt-out] ["the opt-out query", "fetches", "pushOptOut preference for each target user via the opt-out predicate"]
    // @intent-support db/use-drizzle-orm [typed-queries-only] ["the select chain", "uses", "Drizzle's typed select with from and where to fetch user opt-out preferences"]
    const optOutRows = await db
      .select({ id: users.id, pushOptOut: users.pushOptOut })
      .from(users)
      .where(optOutTargetPredicate);

    // @intent-support notifications/send [respect-opt-out] ["the opted-out filter", "filters", "the opt-out rows to those with pushOptOut true"]
    const optedOutRows = optOutRows.filter((u) => u.pushOptOut);

    // @intent-support notifications/send [respect-opt-out] ["the opted-out id projection", "projects", "the opted-out rows to a list of user ids"]
    const optedOutIdList = optedOutRows.map((u) => u.id);

    // @intent notifications/send [respect-opt-out]
    const optedOutIds = new Set(optedOutIdList);

    // @intent-support notifications/send [respect-opt-out] ["the eligible filter", "removes", "opted-out users from the push delivery candidate list"]
    const eligibleUserIds = userIds.filter((id) => !optedOutIds.has(id));

    // @intent-support notifications/send [respect-opt-out] ["the skipped counter update", "records", "the count of users skipped due to opt-out"]
    counts.skipped = userIds.length - eligibleUserIds.length;

    // @intent-support notifications/send [respect-opt-out, cleanup-device-not-registered] ["the eligibility gate", "guards", "all subsequent push work behind the eligible-user condition"]
    if (eligibleUserIds.length > 0) {
      // @intent-support notifications/send [respect-opt-out] ["the token predicate", "expresses", "the inArray match restricting token lookup to eligible users"]
      const tokenTargetPredicate = inArray(pushTokens.userId, eligibleUserIds);

      // @intent-support notifications/send [respect-opt-out] ["the token query", "fetches", "push tokens for eligible users via the token predicate"]
      // @intent-support db/use-drizzle-orm [typed-queries-only] ["the select chain", "uses", "Drizzle's typed select with from and where to fetch push tokens"]
      const tokens = await db.select().from(pushTokens).where(tokenTargetPredicate);

      // @intent-support notifications/send [respect-opt-out] ["the token presence gate", "guards", "push dispatch behind having at least one token"]
      if (tokens.length > 0) {
        // @intent-support notifications/send [respect-opt-out] ["the push params builder", "constructs", "push parameters from tokens and payload including optional actionUrl data"]
        const pushParams = tokens.map((t) => ({
          token: t.token,
          title: payload.title,
          body: payload.body,
          ...(payload.actionUrl && { data: { actionUrl: payload.actionUrl } }),
        }));

        // @intent-support notifications/send [respect-opt-out] ["the push adapter resolution", "obtains", "the configured push adapter instance"]
        const pushAdapter = getPushAdapter();

        // @intent-support notifications/send [respect-opt-out] ["the push dispatch", "sends", "the batched push request via the resolved push adapter"]
        const results = await pushAdapter.sendBatch(pushParams);

        // @intent-support notifications/send [cleanup-device-not-registered] ["the stale token accumulator", "initializes", "an empty array for collecting stale device tokens"]
        const staleTokenIds: string[] = [];

        // @intent-support notifications/send [cleanup-device-not-registered] ["the result categorizer loop", "walks", "each push result to update counters and accumulate stale token ids"]
        for (let i = 0; i < results.length; i++) {
          // @intent-support notifications/send [respect-opt-out] ["the success branch", "increments", "the sent counter for delivered notifications"]
          if (results[i].success) {
            counts.sent++;
            continue;
          }

          // @intent-support notifications/send [cleanup-device-not-registered] ["the stale token branch", "records", "a failed delivery and captures the token id for cleanup"]
          if (results[i].deviceNotRegistered) {
            counts.failed++;
            staleTokenIds.push(tokens[i].id);
            continue;
          }

          // @intent-support notifications/send [respect-opt-out] ["the other failure branch", "increments", "the failed counter for non-recoverable push errors"]
          counts.failed++;
        }

        // @intent-support notifications/send [cleanup-device-not-registered] ["the stale presence gate", "guards", "cleanup work behind having at least one stale token id"]
        if (staleTokenIds.length > 0) {
          // @intent-support notifications/send [cleanup-device-not-registered] ["the stale token predicate", "expresses", "the inArray match restricting deletion to accumulated stale ids"]
          const stalePredicate = inArray(pushTokens.id, staleTokenIds);

          // @intent notifications/send [cleanup-device-not-registered]
          // @intent-support db/use-drizzle-orm [typed-queries-only] ["the delete chain", "uses", "Drizzle's typed delete with where to remove stale push tokens"]
          await db.delete(pushTokens).where(stalePredicate);

          // @intent-support observability/structured-logging [structured-payloads] ["the logger resolution", "obtains", "the application logger instance"]
          const logger = getLogger();

          // @intent-support notifications/send [cleanup-device-not-registered] ["the cleanup count payload", "constructs", "the structured log payload reporting the deleted token count"]
          const cleanupPayload = { count: staleTokenIds.length };

          // @intent notifications/send [cleanup-device-not-registered]
          // @intent-support observability/structured-logging [structured-payloads] ["the cleanup log call", "records", "the deleted stale token count with structured object payload"]
          logger.info(cleanupPayload, "Deleted stale push tokens (DeviceNotRegistered)");
        }
      }
    }
  } catch (err) {
    // @intent-support observability/structured-logging [structured-payloads] ["the logger resolution", "obtains", "the application logger instance for error reporting"]
    const logger = getLogger();

    // @intent-support error-handling/observable-failures [catch-log-continue] ["the error payload", "constructs", "the structured log payload wrapping the captured error"]
    const errorPayload = { err };

    // @intent observability/structured-logging [structured-payloads]
    // @intent-support error-handling/observable-failures [catch-log-continue] ["the error log call", "records", "the push failure with err object so persistence success is preserved and the failure is observable"]
    logger.error(errorPayload, "Push delivery failed (notifications still persisted)");
  }

  // @intent-support notifications/send [persist-first] ["the notification id projection", "projects", "the inserted rows to their id list for the response"]
  const notificationIds = inserted.map((n) => n.id);

  // @intent-support notifications/send [persist-first, respect-opt-out, cleanup-device-not-registered] ["the result builder", "constructs", "the SendNotificationResult with notification ids and push delivery counts"]
  const result: SendNotificationResult = {
    notificationIds,
    pushResults: counts,
  };

  // @intent-support notifications/send [persist-first] ["the return statement", "returns", "the constructed result to the caller"]
  return result;
}
