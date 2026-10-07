// Evidence adapter (Stage 20): turns the output of the Stage 34 three-way matcher
// (scripts/trading/real-revenue-verify.mjs → verify(bundle)) into settlement evidence for the
// shadow engine. Only items the matcher marked matched AND whose path verdict is
// REAL-REVENUE-VERIFIED become evidence; everything else is returned in `skipped` with the reason.
// Pure: no I/O.

/** Matcher source type → shadow event type. */
export const SOURCE_EVENT_TYPE = Object.freeze({
  razorpay_payment: 'subscription_payment',
  binance_rebate: 'broker_rebate',
});

/**
 * @param bundle  the real-revenue-input/1.0 bundle given to verify()
 * @param result  verify(bundle)'s return value
 * @param [eventIdOf] maps a matcher source to the shadow event id (default: the source id)
 */
export function evidenceFromVerification(bundle, result, eventIdOf = (s) => s.id) {
  const sourceById = new Map((bundle.sources ?? []).map((s) => [`${s.type}|${s.id}`, s]));
  const evidence = [];
  const skipped = [];
  for (const it of result.items ?? []) {
    const s = sourceById.get(`${it.sourceType}|${it.sourceId}`);
    const eventType = SOURCE_EVENT_TYPE[it.sourceType];
    if (!s || !eventType) { skipped.push({ sourceId: it.sourceId, reason: 'unknown source' }); continue; }
    if (!it.matched) { skipped.push({ sourceId: it.sourceId, reason: 'not three-way matched' }); continue; }
    if (result.verdicts?.[it.path] !== 'REAL-REVENUE-VERIFIED') { skipped.push({ sourceId: it.sourceId, reason: `path verdict ${result.verdicts?.[it.path]}` }); continue; }
    const fee = BigInt(s.feeMinor ?? '0') + BigInt(s.taxMinor ?? '0');
    evidence.push(Object.freeze({
      eventType, eventId: eventIdOf(s),
      evidenceId: `${it.journalTxnId}|${it.statementLineRef}|${it.sourceId}`,
      matched: true, mode: s.mode, simulated: false, fundedBy: s.fundedBy, settled: s.status === 'settled',
      grossMinor: String(s.grossMinor), feeMinor: String(fee), currency: s.currency,
      statementRef: it.statementLineRef, journalRef: it.journalTxnId,
    }));
  }
  return { evidence, skipped };
}
