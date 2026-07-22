// Fee Ledger — journaled, exactly-once fee record (Constitution §9, §11).
//
// Persists each FeeInstruction into the reused M1 hash-chain Journal and
// enforces exactly-once per txId:
//   - first record  -> journaled.
//   - replay (same auditHash) -> deduped, NO new journal entry (no double charge).
//   - different auditHash for the same txId -> FEE_MISMATCH (tamper / double-charge
//     attempt rejected).
// record() is synchronous, so within Node's single thread the check-then-append
// is atomic — concurrent record() calls cannot both write.

import { FeeError } from './money.js';

export class FeeLedger {
  constructor({ journal, clock } = {}) {
    if (!journal) throw new FeeError('CONFIG', 'FeeLedger requires a journal');
    this.journal = journal;
    this.clock = clock || (() => Date.now());
    this._index = new Map(); // txId -> instruction
  }

  record(instruction) {
    const txId = instruction && instruction.txId;
    if (!txId) throw new FeeError('CONFIG', 'instruction.txId required');
    if (!instruction.auditHash) throw new FeeError('CONFIG', 'instruction.auditHash required');

    const existing = this._index.get(txId);
    if (existing) {
      if (existing.auditHash !== instruction.auditHash) {
        throw new FeeError('FEE_MISMATCH', `fee already recorded for ${txId} with a different auditHash`, {
          existing: existing.auditHash, incoming: instruction.auditHash,
        });
      }
      return { deduped: true, instruction: existing };
    }

    this.journal.append(`fee:${txId}`, 'FEE', instruction, this.clock());
    this._index.set(txId, instruction);
    return { deduped: false, instruction };
  }

  get(txId) { return this._index.get(txId) || null; }

  /** Rebuild the fee index from the journal alone (replay). */
  static replay(journal) {
    const idx = new Map();
    for (const e of journal.all()) {
      if (e.phase === 'FEE' && String(e.txId).startsWith('fee:')) idx.set(e.payload.txId, e.payload);
    }
    return idx;
  }
}
