import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";

const IS_DEV = process.env.NODE_ENV === "development";

export function attachBaseMiddleware(app) {
    app.use(express.json({ limit: '100kb' }));
    app.use(express.urlencoded({ extended: true, limit: '100kb' }));
    app.use(cookieParser());

    // Safety headers and CORS
    app.use(helmet({
        contentSecurityPolicy: {
            useDefaults: true,
            directives: {
                scriptSrc: IS_DEV
                    ? ["'self'", "'unsafe-eval'"]
                    : ["'self'"]
            }
        },
        crossOriginResourcePolicy: {
            policy: IS_DEV ? "cross-origin" : "same-origin"
        }
    }));

    // CSP report-only header for readiness gate checks
    app.use((req, res, next) => {
        res.setHeader('Content-Security-Policy-Report-Only', "default-src 'self'");
        next();
    });

    const CORS_ORIGINS = (process.env.CORS_ORIGINS || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

    // Public endpoints that must allow all origins (machine clients, Chainlist, etc.)
    const PUBLIC_PATHS = [
        '/rpc',
        '/health',
        '/healthz',
        '/api/auth',
        '/api/keys',
        '/api/pricing',
        '/api/status',
        '/api/epochs',
        '/api/nodes',
        '/api/settlement',
        '/api/admin/mal',
        '/os',
        '/provider.json'
    ];

    const corsOptions = {
        origin: function (origin, callback) {
            if (!origin) return callback(null, true); // Server-to-server (no Origin header): allowed
            // Fail closed: with no explicit allowlist, deny ALL cross-origin
            // browser requests rather than reflecting the origin with
            // credentials:true (P0-5, 2026-09). Public machine endpoints keep
            // their own origin:"*" via publicCorsOptions above and are
            // unaffected. Set CORS_ORIGINS to opt specific origins back in.
            if (CORS_ORIGINS.length === 0) return callback(null, false);
            return callback(null, CORS_ORIGINS.includes(origin));
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Admin-Key", "X-API-Key"]
    };

    // Public CORS for machine endpoints (always allow all origins)
    const publicCorsOptions = {
        origin: "*",
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "X-API-Key", "X-Admin-Token", "Authorization"]
    };

    // Apply public CORS to machine endpoints
    PUBLIC_PATHS.forEach(path => {
        app.use(path, cors(publicCorsOptions));
    });

    // Apply standard CORS to all other routes
    app.use(cors(corsOptions));
    app.options(/.*$/, cors(corsOptions));

    if (process.env.NODE_ENV === 'production' && !process.env.E2E_TEST) {
        app.use("/__test", (req, res) => res.status(404).send("Not Found"));
    }
}
