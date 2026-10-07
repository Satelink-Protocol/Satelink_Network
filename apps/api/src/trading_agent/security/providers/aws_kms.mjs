// AWS KMS key provider (Stage 28, option 1) — WRITTEN, OFF.
//
// Not usable until the founder provisions a KMS account (Gate 7 / B-08). provider_factory.mjs only
// builds it when TRADING_KMS_PROVIDER=aws AND TRADING_AWS_KMS_ENABLED=true; nothing sets those.
//
// No SDK dependency: the two KMS JSON-1.1 calls (GenerateDataKey, Decrypt) are signed with AWS
// Signature Version 4 here, over an injected fetch. Credentials are passed in by the caller (an
// execution-service secret loader), never read from env by this module, never logged.
// The encryption context goes to KMS as EncryptionContext, so CloudTrail records which credential
// every decrypt was for, and a wrapped key copied to another credential fails at KMS.
import { createHash, createHmac } from 'node:crypto';
import { SecurityError } from '../errors.mjs';
import { canonicalContext } from '../envelope.mjs';

const sha256hex = (s) => createHash('sha256').update(s).digest('hex');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();

/** AWS SigV4 signing for a POST with a JSON body. Pure: returns headers. */
export function signV4({ method = 'POST', host, region, service = 'kms', target, body, credentials, now }) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const date = amzDate.slice(0, 8);
  const headers = {
    'content-type': 'application/x-amz-json-1.1',
    host,
    'x-amz-date': amzDate,
    'x-amz-target': target,
    ...(credentials.sessionToken ? { 'x-amz-security-token': credentials.sessionToken } : {}),
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(headers[n]).trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, '/', '', canonicalHeaders, signedHeaders, sha256hex(body)].join('\n');
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${credentials.secretAccessKey}`, date);
  const kSigning = hmac(hmac(hmac(kDate, region), service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

export class AwsKmsKeyProvider {
  #fetch; #creds; #region; #keyId; #clock;
  /**
   * @param {{ region: string, keyId: string, credentials: () => Promise<{accessKeyId, secretAccessKey, sessionToken?}>,
   *           fetch: typeof fetch, clock?: () => Date }} opts
   */
  constructor({ region, keyId, credentials, fetch, clock = () => new Date() }) {
    if (!/^[a-z]{2}-[a-z]+-\d$/.test(region ?? '')) throw new SecurityError('CONFIG', 'AWS region required (e.g. ap-south-1)');
    if (typeof keyId !== 'string' || !/^(arn:aws:kms:|alias\/|[0-9a-f-]{36}$)/.test(keyId)) throw new SecurityError('CONFIG', 'KMS key id, alias or ARN required');
    if (typeof credentials !== 'function' || typeof fetch !== 'function') throw new SecurityError('CONFIG', 'credentials loader and fetch are required');
    this.#region = region; this.#keyId = keyId; this.#creds = credentials; this.#fetch = fetch; this.#clock = clock;
    this.id = 'aws-kms';
  }

  async #call(target, payload) {
    const host = `kms.${this.#region}.amazonaws.com`;
    const body = JSON.stringify(payload);
    const creds = await this.#creds();
    if (!creds?.accessKeyId || !creds?.secretAccessKey) throw new SecurityError('CONFIG', 'KMS credentials unavailable');
    const headers = signV4({ host, region: this.#region, target: `TrentService.${target}`, body, credentials: creds, now: this.#clock() });
    let res;
    try {
      res = await this.#fetch(`https://${host}/`, { method: 'POST', headers, body });
    } catch {
      throw new SecurityError('PROVIDER_UNAVAILABLE', `KMS ${target} request failed`);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const type = String(json.__type ?? '').split('#').pop();
      if (target === 'Decrypt' && /InvalidCiphertext|IncorrectKey|AccessDenied/.test(type)) throw new SecurityError('DECRYPT_FAILED', `KMS refused: ${type}`);
      throw new SecurityError(res.status >= 500 || res.status === 429 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER', `KMS ${target} → ${res.status} ${type}`);
    }
    return json;
  }

  #encryptionContext(context) {
    canonicalContext(context); // validates
    return Object.fromEntries(Object.keys(context).sort().map((k) => [k, context[k]]));
  }

  async generateDataKey({ context }) {
    const r = await this.#call('GenerateDataKey', { KeyId: this.#keyId, KeySpec: 'AES_256', EncryptionContext: this.#encryptionContext(context) });
    const plaintextKey = Buffer.from(r.Plaintext ?? '', 'base64');
    if (plaintextKey.length !== 32) throw new SecurityError('PROVIDER', 'KMS returned a data key that is not 32 bytes');
    return { plaintextKey, wrappedKey: Buffer.from(r.CiphertextBlob ?? '', 'base64'), keyRef: r.KeyId ?? this.#keyId };
  }

  async unwrapDataKey({ wrappedKey, keyRef, context }) {
    const r = await this.#call('Decrypt', { CiphertextBlob: Buffer.from(wrappedKey).toString('base64'), KeyId: keyRef ?? this.#keyId, EncryptionContext: this.#encryptionContext(context) });
    const k = Buffer.from(r.Plaintext ?? '', 'base64');
    if (k.length !== 32) throw new SecurityError('DECRYPT_FAILED', 'KMS returned an invalid data key');
    return k;
  }
}
