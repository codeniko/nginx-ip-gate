import http from 'node:http';
import fs from 'node:fs';
import dotenv from 'dotenv';

import { loadConfig } from './lib/config.js';
import { createLogger } from './lib/logger.js';
import { createAllowlist } from './lib/allowlist.js';
import { loadUsers, createAuth } from './lib/auth.js';
import { createGateHandler } from './handlers/gate.js';
import { createVerifyHandler } from './handlers/verify.js';
import { createDeauthHandler } from './handlers/deauth.js';
import { createHeartbeatHandler } from './handlers/heartbeat.js';

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
});
process.on('uncaughtException', (e) => {
    console.error('Uncaught exception:', e);
    process.exit(1);
});

dotenv.config();
const config = loadConfig();
const logger = createLogger({ debug: config.debug });

const users = loadUsers(config.usersFile);
const auth = createAuth(users);
const allowlist = createAllowlist({
    fixedTimeout: config.fixedTimeout,
    slidingTimeout: config.slidingTimeout,
});

setInterval(() => {
    const removed = allowlist.sweep();
    if (removed > 0) logger.log(`sweep: removed ${removed} expired entries (${allowlist.size()} remain)`);
}, config.sweepInterval).unref();

const gateTemplate = fs.readFileSync(new URL('./views/gate.html', import.meta.url), 'utf8');

const gate = createGateHandler({ template: gateTemplate, allowlist, auth, logger });
const verify = createVerifyHandler({ allowlist, logger });
const deauth = createDeauthHandler({ allowlist, logger });
const heartbeat = createHeartbeatHandler({ allowlist, auth, logger });

// Liveness probe for the Docker HEALTHCHECK. Intentionally silent (no
// logger calls) and untouched by allowlist/auth so it can be hammered
// every few seconds without polluting verify/auth telemetry.
const health = (_, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end('OK\n');
};

const route = (path) => {
    if (path === '/health' || path === '/health/') return health;
    if (path === '/verify' || path === '/verify/') return verify;
    if (path === '/deauth' || path === '/deauth/') return deauth;
    if (path === '/heartbeat' || path === '/heartbeat/') return heartbeat;
    if (path.endsWith('/gate') || path.endsWith('/gate/')) return gate;
    return null;
};

const server = http.createServer((req, res) => {
    const path = (req.url || '/').split('?')[0];
    const handler = route(path);
    if (!handler) {
        res.statusCode = 404;
        return res.end('NOT FOUND');
    }
    Promise.resolve(handler(req, res)).catch((e) => {
        console.error('Handler error:', e);
        if (!res.headersSent) {
            res.statusCode = 500;
            res.end('INTERNAL ERROR');
        }
    });
});

const fmt = (ms) => ms == null ? 'off' : `${ms}ms`;
console.log(`[${new Date().toISOString()}] nginx-ip-gate listening on ${config.host}:${config.port}`);
console.log(`[${new Date().toISOString()}] users: ${Object.keys(users).length}, fixed=${fmt(config.fixedTimeout)} sliding=${fmt(config.slidingTimeout)}`);
server.listen(config.port, config.host);
