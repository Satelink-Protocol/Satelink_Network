import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createClaimsRouter } from '../src/routes/claims_route.mjs';

// Pins T-02 (audit/04_BUILD_PLAN.md): claims_route.mjs must not accept the
// hard-coded literal 'satelink-first-claim-2026' as a valid admin secret.
// Any self-registered JWT + that literal previously reached admin endpoints
// that reassign revenue and allocate earnings (02_INVENTORY.md §4 B6).
//
// Required contract after the fix:
//   - ADMIN_BACKFILL_SECRET unset  -> 503 (misconfigured), regardless of body
//   - ADMIN_BACKFILL_SECRET set, body sends the OLD LITERAL -> 403 (rejected)
//   - ADMIN_BACKFILL_SECRET set, body matches it            -> guard passes
//     (proven by reaching the next check downstream of the secret gate)

const JWT_SECRET = process.env.JWT_SECRET;
const OLD_LITERAL = 'satelink-first-claim-2026';

function signToken() {
    return jwt.sign({ userId: 'u1', role: 'admin' }, JWT_SECRET, { expiresIn: '5m' });
}

// Minimal pool: only used once a request gets past the secret gate.
function makePool({ connectShouldReject = false } = {}) {
    return {
        async query() { return { rows: [], rowCount: 0 }; },
        async connect() {
            if (connectShouldReject) throw new Error('no DB in this test');
            return {
                async query() { return { rows: [], rowCount: 0 }; },
                release() {},
            };
        },
    };
}

function buildApp(pool) {
    const app = express();
    app.use(express.json());
    app.use('/api/nodes', createClaimsRouter(pool));
    return app;
}

