const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Open-redirect protection: a `next` value is only safe if it's a same-host
// relative URL — must start with a single `/`, not `//` (scheme-relative
// like `//evil.com`), no backslashes (some browsers treat `\` as `/`), and
// bounded length. Anything else collapses to empty (treated as no redirect).
export const isSafeNext = (s) =>
    typeof s === 'string'
    && s.length > 0 && s.length <= 1024
    && s.startsWith('/')
    && !s.startsWith('//')
    && !s.includes('\\');

const SUCCESS_BODY = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Authenticated</title>
<style>body{font-family:system-ui,sans-serif;max-width:22rem;margin:4rem auto;padding:0 1rem}</style>
</head><body><p>Authenticated. Close this tab or visit your app.</p></body></html>
`;

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
    const render = ({ next = '', error = '' } = {}) =>
        template
            .replace('{{NEXT}}', escapeHtml(next))
            .replace('{{ERROR}}', escapeHtml(error));

    const sanitizeNext = (raw) => {
        if (isSafeNext(raw)) return raw;
        if (raw) logger.log(`gate: ignoring unsafe next param: ${String(raw).slice(0, 80)}`);
        return '';
    };

    return async (req, res) => {
        if (req.method === 'GET') {
            const url = new URL(req.url || '/', 'http://_');
            const next = sanitizeNext(url.searchParams.get('next') || '');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            return res.end(render({ next }));
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
        const next = sanitizeNext(params.get('next') || '');

        const ok = await auth.verify(username, password);
        if (!ok) {
            logger.log(`gate: rejected login for "${username}" from ${ip}`);
            res.statusCode = 401;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            return res.end(render({ next, error: 'Invalid username or password.' }));
        }

        allowlist.add(ip, username);
        logger.log(`gate: allowlisted ${ip} as "${username}"`);

        if (next) {
            // Has a safe return URL — 302 there. Browsers follow it natively;
            // our JS reads the same value from the hidden input and runs the
            // gate-open animation before navigating itself.
            res.statusCode = 302;
            res.setHeader('Location', next);
            return res.end();
        }

        // No return URL — show a tiny "you're in" page for no-JS, signal
        // success (status 200) to JS so it can play the animation without
        // navigating.
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        return res.end(SUCCESS_BODY);
    };
};
