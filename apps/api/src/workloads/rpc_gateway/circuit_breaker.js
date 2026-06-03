/**
 * Circuit Breaker for RPC Providers
 * S1-RPC-003: 3-state circuit breaker with Redis persistence
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Provider failing, immediately skip to next
 * - HALF_OPEN: Testing if provider recovered (1 test request)
 *
 * Transitions:
 * - CLOSED → OPEN: after FAILURE_THRESHOLD consecutive failures
 * - OPEN → HALF_OPEN: after RESET_TIMEOUT_MS
 * - HALF_OPEN → CLOSED: on success
 * - HALF_OPEN → OPEN: on failure
 */

import { getSharedRedis } from './shared_redis.js';
import { CHAIN_ALIASES } from './providers.js';

const FAILURE_THRESHOLD = 5;
const RESET_TIMEOUT_MS = 30000;

const STATE = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

// Use shared Redis client to avoid connection pool exhaustion
function getRedis() {
  return getSharedRedis();
}

function getCircuitKey(chain, providerId) {
  const normalized = CHAIN_ALIASES[chain] || chain;
  return `rpc:circuit:${normalized}:${providerId}`;
}

async function getCircuitState(chain, providerId) {
  const client = getRedis();
  if (!client) {
    return { state: STATE.CLOSED, failures: 0, lastFailure: 0, lastTest: 0 };
  }

  try {
    const key = getCircuitKey(chain, providerId);
    const data = await client.get(key);

    if (!data) {
      return { state: STATE.CLOSED, failures: 0, lastFailure: 0, lastTest: 0 };
    }

    return JSON.parse(data);
  } catch (err) {
    console.error('[CircuitBreaker] Get state failed:', err.message);
    return { state: STATE.CLOSED, failures: 0, lastFailure: 0, lastTest: 0 };
  }
}

async function setCircuitState(chain, providerId, circuitState) {
  const client = getRedis();
  if (!client) return;

  try {
    const key = getCircuitKey(chain, providerId);
    await client.set(key, JSON.stringify(circuitState), 'EX', 3600);
  } catch (err) {
    console.error('[CircuitBreaker] Set state failed:', err.message);
  }
}

export async function isOpen(chain, providerId) {
  const circuit = await getCircuitState(chain, providerId);
  const now = Date.now();

  if (circuit.state === STATE.CLOSED) {
    return false;
  }

  if (circuit.state === STATE.OPEN) {
    if (now - circuit.lastFailure >= RESET_TIMEOUT_MS) {
      circuit.state = STATE.HALF_OPEN;
      circuit.lastTest = now;
      await setCircuitState(chain, providerId, circuit);
      console.log(`[CircuitBreaker] ${providerId}: OPEN → HALF_OPEN (testing)`);
      return false;
    }
    return true;
  }

  if (circuit.state === STATE.HALF_OPEN) {
    return false;
  }

  return false;
}

export async function recordSuccess(chain, providerId) {
  const circuit = await getCircuitState(chain, providerId);

  if (circuit.state === STATE.HALF_OPEN) {
    console.log(`[CircuitBreaker] ${providerId}: HALF_OPEN → CLOSED (recovered)`);
  }

  const newState = {
    state: STATE.CLOSED,
    failures: 0,
    lastFailure: 0,
    lastTest: 0
  };

  await setCircuitState(chain, providerId, newState);
}

export async function recordFailure(chain, providerId) {
  const circuit = await getCircuitState(chain, providerId);
  const now = Date.now();

  if (circuit.state === STATE.HALF_OPEN) {
    console.log(`[CircuitBreaker] ${providerId}: HALF_OPEN → OPEN (still failing)`);
    await setCircuitState(chain, providerId, {
      state: STATE.OPEN,
      failures: circuit.failures + 1,
      lastFailure: now,
      lastTest: circuit.lastTest
    });
    return;
  }

  const newFailures = circuit.failures + 1;

  if (newFailures >= FAILURE_THRESHOLD) {
    console.log(`[CircuitBreaker] ${providerId}: CLOSED → OPEN (${newFailures} failures)`);
    await setCircuitState(chain, providerId, {
      state: STATE.OPEN,
      failures: newFailures,
      lastFailure: now,
      lastTest: 0
    });
  } else {
    await setCircuitState(chain, providerId, {
      state: STATE.CLOSED,
      failures: newFailures,
      lastFailure: now,
      lastTest: 0
    });
  }
}

export async function getCircuitStats(chain, providerId) {
  const circuit = await getCircuitState(chain, providerId);
  const now = Date.now();

  let effectiveState = circuit.state;
  if (circuit.state === STATE.OPEN && now - circuit.lastFailure >= RESET_TIMEOUT_MS) {
    effectiveState = STATE.HALF_OPEN;
  }

  return {
    state: effectiveState,
    failures: circuit.failures,
    lastFailure: circuit.lastFailure,
    lastTest: circuit.lastTest,
    timeUntilReset: circuit.state === STATE.OPEN
      ? Math.max(0, RESET_TIMEOUT_MS - (now - circuit.lastFailure))
      : 0
  };
}

export async function forceOpen(chain, providerId) {
  await setCircuitState(chain, providerId, {
    state: STATE.OPEN,
    failures: FAILURE_THRESHOLD,
    lastFailure: Date.now(),
    lastTest: 0
  });
  console.log(`[CircuitBreaker] ${providerId}: FORCED OPEN`);
}

export async function forceClose(chain, providerId) {
  await setCircuitState(chain, providerId, {
    state: STATE.CLOSED,
    failures: 0,
    lastFailure: 0,
    lastTest: 0
  });
  console.log(`[CircuitBreaker] ${providerId}: FORCED CLOSED`);
}

export { STATE, FAILURE_THRESHOLD, RESET_TIMEOUT_MS };
