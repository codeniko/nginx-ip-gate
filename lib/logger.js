import { logTimestamp } from './time.js';

export const createLogger = ({ debug = false, scrubStrings = [] } = {}) => {
    const scrub = (s) => scrubStrings.reduce((acc, sec) => sec ? acc.replaceAll(sec, '**SCRUBBED**') : acc, String(s));
    return {
        log: (...args) => {
            if (!debug) return;
            console.log(`[${logTimestamp()}]`, ...args.map(scrub));
        },
    };
};
