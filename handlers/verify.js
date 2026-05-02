export const createVerifyHandler = ({ allowlist, logger, trustRemoteAddr = false }) => (req, res) => {
    if (req.method !== 'GET') {
        res.statusCode = 405;
        res.setHeader('Allow', 'GET');
        return res.end('METHOD NOT ALLOWED');
    }

    const ip = req.headers['x-forwarded-for'] || (trustRemoteAddr ? req.socket?.remoteAddress : null);
    if (!ip) {
        logger.log('verify: missing X-Forwarded-For');
        res.statusCode = 401;
        return res.end('UNAUTHORIZED');
    }

    if (allowlist.check(ip)) {
        res.statusCode = 200;
        return res.end('OK');
    }

    logger.log(`verify: rejected ${ip}`);
    res.statusCode = 401;
    return res.end('UNAUTHORIZED');
};
