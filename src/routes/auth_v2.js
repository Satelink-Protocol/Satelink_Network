import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { rateLimit } from 'express-rate-limit';


export function verifyJWT(req, res, next) {
    // ── DEV BYPASS REMOVED: ──

    let authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } else if (req.cookies && req.cookies.satelink_session) {
        token = req.cookies.satelink_session;
    } else if (req.query.token) {
        token = req.query.token;
    }

    if (!token) {
        return res.status(401).json({ ok: false, code: 'UNAUTHENTICATED', error: 'Unauthorized' });
    }

    try {
        const secret = process.env.JWT_SECRET;
        const decoded = jwt.verify(token, secret);
        req.user = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ ok: false, code: 'UNAUTHENTICATED', error: 'Invalid or expired token' });
    }
}

export function createUnifiedAuthRouter(opsEngine) {
    const router = Router();

    // GET /me - Returns current user info from JWT
    router.get('/me', verifyJWT, (req, res) => {
        res.json({
            ok: true,
            user: {
                wallet: req.user.wallet,
                role: req.user.role,
                iat: req.user.iat,
                exp: req.user.exp,
                iss: req.user.iss,
                permissions: getPermissionsForRole(req.user.role)
            }
        });
    });

    // Mock Login for other roles (DEV ONLY) — includes JWT issuer fix
    if (process.env.NODE_ENV !== 'production') {
        router.post('/__test/auth/login', async (req, res) => {
            const { wallet, role } = req.body;
            if (!wallet || !role) return res.status(400).json({ error: 'Wallet and Role required' });

            const secret = process.env.JWT_SECRET;
            const token = jwt.sign(
                { wallet: wallet.toLowerCase(), role, userId: wallet.toLowerCase(), type: 'access' },
                secret,
                { expiresIn: '7d', issuer: process.env.JWT_ISSUER || 'satelink-network' }
            );

            res.json({ success: true, token });
        });
    }

    // IP Hashing helper for rate limits
    const hashIp = (ip) => {
        const salt = process.env.IP_HASH_SALT || process.env.IP_SALT || 'satelink_default_salt';
        return crypto.createHash('sha256').update((ip || '') + salt).digest('hex').substring(0, 16);
    };

    // Permissionless onboarding rate limiter
    const authRateLimitPerMin = parseInt(process.env.AUTH_RATE_LIMIT_PER_MIN || '10', 10);
    const authLimiter = rateLimit({
        windowMs: 60 * 1000, // 1 minute
        max: authRateLimitPerMin,
        validate: { trustProxy: false, xForwardedForHeader: false, keyGeneratorIpFallback: false },
        keyGenerator: (req, res) => {
            if (req.ipHash) return req.ipHash;
            // Use express-rate-limit's built-in ip generator if available to avoid IPv6 warning, then hash it
            const ip = req.ip || req.connection?.remoteAddress || 'unknown';
            return hashIp(ip);
        },
        message: { ok: false, error: 'Too many authentication attempts, please try again later.' }
    });

    if (!process.env.IP_HASH_SALT) {
        console.warn("[WARN] IP_HASH_SALT is not set. Using default salt for auth rate limiting (not recommended for production).");
    }

    // Hash password helper
    const hashPassword = (password) => {
        const salt = process.env.PASSWORD_SALT || process.env.JWT_SECRET;
        if (!salt) {
            throw new Error('FATAL: PASSWORD_SALT or JWT_SECRET must be set for password hashing');
        }
        return crypto.createHash('sha256').update(password + salt).digest('hex');
    };

    // POST /auth/register - Permissionless onboarding
    router.post('/register', authLimiter, async (req, res) => {
        const { email, password, username } = req.body;

        if (!email || typeof email !== 'string' || !email.includes('@')) {
            return res.status(400).json({ ok: false, error: 'Valid email is required' });
        }
        if (!password || typeof password !== 'string' || password.length < 10) {
            return res.status(400).json({ ok: false, error: 'Password must be at least 10 characters long' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const role = 'node_operator'; // Default role
        const pwdHash = hashPassword(password);
        const now = Date.now();

        try {
            if (!opsEngine || !opsEngine.db) {
                return res.status(500).json({ ok: false, error: 'Database connection not available' });
            }

            // Ensure schema exists robustly at runtime
            await opsEngine.db.query(
                "CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, password_hash TEXT, role TEXT, created_at INTEGER)"
            );

            // Check if user exists (generic error response for UX vs Security balance as per requirements)
            const existingUser = await opsEngine.db.get("SELECT email FROM users WHERE email = ?", [normalizedEmail]);
            if (existingUser) {
                return res.status(400).json({ ok: false, error: 'Email already used' });
            }

            // Insert into new users schema
            await opsEngine.db.query(
                "INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
                [normalizedEmail, pwdHash, role, now]
            );

            // Insert into legacy user_roles for compatibility with existing RBAC
            await opsEngine.db.query(
                "INSERT OR REPLACE INTO user_roles (wallet, role, updated_at) VALUES (?, ?, ?)",
                [normalizedEmail, role, now]
            );

            // Generate JWT (matching structure from src/middleware/auth.js and /me endpoint)
            const secret = process.env.JWT_SECRET;
            if (!secret) throw new Error("JWT_SECRET missing");

            const token = jwt.sign(
                {
                    userId: normalizedEmail,
                    wallet: normalizedEmail, // mapped for legacy compatibility
                    role: role,
                    type: 'access'
                },
                secret,
                { expiresIn: process.env.JWT_TTL || '15m', issuer: process.env.JWT_ISSUER || 'satelink-network', algorithm: 'HS256' }
            );

            res.json({
                ok: true,
                token,
                user: { id: normalizedEmail, email: normalizedEmail, role, username }
            });

        } catch (e) {
            console.error("[AUTH] Registration error:", e);
            res.status(500).json({ ok: false, error: 'Internal server error during registration' });
        }
    });

    // POST /auth/login - Permissionless login
    router.post('/login', authLimiter, async (req, res) => {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ ok: false, error: 'Email and password are required' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const pwdHash = hashPassword(password);

        try {
            if (!opsEngine || !opsEngine.db) {
                return res.status(500).json({ ok: false, error: 'Database connection not available' });
            }

            // Ensure schema exists robustly at runtime
            await opsEngine.db.query(
                "CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, password_hash TEXT, role TEXT, created_at INTEGER)"
            );

            // Check user (timing attack prevention is minimal here, standard quick hash comparison)
            const user = await opsEngine.db.get(
                "SELECT email, role FROM users WHERE email = ? AND password_hash = ?",
                [normalizedEmail, pwdHash]
            );

            if (!user) {
                // Return generic error as requested
                return res.status(401).json({ ok: false, error: 'Invalid email or password' });
            }

            // Generate JWT
            const secret = process.env.JWT_SECRET;
            if (!secret) throw new Error("JWT_SECRET missing");

            const token = jwt.sign(
                {
                    userId: user.email,
                    wallet: user.email, // mapped for legacy compatibility
                    role: user.role,
                    type: 'access'
                },
                secret,
                { expiresIn: process.env.JWT_TTL || '15m', issuer: process.env.JWT_ISSUER || 'satelink-network', algorithm: 'HS256' }
            );

            res.json({
                ok: true,
                token,
                user: { id: user.email, email: user.email, role: user.role }
            });

        } catch (e) {
            console.error("[AUTH] Login error:", e);
            res.status(500).json({ ok: false, error: 'Internal server error during login' });
        }
    });

    return router;
}

export function getPermissionsForRole(role) {
    const common = ['view_dashboard'];
    const permissions = {
        'admin_super': [...common, 'manage_system', 'manage_treasury', 'manage_ops'],
        'admin_ops': [...common, 'manage_ops'],
        'node_operator': [...common, 'view_node_stats', 'claim_rewards'],
        'builder': [...common, 'manage_keys', 'view_usage'],
        'distributor_lco': [...common, 'view_referrals', 'claim_commissions'],
        'distributor_influencer': [...common, 'view_referrals', 'claim_commissions'],
        'enterprise': [...common, 'view_usage', 'view_invoices']
    };
    return permissions[role] || common;
}
