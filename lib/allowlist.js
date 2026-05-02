export const createAllowlist = ({ fixedTimeout, slidingTimeout, now = () => Date.now() }) => {
    const entries = new Map();

    const isExpired = (entry, t) => {
        if (fixedTimeout != null && t - entry.createdAt >= fixedTimeout) return true;
        if (slidingTimeout != null && t - entry.lastModifiedAt >= slidingTimeout) return true;
        return false;
    };

    return {
        add(ip, user) {
            const t = now();
            entries.set(ip, { createdAt: t, lastModifiedAt: t, user });
        },
        check(ip) {
            const entry = entries.get(ip);
            if (!entry) return false;
            const t = now();
            if (isExpired(entry, t)) {
                entries.delete(ip);
                return false;
            }
            entry.lastModifiedAt = t;
            return true;
        },
        remove(ip) {
            return entries.delete(ip);
        },
        sweep() {
            const t = now();
            let removed = 0;
            for (const [ip, entry] of entries) {
                if (isExpired(entry, t)) {
                    entries.delete(ip);
                    removed++;
                }
            }
            return removed;
        },
        size: () => entries.size,
        _entries: entries,
    };
};
