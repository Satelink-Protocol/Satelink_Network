// KeyProvider selection (Stage 28, option 1). Decides which provider may wrap broker-credential
// data keys, from config only. Default: NONE → credential storage is unavailable (fail closed).
//
//   TRADING_KMS_PROVIDER=local  → LocalDevKeyProvider. Refused when NODE_ENV=production unless
//                                 TRADING_LOCAL_KEY_PROVIDER_ACCEPTED=capped-beta (a founder decision:
//                                 "accept the local key provider for a capped beta", Phase 9).
//   TRADING_KMS_PROVIDER=aws    → AwsKmsKeyProvider. Refused unless TRADING_AWS_KMS_ENABLED=true
//                                 (written, OFF — Gate 7 stays NOT PASSED until a KMS account exists).
// Secrets (master key, AWS credentials) are injected by the caller's secret loader; env holds names
// and switches only.
import { SecurityError } from './errors.mjs';
import { LocalDevKeyProvider } from './providers/local_dev.mjs';
import { AwsKmsKeyProvider } from './providers/aws_kms.mjs';

export const KeyProviderKind = Object.freeze({ LOCAL: 'local', AWS: 'aws' });

/**
 * @param {{ env?: object, loadLocalMasterKey?: () => Buffer, aws?: { credentials, fetch, keyId, region } }} deps
 */
export function keyProviderFromConfig({ env = process.env, loadLocalMasterKey, aws } = {}) {
  const kind = env.TRADING_KMS_PROVIDER;
  if (!kind) throw new SecurityError('NOT_CONFIGURED', 'no key provider configured: broker credential storage is unavailable');
  if (kind === KeyProviderKind.LOCAL) {
    if (env.NODE_ENV === 'production' && env.TRADING_LOCAL_KEY_PROVIDER_ACCEPTED !== 'capped-beta') {
      throw new SecurityError('REFUSED', 'local key provider is refused in production without the founder\'s capped-beta acceptance');
    }
    if (typeof loadLocalMasterKey !== 'function') throw new SecurityError('CONFIG', 'local provider needs a master-key loader');
    return new LocalDevKeyProvider({ masterKey: loadLocalMasterKey(), keyId: env.TRADING_LOCAL_KEY_ID || 'local-dev-1' });
  }
  if (kind === KeyProviderKind.AWS) {
    if (env.TRADING_AWS_KMS_ENABLED !== 'true') throw new SecurityError('REFUSED', 'AWS KMS provider is written but OFF (needs a provisioned KMS account — Gate 7)');
    if (!aws) throw new SecurityError('CONFIG', 'AWS provider needs credentials, fetch, keyId and region');
    return new AwsKmsKeyProvider(aws);
  }
  throw new SecurityError('CONFIG', `unknown TRADING_KMS_PROVIDER ${kind}`);
}
