#!/usr/bin/env node
// End-to-end smoke: spawns the server with a temp users file, hits every
// endpoint over real HTTP, asserts response codes, tears down. Run via
// `npm run smoke`.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const PASSWORD = 'hunter2';
const IP = '1.2.3.4';
const PORT = process.env.SMOKE_PORT || '3137';
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const tmp = mkdtempSync(join(tmpdir(), 'nginx-ip-gate-smoke-'));
const usersFile = join(tmp, 'users.json');
writeFileSync(usersFile, JSON.stringify({ alice: bcrypt.hashSync(PASSWORD, 4) }));

const child = spawn(process.execPath, ['index.js'], {
    cwd: projectRoot,
    env: {
        ...process.env,
        USERS_FILE: usersFile,
        PORT,
        FIXED_TIMEOUT: '8h',
        SLIDING_TIMEOUT: '30m',
        DEBUG: 'no',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
});

let serverStdout = '';
child.stdout.on('data', (c) => { serverStdout += c; });
let serverStderr = '';
child.stderr.on('data', (c) => { serverStderr += c; });

const cleanup = () => {
    if (!child.killed) child.kill();
    rmSync(tmp, { recursive: true, force: true });
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

await waitForListening();

const cases = [
    ['/verify before login',            () => req('GET',  '/verify',    { ip: IP }),                                            401],
    ['GET /gate serves form',           () => req('GET',  '/gate'),                                                              200],
    ['POST /gate bad creds',            () => req('POST', '/gate',      { ip: IP, body: 'username=alice&password=wrong' }),     401],
    ['POST /gate good creds',           () => req('POST', '/gate',      { ip: IP, body: `username=alice&password=${PASSWORD}` }),200],
    ['POST /gate good creds + next',    () => req('POST', '/gate',      { ip: IP, body: `username=alice&password=${PASSWORD}&next=/app1` }), 302],
    ['/verify after login',             () => req('GET',  '/verify',    { ip: IP }),                                            200],
    ['/verify from other IP',           () => req('GET',  '/verify',    { ip: '9.9.9.9' }),                                     401],
    ['/deauth removes IP',              () => req('GET',  '/deauth',    { ip: IP }),                                            200],
    ['/verify after deauth',            () => req('GET',  '/verify',    { ip: IP }),                                            401],
    ['/verify with no X-Forwarded-For', () => req('GET',  '/verify'),                                                            401],
    ['/health (no auth, no XFF)',       () => req('GET',  '/health'),                                                            200],
    ['/heartbeat without auth',         () => req('GET',  '/heartbeat', { ip: IP }),                                            401],
    ['/heartbeat with bad creds',       () => req('GET',  '/heartbeat', { ip: IP, basicAuth: ['alice', 'wrong'] }),             401],
    ['/heartbeat with good creds',      () => req('GET',  '/heartbeat', { ip: IP, basicAuth: ['alice', PASSWORD] }),            200],
    ['/verify after heartbeat',         () => req('GET',  '/verify',    { ip: IP }),                                            200],
    ['GET /unknown',                    () => req('GET',  '/unknown'),                                                           404],
];

console.log('nginx-ip-gate smoke\n');
let failed = 0;
for (const [name, fn, expected] of cases) {
    let got;
    try {
        got = (await fn()).status;
    } catch (e) {
        got = `error: ${e.message}`;
    }
    const ok = got === expected;
    if (!ok) failed++;
    const tag = ok ? '  ok  ' : 'FAIL  ';
    const detail = ok ? `(${got})` : `(got ${got}, expected ${expected})`;
    console.log(`${tag}${name.padEnd(34)} ${detail}`);
}

console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed) {
    console.log('\n--- server stdout ---\n' + serverStdout);
    console.log('--- server stderr ---\n' + serverStderr);
}
process.exit(failed === 0 ? 0 : 1);

// ---------- helpers ----------

function waitForListening(timeoutMs = 5000) {
    return new Promise((res, rej) => {
        const start = Date.now();
        const tick = setInterval(() => {
            if (serverStdout.includes('listening on')) {
                clearInterval(tick);
                res();
            } else if (child.exitCode != null) {
                clearInterval(tick);
                rej(new Error(`Server exited early (code ${child.exitCode})\nstderr:\n${serverStderr}`));
            } else if (Date.now() - start > timeoutMs) {
                clearInterval(tick);
                rej(new Error(`Server did not start within ${timeoutMs}ms\nstdout:\n${serverStdout}\nstderr:\n${serverStderr}`));
            }
        }, 25);
    });
}

function req(method, path, { ip, body, basicAuth } = {}) {
    return new Promise((res, rej) => {
        const headers = {};
        if (ip) headers['x-forwarded-for'] = ip;
        if (body) {
            headers['content-type'] = 'application/x-www-form-urlencoded';
            headers['content-length'] = Buffer.byteLength(body);
        }
        if (basicAuth) {
            const [user, pass] = basicAuth;
            headers['authorization'] = 'Basic ' + Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
        }
        const r = http.request({ method, host: '127.0.0.1', port: PORT, path, headers }, (resp) => {
            const chunks = [];
            resp.on('data', (c) => chunks.push(c));
            resp.on('end', () => res({ status: resp.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: resp.headers }));
        });
        r.on('error', rej);
        if (body) r.write(body);
        r.end();
    });
}
