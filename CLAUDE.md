# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A tiny Node.js auth backend for Nginx's [`auth_request`](https://nginx.org/en/docs/http/ngx_http_auth_request_module.html) module. A user POSTs username + password to `/gate`; the server allowlists their public IP for a configurable window. Every device behind the same NAT inherits access until the window expires — designed for the smart-TV-on-LAN use case where a phone logs in via the form and the TV streams under the same public IP.

## Commands

- Install: `npm ci`
- Run (production): `node index.js` (loads `.env`)
- Run (local browser testing): `npm run dev` — overrides `TRUST_REMOTE_ADDR=yes` for that process so the form works via `http://localhost:8350` without an Nginx in front. Don't use in production.
- Hash a password: `npm run hashpw -- <password>` (paste output as the value in `users.json`)
- Unit tests: `npm test` (Jest with `NODE_OPTIONS=--experimental-vm-modules` because the project is ESM)
- Single test file: `npm test -- tests/handlers/gate.test.js`
- Single test by name: `npm test -- -t "POST with valid creds"`
- End-to-end smoke: `npm run smoke` — spins up the server with a temp `users.json`, hits every endpoint over real HTTP, asserts status codes, tears down. Override port with `SMOKE_PORT=… npm run smoke`.
- Docker: `docker compose up --build` (publishes port 8350 to localhost only; native Nginx on the host reaches the gate at `http://127.0.0.1:8350`).

## Architecture

The server is plain `node:http` — no framework. `index.js` wires factories and dispatches by URL path.

**Six endpoints**, resolved in the `route()` function at the bottom of `index.js`:

- `GET /gate` — serve `views/gate.html`. The form has no `action`, so POSTs back to whatever URL it was served from.
- `POST /gate` — parse `application/x-www-form-urlencoded`, verify creds, allowlist `X-Forwarded-For`. Two response shapes depending on the `next` form field: with a safe relative `next`, returns `302 Location: <next>`; without, returns `200 OK` with a tiny "Authenticated" body and no redirect (lets the JS path play the gate-open animation and stay on the welcome screen).
- `next` plumbing: GET `/gate` reads `?next=…` from the URL, validates via `isSafeNext` (must start with `/`, not `//`, no backslash, ≤1024 chars), and embeds it as a hidden form field. POST re-validates from the body. Unsafe values collapse to empty — same UX as no-next. Server-side validation runs at both points; the JS in `views/gate.html` mirrors the same check as defense-in-depth before calling `window.location.assign`. Nginx examples use `error_page 401 = @to_gate; @to_gate { return 302 /gate?next=$request_uri; }`. Known imperfection: `$request_uri` isn't URL-encoded by Nginx, so multi-`&` query strings on the original URL get truncated when round-tripped through `next` — single-`?` URLs roundtrip fine.
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

**`X-Forwarded-For` is required** by `/verify`, `/deauth`, `POST /gate`, and `/heartbeat`. Nginx must set it (`proxy_set_header X-Forwarded-For $remote_addr;` — see `examples/nginx-*.conf`). Without it the handlers return 401/400. Don't silently fall back to `req.socket.remoteAddress` — behind Nginx that's the proxy, not the real client, and would effectively allowlist everyone.

**Dev-only escape hatch**: `TRUST_REMOTE_ADDR=yes` (config flag, off by default) lets the credentialed handlers fall back to `req.socket.remoteAddress` when XFF is missing. Designed for local `npm start` testing in a browser at `http://localhost:8350` without an Nginx in front. XFF still wins when both are present, so a misconfigured prod box with the flag accidentally on still does the right thing — but production should leave it off.

**Users live in `users.json`** as a flat `{username: bcryptHash}` map (no nested objects). Hashes generated via `npm run hashpw -- <password>`. Bcrypt comparison is in `lib/auth.js`. The file is gitignored — there's no committed template; create it from scratch on a fresh deploy.

**Config via `.env`**, committed with sensible defaults — there are no secrets in env. Only `users.json` carries secrets and stays gitignored. If you ever add a secret-bearing env var (e.g. session secret), revisit `.gitignore` and reintroduce a `.env.example` template.

## Test setup gotcha

ESM + Jest requires `NODE_OPTIONS=--experimental-vm-modules` (set in the `test` script). Use `import { jest } from '@jest/globals'`. When mocking a POST body in handler tests, send `Buffer` chunks via `Readable.from([Buffer.from(body, 'utf8')])` — real `http.IncomingMessage` yields `Buffer` chunks and `Buffer.concat` rejects strings. See `tests/handlers/gate.test.js:23` for the canonical fixture.
