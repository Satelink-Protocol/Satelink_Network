/**
 * Wallet Auth — EIP-191 signature verification and nonce management.
 *
 * Security invariants:
 *   - Nonces stored in DB (auth_nonces table), NOT in memory
 *   - Nonces expire after 5 minutes
 *   - Nonces are single-use (deleted after verification)
 *   - Address recovery via ethers.verifyMessage (EIP-191)
 */

import crypto from 'crypto';
import { ethers } from 'ethers';

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generate a nonce for wallet authentication.
 * @param {object} db - Database instance
 * @param {string} address - Wallet address (0x...)
 * @returns {Promise<{ nonce: string, message_template: string, expires_at: number }>}
 */
export async function generateNonce(db, address) {
    if (!address || typeof address !== 'string' || address.length < 10) {
        throw new Error('Valid wallet address required');
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    const expiresAt = now + NONCE_TTL_MS;

    // Persist nonce in DB — replaces any existing nonce for this address
    await db.query(
        `INSERT INTO auth_nonces (address, nonce, created_at, expires_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (address) DO UPDATE SET
           nonce = EXCLUDED.nonce,
           created_at = EXCLUDED.created_at,
           expires_at = EXCLUDED.expires_at`,
        [address.toLowerCase(), nonce, now, expiresAt]
    );

    const messageTemplate = [
        'Welcome to Satelink!',
        '',
        'Authorize your device by signing this nonce: ${nonce}',
        '',
        'Address: ${address}',
        'Timestamp: ${timestamp}',
    ].join('\n');

    return {
        nonce,
        message_template: messageTemplate,
        expires_at: expiresAt,
        created_at: now,
    };
}

/**
 * Verify a wallet signature against a stored nonce.
 * @param {object} db - Database instance
 * @param {string} address - Wallet address
 * @param {string} signature - Signed message
 * @param {string} message - The message that was signed
 * @returns {Promise<{ valid: boolean, address: string }>}
 */
export async function verifySignature(db, address, signature, message) {
    if (!address || !signature) {
        throw new Error('Address and signature required');
    }

    const normalizedAddress = address.toLowerCase();

    // Retrieve stored nonce
    const row = await db.get(
        "SELECT nonce, expires_at FROM auth_nonces WHERE address = ?",
        [normalizedAddress]
    );

    if (!row) {
        throw new Error('Invalid or expired nonce');
    }

    if (Date.now() > row.expires_at) {
        // Clean up expired nonce
        await db.query("DELETE FROM auth_nonces WHERE address = ?", [normalizedAddress]);
        throw new Error('Nonce has expired');
    }

    // Recover signer address from signature (EIP-191)
    let recoveredAddress;
    try {
        recoveredAddress = ethers.verifyMessage(message, signature);
    } catch (e) {
        throw new Error('Signature verification failed: ' + e.message);
    }

    if (recoveredAddress.toLowerCase() !== normalizedAddress) {
        throw new Error('Recovered address does not match');
    }

    // Invalidate nonce (single-use)
    await db.query("DELETE FROM auth_nonces WHERE address = ?", [normalizedAddress]);

    return { valid: true, address: recoveredAddress };
}
