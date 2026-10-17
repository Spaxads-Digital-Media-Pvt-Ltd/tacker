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

## 5. Test the other pricing and attribution features

The test catalog has an offer for each (refs 16–20 on the `test` network; the seed prints yours). `<CODE>` is your
secure code (Settings › Security). On localhost, add `-H 'X-Forwarded-For: <some IP>'` to give each visitor its
own address, because the fraud check flags an address after 30 clicks a minute.

**CPC: paid per click** (Google Display, payout model CPC, Revenue Action "Click"). Each unique, valid click from a
partner is a *paid click*: the partner earns 0.30, the advertiser is billed 0.50, and the ledger books it. Nothing
else to send. It shows in Reports › Conversion with source `click` and event `click`. In reports it counts as
money, not as a conversion. A repeat click from the same visitor, or a flagged click, isn't paid. A partner
postback with level **CPC** fires for each paid click.

```bash
curl -sI -H 'X-Forwarded-For: 198.51.100.7' 'http://localhost:4002/click?offer_id=16&pub_id=1'
```

**Impressions and CPM** (YouTube Pre-roll, payout model CPM, Revenue Action "Impression"). The partner puts the
impression pixel where the ad shows:
`<img src="https://<tracking-domain>/impression?offer_id=17&pub_id=1&sub1=…" width="1" height="1">`.
Each impression goes through the same checks as a click and is recorded (Reports › Impression), with the reason
when it's rejected. Valid impressions are booked as money every few minutes: 2.00 / 5.00 per 1,000. Add
`&format=json` to get `{ impression_id }` back. With an **Impression URL** on the offer, the pixel redirects the
browser there with `{imp_id}` filled in (an MMP's view-through link, for example). Reports can show
`metrics=impressions,unique_impressions,invalid_impressions,ctr`.

**View-through** (same offer, Attribution › View-Through, 24 h). A conversion with no click is credited to the
partner whose impression the visitor saw:

```bash
curl -s 'http://localhost:4002/impression?offer_id=17&pub_id=1&format=json'   # → impression_id
curl -s 'http://localhost:4002/postback?impression_id=<IMPRESSION_ID>&txn_id=vt-1&status=approved&secure_code=<CODE>'
# or without the id: &offer_id=17&ip=<the visitor's IP> — or the pixel on the thank-you page (it sends the cookie)
```

**Email ownership** (Netflix Subscription, Attribution › Email Ownership). A conversion with `&email=` makes its
partner the customer's owner. A later postback with the email and `offer_id`, but no click id, is credited to the
owner, for example a subscription rebill:

```bash
curl -s 'http://localhost:4002/postback?click_id=<CLICK_ID>&email=jane@example.com&txn_id=sub-1&status=approved&secure_code=<CODE>'
curl -s 'http://localhost:4002/postback?offer_id=18&email=jane@example.com&txn_id=rebill-1&status=approved&secure_code=<CODE>'
```

Set the owner rule and window in Attribution: first or last partner, and the number of days. Only a hash of the
address is stored.

**Price per product** (Amazon Fashion, Revenue › Price Per Product). The postback lists the order's products. Each
line is priced by its product rule: SKU `SHOE-1` pays 5.00 a unit and bills 20 %, category `electronics` pays
3 %, and anything else gets the base rate, 1.00 a unit with 10 % revenue. Manage the rules with
`GET|POST /api/offers/:id/products` and `PATCH|DELETE /api/offers/:id/products/:productId`.

```bash
curl -s "http://localhost:4002/postback?click_id=<CLICK_ID>&txn_id=order-9&status=approved&secure_code=<CODE>&products=$(python3 -c 'import urllib.parse,json;print(urllib.parse.quote(json.dumps([{"sku":"SHOE-1","price":"50","quantity":2},{"sku":"TV-9","category":"electronics","price":"300","quantity":1}])))')"
# one product as plain parameters: &sku=SHOE-1&quantity=3&price=10
```

**Direct linking** (Booking Direct, Click Tracking Type "Redirect + Direct"). Partners link straight to the
advertiser's page, `https://www.booking.com/?offer_id=20&pub_id=1&sub1=…`, and the advertiser's page has the tag:
`<script src="https://<tracking-domain>/sdk.js" data-auto-click></script>`. On the thank-you page:
`trk.conversion({ event: 'purchase', txn_id: 'ORDER-1' })`. `GET /api/offers/:id/links?publisherId=…` returns the
direct link, the impression pixel and the tag. A click the tag sends from any other site is ignored.

**24metrics** (Attribution › 24metrics Tracker, with your 24metrics integration ID). Every click is checked by
24metrics in the background:
- **Rejected:** the click is flagged `24metrics:<reason>`, its conversions wait as pending, and the address is
  blocked for a day.
- **Approved:** its conversions are reported to 24metrics.

Without an account, run the stand-in: `npm run dev:fake-24metrics` (port 4799; it rejects 203.0.113.66). Then
put `TRACKER24_GATEWAY_URL=http://localhost:4799/{id}` in `api-backend/.env`, restart, and click with
`-H 'X-Forwarded-For: 203.0.113.66'`.

## When something doesn't record

| Advertiser Postback says | Why | Fix |
|---|---|---|
| `security_failed` | `secure_code` is missing or wrong | Copy it again from Settings › Security |
| `click_not_found` | The click id isn't ours, or the click was rejected | Use the `click_id` from the landing page URL; check Reports › Click |
| `duplicate` | The same `txn_id` (or no `txn_id`) for the same event | Send a new `txn_id`, or change the offer's duplicate rule |
| 404 `unknown_tracking_host` | The domain isn't registered | Run `npm run tunnel -- <slug>` again (free ngrok URLs change) |
| `unknown_impression` | No valid impression with that id, the offer has view-through off, or the window passed | Check Reports › Impression; turn on Attribution › View-Through |
| `unknown_email` | Nobody owns that customer's email on the offer (or the ownership window ended) | Send the first conversion with `&email=` and its click id |
| pending, `24metrics_flagged` | 24metrics rejected the click | Review it in Reports › Conversion (approve or reject) |

| Partner Postback says | Why | Fix |
|---|---|---|
| no attempt | The partner has no postback for that offer or event, or the conversion is still pending | Add one under Partners › Postbacks; approve the conversion |
