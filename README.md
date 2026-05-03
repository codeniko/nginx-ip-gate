# nginx-ip-gate

Tiny Node.js auth backend for the Nginx [`auth_request`](https://nginx.org/en/docs/http/ngx_http_auth_request_module.html) module inspired by [`zuavra/nginx-ip-whitelister`](https://github.com/zuavra/nginx-ip-whitelister).

A user POSTs username + password to `/gate` from any device on the LAN; the server allowlists their public IP for a configurable window. Every device behind the same NAT (TVs, casting devices) inherits access until the window expires.

> **Be mindful using this from public WiFi, hotels, cafés, cellular networks, or work — it allows every device on that network to access your apps. Only run behind HTTPS.

## How it works

```
                 not allowlisted              allowlisted
                  ┌───────────────┐            ┌───────────────┐
   Browser ──┬──> │ Nginx         │ ─302 /gate │ Nginx         │ ──> upstream app
             │    │ + auth_request│            │ + auth_request│
             │    │   ↓           │            │   ↓ /verify   │
             │    │   /verify 401 │            │   200 OK      │
             │    └───────────────┘            └───────────────┘
             │            │
             │            │ 302 to /gate?next=<original-url>
             │            ↓
             │     ┌───────────────┐    POST /gate    ┌───────────────┐
             └─────│ /gate (form)  │ ───────────────> │ allowlist.add │
                   └───────────────┘                  │ → 302 to next │
                                                      └───────────────┘
```

For each request to a protected app, Nginx fires a subrequest to `/verify`. If the requester's IP is in the in-memory allowlist, the subrequest returns 200 and the original request proceeds to the upstream. If not, Nginx 302s the user to `/gate?next=<original-url>`, which serves a login form. POSTing valid creds adds the IP to the allowlist and 302s back to `next`.

The allowlist is **single, shared, and lives in RAM** — one login covers every gated app behind this Nginx. Entries expire on a configurable timeout policy (fixed cap from login + sliding window of inactivity, either or both). A periodic sweep evicts expired entries to bound memory growth from never-revisited IPs (e.g. dynamic ISP leases).

## Setup

```sh
npm ci

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

Use `npm run dev` when you want to fill in the form via `http://localhost:8350` without an Nginx in front; it sets `TRUST_REMOTE_ADDR=yes` for that one process so the handlers fall back to the connection's source IP. **Don't use it in production** — see the env vars table below.

## Endpoints

| Method | Path         | Purpose                                                                                |
| ------ | ------------ | -------------------------------------------------------------------------------------- |
| GET    | `/gate`      | Login form. Honours `?next=<safe-relative-url>` and embeds it as a hidden form field.  |
| POST   | `/gate`      | Verify creds, allowlist `X-Forwarded-For`. With safe `next`: 302 there. Without: 200.  |
| GET    | `/heartbeat` | Verify Basic-Auth creds, allowlist `X-Forwarded-For`. For routers/cron/automations.    |
| GET    | `/verify`    | `auth_request` target — 200 if IP allowlisted, 401 otherwise                           |
| GET    | `/deauth`    | Remove `X-Forwarded-For` from the allowlist (no auth required)                         |
| GET    | `/health`    | Liveness probe — always 200, no auth, no logging. Used by the Docker HEALTHCHECK.      |

`POST /gate`, `/verify`, `/deauth`, and `/heartbeat` all read `X-Forwarded-For` to identify the client. Nginx must be configured to set it (`proxy_set_header X-Forwarded-For $remote_addr;` — see `examples/`). `GET /gate` (form rendering) and `/health` (liveness probe) don't need it.

For local browser testing without an Nginx in front, set `TRUST_REMOTE_ADDR=yes` (or just run `npm run dev`). The handlers fall back to `req.socket.remoteAddress` when `X-Forwarded-For` is missing. **Don't enable this in production** — it's the only way silent misconfiguration could allowlist Nginx itself.

### `/heartbeat` for routers and automations

A periodic credentialed ping that keeps an IP in the allowlist without anyone touching the form. Authenticate with HTTP Basic Auth (same `users.json` credentials as `/gate`):

```sh
curl -u alice:hunter2 https://example.com/heartbeat
# good 1.2.3.4       ← IP was newly allowlisted
# nochg 1.2.3.4      ← IP was already alive; lastModifiedAt refreshed
```

In a router's "Custom DDNS" UI: server URL `https://example.com/heartbeat`, username/password from `users.json`, update interval comfortably less than `SLIDING_TIMEOUT` (e.g. 5–10 min if sliding is 30m). The router never sees a redirect — responses are always small `text/plain` bodies. Make sure your router has hairpin NAT enabled (almost all do by default) so the request actually goes back through Nginx and gets the right `X-Forwarded-For`.

### Returning users to the URL they were trying to reach

When Nginx 401s an unauthenticated user, the example configs redirect to `/gate?next=$request_uri`. The gate validates `next` (must be a same-host relative path), embeds it as a hidden form field, and on successful login 302s back to it. The hidden field is sent in the POST body — not the URL — so configurations that strip query strings on POST (some Nginx rewrites, CDNs, WAFs) don't break the redirect.

**Open-redirect protection.** `next` is only honored if it starts with a single `/`, doesn't start with `//`, contains no backslashes, and is ≤ 1024 chars. Anything unsafe is silently collapsed to empty — same UX as no `next` at all (form authenticates, doors open, no redirect). Validation runs on both GET and POST.

**Known limitation.** Nginx interpolates `$request_uri` raw into the redirect URL without URL-encoding, so original URLs with `&`-separated query parameters (e.g. `/app1?a=1&b=2`) lose everything after the first `&` when round-tripped through `next`. Single-`?` query strings roundtrip fine.

## Nginx config

See `examples/nginx-host-based.conf` (one server block per app), `examples/nginx-path-based.conf` (multiple apps on different paths in one server block), and `examples/nginx-http-ip-gate.conf` (optional http-level rate-limit snippet — see below).

### Rate limiting `/gate` and `/heartbeat` (opt-in)

Each POST to `/gate` or hit on `/heartbeat` runs a bcrypt compare (~100ms). Without a limit, async-fired requests can both brute-force credentials AND tie up the gate's event loop, stalling legitimate `/verify` traffic. The example configs include `limit_req` directives for this protection, but they're **commented out by default** so a fresh install passes `nginx -t` with no extra setup. Two steps to enable:

**1. Install the http-block snippet** (once). The `limit_req_zone` directive must live at the `http {}` level, not inside any server block, so it ships as a separate file:

```sh
sudo cp examples/nginx-http-ip-gate.conf /etc/nginx/conf.d/
```

That snippet contains one line:

```nginx
limit_req_zone $binary_remote_addr zone=gate_login:10m rate=10r/m;
```

It defines *what* the limit is: a per-IP token bucket refilling at 10 requests per minute. `10m` of shared memory holds ~160k unique IP entries.

**2. Uncomment the `limit_req` lines** in your server-block config. Look for two lines that match `# limit_req zone=gate_login burst=5 nodelay;` (one in `/gate`, one in `/heartbeat`) and remove the leading `#`. Then:

```sh
sudo nginx -t && sudo systemctl reload nginx
```

If you uncomment the `limit_req` lines without installing the snippet, `nginx -t` will fail with `"zero size shared memory zone gate_login"`.

The `burst=5 nodelay` parameters matter:

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
| `PORT`            | `8350`          | Port to listen on                    |
| `HOST`            | `0.0.0.0`       | Interface to bind                    |
| `USERS_FILE`      | `./users.json`  | Path to bcrypt-hash map              |
| `FIXED_TIMEOUT`   | (unset)         | Hard cap from login. `Nd|Nh|Nm|Ns`.  |
| `SLIDING_TIMEOUT` | (unset)         | Inactivity timeout. Same format.     |
| `SWEEP_INTERVAL`  | `24h`           | How often to evict expired entries from the in-memory map. Cleanup-only; doesn't affect when an IP loses access. |
| `TRUST_REMOTE_ADDR` | `no`          | **Dev only.** When `yes`, falls back to `req.socket.remoteAddress` if `X-Forwarded-For` is missing. Lets you test the form via `http://localhost:8350` without an Nginx in front. Leave unset in production. |
| `DEBUG`           | `no`            | `yes` to log every request           |

At least one of `FIXED_TIMEOUT` and `SLIDING_TIMEOUT` must be set; setting both means an entry expires at whichever fires first. Recommended starting point: `FIXED_TIMEOUT=8h SLIDING_TIMEOUT=30m`.

## Tests

```sh
npm test            # unit tests (Jest)
npm run smoke       # end-to-end: spins up the server with a temp users file, hits every endpoint, reports
```

## Docker

The shipped `docker-compose.yaml` pulls the CI-built image from GitHub Container Registry and runs it as a container that publishes port 8350 to **localhost only** (not exposed on your LAN). Your Nginx (running on the host) reaches it at `http://127.0.0.1:8350`.

```sh
# Create users.json (see Setup above), then:
docker compose up -d

# Verify the container is up and healthy
docker compose ps
```

To build locally from the Dockerfile instead of pulling, see the comments in `docker-compose.yaml`.

In your Nginx config, the `proxy_pass` lines all point at `http://127.0.0.1:8350/...`.

**Why bind to localhost only.** The gate has no business being directly reachable from outside the host — it should only ever be hit via your reverse proxy. Binding to `127.0.0.1:8350` keeps it that way without you having to do anything. If you ever need to run Nginx on a different machine from the gate, change the bind to `0.0.0.0:8350` and put TLS + auth (or a private network) in front.
