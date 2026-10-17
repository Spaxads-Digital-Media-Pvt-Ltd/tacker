# Testing clicks and postbacks

How to test the tracker end to end: on your own machine first, then with real external trackers (Everflow,
Trackier, Voluum, RedTrack). The test catalog (`npm run seed:test-catalog -- <network-slug>`) gives you
advertisers, partners and 15 offers with different settings to test against.

## The two URLs that matter

| | URL | Who calls it |
|---|---|---|
| **Tracking link** | `https://<tracking-domain>/click?offer_id=<OFFER_REF>&pub_id=<PARTNER_REF>&sub1=<THEIR_CLICK_ID>` | The visitor's browser (sent by a partner or an external tracker) |
| **Postback** | `https://<tracking-domain>/postback?click_id=<OUR_CLICK_ID>&txn_id=<ORDER_ID>&status=approved&secure_code=<CODE>` | The advertiser's server, or the tracker it uses, when the visitor converts |

- `secure_code` is required. Find it in **Settings › Security**. A postback without the right code is refused (403).
- Optional postback parameters: `event=purchase` (the goal / event), `payout=` and `revenue=` (override the amounts), `sale_amount=` (the order value used by percentage / RevShare offers), `status=pending|rejected`.
- Our click id reaches the advertiser through the offer's destination URL macro `{click_id}`. The test offers all add `click_id={click_id}`, so you can read it in the landing page's address bar.
- Partner postbacks (Partners › a partner › Postbacks) can use these macros: `{click_id}` (ours), `{sub1}`…`{sub5}` (what the partner sent — usually **their** click id), `{payout}`, `{currency}`, `{event}`, `{txn_id}`, `{conversion_id}`, `{offer_id}`, `{publisher_id}`.

## 0. GEO (countries) — set this up first

Country rules (Offer › GEO allow / block lists, per-country payouts and landing pages) and geo targeting need a
**GeoIP database** on the tracking server. Without one, the tracker can't tell where a visitor is, so it lets
every country through. That's why allowed and blocked countries seemed to do nothing.

1. Get a database. Run `cd api-backend && npm run geoip:download`. Choose one source:
   - **MaxMind GeoLite2 (recommended for production)**: create a free account at maxmind.com, go to *Manage
     License Keys*, create a key, and put `MAXMIND_LICENSE_KEY=…` in `api-backend/.env`. It's updated twice a
     week and includes region codes, postal codes and US DMA codes.
   - **DB-IP Lite (no account)**: used automatically when there's no MaxMind key. It's updated monthly, under
     CC BY 4.0, so show the credit "IP Geolocation by DB-IP" somewhere in the product. It has region *names* but
     no postal or DMA codes.
   - **Behind Cloudflare** the tracker also reads Cloudflare's `CF-IPCountry` header (country only) when the
     database doesn't know an IP.
2. Check it's loaded: `curl -s localhost:4002/health`, then look for `"geoip": {"city": "data/geoip/…", "enforced": true}`.
   The tracker picks up a new file within 10 minutes, without a restart.
3. Keep it fresh: re-run the download weekly (MaxMind) or monthly (DB-IP), for example from cron.
4. Test countries on your own machine. Your own address (127.0.0.1) has no country, so use one of these:
   - pretend to be a visitor from somewhere:
     `curl -sI -H 'X-Forwarded-For: 49.36.0.1' 'http://localhost:4002/click?offer_id=1&pub_id=1'`
     Sample IPs: 49.36.0.1 India · 8.8.4.4 US · 81.2.69.142 UK · 77.88.55.88 Russia · 114.114.114.114 China;
   - or force a country in development: `&geo=US`, or a country and region with `&geo=US-CA`;
   - or open the tunnel URL (section 2) on a phone or through a VPN. Real visitor IPs arrive through ngrok.
