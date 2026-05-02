const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Signed out</title>
<style>body{font-family:system-ui,sans-serif;max-width:22rem;margin:4rem auto;padding:0 1rem}</style>
</head><body><p>Signed out. This IP has been removed from the allowlist.</p></body></html>
`;

export const createDeauthHandler = ({ allowlist, logger, trustRemoteAddr = false }) => (req, res) => {
    if (req.method !== 'GET') {
        res.statusCode = 405;
        res.setHeader('Allow', 'GET');
        return res.end('METHOD NOT ALLOWED');
    }

    const ip = req.headers['x-forwarded-for'] || (trustRemoteAddr ? req.socket?.remoteAddress : null);
    if (!ip) {
        res.statusCode = 400;
        return res.end('MISSING X-FORWARDED-FOR');
    }

    const removed = allowlist.remove(ip);
    logger.log(`deauth: ${ip} ${removed ? 'removed' : 'not present'}`);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(PAGE);
};
