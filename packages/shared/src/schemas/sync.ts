import { z } from "zod";

// @intent shared/sync/action-vocabulary [action-unlisted-value]
export const SyncActionSchema = z.enum(["created", "updated", "deleted"]);
export type SyncAction = z.infer<typeof SyncActionSchema>;

// @intent shared/sync/event-shape [three-fields-only, timestamp-epoch-ms]
// @intent shared/sync/payload-opacity [no-payload-inspection, no-payload-transformation]
export const SyncEventSchema = z
  .object({
    action: SyncActionSchema,
    data: z.unknown(),
    timestamp: z.number().int().nonnegative(),
  })
  .strict();
type BaseSyncEvent = z.infer<typeof SyncEventSchema>;
export type SyncEvent<T = unknown> = Omit<BaseSyncEvent, "data"> & { data: T };

// @intent shared/sync/channel-naming [channel-name-derivation]
export function syncChannel(entity: string): string {
  // @intent shared/sync/channel-naming [channel-name-derivation]
  return `sync:${entity}`;
}
