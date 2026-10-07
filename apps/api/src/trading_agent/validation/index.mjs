// Validation engines (Phase 6 item 5): walk-forward + stress / Monte Carlo on the Stage 14
// simulator. Every result is labelled HYPOTHETICAL and sealed with a resultHash.
export const DOMAIN = 'validation';
export { WALK_FORWARD_CONFIG, STRESS_CONFIG } from './config.mjs';
export { walkForward } from './walk_forward.mjs';
export { stressTest, bootstrapTrades, applyGap } from './stress.mjs';
export { HYPOTHETICAL, VALIDATION_DISCLAIMER, ValidationError, mulberry32 } from './common.mjs';
