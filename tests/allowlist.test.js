import { describe, test, expect } from '@jest/globals';
import { createAllowlist } from '../lib/allowlist.js';

const setup = ({ fixed = 8 * 3600 * 1000, sliding = 30 * 60 * 1000, t = 0 } = {}) => {
    const clock = { now: t };
    const al = createAllowlist({
        fixedTimeout: fixed,
        slidingTimeout: sliding,
        now: () => clock.now,
    });
    return { al, clock };
};

describe('allowlist', () => {
    test('add then check returns true', () => {
        const { al } = setup();
        al.add('1.2.3.4', 'alice');
        expect(al.check('1.2.3.4')).toBe(true);
    });

    test('check on unknown IP returns false', () => {
        const { al } = setup();
        expect(al.check('9.9.9.9')).toBe(false);
    });

    test('check refreshes lastModifiedAt within sliding window', () => {
        const { al, clock } = setup({ sliding: 1000 });
        clock.now = 0;
        al.add('1.1.1.1', 'u');
        clock.now = 800;
        expect(al.check('1.1.1.1')).toBe(true);
        clock.now = 1700;
        expect(al.check('1.1.1.1')).toBe(true);
    });

    test('sliding cap evicts an idle entry', () => {
        const { al, clock } = setup({ sliding: 1000 });
        clock.now = 0;
        al.add('1.1.1.1', 'u');
        clock.now = 1500;
        expect(al.check('1.1.1.1')).toBe(false);
        expect(al.size()).toBe(0);
    });

    test('fixed cap evicts even when sliding is fresh', () => {
        const { al, clock } = setup({ fixed: 2000, sliding: 10_000 });
        clock.now = 0;
        al.add('1.1.1.1', 'u');
        clock.now = 1000;
        expect(al.check('1.1.1.1')).toBe(true);
        clock.now = 2500;
        expect(al.check('1.1.1.1')).toBe(false);
        expect(al.size()).toBe(0);
    });

    test('remove deletes an entry and returns true; false if absent', () => {
        const { al } = setup();
        al.add('1.1.1.1', 'u');
        expect(al.remove('1.1.1.1')).toBe(true);
        expect(al.remove('1.1.1.1')).toBe(false);
    });

    test('fixed-only mode: sliding never fires regardless of inactivity', () => {
        const clock = { now: 0 };
        const al = createAllowlist({
            fixedTimeout: 5000,
            slidingTimeout: null,
            now: () => clock.now,
        });
        al.add('1.1.1.1', 'u');
        clock.now = 4000; // long past any reasonable sliding window
        expect(al.check('1.1.1.1')).toBe(true);
        clock.now = 5500; // past fixed
        expect(al.check('1.1.1.1')).toBe(false);
    });

    test('sweep removes expired entries and leaves valid ones; returns count removed', () => {
        const clock = { now: 0 };
        const al = createAllowlist({ fixedTimeout: 1000, slidingTimeout: null, now: () => clock.now });
        clock.now = 0;
        al.add('1.1.1.1', 'a');
        clock.now = 1400;
        al.add('2.2.2.2', 'b');
        clock.now = 1500;
        // 1.1.1.1: created at 0, age 1500 >= 1000 → expired
        // 2.2.2.2: created at 1400, age 100 < 1000 → still valid
        const removed = al.sweep();
        expect(removed).toBe(1);
        expect(al.size()).toBe(1);
        expect(al._entries.has('2.2.2.2')).toBe(true);
        expect(al._entries.has('1.1.1.1')).toBe(false);
    });

    test('sweep on empty map returns 0 and is safe', () => {
        const { al } = setup();
        expect(al.sweep()).toBe(0);
    });

    test('sliding-only mode: fixed never fires regardless of total elapsed', () => {
        const clock = { now: 0 };
        const al = createAllowlist({
            fixedTimeout: null,
            slidingTimeout: 1000,
            now: () => clock.now,
        });
        al.add('1.1.1.1', 'u');
        // Refresh repeatedly past any reasonable fixed cap
        for (let t = 500; t <= 100_000; t += 500) {
            clock.now = t;
            expect(al.check('1.1.1.1')).toBe(true);
        }
        // Now go idle
        clock.now += 1500;
        expect(al.check('1.1.1.1')).toBe(false);
    });
});