5. Countries can be set in **two places**: Offer › GEO, and Edit Offer › Targeting › Country. A click has to
   pass both. If they don't overlap, for example GEO "allow US, CA" with Targeting "include IN", nothing gets
   through. The offer API now returns `configWarnings` describing a conflict like this.
6. Region rules (GEO with a region): enter the code (`CA` or `US-CA`) or the name (`California`). The most
   specific rule wins: country + region, then country, then `*`.

## 1. Test locally (no external tracker)

1. Keep `npm run dev` running in `api-backend` (it includes the workers, which save clicks and send partner postbacks).
2. Open a test link from the seed output, e.g. the debug offer:
   `http://localhost:4002/click?offer_id=15&pub_id=1&sub1=my-test-1&geo=US`
   It shows exactly what the tracker passed, including `click_id`. Add `&geo=US` (or another country) on
   localhost, where the visitor's country can't be detected.
3. Fire the conversion in the browser, or with curl:
   `http://localhost:4002/postback?click_id=<click_id>&txn_id=order-1&status=approved&secure_code=<CODE>`
4. Check the results:
   - **Reports › Conversion** — the conversion and its payout.
   - **Reports › Advertiser Postback** — every postback received, and why one was refused.
   - **Reports › Partner Postback** — what was sent on to the partner (the test partners post to httpbin.org,
     which answers 200).
   - **Reports › Click** — rejected clicks and the reason, such as "Geo not allowed" or "Partner pending approval".
5. Try the different behaviours:
   - `offer_id=1&geo=IN` → rejected, because GEO allows only US and CA.
   - `pub_id=5` → rejected, because the partner is pending.
   - `offer_id=14` → rejected, because the offer is paused.
   - `offer_id=4`: send `&event=lead`, then `&event=purchase` → two conversions on one click.
   - `offer_id=2` or `offer_id=5` with `&sale_amount=40` → revenue is a percentage of the sale.
   - `offer_id=13` → the conversion arrives as pending (manual approval).
   - The **Postback tester** (`/app/aff-postback-test`) sends a sample postback to any URL and shows the reply.

6. **Coupon codes (no click).** Give a partner a coupon (Partners › Coupon Codes, or Offer › Coupons). The
   advertiser posts the sale with the coupon instead of a click id:
   `http://localhost:4002/postback?coupon_code=TEST10&txn_id=order-2&sale_amount=40&status=approved&secure_code=<CODE>`
   It's credited to the coupon's partner on that offer. Always send a `txn_id`, so a retry isn't counted twice.
7. **Deep links.** On an offer with *Allow deep links*, a partner can send a visitor to another page of the
   advertiser's site, for example `&url=https%3A%2F%2Fwww.amazon.com%2Fdp%2FB0TEST`. The click id is still added
   the way the offer URL passes it. A page on any other site is ignored, so it can't be used as an open redirect.

## 2. Make the tracker reachable from the internet

External trackers call your postback URL from their servers, so `localhost` won't do. Run:

```bash
cd api-backend
npm run tunnel -- test        # your network's slug
```

It prints a public `https://xxxx.ngrok-free.app` URL and registers it as a tracking domain for the network.
Use that URL in place of `http://localhost:4002` below. Keep it running; a free ngrok URL changes every time
you restart it. Browsers see ngrok's warning page once; server-to-server calls are not affected.

## 3. External tracker as the PARTNER's tracker (traffic comes to you)

Your partner buys traffic and tracks it in Voluum, RedTrack, Everflow or Trackier. They send visitors to your
tracking link with their click id in `sub1`, and you post the conversion back to them.

**In the external tracker:** add an offer whose URL is your tracking link, with their click-id macro in `sub1`:

