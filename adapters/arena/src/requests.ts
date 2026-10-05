/**
 * @tradrl/adapter-arena — documented wire request construction.
 *
 * The neutrality contract pins HOW requests travel: the session passes
 * the raw request frame through the transport UNMANGLED (pass-through,
 * like the SDK's subscription frames). Therefore the CONSTRUCTION lives
 * here, as pure exported helpers: callers build the documented Arena
 * wire frames and the matching channel subscription, and the session
 * carries both verbatim.
 *
 * The documented shapes (the Arena wire's request API):
 *   - the channel SUBSCRIBE frame: { action: "SUBSCRIBE", stream:
 *     <stream>, sinceRevision: <n> } — the wire delivers the stream's
 *     messages from the declared revision onward;
 *   - the routed capability-request frame: built by ../routing.ts (the
 *     pure translation of a platform capability request).
 */

import { failure, protocolError, success, type SdkResult } from './contract/errors';
import type { JsonObject } from './contract/json';
import type { ChannelSubscription } from './contract/session';
import { ARENA_CHANNEL_TABLE_IDS } from './mapping-tables';

/** The adapter's raw channel ids (documented Arena wire channels). */
export type ArenaChannel = 'arenaCatalog' | 'arenaQuotes' | 'arenaDeliveries';

/**
 * Build the documented SUBSCRIBE frame for one wire stream from a
 * declared catalog revision. Total: the revision must be a positive
 * safe integer (the wire delivers from that revision onward).
 */
export function arenaSubscribeRequest(stream: ArenaChannel, sinceRevision: number): SdkResult<JsonObject> {
  if (!/^[a-z][a-zA-Z]*$/.test(stream)) {
    return failure(protocolError('invalid_configuration', `the SUBSCRIBE stream name "${stream}" must be the documented stream name`));
  }
  if (typeof sinceRevision !== 'number' || !Number.isSafeInteger(sinceRevision) || sinceRevision < 1) {
    return failure(protocolError('invalid_configuration', 'the SUBSCRIBE sinceRevision must be a positive safe integer (the catalog revision to replay from)'));
  }
  return success({ action: 'SUBSCRIBE', stream, sinceRevision });
}

/**
 * Build a complete channel subscription for one wire stream: the
 * documented SUBSCRIBE frame plus the declared mapping table binding.
 * The frame travels through the transport UNMANGLED.
 */
export function arenaSubscription(args: { readonly channel: ArenaChannel; readonly sinceRevision: number }): SdkResult<ChannelSubscription> {
  const request = arenaSubscribeRequest(args.channel, args.sinceRevision);
  if (!request.ok) return request;
  const tableId = ARENA_CHANNEL_TABLE_IDS[args.channel];
  if (tableId === undefined) {
    return failure(protocolError('invalid_configuration', `channel "${args.channel}" has no declared mapping table`));
  }
  return success({
    channel: args.channel,
    request: request.value,
    mapping_table_id: tableId,
  });
}
