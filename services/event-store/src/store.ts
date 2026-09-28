<persisted-output>
Output too large (53.5KB). Full output saved to: /home/z/my-project/tool-results/read_1790599453404_60ce39fdc695.txt

Preview (first 2KB):
/**
 *
 * APPEND-ONLY CONTRACT (structural + documented): the store exposes NO API
 * that can mutate committed history — `commit` and `appendCorrections`
 * append, every other method is a pure read. Stored events and corrections
 * are deep-frozen; the commit log is the single source of truth and
 * `replayCommitLog` rebuilds identical state from it.
 *
 * L4 POINT-IN-TIME TRUTH: `event_time`/`source_time`/`available_time` are
 * preserved EXACTLY as received; `ingestion_time` is STAMPED at commit from
 * the configured commit clock — never earlier. Window queries filter on
 * `available_time` (inclusive boundaries), NEVER on `event_time`.
 *
 * DETERMINISM: commits are a pure fold over (events, batchMeta) sequences
 * and the configured clock — same input in the same order with the same
 * config yields identical state (snapshot deep-equal, provable). Commit ids
 * derive from the monotonic commit sequence (`cmt-00000001`, ...).
 *
 * L9 LINEAGE: every stored event keeps provenance (origin, adapter,
 * derived_from, transform) plus a stamped custody chain (adapter ->
 * ingestion batch -> store commit); the store answers lineage queries
 * (ancestors/roots/depth) and latest-correction status.
 *
 * L13/L14 PROVIDER NEUTRALITY: the store knows envelopes, quartets,
 * sequences and provenance — nothing vendor-specific.
 */

import {
  isNonEmptyString,
  isNonNegativeSafeInteger,
  isRecord,
  type BatchId,
  type CommitId,
  type CorrectionId,
  type EventId,
  type InstrumentId,
  type VenueId,
} from './fields';
import type { StoreError } from './fields';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type { EventType } from './taxonomy';
...
</persisted-output>