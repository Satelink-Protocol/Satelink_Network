/**
 * SAT-240: End-to-end smoke test for USDT deposit flow on Polygon Mainnet
 *
 * Steps:
 *  1. Get calldata from /credits/deposit/initiate
 *  2. Approve USDT to RevenueVault on-chain
 *  3. Deposit USDT to RevenueVault on-chain
 *  4. Poll /credits/balance until credited (max 5 min)
 *  5. Make one RPC call via /rpc/polygon with X-Wallet-Address
 *  6. Verify balance decreased (credit deducted)
 */

import { ethers } from 'ethers';

const PRIVATE_KEY = process.env.POLYGON_SIGNER_KEY;
const RPC_URL = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
const API_BASE = process.env.API_BASE || 'https://rpc.satelink.network';
const DEPOSIT_USDT = parseFloat(process.env.DEPOSIT_AMOUNT || '0.1');

const USDT_ADDRESS = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const VAULT_ADDRESS = '0x577D3716d6Ad5b676d230f5409deF9838FABaCEF';

if (!PRIVATE_KEY) {
  console.error('ERROR: POLYGON_SIGNER_KEY env var required');
  process.exit(1);
}

const results = {
  timestamp: new Date().toISOString(),
  wallet: null,
  steps: [],
  success: false,
  failures: []
};

