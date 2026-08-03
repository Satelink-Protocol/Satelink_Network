export async function shadowWriteDraw(pool, event, logger = console) {
  try {
    if (process.env.ENABLE_SHADOW_DRAW !== 'true') return;

    // Use dynamic import since @satelink/financial is in TS
    const financial = await import('@satelink/financial/src/index.ts');
    const domain = await import('@satelink/financial-domain/src/index.ts');

    const { PostgresUnitOfWork } = financial;
    const { Draw, LedgerTransaction, TxnId, SourceReference, AccountId, PrincipalId, FundingSourceId, AuthorizationId, Money, Currency, DrawId } = domain;

    const { txHash, payer, amountUsd, isTestData, network } = event;

    if (isTestData) return; // Invariant 10

    // Construct the M6 Draw and LedgerTransaction aggregates
    const drawIdStr = `draw_x402_${txHash}`;
    const txnIdStr = `txn_x402_${txHash}`;
    const amountBig = BigInt(Math.floor(amountUsd * 1000000));
    const usdt = new Currency('USDT', 6, 1000000n);
    const amount = new Money(amountBig, usdt);

    const drawId = DrawId.of(drawIdStr).unwrap();
    const principalId = PrincipalId.of(payer).unwrap(); // Fallback to wallet address as Principal
    const accountId = AccountId.of(payer).unwrap(); // Fallback to wallet address as Account
    const fundingSourceId = FundingSourceId.of(`fs_x402_${payer}`).unwrap();
    const authorizationId = AuthorizationId.of(`auth_x402_${txHash}`).unwrap();

    let draw = Draw.request({
      id: drawId,
      principalId,
      accountId,
      fundingSourceId,
      authorizationId,
      amount,
      idempotencyKey: `idem_x402_draw_${txHash}`,
      createdAt: Date.now()
    }).unwrap();

    // Fast-forward to settled
    draw = draw.authorize().unwrap();
    draw = draw.beginSettlement(0n).unwrap();
    draw = draw.submitSettlement({ refType: 'x402', refValue: txHash }).unwrap();
    draw = draw.confirmSettlement(0n, Date.now()).unwrap();

    const txnId = TxnId.of(txnIdStr).unwrap();
    const source = SourceReference.of('draw', drawIdStr).unwrap();

    const ledgerTx = LedgerTransaction.create({
      txnId,
      source,
      entries: [
        {
          account: AccountId.of('acct_platform_revenue').unwrap(),
          direction: domain.Direction.of('credit').unwrap(),
          amount,
          state: domain.EntryState.POSTED,
          source
        },
        {
          account: AccountId.of('acct_platform_suspense').unwrap(),
          direction: domain.Direction.of('debit').unwrap(),
          amount,
          state: domain.EntryState.POSTED,
          source
        }
      ]
    }).unwrap();

    // Invoke PostgresUnitOfWork via the isolated pool
    const client = await pool.connect();
    try {
      const uow = new PostgresUnitOfWork(client);
      const res = await uow.commitDrawAndLedger(draw, ledgerTx);
      if (res.isErr) {
        throw new Error(`UoW failed: ${res.error}`);
      }
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error?.('[shadow-draw] write failed:', err?.message ?? err);
  }
}
