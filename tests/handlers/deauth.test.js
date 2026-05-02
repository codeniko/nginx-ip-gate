import { describe, test, expect, jest } from '@jest/globals';
import { createDeauthHandler } from '../../handlers/deauth.js';

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

describe('deauth handler', () => {
    test('non-GET returns 405', () => {
        const allowlist = { remove: jest.fn() };
        const handler = createDeauthHandler({ allowlist, logger: mockLogger() });
        const res = mockRes();
        handler({ method: 'POST', headers: {} }, res);
        expect(res.statusCode).toBe(405);
    });

    test('missing X-Forwarded-For returns 400', () => {
        const allowlist = { remove: jest.fn() };
        const handler = createDeauthHandler({ allowlist, logger: mockLogger() });
        const res = mockRes();
        handler({ method: 'GET', headers: {} }, res);
        expect(res.statusCode).toBe(400);
        expect(allowlist.remove).not.toHaveBeenCalled();
    });

    test('removes IP and returns 200 when present', () => {
        const allowlist = { remove: jest.fn(() => true) };
        const handler = createDeauthHandler({ allowlist, logger: mockLogger() });
        const res = mockRes();
        handler({ method: 'GET', headers: { 'x-forwarded-for': '1.2.3.4' } }, res);
        expect(allowlist.remove).toHaveBeenCalledWith('1.2.3.4');
        expect(res.statusCode).toBe(200);
    });

    test('idempotent: returns 200 even when IP not present', () => {
        const allowlist = { remove: jest.fn(() => false) };
        const handler = createDeauthHandler({ allowlist, logger: mockLogger() });
        const res = mockRes();
        handler({ method: 'GET', headers: { 'x-forwarded-for': '1.2.3.4' } }, res);
        expect(res.statusCode).toBe(200);
    });
});
