import { describe, test, expect, jest } from '@jest/globals';
import { Readable } from 'node:stream';
import { createGateHandler, isSafeNext } from '../../handlers/gate.js';

const TEMPLATE = '<form>NEXT={{NEXT}} ERROR={{ERROR}}</form>';

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

const reqWith = ({ method, headers = {}, body = '', url = '/gate' }) => {
    const stream = Readable.from([Buffer.from(body, 'utf8')]);
    stream.method = method;
    stream.headers = headers;
    stream.url = url;
    return stream;
};

describe('isSafeNext', () => {
    test.each([
        ['/app1', true],
        ['/app1/movies', true],
        ['/a', true],
        ['/app1?q=1', true],
        ['', false],
        ['app1', false],          // missing leading slash
        ['//evil.com', false],    // scheme-relative
        ['//evil.com/path', false],
        ['https://evil.com', false],
        ['/app\\1', false],       // backslash
        ['/' + 'a'.repeat(2000), false],   // too long
    ])('isSafeNext(%j) → %s', (input, expected) => {
        expect(isSafeNext(input)).toBe(expected);
    });
});

describe('gate handler', () => {
    test('GET serves the form with empty next', async () => {
        const allowlist = { add: jest.fn() };
        const auth = { verify: jest.fn() };
        const handler = createGateHandler({ template: TEMPLATE, allowlist, auth, logger: mockLogger() });
        const res = mockRes();
        await handler(reqWith({ method: 'GET' }), res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toBe('<form>NEXT= ERROR=</form>');
        expect(allowlist.add).not.toHaveBeenCalled();
    });

    test('GET with safe ?next embeds it in the form', async () => {
        const handler = createGateHandler({
            template: TEMPLATE,
            allowlist: { add: jest.fn() },
            auth: { verify: jest.fn() },
            logger: mockLogger(),
        });
        const res = mockRes();
        await handler(reqWith({ method: 'GET', url: '/gate?next=/app1/movies' }), res);
        expect(res.body).toContain('NEXT=/app1/movies');
    });

    test('GET with unsafe ?next collapses to empty (no warn for blank, log for unsafe)', async () => {
        const logger = mockLogger();
        const handler = createGateHandler({
            template: TEMPLATE,
            allowlist: { add: jest.fn() },
            auth: { verify: jest.fn() },
            logger,
        });
        const res = mockRes();
        await handler(reqWith({ method: 'GET', url: '/gate?next=//evil.com' }), res);
        expect(res.body).toContain('NEXT=');
        expect(res.body).not.toContain('evil.com');
        expect(logger.log).toHaveBeenCalledWith(expect.stringMatching(/unsafe next/));
    });

    test('GET with absolute http(s) ?next is rejected', async () => {
        const handler = createGateHandler({
            template: TEMPLATE,
            allowlist: { add: jest.fn() },
            auth: { verify: jest.fn() },
            logger: mockLogger(),
        });
        const res = mockRes();
        await handler(reqWith({ method: 'GET', url: '/gate?next=https://evil.com' }), res);
        expect(res.body).not.toContain('evil.com');
    });

    test('POST with missing X-Forwarded-For returns 400', async () => {
        const allowlist = { add: jest.fn() };
        const auth = { verify: jest.fn(() => true) };
        const handler = createGateHandler({ template: TEMPLATE, allowlist, auth, logger: mockLogger() });
        const res = mockRes();
        await handler(reqWith({ method: 'POST', body: 'username=alice&password=hunter2' }), res);
        expect(res.statusCode).toBe(400);
        expect(allowlist.add).not.toHaveBeenCalled();
    });

    test('POST with valid creds and no next returns 200 (no Location, no redirect)', async () => {
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
        expect(allowlist.add).toHaveBeenCalledWith('1.2.3.4', 'alice');
        expect(res.statusCode).toBe(200);
        expect(res.headers.Location).toBeUndefined();
        expect(res.body).toContain('Authenticated');
    });

    test('POST with valid creds and safe next 302s to next', async () => {
        const allowlist = { add: jest.fn() };
        const auth = { verify: jest.fn(async () => true) };
        const handler = createGateHandler({ template: TEMPLATE, allowlist, auth, logger: mockLogger() });
        const res = mockRes();
        await handler(
            reqWith({
                method: 'POST',
                headers: { 'x-forwarded-for': '1.2.3.4' },
                body: 'username=alice&password=hunter2&next=/app1/movies',
            }),
            res,
        );
        expect(allowlist.add).toHaveBeenCalledWith('1.2.3.4', 'alice');
        expect(res.statusCode).toBe(302);
        expect(res.headers.Location).toBe('/app1/movies');
    });

    test('POST with valid creds and unsafe next behaves like no next (200, no Location)', async () => {
        const allowlist = { add: jest.fn() };
        const auth = { verify: jest.fn(async () => true) };
        const logger = mockLogger();
        const handler = createGateHandler({ template: TEMPLATE, allowlist, auth, logger });
        const res = mockRes();
        await handler(
            reqWith({
                method: 'POST',
                headers: { 'x-forwarded-for': '1.2.3.4' },
                body: 'username=alice&password=hunter2&next=https://evil.com',
            }),
            res,
        );
        expect(allowlist.add).toHaveBeenCalled();
        expect(res.statusCode).toBe(200);
        expect(res.headers.Location).toBeUndefined();
        expect(logger.log).toHaveBeenCalledWith(expect.stringMatching(/unsafe next/));
    });

    test('POST with bad creds returns 401 and preserves next in re-rendered form', async () => {
        const allowlist = { add: jest.fn() };
        const auth = { verify: jest.fn(async () => false) };
        const handler = createGateHandler({ template: TEMPLATE, allowlist, auth, logger: mockLogger() });
        const res = mockRes();
        await handler(
            reqWith({
                method: 'POST',
                headers: { 'x-forwarded-for': '1.2.3.4' },
                body: 'username=alice&password=wrong&next=/app1',
            }),
            res,
        );
        expect(allowlist.add).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(res.body).toContain('NEXT=/app1');
        expect(res.body).toContain('ERROR=Invalid');
    });

    test('non-GET/POST returns 405', async () => {
        const handler = createGateHandler({
            template: TEMPLATE,
            allowlist: { add: jest.fn() },
            auth: { verify: jest.fn() },
            logger: mockLogger(),
        });
        const res = mockRes();
        await handler(reqWith({ method: 'PUT' }), res);
        expect(res.statusCode).toBe(405);
    });

    test('error message in form is HTML-escaped', async () => {
        const handler = createGateHandler({
            template: '{{NEXT}}{{ERROR}}',
            allowlist: { add: jest.fn() },
            auth: { verify: jest.fn(async () => false) },
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

    test('next value is HTML-escaped when embedded', async () => {
        // Should be safe — / is allowed but other special chars should be escaped.
        // Construct a "safe" next that still has a quote that needs escaping.
        const handler = createGateHandler({
            template: '{{NEXT}}',
            allowlist: { add: jest.fn() },
            auth: { verify: jest.fn() },
            logger: mockLogger(),
        });
        const res = mockRes();
        await handler(reqWith({ method: 'GET', url: '/gate?next=' + encodeURIComponent('/foo"bar') }), res);
        expect(res.body).not.toContain('"bar');
        expect(res.body).toContain('&quot;');
    });
});
