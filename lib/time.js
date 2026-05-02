const multipliers = {
    d: 24 * 60 * 60,
    h: 60 * 60,
    m: 60,
    s: 1,
};

export const parseInterval = (interval) => {
    const str = String(interval || '');
    const match = str.match(/^([1-9]\d*)([dhms])$/i);
    if (!match) return null;
    const amount = parseInt(match[1], 10);
    const unit = multipliers[match[2].toLowerCase()];
    return amount * unit * 1000;
};

export const logTimestamp = (date = new Date()) => {
    const offset = date.getTimezoneOffset() * 6e4;
    return new Date(date.getTime() - offset).toISOString().replace('T', ' ').replace('Z', '');
};
