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
