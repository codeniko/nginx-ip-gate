import { describe, test, expect } from '@jest/globals';
import { loadConfig } from '../lib/config.js';

const baseEnv = { USERS_FILE: './users.json' };

describe('config: timeout validation', () => {
    test('both timeouts set: both parsed', () => {
        const cfg = loadConfig({ ...baseEnv, FIXED_TIMEOUT: '8h', SLIDING_TIMEOUT: '30m' });
        expect(cfg.fixedTimeout).toBe(8 * 3600 * 1000);
        expect(cfg.slidingTimeout).toBe(30 * 60 * 1000);
    });

    test('fixed-only is allowed; sliding is null', () => {
        const cfg = loadConfig({ ...baseEnv, FIXED_TIMEOUT: '4h' });
        expect(cfg.fixedTimeout).toBe(4 * 3600 * 1000);
        expect(cfg.slidingTimeout).toBe(null);
    });

    test('sliding-only is allowed; fixed is null', () => {
        const cfg = loadConfig({ ...baseEnv, SLIDING_TIMEOUT: '15m' });
        expect(cfg.fixedTimeout).toBe(null);
        expect(cfg.slidingTimeout).toBe(15 * 60 * 1000);
    });

    test('neither set: throws', () => {
        expect(() => loadConfig({ ...baseEnv })).toThrow(/at least one/i);
    });

    test('empty strings count as unset', () => {
        expect(() => loadConfig({ ...baseEnv, FIXED_TIMEOUT: '', SLIDING_TIMEOUT: '' }))
            .toThrow(/at least one/i);
    });

    test('invalid format throws (not silently ignored)', () => {
        expect(() => loadConfig({ ...baseEnv, FIXED_TIMEOUT: '8 hours' }))
            .toThrow(/Invalid FIXED_TIMEOUT/);
    });
});

describe('config: sweep interval', () => {
    test('defaults to 24h when unset', () => {
        const cfg = loadConfig({ ...baseEnv, FIXED_TIMEOUT: '8h' });
        expect(cfg.sweepInterval).toBe(24 * 3600 * 1000);
    });

    test('respects override', () => {
        const cfg = loadConfig({ ...baseEnv, FIXED_TIMEOUT: '8h', SWEEP_INTERVAL: '15m' });
        expect(cfg.sweepInterval).toBe(15 * 60 * 1000);
    });

    test('invalid value throws', () => {
        expect(() => loadConfig({ ...baseEnv, FIXED_TIMEOUT: '8h', SWEEP_INTERVAL: 'bogus' }))
            .toThrow(/Invalid SWEEP_INTERVAL/);
    });
});

describe('config: trust remote addr', () => {
    test('defaults to false when unset', () => {
        const cfg = loadConfig({ ...baseEnv, FIXED_TIMEOUT: '8h' });
        expect(cfg.trustRemoteAddr).toBe(false);
    });

    test('"yes" → true (case-insensitive)', () => {
        const cfg1 = loadConfig({ ...baseEnv, FIXED_TIMEOUT: '8h', TRUST_REMOTE_ADDR: 'yes' });
        const cfg2 = loadConfig({ ...baseEnv, FIXED_TIMEOUT: '8h', TRUST_REMOTE_ADDR: 'YES' });
        expect(cfg1.trustRemoteAddr).toBe(true);
        expect(cfg2.trustRemoteAddr).toBe(true);
    });

    test('"no" / anything else → false', () => {
        const cfgNo = loadConfig({ ...baseEnv, FIXED_TIMEOUT: '8h', TRUST_REMOTE_ADDR: 'no' });
        const cfgWeird = loadConfig({ ...baseEnv, FIXED_TIMEOUT: '8h', TRUST_REMOTE_ADDR: 'true' });
        expect(cfgNo.trustRemoteAddr).toBe(false);
        expect(cfgWeird.trustRemoteAddr).toBe(false);
    });
});
