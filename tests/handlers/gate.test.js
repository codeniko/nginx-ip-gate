import { describe, test, expect, jest } from '@jest/globals';
import { Readable } from 'node:stream';
import { createGateHandler } from '../../handlers/gate.js';

const TEMPLATE = '<form>{{ERROR}}</form>';

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

const reqWith = ({ method, headers = {}, body = '' }) => {
    const stream = Readable.from([Buffer.from(body, 'utf8')]);
    stream.method = method;
    stream.headers = headers;
    return stream;
};

describe('gate handler', () => {
    test('GET serves the form', async () => {
        const allowlist = { add: jest.fn() };
        const auth = { verify: jest.fn() };
        const handler = createGateHandler({ template: TEMPLATE, allowlist, auth, logger: mockLogger() });
        const res = mockRes();
        await handler(reqWith({ method: 'GET' }), res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain('<form>');
        expect(res.body).not.toContain('{{ERROR}}');
        expect(allowlist.add).not.toHaveBeenCalled();
    });

    test('POST with missing X-Forwarded-For returns 400', async () => {
        const allowlist = { add: jest.fn() };
        const auth = { verify: jest.fn(() => true) };
        const handler = createGateHandler({ template: TEMPLATE, allowlist, auth, logger: mockLogger() });
        const res = mockRes();
        await handler(
            reqWith({ method: 'POST', body: 'username=alice&password=hunter2' }),
            res,
        );
        expect(res.statusCode).toBe(400);
        expect(allowlist.add).not.toHaveBeenCalled();
    });

    test('POST with valid creds adds IP and 302s to ./', async () => {
        const allowlist = { add: jest.fn() };
        const auth = { verify: jest.fn(async () => true) };
        const handler = createGateHandler({ template: TEMPLATE, allowlist, auth, logger: mockLogger() });
        const res = mockRes();
        await handler(
            reqWith({
                method: 'POST',
                headers: { 'x-forwarded-for': '1.2.3.4' },
                body: 'username=alice&password=hunter2',
            }),
            res,
        );
        expect(auth.verify).toHaveBeenCalledWith('alice', 'hunter2');
        expect(allowlist.add).toHaveBeenCalledWith('1.2.3.4', 'alice');
        expect(res.statusCode).toBe(302);
        expect(res.headers.Location).toBe('./');
    });

    test('POST with bad creds returns 401 and does not allowlist', async () => {
        const allowlist = { add: jest.fn() };
        const auth = { verify: jest.fn(async () => false) };
        const handler = createGateHandler({ template: TEMPLATE, allowlist, auth, logger: mockLogger() });
        const res = mockRes();
        await handler(
            reqWith({
                method: 'POST',
                headers: { 'x-forwarded-for': '1.2.3.4' },
                body: 'username=alice&password=wrong',
            }),
            res,
        );
        expect(allowlist.add).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(res.body).toContain('Invalid');
    });

    test('non-GET/POST returns 405', async () => {
        const allowlist = { add: jest.fn() };
        const auth = { verify: jest.fn() };
        const handler = createGateHandler({ template: TEMPLATE, allowlist, auth, logger: mockLogger() });
        const res = mockRes();
        await handler(reqWith({ method: 'PUT' }), res);
        expect(res.statusCode).toBe(405);
    });

    test('error message in form is HTML-escaped', async () => {
        const allowlist = { add: jest.fn() };
        const auth = { verify: jest.fn(async () => false) };
        const handler = createGateHandler({
            template: '{{ERROR}}',
            allowlist,
            auth,
            logger: mockLogger(),
        });
        const res = mockRes();
        await handler(
            reqWith({
                method: 'POST',
                headers: { 'x-forwarded-for': '1.2.3.4' },
                body: 'username=x&password=y',
            }),
            res,
        );
        expect(res.body).not.toContain('<');
    });
});
