const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const readBody = (req, limitBytes = 4096) => new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (c) => {
        total += c.length;
        if (total > limitBytes) {
            reject(new Error('Body too large'));
            req.destroy();
            return;
        }
        chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
});

export const createGateHandler = ({ template, allowlist, auth, logger, trustRemoteAddr = false }) => {
    const render = (error = '') => template.replace('{{ERROR}}', escapeHtml(error));

    return async (req, res) => {
        if (req.method === 'GET') {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            return res.end(render());
        }

        if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Allow', 'GET, POST');
            return res.end('METHOD NOT ALLOWED');
        }

        const ip = req.headers['x-forwarded-for'] || (trustRemoteAddr ? req.socket?.remoteAddress : null);
        if (!ip) {
            logger.log('gate POST: missing X-Forwarded-For');
            res.statusCode = 400;
            return res.end('MISSING X-FORWARDED-FOR');
        }

        let body;
        try {
            body = await readBody(req);
        } catch {
            res.statusCode = 413;
            return res.end('PAYLOAD TOO LARGE');
        }

        const params = new URLSearchParams(body);
        const username = params.get('username') || '';
        const password = params.get('password') || '';

        const ok = await auth.verify(username, password);
        if (!ok) {
            logger.log(`gate: rejected login for "${username}" from ${ip}`);
            res.statusCode = 401;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            return res.end(render('Invalid username or password.'));
        }

        allowlist.add(ip, username);
        logger.log(`gate: allowlisted ${ip} as "${username}"`);
        res.statusCode = 302;
        res.setHeader('Location', './');
        return res.end();
    };
};
