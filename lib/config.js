import { parseInterval } from './time.js';

const parseTimeout = (name, raw) => {
    if (raw == null || raw === '') return null;
    const parsed = parseInterval(raw);
    if (parsed == null) {
        throw new Error(`Invalid ${name}: ${JSON.stringify(raw)}. Use Nd|Nh|Nm|Ns (e.g. "8h", "30m").`);
    }
    return parsed;
};

export const loadConfig = (env = process.env) => {
    const fixedTimeout = parseTimeout('FIXED_TIMEOUT', env.FIXED_TIMEOUT);
    const slidingTimeout = parseTimeout('SLIDING_TIMEOUT', env.SLIDING_TIMEOUT);
    if (fixedTimeout == null && slidingTimeout == null) {
        throw new Error('At least one of FIXED_TIMEOUT or SLIDING_TIMEOUT must be set.');
    }
    const sweepInterval = parseTimeout('SWEEP_INTERVAL', env.SWEEP_INTERVAL) ?? parseInterval('24h');
    return {
        port: parseInt(env.PORT, 10) || 3000,
        host: env.HOST || '0.0.0.0',
        usersFile: env.USERS_FILE || './users.json',
        fixedTimeout,
        slidingTimeout,
        sweepInterval,
        trustRemoteAddr: String(env.TRUST_REMOTE_ADDR || '').toLowerCase() === 'yes',
        debug: String(env.DEBUG || '').toLowerCase() === 'yes',
    };
};
