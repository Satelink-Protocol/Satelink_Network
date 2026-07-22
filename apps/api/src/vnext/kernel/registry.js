// Workload adapter registry (Constitution §12).
//
// Registration is the ONLY thing adding a workload requires — the kernel is
// never edited. Same Map register/get pattern as the existing production
// `settlement/adapter_registry.js`, scoped to workload adapters.

export class Registry {
  constructor() { this._adapters = new Map(); }

  register(adapter) {
    const caps = adapter.capabilities();
    if (!caps || !caps.key) throw new Error('adapter has no capability key');
    this._adapters.set(caps.key, adapter);
    return this;
  }

  get(key) {
    const a = this._adapters.get(key);
    if (!a) throw new Error(`no adapter registered for workload '${key}'`);
    return a;
  }

  has(key) { return this._adapters.has(key); }
}
