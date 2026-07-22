// Reliable executor — persists the request as a durable SUBMIT event before the
// kernel runs, so a crashed/incomplete transaction can be resumed later purely
// from the journal (the RecoveryWorker replays it by txId). Thin wrapper; adds
// no business logic.

export class ReliableExecutor {
  constructor({ kernel, journal, clock } = {}) {
    if (!kernel || !journal) throw new Error('ReliableExecutor requires { kernel, journal }');
    this.kernel = kernel;
    this.journal = journal;
    this.clock = clock || (() => Date.now());
  }

  async submit(request, { txId } = {}) {
    if (!txId) throw new Error('submit requires an explicit txId (idempotency key)');
    await this.journal.append(txId, 'SUBMIT', { request }, this.clock());
    return this.kernel.execute(request, { txId });
  }
}
