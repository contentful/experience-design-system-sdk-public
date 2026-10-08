import type { RunRecord, RunRecordV1, RunRecordV2 } from '../types/run-record.js';

export function migrateRecord(rec: RunRecord | RunRecordV1 | RunRecordV2): RunRecord {
  return {
    ...rec,
    tokensPath: (rec as RunRecord).tokensPath ?? null,
    tokenSessionId: (rec as RunRecord).tokenSessionId ?? null,
    sourceFingerprint: (rec as RunRecord).sourceFingerprint ?? null,
  };
}
