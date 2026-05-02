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

    test('known IP returns 200', () => {
        const allowlist = { check: jest.fn(() => true) };
        const handler = createVerifyHandler({ allowlist, logger: mockLogger() });
        const res = mockRes();
        handler({ method: 'GET', headers: { 'x-forwarded-for': '1.2.3.4' } }, res);
        expect(res.statusCode).toBe(200);
    });
});