| Tracker | Offer URL to paste there |
|---|---|
| Voluum | `https://<tunnel>/click?offer_id=1&pub_id=1&sub1={clickid}` |
| RedTrack | `https://<tunnel>/click?offer_id=1&pub_id=1&sub1={clickid}` |
| Everflow (as the partner's network) | `https://<tunnel>/click?offer_id=1&pub_id=1&sub1={transaction_id}` |
| Trackier (as the partner's network) | `https://<tunnel>/click?offer_id=1&pub_id=1&sub1={click_id}` |

**In this tracker:** go to Partners › that partner › Postbacks and add their postback URL, with `{sub1}` where
their click id goes:

| Tracker | Partner postback URL to add here |
|---|---|
| Voluum | `https://<your-voluum-domain>/postback?cid={sub1}&payout={payout}&txid={txn_id}` |
| RedTrack | `https://<your-redtrack-domain>/postback?clickid={sub1}&sum={payout}` |
| Everflow | `https://<everflow-tracking-domain>/?nid=<YOUR_EVERFLOW_NID>&transaction_id={sub1}&amount={payout}` |
| Trackier | `https://<trackier-domain>/acquisition?click_id={sub1}&security_token=<THEIR_TOKEN>&txn_id={txn_id}` |

**Then:**

1. Open the external tracker's campaign link. It redirects to your link and on to the landing page.
2. Copy our `click_id` from the landing page URL and fire the postback (section 1, step 3).
3. The conversion appears here, the partner postback fires, and the external tracker shows the conversion.

This direction works even without the tunnel, because your own browser follows the redirects and your server
sends the postback out.

## 4. External tracker as the ADVERTISER's tracker (conversions come to you)

Your advertiser tracks sales in Everflow, Trackier, Voluum or RedTrack. Your offer sends visitors to their
link with our click id, and their system posts the conversion back to you. This needs the tunnel.

**In this tracker:** set the offer's destination URL to their link, with `{click_id}` in their click-id parameter:

| Tracker | Destination URL (set on your offer) | Postback URL to paste in their system |
|---|---|---|
| Everflow | their partner link + `?sub1={click_id}` | `https://<tunnel>/postback?click_id={sub1}&txn_id={transaction_id}&payout={payout_amount}&status=approved&secure_code=<CODE>` |
| Trackier | their publisher link + `&p1={click_id}` | `https://<tunnel>/postback?click_id={p1}&txn_id={txn_id}&status=approved&secure_code=<CODE>` |
| Voluum (you as their traffic source) | their campaign URL + `&cid={click_id}` (the traffic source's external-id parameter) | `https://<tunnel>/postback?click_id={externalid}&payout={payout}&status=approved&secure_code=<CODE>` |
| RedTrack (you as their traffic channel) | their campaign URL + their click-id parameter `={click_id}` | `https://<tunnel>/postback?click_id={ref_id}&payout={payout}&status=approved&secure_code=<CODE>` |

In Everflow the postback goes under Partners › your partner account › Postbacks. In Trackier it's the
publisher (global) postback. In Voluum it's the Traffic Source postback URL. In RedTrack it's the Traffic
channel postback.

**Then:**

1. Click your tracking link. It goes to their link and then to their landing page.
2. Record a conversion in their system: Everflow and Trackier have test or manual conversions; in Voluum or
   RedTrack, open their own postback URL with their click id.
3. Their system fires your postback, and the conversion appears in Reports › Conversion. Reports › Advertiser
   Postback shows each request, including refused ones (wrong code, unknown click).

## When something doesn't record

| Advertiser Postback says | Why | Fix |
|---|---|---|
| `security_failed` | `secure_code` is missing or wrong | Copy it again from Settings › Security |
| `click_not_found` | The click id isn't ours, or the click was rejected | Use the `click_id` from the landing page URL; check Reports › Click |
| `duplicate` | The same `txn_id` (or no `txn_id`) for the same event | Send a new `txn_id`, or change the offer's duplicate rule |
| 404 `unknown_tracking_host` | The domain isn't registered | Run `npm run tunnel -- <slug>` again (free ngrok URLs change) |

| Partner Postback says | Why | Fix |
|---|---|---|
| no attempt | The partner has no postback for that offer or event, or the conversion is still pending | Add one under Partners › Postbacks; approve the conversion |
