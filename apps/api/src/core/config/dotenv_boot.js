/**
 * Centralized dotenv bootstrap — loads .env then .env.local (if present) with override.
 * Import this ONCE at the top of every entry point instead of "dotenv/config".
 *
 * Railway/production: skip loading .env files when platform vars are detected.
 * This prevents the bundled .env file from overwriting Railway-injected vars.
 */
import dotenv from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";

// Railway injects vars like RAILWAY_PROJECT_ID, RAILWAY_SERVICE_ID
// Also check if DATABASE_URL is a real (non-localhost) PostgreSQL URL
const isRailway = !!(process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
const hasRealDbUrl = process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost') && !process.env.DATABASE_URL.includes('127.0.0.1');

console.log(`[dotenv] isRailway=${isRailway}, hasRealDbUrl=${hasRealDbUrl}, DATABASE_URL=${process.env.DATABASE_URL ? 'SET' : 'UNSET'}`);

if (isRailway) {
    console.log('[dotenv] Skipping .env load — platform vars detected');
} else {
    // Local dev: load .env files
    const envPath = resolve(process.cwd(), ".env");
    if (existsSync(envPath)) {
        console.log(`[dotenv] Loading ${envPath}`);
        dotenv.config({ path: envPath });
    }

    const localPath = resolve(process.cwd(), ".env.local");
    if (existsSync(localPath)) {
        console.log(`[dotenv] Loading ${localPath} with override`);
        dotenv.config({ path: localPath, override: true });
    }
}
