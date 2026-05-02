# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A tiny Node.js auth backend for Nginx's [`auth_request`](https://nginx.org/en/docs/http/ngx_http_auth_request_module.html) module. A user POSTs username + password to `/gate`; the server allowlists their public IP for a configurable window. Every device behind the same NAT inherits access until the window expires — designed for the smart-TV-on-LAN use case where a phone logs in via the form and the TV streams under the same public IP.

## Commands

- Install: `npm install`
- Run: `node index.js` (loads `.env`)
- Hash a password: `npm run hashpw -- <password>` (paste output as the value in `users.json`)
- Unit tests: `npm test` (Jest with `NODE_OPTIONS=--experimental-vm-modules` because the project is ESM)
- Single test file: `npm test -- tests/handlers/gate.test.js`
- Single test by name: `npm test -- -t "POST with valid creds"`
- End-to-end smoke: `npm run smoke` — spins up the server with a temp `users.json`, hits every endpoint over real HTTP, asserts status codes, tears down. Override port with `SMOKE_PORT=… npm run smoke`.
- Docker: `docker compose up --build` (publishes port 3000 to localhost only; native Nginx on the host reaches the gate at `http://127.0.0.1:3000`).

## Architecture

The server is plain `node:http` — no framework. `index.js` wires factories and dispatches by URL path.

**Six endpoints**, resolved in the `route()` function at the bottom of `index.js`:

- `GET /gate` — serve `views/gate.html`. The form has no `action`, so POSTs back to whatever URL it was served from.
- `POST /gate` — parse `application/x-www-form-urlencoded`, verify creds, allowlist `X-Forwarded-For`, respond `302 Location: ./`. The relative location resolves correctly under both `/gate` (host-based) and `/jellyfin/gate` (path-based) deployments without the gate caring about the prefix.
- `GET /heartbeat` — machine-friendly equivalent of `POST /gate`. HTTP Basic Auth instead of a form body, no redirect, response body is `good <ip>` or `nochg <ip>` (DynDNS protocol convention) so off-the-shelf router DDNS clients render a healthy status. Designed for routers, cron jobs, and home-automation pings.
- `GET /verify` — `auth_request` target. 200 if the IP is allowlisted (refreshes `lastModifiedAt`), 401 otherwise.
- `GET /deauth` — idempotent removal of the requester's IP from the allowlist. No auth.
- `GET /health` — liveness probe for the Docker HEALTHCHECK. Always 200, no auth, no logging, untouched by the allowlist. Inline in `index.js` (no separate handler module) because it's three lines and dependency-free.

**Single shared allowlist** (`lib/allowlist.js`) — `Map<ip, { createdAt, lastModifiedAt, user }>`. One login covers every gated app behind this Nginx; there is intentionally no per-app namespacing. Per-IP eviction is lazy (only on the next `/verify` for that IP), so a periodic `sweep()` runs on `setInterval` from `index.js` to prune entries whose IPs never come back — important for dynamic-IP ISPs where each lease rotation is effectively a new key. Cadence is `SWEEP_INTERVAL` (default `24h`); the interval is `.unref()`'d so it doesn't block shutdown.

**Two timeouts, both optional, at-least-one required** (`lib/config.js:14`).

- `FIXED_TIMEOUT` — hard cap measured from `createdAt` (the login moment). Doesn't move.
- `SLIDING_TIMEOUT` — reset on each successful `/verify`.

When both are set, an entry expires at whichever fires first. Either can be unset (comment it out in `.env`) and the other still enforces alone. Format: `Nd|Nh|Nm|Ns`. Note that a continuously-streaming TV refreshes the sliding timer every chunk request, so in practice the fixed cap is the only thing bounding an active session.

**Factory pattern** — every lib/handler module exports a `create*` function taking deps as parameters (e.g. `createAllowlist({ fixedTimeout, slidingTimeout, now })`). `index.js` is the only place real deps are wired up; tests pass mocks. Keep this shape when adding modules.

**`X-Forwarded-For` is required** by `/verify`, `/deauth`, and `POST /gate`. Nginx must set it (`proxy_set_header X-Forwarded-For $remote_addr;` — see `examples/nginx-*.conf`). Without it the gate returns 401/400. Don't fall back to `req.socket.remoteAddress` — behind Nginx that's the proxy, not the real client.

**Users live in `users.json`** as a flat `{username: bcryptHash}` map (no nested objects). Hashes generated via `npm run hashpw -- <password>`. Bcrypt comparison is in `lib/auth.js`. The file is gitignored — there's no committed template; create it from scratch on a fresh deploy.

**Config via `.env`**, committed with sensible defaults — there are no secrets in env. Only `users.json` carries secrets and stays gitignored. If you ever add a secret-bearing env var (e.g. session secret), revisit `.gitignore` and reintroduce a `.env.example` template.

## Test setup gotcha

ESM + Jest requires `NODE_OPTIONS=--experimental-vm-modules` (set in the `test` script). Use `import { jest } from '@jest/globals'`. When mocking a POST body in handler tests, send `Buffer` chunks via `Readable.from([Buffer.from(body, 'utf8')])` — real `http.IncomingMessage` yields `Buffer` chunks and `Buffer.concat` rejects strings. See `tests/handlers/gate.test.js:23` for the canonical fixture.