describe('claims_route — T-02 admin secret (no hard-coded fallback)', () => {
    const originalSecret = process.env.ADMIN_BACKFILL_SECRET;
    afterEach(() => {
        if (originalSecret === undefined) delete process.env.ADMIN_BACKFILL_SECRET;
        else process.env.ADMIN_BACKFILL_SECRET = originalSecret;
    });

    describe('POST /admin/backfill-revenue', () => {
        it('ADMIN_BACKFILL_SECRET unset -> 503, even with the old literal', async () => {
            delete process.env.ADMIN_BACKFILL_SECRET;
            const app = buildApp(makePool());
            const res = await request(app)
                .post('/api/nodes/admin/backfill-revenue')
                .set('Authorization', `Bearer ${signToken()}`)
                .send({ nodeId: 'n1', adminSecret: OLD_LITERAL });
            expect(res.status).to.equal(503);
        });

        it('ADMIN_BACKFILL_SECRET set -> the old literal is rejected (403)', async () => {
            process.env.ADMIN_BACKFILL_SECRET = 'a-real-secret';
            const app = buildApp(makePool());
            const res = await request(app)
                .post('/api/nodes/admin/backfill-revenue')
                .set('Authorization', `Bearer ${signToken()}`)
                .send({ nodeId: 'n1', adminSecret: OLD_LITERAL });
            expect(res.status).to.equal(403);
        });

        it('ADMIN_BACKFILL_SECRET set -> the correct secret passes the gate', async () => {
            process.env.ADMIN_BACKFILL_SECRET = 'a-real-secret';
            const app = buildApp(makePool());
            const res = await request(app)
                .post('/api/nodes/admin/backfill-revenue')
                .set('Authorization', `Bearer ${signToken()}`)
                .send({ adminSecret: 'a-real-secret' }); // no nodeId -> proves we reached the next check
            expect(res.status).to.equal(400);
            expect(res.body.error).to.match(/nodeId required/);
        });
    });

    describe('POST /admin/allocate-earnings', () => {
        it('ADMIN_BACKFILL_SECRET unset -> 503, even with the old literal', async () => {
            delete process.env.ADMIN_BACKFILL_SECRET;
            const app = buildApp(makePool());
            const res = await request(app)
                .post('/api/nodes/admin/allocate-earnings')
                .set('Authorization', `Bearer ${signToken()}`)
                .send({ nodeId: 'n1', adminSecret: OLD_LITERAL });
            expect(res.status).to.equal(503);
        });

        it('ADMIN_BACKFILL_SECRET set -> the old literal is rejected (403)', async () => {
            process.env.ADMIN_BACKFILL_SECRET = 'a-real-secret';
            const app = buildApp(makePool());
            const res = await request(app)
                .post('/api/nodes/admin/allocate-earnings')
                .set('Authorization', `Bearer ${signToken()}`)
                .send({ nodeId: 'n1', adminSecret: OLD_LITERAL });
            expect(res.status).to.equal(403);
        });

        it('ADMIN_BACKFILL_SECRET set -> the correct secret passes the gate', async () => {
            process.env.ADMIN_BACKFILL_SECRET = 'a-real-secret';
            const app = buildApp(makePool());
            const res = await request(app)
                .post('/api/nodes/admin/allocate-earnings')
                .set('Authorization', `Bearer ${signToken()}`)
                .send({ adminSecret: 'a-real-secret' }); // no nodeId -> proves we reached the next check
            expect(res.status).to.equal(400);
            expect(res.body.error).to.match(/nodeId required/);
        });
    });

    describe('POST /admin/close-epoch', () => {
        it('ADMIN_BACKFILL_SECRET unset -> 503, even with the old literal', async () => {
            delete process.env.ADMIN_BACKFILL_SECRET;
            const app = buildApp(makePool());
            const res = await request(app)
                .post('/api/nodes/admin/close-epoch')
                .set('Authorization', `Bearer ${signToken()}`)
                .send({ adminSecret: OLD_LITERAL });
            expect(res.status).to.equal(503);
        });

        it('ADMIN_BACKFILL_SECRET set -> the old literal is rejected (403)', async () => {
            process.env.ADMIN_BACKFILL_SECRET = 'a-real-secret';
            const app = buildApp(makePool());
            const res = await request(app)
                .post('/api/nodes/admin/close-epoch')
                .set('Authorization', `Bearer ${signToken()}`)
                .send({ adminSecret: OLD_LITERAL });
            expect(res.status).to.equal(403);
        });

        it('ADMIN_BACKFILL_SECRET set -> the correct secret passes the gate', async () => {
            process.env.ADMIN_BACKFILL_SECRET = 'a-real-secret';
            // connect() rejects -> proves we got past the secret gate into the DB code
            // (500, not 403/503).
            const app = buildApp(makePool({ connectShouldReject: true }));
            const res = await request(app)
                .post('/api/nodes/admin/close-epoch')
                .set('Authorization', `Bearer ${signToken()}`)
                .send({ adminSecret: 'a-real-secret' });
            expect(res.status).to.equal(500);
        });
    });

    // The build plan's literal acceptance command sends the secret as an
    // `Authorization: Bearer` header. The route never reads it from there —
    // it reads `req.body.adminSecret`, behind `verifyJWT` (which requires a
    // real JWT in that same header). This documents that the plan's literal
    // command is a false negative: it returns 401 from verifyJWT regardless
    // of this fix, so it cannot be used to prove the fix works either way.
    it('build-plan literal acceptance command does not exercise this fix (401 from verifyJWT, not the secret gate)', async () => {
        process.env.ADMIN_BACKFILL_SECRET = 'a-real-secret';
        const app = buildApp(makePool());
        const res = await request(app)
            .post('/api/nodes/admin/backfill-revenue')
            .set('Authorization', `Bearer ${OLD_LITERAL}`) // not a valid JWT
            .send({ nodeId: 'n1' }); // no adminSecret in body
        expect(res.status).to.equal(401);
        expect(res.body.code).to.equal('UNAUTHENTICATED'); // rejected by verifyJWT, never reaches the secret check
    });

    it('the literal string is not present anywhere in the source file', async () => {
        const fs = await import('fs');
        const src = fs.readFileSync(new URL('../src/routes/claims_route.mjs', import.meta.url), 'utf8');
        expect(src).to.not.include(OLD_LITERAL);
    });
});
