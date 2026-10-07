// Trading security layer (Stage 28, option 1 — no cloud KMS). See README.md.
export const DOMAIN = 'security';
export { SecurityError } from './errors.mjs';
export { ENCRYPTION_ALG, sealSecret, openSecret, assertKeyProvider, canonicalContext } from './envelope.mjs';
export { LocalDevKeyProvider } from './providers/local_dev.mjs';
export { AwsKmsKeyProvider, signV4 } from './providers/aws_kms.mjs';
export { keyProviderFromConfig, KeyProviderKind } from './provider_factory.mjs';
export { egressConfig, assertEgressReady, EgressStatus, BLOCKED_REGION_PATTERNS } from './egress.mjs';
export { createAdminStepUpGuard, requireAdminStepUp, ADMIN_ACTIONS } from './admin_step_up.mjs';
export { runDailyKeyRecheck, SYSTEM_ACTOR } from './key_recheck.mjs';
export const CREDENTIAL_DECRYPT_ROLE = 'trading_credential_decryptor';