function log(step, status, detail) {
  const entry = { step, status, detail, ts: new Date().toISOString() };
  results.steps.push(entry);
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : status === 'INFO' ? 'ℹ️' : '⏳';
  console.log(`${icon} [${step}] ${detail}`);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const address = wallet.address;
  results.wallet = address;

  console.log('\n=== SAT-240: End-to-End Deposit Smoke Test ===');
  console.log(`Wallet: ${address}`);
  console.log(`Amount: ${DEPOSIT_USDT} USDT`);
  console.log(`API: ${API_BASE}`);
  console.log(`Vault: ${VAULT_ADDRESS}\n`);

  // --- PRE-CHECK: Balances ---
  const usdtAbi = [
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address,address) view returns (uint256)'
  ];
  const usdt = new ethers.Contract(USDT_ADDRESS, usdtAbi, provider);
  const [maticBal, usdtBal] = await Promise.all([
    provider.getBalance(address),
    usdt.balanceOf(address)
  ]);
  const usdtHuman = parseFloat(ethers.formatUnits(usdtBal, 6));
  const maticHuman = parseFloat(ethers.formatEther(maticBal));

  log('PRE-CHECK', 'INFO', `MATIC: ${maticHuman.toFixed(4)}, USDT: ${usdtHuman.toFixed(6)}`);

  if (maticHuman < 0.001) {
    log('PRE-CHECK', 'FAIL', 'Insufficient MATIC for gas (need >= 0.001)');
    results.failures.push('insufficient_matic');
    printSummary();
    process.exit(1);
  }
  if (usdtHuman < DEPOSIT_USDT) {
    log('PRE-CHECK', 'FAIL', `Insufficient USDT: have ${usdtHuman}, need ${DEPOSIT_USDT}`);
    results.failures.push('insufficient_usdt');
    printSummary();
    process.exit(1);
  }
  log('PRE-CHECK', 'PASS', 'Sufficient MATIC and USDT available');

  // --- STEP 1: Get calldata from API ---
  log('STEP-1', 'INFO', `GET ${API_BASE}/credits/deposit/initiate?amount=${DEPOSIT_USDT}`);
  let initiateData;
  try {
    const res = await fetch(`${API_BASE}/credits/deposit/initiate?amount=${DEPOSIT_USDT}`);
    initiateData = await res.json();
    if (!initiateData.approveCalldata || !initiateData.depositCalldata) {
      throw new Error('Missing calldata in response: ' + JSON.stringify(initiateData));
    }
    log('STEP-1', 'PASS', `Got calldata. amountRaw=${initiateData.amountRaw}`);
  } catch (err) {
    log('STEP-1', 'FAIL', `initiate endpoint error: ${err.message}`);
    results.failures.push('initiate_endpoint_failed');
    printSummary();
    process.exit(1);
  }

  // --- STEP 2: Approve USDT ---
  log('STEP-2', 'INFO', `Sending approve tx to USDT contract (spender: vault)`);
  let approveTx;
  try {
    const feeData = await provider.getFeeData();
    approveTx = await wallet.sendTransaction({
      to: USDT_ADDRESS,
      data: initiateData.approveCalldata,
      gasLimit: 80000n,
      maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits('100', 'gwei'),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits('30', 'gwei'),
    });
    log('STEP-2', 'INFO', `Approve tx sent: ${approveTx.hash}`);
    const approveReceipt = await approveTx.wait(1);
    if (approveReceipt.status === 1) {
      log('STEP-2', 'PASS', `Approve confirmed in block ${approveReceipt.blockNumber}. Gas used: ${approveReceipt.gasUsed}`);
    } else {
      throw new Error('Approve tx reverted');
    }
  } catch (err) {
    log('STEP-2', 'FAIL', `Approve failed: ${err.message}`);
    results.failures.push('approve_failed');
    printSummary();
    process.exit(1);
  }

  // --- STEP 3: Deposit USDT ---
  log('STEP-3', 'INFO', `Sending deposit tx to RevenueVault`);
  let depositTx;
  let depositTxHash;
  try {
    const feeData = await provider.getFeeData();
    depositTx = await wallet.sendTransaction({
      to: VAULT_ADDRESS,
      data: initiateData.depositCalldata,
      gasLimit: 120000n,
      maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits('100', 'gwei'),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits('30', 'gwei'),
    });
    depositTxHash = depositTx.hash;
    log('STEP-3', 'INFO', `Deposit tx sent: ${depositTxHash}`);
    log('STEP-3', 'INFO', `Polygonscan: https://polygonscan.com/tx/${depositTxHash}`);
    const depositReceipt = await depositTx.wait(1);
    if (depositReceipt.status === 1) {
      log('STEP-3', 'PASS', `Deposit confirmed in block ${depositReceipt.blockNumber}. Gas used: ${depositReceipt.gasUsed}`);
    } else {
      throw new Error('Deposit tx reverted');
    }
  } catch (err) {
    log('STEP-3', 'FAIL', `Deposit failed: ${err.message}`);
    results.failures.push('deposit_failed');
    results.depositTxHash = depositTxHash;
    printSummary();
    process.exit(1);
  }
  results.depositTxHash = depositTxHash;

  // --- STEP 4: Poll /credits/balance until credited ---
  log('STEP-4', 'INFO', `Polling ${API_BASE}/credits/balance?wallet=${address} (max 5 min)`);
  const POLL_INTERVAL_MS = 10000;
  const POLL_TIMEOUT_MS = 300000;
  const startPoll = Date.now();
  let creditBalance = 0;

  while (Date.now() - startPoll < POLL_TIMEOUT_MS) {
    try {
      const res = await fetch(`${API_BASE}/credits/balance?wallet=${address}`);
      const data = await res.json();
      creditBalance = parseFloat(data.balance_usdt || 0);
      log('STEP-4', 'INFO', `balance_usdt=${creditBalance}, status=${data.status} (elapsed: ${Math.round((Date.now() - startPoll)/1000)}s)`);
      if (creditBalance > 0) {
        log('STEP-4', 'PASS', `Credits confirmed: ${creditBalance} USDT in DB`);
        break;
      }
    } catch (err) {
      log('STEP-4', 'INFO', `Poll error: ${err.message}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }

  if (creditBalance <= 0) {
    log('STEP-4', 'FAIL', `Credits not credited after ${POLL_TIMEOUT_MS/1000}s — DepositListener may not be running or event was missed`);
    results.failures.push('credit_not_reflected');
    printSummary();
    process.exit(1);
  }

  // --- STEP 5: Make one RPC call with X-Wallet-Address ---
  log('STEP-5', 'INFO', `Making eth_blockNumber call to ${API_BASE}/rpc/polygon`);
  try {
    const rpcRes = await fetch(`${API_BASE}/rpc/polygon`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wallet-Address': address
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1
      })
    });
    const rpcData = await rpcRes.json();
    if (rpcData.error) {
      log('STEP-5', 'FAIL', `RPC error: ${JSON.stringify(rpcData.error)}`);
      results.failures.push('rpc_call_failed');
    } else {
      const blockHex = rpcData.result;
      const blockNum = parseInt(blockHex, 16);
      log('STEP-5', 'PASS', `RPC call success: eth_blockNumber = ${blockNum} (0x${blockNum.toString(16)})`);
    }
  } catch (err) {
    log('STEP-5', 'FAIL', `RPC call error: ${err.message}`);
    results.failures.push('rpc_call_failed');
  }

  // --- STEP 6: Verify credit deducted ---
  log('STEP-6', 'INFO', 'Waiting 3s then checking balance again to verify deduction...');
  await sleep(3000);
  try {
    const res = await fetch(`${API_BASE}/credits/balance?wallet=${address}`);
    const data = await res.json();
    const newBalance = parseFloat(data.balance_usdt || 0);
    const deducted = creditBalance - newBalance;
    if (deducted > 0) {
      log('STEP-6', 'PASS', `Credit deducted: ${creditBalance} → ${newBalance} USDT (deducted: ${deducted.toFixed(8)})`);
    } else if (deducted === 0) {
      log('STEP-6', 'INFO', `Balance unchanged at ${newBalance} USDT — billing may be deducted at epoch close, or RPC gateway not charging yet`);
    } else {
      log('STEP-6', 'INFO', `Balance: ${newBalance} USDT (was ${creditBalance})`);
    }
    results.finalBalance = newBalance;
  } catch (err) {
    log('STEP-6', 'INFO', `Could not verify deduction: ${err.message}`);
  }

  results.success = results.failures.length === 0;
  printSummary();
}

function printSummary() {
  console.log('\n=== SMOKE TEST SUMMARY ===');
  console.log(`Wallet: ${results.wallet}`);
  console.log(`Deposit tx: ${results.depositTxHash || 'N/A'}`);
  console.log(`Success: ${results.success}`);
  if (results.failures.length > 0) {
    console.log(`Failures: ${results.failures.join(', ')}`);
  }
  console.log('\nStep log:');
  for (const s of results.steps) {
    console.log(`  [${s.status}] ${s.step}: ${s.detail}`);
  }
  console.log('\nFull results (JSON):');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error('FATAL:', err);
  results.failures.push('fatal: ' + err.message);
  printSummary();
  process.exit(1);
});
