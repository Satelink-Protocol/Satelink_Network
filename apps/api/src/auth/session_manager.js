/**
 * Session Manager — JWT issuance, user upsert, device tracking.
 *
 * Orchestrates the post-verification flow:
 *   1. Upsert user record
 *   2. Generate JWT token pair
 *   3. Record device fingerprint
 *   4. Set secure cookies
 */

import crypto from 'crypto';
import { generateTokenPair } from './jwt_service.js';
import { getPermissions, getDashboardRoute } from './role_service.js';

/**
 * Create a session for a verified wallet.
 * @param {object} db - Database instance
 * @param {string} wallet - Verified wallet address
 * @param {object} deviceInfo - { ip, userAgent }
 * @returns {Promise<{ tokens, user, dashboardRoute }>}
 */
export async function createSession(db, wallet, deviceInfo = {}) {
    const normalizedWallet = wallet.toLowerCase();
    const now = Date.now();

    // Upsert user — create on first login, update last_login on return
    await db.query(
        `INSERT INTO users (wallet, role, created_at, last_login_at)
         VALUES (?, 'user', ?, ?)
         ON CONFLICT (wallet) DO UPDATE SET last_login_at = EXCLUDED.last_login_at`,
        [normalizedWallet, now, now]
    );

    // Fetch user with role
    const user = await db.get(
        "SELECT wallet, role, created_at FROM users WHERE wallet = ?",
        [normalizedWallet]
    );

    if (!user) {
        throw new Error('Failed to create or retrieve user record');
    }

    const role = user.role || 'user';
    const permissions = getPermissions(role);
    const dashboardRoute = getDashboardRoute(role);
    const sessionId = crypto.randomUUID();

    // Generate JWT pair
    const tokens = generateTokenPair({
        userId:      normalizedWallet,
        role,
        wallet:      normalizedWallet,
        permissions,
        sessionId,
    });

    // Record device fingerprint (best-effort)
    try {
        const ipHash = deviceInfo.ip
            ? crypto.createHash('sha256').update(deviceInfo.ip + process.env.IP_HASH_SALT).digest('hex').substring(0, 16)
            : 'unknown';

        const deviceId = crypto.createHash('sha256')
            .update(`${normalizedWallet}:${deviceInfo.userAgent || ''}:${ipHash}`)
            .digest('hex')
            .substring(0, 32);

        await db.query(
            `INSERT INTO trusted_devices (device_public_id, wallet, ip_hash, user_agent, created_at, last_used_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (device_public_id) DO UPDATE SET last_used_at = EXCLUDED.last_used_at`,
            [deviceId, normalizedWallet, ipHash, (deviceInfo.userAgent || '').substring(0, 200), now, now]
        );
    } catch (_) {
        // Device tracking is best-effort — don't fail the login
    }

    return {
        tokens,
        user: {
            wallet:      normalizedWallet,
            role,
            permissions,
            sessionId,
        },
        dashboardRoute,
    };
}

/**
 * Cookie configuration for session tokens.
 */
export function getSessionCookieOptions() {
    return {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge:   15 * 60 * 1000, // 15 minutes (matches access token TTL)
    };
}

/**
 * Refresh cookie configuration (longer-lived).
 */
export function getRefreshCookieOptions() {
    return {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path:     '/auth/refresh',
        maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
    };
}
