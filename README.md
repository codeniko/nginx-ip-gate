# nginx-ip-gate

Tiny Node.js auth backend for the Nginx [`auth_request`](https://nginx.org/en/docs/http/ngx_http_auth_request_module.html) module inspired by [`zuavra/nginx-ip-whitelister`](https://github.com/zuavra/nginx-ip-whitelister).

A user POSTs username + password to `/gate` from any device on the LAN; the server allowlists their public IP for a configurable window. Every device behind the same NAT (TVs, casting devices) inherits access until the window expires.

> **Be mindful using this from public WiFi, hotels, cafés, cellular networks, or work because this allows all the devices on that network from everyone to access your apps. Only run behind HTTPS.

## Setup

```sh
npm install

# Generate a bcrypt hash for your password
npm run hashpw -- mySecret
# → $2a$10$...

# Create users.json with that hash. Format is a flat {username: hash} map:
#   {
#     "alice": "$2a$10$..."
#   }

node index.js          # production
npm run dev            # local browser testing (sets TRUST_REMOTE_ADDR=yes)
```

`users.json` is gitignored. `.env` is committed with sensible defaults — edit it in place to change ports/timeouts. Comment a timeout out to disable just that one (at least one of `FIXED_TIMEOUT`/`SLIDING_TIMEOUT` must remain set).

Use `npm run dev` when you want to fill in the form via `http://localhost:3000` without an Nginx in front; it sets `TRUST_REMOTE_ADDR=yes` for that one process so the handlers fall back to the connection's source IP. **Don't use it in production** — see the env vars table below.

## Endpoints

| Method | Path         | Purpose                                                                                |
| ------ | ------------ | -------------------------------------------------------------------------------------- |
| GET    | `/gate`      | Login form                                                                             |
| POST   | `/gate`      | Verify creds, allowlist `X-Forwarded-For`, redirect to `./`                            |
| GET    | `/heartbeat` | Verify Basic-Auth creds, allowlist `X-Forwarded-For`. For routers/cron/automations.    |
| GET    | `/verify`    | `auth_request` target — 200 if IP allowlisted, 401 otherwise                           |
| GET    | `/deauth`    | Remove `X-Forwarded-For` from the allowlist (no auth required)                         |
| GET    | `/health`    | Liveness probe — always 200, no auth, no logging. Used by the Docker HEALTHCHECK.      |

All endpoints read `X-Forwarded-For`; Nginx must be configured to set it (`proxy_set_header X-Forwarded-For $remote_addr;`).

### `/heartbeat` for routers and automations

A periodic credentialed ping that keeps an IP in the allowlist without anyone touching the form. Authenticate with HTTP Basic Auth (same `users.json` credentials as `/gate`):

```sh
curl -u alice:hunter2 https://example.com/heartbeat
# good 1.2.3.4       ← IP was newly allowlisted
# nochg 1.2.3.4      ← IP was already alive; lastModifiedAt refreshed
```

In a router's "Custom DDNS" UI: server URL `https://example.com/heartbeat`, username/password from `users.json`, update interval comfortably less than `SLIDING_TIMEOUT` (e.g. 5–10 min if sliding is 30m). The router never sees a redirect — responses are always small `text/plain` bodies. Make sure your router has hairpin NAT enabled (almost all do by default) so the request actually goes back through Nginx and gets the right `X-Forwarded-For`.

## Nginx config

See `examples/nginx-host-based.conf` (one server block per app) and `examples/nginx-path-based.conf` (multiple apps on different paths in one server block).

### Rate limiting `/gate` and `/heartbeat`

Each POST to `/gate` or hit on `/heartbeat` runs a bcrypt compare (~100ms). Without a limit, async-fired requests both brute-force credentials AND tie up the gate's event loop, stalling legitimate `/verify` traffic. Both example configs include `limit_req` directives to throttle this. The setup is two pieces in two different places:

**1. Declare the zone at the `http {}` level** (once, in your global Nginx config — *not* inside a server block):

```nginx
limit_req_zone $binary_remote_addr zone=gate_login:10m rate=10r/m;
```

This defines *what* the limit is: a per-IP token bucket refilling at 10 requests per minute. `10m` of shared memory holds ~160k unique IP entries.

**2. Apply it inside each protected location** (`/gate`, `/heartbeat`):

```nginx
limit_req zone=gate_login burst=5 nodelay;
```

This controls *how* the limit is enforced. The two parameters matter:

| Config                                      | Behavior                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `limit_req zone=z;` (no burst)              | One request every 6s. Excess gets 503 immediately. Strict to the point of breaking double-clicks.     |
| `limit_req zone=z burst=5;` (no nodelay)    | First 5 from a flurry queue up and *trickle out* at 1 every 6s. Legitimate users see a long delay.    |
| `limit_req zone=z burst=5 nodelay;` (ours)  | First 5 from a flurry are served **immediately**. After that, rate kicks in (excess → 503/429).       |

In plain words: **per-IP, sustained max 10 attempts/min, with a 5-request burst served instantly.** That covers human double-clicks and router check-in retries comfortably, while capping a brute-force script to ~10/min — slow enough that bcrypt's per-attempt cost makes any reasonable password infeasible to crack online.

Rule of thumb when tuning: `rate` is for the attacker's average; `burst + nodelay` is for the legitimate user's UX.

## Env vars

| Var               | Default         | Notes                                |
| ----------------- | --------------- | ------------------------------------ |
| `PORT`            | `3000`          | Port to listen on                    |
| `HOST`            | `0.0.0.0`       | Interface to bind                    |
| `USERS_FILE`      | `./users.json`  | Path to bcrypt-hash map              |
| `FIXED_TIMEOUT`   | (unset)         | Hard cap from login. `Nd|Nh|Nm|Ns`.  |
| `SLIDING_TIMEOUT` | (unset)         | Inactivity timeout. Same format.     |
| `SWEEP_INTERVAL`  | `24h`           | How often to evict expired entries from the in-memory map. Cleanup-only; doesn't affect when an IP loses access. |
| `TRUST_REMOTE_ADDR` | `no`          | **Dev only.** When `yes`, falls back to `req.socket.remoteAddress` if `X-Forwarded-For` is missing. Lets you test the form via `http://localhost:3000` without an Nginx in front. Leave unset in production. |
| `DEBUG`           | `no`            | `yes` to log every request           |

At least one of `FIXED_TIMEOUT` and `SLIDING_TIMEOUT` must be set; setting both means an entry expires at whichever fires first. Recommended starting point: `FIXED_TIMEOUT=8h SLIDING_TIMEOUT=30m`.

## Tests

```sh
npm test            # unit tests (Jest)
npm run smoke       # end-to-end: spins up the server with a temp users file, hits every endpoint, reports
```

## Docker

The shipped `docker-compose.yaml` runs the gate as a container that publishes port 3000 to **localhost only** (not exposed on your LAN). Your Nginx (running on the host) reaches it at `http://127.0.0.1:3000`.

```sh
# Create users.json (see Setup above), then:
docker compose up -d --build

# Verify the container is up and healthy
docker compose ps
```

In your Nginx config, the `proxy_pass` lines all point at `http://127.0.0.1:3000/...`.

**Why bind to localhost only.** The gate has no business being directly reachable from outside the host — it should only ever be hit via your reverse proxy. Binding to `127.0.0.1:3000` keeps it that way without you having to do anything. If you ever need to run Nginx on a different machine from the gate, change the bind to `0.0.0.0:3000` and put TLS + auth (or a private network) in front.
