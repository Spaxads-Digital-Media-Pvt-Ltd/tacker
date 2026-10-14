# Cloudflare edge configuration — tracking domain (spec §5, §3B)

The tracking hot path (`/click`, `/postback`, `/pixel`, `/iframe`) sits behind Cloudflare. The edge
does TLS termination, DDoS/WAF protection, and geo/bot signals — but it **must never cache a
tracking response**. Every click is a unique event: caching a 302 would send the wrong destination
(or the wrong `click_id`) to a different user. The origin already sets `Cache-Control: no-store` on
all four endpoints; the rules below make the edge honor that and add protection.

## DNS

- Tracking hostname (e.g. `demo.ourtracking.com`, plus any customer vanity domains) → **A/CNAME to
  origin, proxied (orange cloud)**. Proxying is what puts Cloudflare in the request path.
- Customer vanity domains: onboard via **Cloudflare for SaaS (Custom Hostnames)** so each network
  can point their own domain at us and get an edge cert automatically.

## Cache rules (Rules → Cache Rules)

| Match | Action |
|---|---|
| `Host` is a tracking host **AND** URI path in `/click`, `/postback`, `/pixel`, `/iframe`, `/health`, `/metrics` | **Bypass cache** (Cache eligibility → Bypass) |
| Everything else on the tracking host | Default (respect origin headers — origin sends `no-store` anyway) |

Rationale: bypass is belt-and-suspenders with the origin `no-store`. `/metrics` and `/health` must
never be cached either. Do **not** enable "Cache Everything" on the tracking zone.

## Redirect / performance

- **Argo Smart Routing**: on — shortens origin RTT on the 302, which is pure latency budget.
- **Tiered Cache**: irrelevant here (nothing is cached); leave default.
- **HTTP/2 + HTTP/3 (QUIC)**: on — faster connection setup for the one-shot click request.
- **0-RTT**: on for the tracking zone (idempotent GET redirect; safe).
- Keep **Rocket Loader / Auto Minify / Email Obfuscation OFF** on tracking hosts — they only apply
  to HTML and add nothing to a 302.

## Security

- **WAF**: managed ruleset on. Add a rate-limiting rule keyed on client IP for `/postback` (e.g.
  > 100 req/10s from one IP → managed challenge) to blunt postback abuse; the origin also enforces
  Redis-based caps, this is the outer layer.
- **Bot Fight Mode / Super Bot Fight Mode**: on, but **allow "Verified Bots"** and do NOT challenge
  `/postback` (server-to-server callers are not browsers and will fail a JS challenge).
- **Firewall**: only expose 80/443 at origin; lock the origin to Cloudflare IP ranges (or use
  **cloudflared** tunnel) so nobody bypasses the edge to hit the origin directly.

## Client IP at the origin (how `req.ip` is derived)

No surface reads `CF-Connecting-IP` (or `True-Client-IP` / `X-Real-IP`). Every surface — tracking
(Fastify `trustProxy`), dashboard, public API and platform admin (Express `trust proxy`, set in
`lib/http/express-app.ts`) — derives the client IP from **`X-Forwarded-For` only**, with the one check
in `src/lib/net/trusted-proxy.ts` (O2):

1. Start from the TCP socket peer. If it is not a trusted proxy, that address **is** the client
   and `X-Forwarded-For` is ignored entirely (in production such a direct connection is also
   rejected with 403 by the guard in `tracking/app.ts`).
2. Otherwise walk `X-Forwarded-For` from the **right**, skipping trusted proxies; the first
   untrusted address is the client. Entries to its left (anything the client wrote itself) are
   never used.

Trusted proxies: loopback (`127.0.0.1`, `::1`), Cloudflare's published IPv4 + IPv6 ranges
(pinned in `trusted-proxy.ts` from <https://www.cloudflare.com/ips-v4/> and `/ips-v6/` — re-check
when Cloudflare changes them), plus `TRUSTED_PROXIES` (comma-separated IPs/CIDRs and the keyword
`private` = 10/8, 172.16/12, 192.168/16, fc00::/7; the older `TRACKING_TRUSTED_PROXIES` is merged in).

**AWS + Cloudflare** (Cloudflare → AWS Application Load Balancer → the app): set
`TRUSTED_PROXIES=private` (the load balancer's nodes have VPC addresses) — or the VPC CIDR itself.
The ALB appends the Cloudflare edge address to `X-Forwarded-For`, Cloudflare had appended the visitor's,
so `req.ip` = the visitor. Lock the load balancer's security group to Cloudflare's ranges so nobody can
reach the origin directly (even then a spoofed `X-Forwarded-For` is never believed — see step 2).

Cloudflare appends the visitor's IP to `X-Forwarded-For` by default, so no edge rule is needed.
What the **origin proxy** (Nginx / load balancer) must do — confirm against the real deployment,
this repository contains no Nginx config:

| Origin setup | Result | Action |
|---|---|---|
| Nginx on the same host, `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` | Correct client IP | None |
| Nginx with `real_ip` (`set_real_ip_from` Cloudflare ranges, `real_ip_header CF-Connecting-IP`) then `$proxy_add_x_forwarded_for` | Correct client IP | None |
| Nginx / LB on **another host or container** (e.g. an AWS ALB) | Client IP = the proxy; production guard returns 403 | `TRUSTED_PROXIES=private` (or its address / CIDR) |
| Nginx **overwrites** `X-Forwarded-For` with `$remote_addr` (no `real_ip`) | Click IP = a Cloudflare edge address | Append instead (`$proxy_add_x_forwarded_for`) |
| Cloudflare connects straight to the tracking port (no origin proxy) | Correct client IP | None (the tracking server speaks plain HTTP — TLS must terminate somewhere) |

Local development: a direct request keeps its real socket address (`127.0.0.1`). Because loopback
is trusted, a local client can still set `X-Forwarded-For`; that is expected in dev and is why
loopback must only ever be the same-host Nginx in production.

## Headers the origin sets (do not override at the edge)

| Endpoint | Status | Cache-Control |
|---|---|---|
| `/click` | 302 → destination | `no-store` |
| `/pixel` | 200 (1×1 gif) | `no-store` |
| `/iframe` | 200 (tiny html) | `no-store` |
| `/postback` | 200 JSON | (default; treated as no-store via bypass rule) |

## Observability at the edge

- Enable **Logpush** (HTTP requests) to your log sink so edge-level latency and status codes are
  visible independent of origin metrics.
- Origin latency is on `/metrics` (`tracker_click_redirect_seconds`); edge-added latency is the
  delta between Cloudflare's `EdgeTimeToFirstByte` and origin timing.
