import { describe, test, expect, jest } from '@jest/globals';
import { createVerifyHandler } from '../../handlers/verify.js';

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

describe('verify handler', () => {
    test('non-GET returns 405', () => {
        const allowlist = { check: jest.fn() };
        const handler = createVerifyHandler({ allowlist, logger: mockLogger() });
        const res = mockRes();
        handler({ method: 'POST', headers: {} }, res);
        expect(res.statusCode).toBe(405);
        expect(res.headers.Allow).toBe('GET');
    });

    test('missing X-Forwarded-For returns 401', () => {
        const allowlist = { check: jest.fn() };
        const handler = createVerifyHandler({ allowlist, logger: mockLogger() });
        const res = mockRes();
        handler({ method: 'GET', headers: {} }, res);
        expect(res.statusCode).toBe(401);
        expect(allowlist.check).not.toHaveBeenCalled();
    });

    test('unknown IP returns 401', () => {
        const allowlist = { check: jest.fn(() => false) };
        const handler = createVerifyHandler({ allowlist, logger: mockLogger() });
        const res = mockRes();
        handler({ method: 'GET', headers: { 'x-forwarded-for': '1.2.3.4' } }, res);
        expect(allowlist.check).toHaveBeenCalledWith('1.2.3.4');
        expect(res.statusCode).toBe(401);
    });

    test('rejection log includes X-Original-URI when nginx forwards it', () => {
        const allowlist = { check: jest.fn(() => false) };
        const logger = mockLogger();
        const handler = createVerifyHandler({ allowlist, logger });
        const res = mockRes();
        handler({
            method: 'GET',
            headers: { 'x-forwarded-for': '1.2.3.4', 'x-original-uri': '/app1/foo?bar=baz' },
        }, res);
        expect(logger.log).toHaveBeenCalledWith('verify: rejected 1.2.3.4 -> /app1/foo?bar=baz');
    });

    test('missing-XFF log includes X-Original-URI when present', () => {
        const allowlist = { check: jest.fn() };
        const logger = mockLogger();
        const handler = createVerifyHandler({ allowlist, logger });
        const res = mockRes();
        handler({ method: 'GET', headers: { 'x-original-uri': '/app1/foo' } }, res);
        expect(logger.log).toHaveBeenCalledWith('verify: missing X-Forwarded-For -> /app1/foo');
    });

    test('known IP returns 200', () => {
        const allowlist = { check: jest.fn(() => true) };
        const handler = createVerifyHandler({ allowlist, logger: mockLogger() });
        const res = mockRes();
        handler({ method: 'GET', headers: { 'x-forwarded-for': '1.2.3.4' } }, res);
        expect(res.statusCode).toBe(200);
    });

    test('with trustRemoteAddr=true and no XFF, falls back to socket.remoteAddress', () => {
        const allowlist = { check: jest.fn(() => true) };
        const handler = createVerifyHandler({ allowlist, logger: mockLogger(), trustRemoteAddr: true });
        const res = mockRes();
        handler({ method: 'GET', headers: {}, socket: { remoteAddress: '127.0.0.1' } }, res);
        expect(allowlist.check).toHaveBeenCalledWith('127.0.0.1');
        expect(res.statusCode).toBe(200);
    });

    test('with trustRemoteAddr=true and XFF present, XFF still wins', () => {
        const allowlist = { check: jest.fn(() => true) };
        const handler = createVerifyHandler({ allowlist, logger: mockLogger(), trustRemoteAddr: true });
        const res = mockRes();
        handler({
            method: 'GET',
            headers: { 'x-forwarded-for': '1.2.3.4' },
            socket: { remoteAddress: '127.0.0.1' },
        }, res);
        expect(allowlist.check).toHaveBeenCalledWith('1.2.3.4');
    });
});
