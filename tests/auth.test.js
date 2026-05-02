import { describe, test, expect } from '@jest/globals';
import bcrypt from 'bcryptjs';
import { createAuth } from '../lib/auth.js';

const PW = 'hunter2';
const HASH = bcrypt.hashSync(PW, 4); // low cost: tests run fast

describe('auth', () => {
    test('valid creds verify', async () => {
        const auth = createAuth({ alice: HASH });
        await expect(auth.verify('alice', PW)).resolves.toBe(true);
    });

    test('wrong password rejects', async () => {
        const auth = createAuth({ alice: HASH });
        await expect(auth.verify('alice', 'nope')).resolves.toBe(false);
    });

    test('unknown user rejects', async () => {
        const auth = createAuth({ alice: HASH });
        await expect(auth.verify('eve', PW)).resolves.toBe(false);
    });

    test('empty password rejects', async () => {
        const auth = createAuth({ alice: HASH });
        await expect(auth.verify('alice', '')).resolves.toBe(false);
    });
});
