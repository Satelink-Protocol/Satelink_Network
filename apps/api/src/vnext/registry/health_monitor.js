// Health Monitor (Constitution §5, §10).
//
// Marks suppliers OFFLINE when their heartbeat goes stale, driving them out of
// candidate selection automatically (via the registry's routable filter). It
// mutates only through the registry API, so every health change is journaled.
// Deterministic and pull-based: `evaluate()` is called explicitly (no timers),
// which keeps replay and tests reproducible.

import { SupplierStatus } from './supplier_registry.js';

export class HealthMonitor {
  constructor({ registry, clock, heartbeatTimeoutMs = 60_000 } = {}) {
    if (!registry) throw new Error('HealthMonitor requires a registry');
    this.registry = registry;
    this.clock = clock || (() => Date.now());
    this.timeout = heartbeatTimeoutMs;
  }

  /** Sweep all suppliers; auto-offline any whose heartbeat has gone stale.
   *  Returns the list of supplierIds transitioned to OFFLINE this sweep. */
  evaluate() {
    const now = this.clock();
    const transitioned = [];
    for (const s of this.registry.list()) {
      // Maintenance is an explicit operator state; never auto-managed.
      if (s.status === SupplierStatus.MAINTENANCE) continue;
      const stale = now - s.lastHeartbeat > this.timeout;
      if (stale && s.status !== SupplierStatus.OFFLINE) {
        this.registry.updateHealth(s.supplierId, { status: SupplierStatus.OFFLINE, health: 'offline', reason: 'stale' });
        transitioned.push(s.supplierId);
      }
    }
    return transitioned;
  }
}
