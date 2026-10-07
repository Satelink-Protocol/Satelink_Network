// Machine / agent API metering prices (Phase 6 item 11).
//
// DRAFT — NOT A PUBLISHED PRICE. These figures only exist so metering and the shadow revenue engine
// can be exercised end to end. Because the price is a draft, every metered charge is posted to the
// SIMULATED book of the shadow revenue engine (item 1). Publishing a price is a founder decision
// (pricing at launch); it becomes a new version with `published: true` and the REAL book.
export const MACHINE_PRICING = Object.freeze({
  version: 'machine-pricing/draft-0',
  published: false,
  currency: 'USD',
  perCallUsdMicro: Object.freeze({ evaluate_opportunity: 5_000, propose: 1_000, propose_strategy: 5_000, get_receipt: 0 }),
});
