// Tenant-scoped portfolio reads (Stage 18). Every method takes the caller's principalId and
// only ever returns that principal's rows; another tenant's account looks like "not found".
import { PortfolioError } from './errors.mjs';

const PRN_RE = /^prn_[A-Za-z0-9_]{1,64}$/;

export class PortfolioReadService {
  #store; #accounts;
  constructor({ store, accounts }) {
    if (!store || typeof accounts?.get !== 'function') throw new PortfolioError('CONFIG', 'PortfolioReadService needs store and accounts');
    this.#store = store; this.#accounts = accounts;
  }
  async #scope(principalId, brokerAccountId) {
    if (!PRN_RE.test(principalId ?? '')) throw new PortfolioError('INVALID', 'principalId required');
    if (brokerAccountId) {
      const a = await this.#accounts.get(brokerAccountId);
      if (!a || a.principalId !== principalId) throw new PortfolioError('NOT_FOUND', 'broker account not found');
    }
  }
  async positions(principalId, { brokerAccountId = null, mode = null } = {}) { await this.#scope(principalId, brokerAccountId); return this.#store.positions(principalId, { brokerAccountId, mode }); }
  async snapshots(principalId, { brokerAccountId = null, limit = 50 } = {}) { await this.#scope(principalId, brokerAccountId); return this.#store.snapshots(principalId, { brokerAccountId, limit }); }
  async reconciliationEvents(principalId, { brokerAccountId = null, mode = null, limit = 50 } = {}) { await this.#scope(principalId, brokerAccountId); return this.#store.reconciliationEvents(principalId, { brokerAccountId, mode, limit }); }
}
