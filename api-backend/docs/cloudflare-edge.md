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
- Pass the real client IP to origin via `CF-Connecting-IP`; the origin runs with `trustProxy` so
  `req.ip` already reflects it.

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
