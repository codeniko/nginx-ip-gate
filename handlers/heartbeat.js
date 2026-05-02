const REALM = 'nginx-ip-gate';

const challenge = (res, body = 'UNAUTHORIZED') => {
    res.statusCode = 401;
    res.setHeader('WWW-Authenticate', `Basic realm="${REALM}"`);
    res.end(body);
};

const decodeBasicAuth = (header) => {
    const match = /^Basic\s+(.+)$/i.exec(header || '');
    if (!match) return null;
    let decoded;
    try {
        decoded = Buffer.from(match[1], 'base64').toString('utf8');
    } catch {
        return null;
    }
    const colon = decoded.indexOf(':');
    if (colon < 0) return null;
    return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
};

export const createHeartbeatHandler = ({ allowlist, auth, logger }) => async (req, res) => {
    if (req.method !== 'GET') {
        res.statusCode = 405;
        res.setHeader('Allow', 'GET');
        return res.end('METHOD NOT ALLOWED');
    }

    const ip = req.headers['x-forwarded-for'];
    if (!ip) {
        logger.log('heartbeat: missing X-Forwarded-For');
        res.statusCode = 400;
        return res.end('MISSING X-FORWARDED-FOR');
    }

    const creds = decodeBasicAuth(req.headers['authorization']);
    if (!creds) return challenge(res);

    const ok = await auth.verify(creds.username, creds.password);
    if (!ok) {
        logger.log(`heartbeat: rejected login for "${creds.username}" from ${ip}`);
        return challenge(res);
    }

    // check() refreshes lastModifiedAt if present + valid; we use its return
    // to decide between DynDNS-style "good" (new) vs "nochg" (already alive).
    const wasAlive = allowlist.check(ip);
    if (!wasAlive) {
        allowlist.add(ip, creds.username);
        logger.log(`heartbeat: allowlisted ${ip} as "${creds.username}"`);
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(`${wasAlive ? 'nochg' : 'good'} ${ip}\n`);
};
