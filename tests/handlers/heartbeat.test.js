import { describe, test, expect, jest } from '@jest/globals';
import { createHeartbeatHandler } from '../../handlers/heartbeat.js';

const mockRes = () => {
    const res = {
        statusCode: 0,
        headers: {},
        body: '',
        setHeader: jest.fn((k, v) => { res.headers[k] = v; }),
        end: jest.fn((b) => { res.body = b ?? ''; }),
    };
    return res;
};

const mockLogger = () => ({ log: jest.fn() });

const basicAuth = (user, pass) =>
    'Basic ' + Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');

const newHandler = (overrides = {}) => {
    const allowlist = { add: jest.fn(), check: jest.fn(() => false), ...overrides.allowlist };
    const auth = { verify: jest.fn(async () => true), ...overrides.auth };
    const logger = mockLogger();
    return {
        handler: createHeartbeatHandler({ allowlist, auth, logger }),
        allowlist,
        auth,
        logger,
    };
};

describe('heartbeat handler', () => {
    test('non-GET returns 405', async () => {
        const { handler, allowlist } = newHandler();
        const res = mockRes();
        await handler({ method: 'POST', headers: {} }, res);
        expect(res.statusCode).toBe(405);
        expect(allowlist.add).not.toHaveBeenCalled();
    });

    test('missing X-Forwarded-For returns 400', async () => {
        const { handler, allowlist } = newHandler();
        const res = mockRes();
        await handler({ method: 'GET', headers: { authorization: basicAuth('alice', 'pw') } }, res);
        expect(res.statusCode).toBe(400);
        expect(allowlist.add).not.toHaveBeenCalled();
    });

    test('missing Authorization returns 401 with WWW-Authenticate', async () => {
        const { handler, allowlist } = newHandler();
        const res = mockRes();
        await handler({ method: 'GET', headers: { 'x-forwarded-for': '1.2.3.4' } }, res);
        expect(res.statusCode).toBe(401);
        expect(res.headers['WWW-Authenticate']).toMatch(/Basic/);
        expect(allowlist.add).not.toHaveBeenCalled();
    });

    test('non-Basic Authorization scheme returns 401', async () => {
        const { handler, allowlist } = newHandler();
        const res = mockRes();
        await handler({
            method: 'GET',
            headers: { 'x-forwarded-for': '1.2.3.4', authorization: 'Bearer some-token' },
        }, res);
        expect(res.statusCode).toBe(401);
        expect(allowlist.add).not.toHaveBeenCalled();
    });

    test('basic auth without colon returns 401', async () => {
        const { handler, allowlist } = newHandler();
        const res = mockRes();
        const malformed = 'Basic ' + Buffer.from('noColonInside').toString('base64');
        await handler({
            method: 'GET',
            headers: { 'x-forwarded-for': '1.2.3.4', authorization: malformed },
        }, res);
        expect(res.statusCode).toBe(401);
        expect(allowlist.add).not.toHaveBeenCalled();
    });

    test('bad credentials return 401 + challenge', async () => {
        const { handler, allowlist } = newHandler({ auth: { verify: jest.fn(async () => false) } });
        const res = mockRes();
        await handler({
            method: 'GET',
            headers: { 'x-forwarded-for': '1.2.3.4', authorization: basicAuth('alice', 'wrong') },
        }, res);
        expect(res.statusCode).toBe(401);
        expect(res.headers['WWW-Authenticate']).toMatch(/Basic/);
        expect(allowlist.add).not.toHaveBeenCalled();
    });

    test('valid creds + new IP: adds and returns 200 "good"', async () => {
        const { handler, allowlist, auth } = newHandler();
        const res = mockRes();
        await handler({
            method: 'GET',
            headers: { 'x-forwarded-for': '1.2.3.4', authorization: basicAuth('alice', 'hunter2') },
        }, res);
        expect(auth.verify).toHaveBeenCalledWith('alice', 'hunter2');
        expect(allowlist.add).toHaveBeenCalledWith('1.2.3.4', 'alice');
        expect(res.statusCode).toBe(200);
        expect(res.body).toBe('good 1.2.3.4\n');
    });

    test('valid creds + already alive: no add, returns 200 "nochg"', async () => {
        const { handler, allowlist } = newHandler({
            allowlist: { add: jest.fn(), check: jest.fn(() => true) },
        });
        const res = mockRes();
        await handler({
            method: 'GET',
            headers: { 'x-forwarded-for': '1.2.3.4', authorization: basicAuth('alice', 'hunter2') },
        }, res);
        expect(allowlist.check).toHaveBeenCalledWith('1.2.3.4');
        expect(allowlist.add).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(200);
        expect(res.body).toBe('nochg 1.2.3.4\n');
    });

    test('password containing colon is split correctly (only first colon separates user from pass)', async () => {
        const { handler, auth } = newHandler();
        const res = mockRes();
        await handler({
            method: 'GET',
            headers: {
                'x-forwarded-for': '1.2.3.4',
                authorization: basicAuth('alice', 'pass:with:colons'),
            },
        }, res);
        expect(auth.verify).toHaveBeenCalledWith('alice', 'pass:with:colons');
    });
});
