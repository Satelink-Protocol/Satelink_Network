// RoutingTransaction — the single entity the kernel owns (Constitution §2, §3).

export const TxState = Object.freeze({
  CREATED: 'CREATED',
  DISCOVERING: 'DISCOVERING', DISCOVERED: 'DISCOVERED',
  QUOTING: 'QUOTING', QUOTED: 'QUOTED',
  ROUTING: 'ROUTING', ROUTED: 'ROUTED',
  SETTLING_IN: 'SETTLING_IN', SETTLED_IN: 'SETTLED_IN',
  EXECUTING: 'EXECUTING', EXECUTED: 'EXECUTED',
  SETTLING_OUT: 'SETTLING_OUT', SETTLED: 'SETTLED',
  CLOSED: 'CLOSED',
  REJECTED: 'REJECTED', FAILED: 'FAILED', COMPENSATING: 'COMPENSATING',
});

export class RoutingTransaction {
  constructor(id, request) {
    this.id = id;
    this.request = request;
    this.state = TxState.CREATED;
    this.candidates = null;
    this.supplier = null;
    this.quote = null;
    this.route = null;
    this.fee = null;
    this.settlementInRef = null;
    this.result = null;
    this.settlementOutRef = null;
    this.reason = null;
  }
}
