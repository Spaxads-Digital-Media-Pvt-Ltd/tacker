-- Verify fixture for 8-section backfill verification.
-- Uses deterministic UUIDs; idempotent (ON CONFLICT DO NOTHING).
-- Insertion order matters: networks → advertisers → publishers → offers (offers FK advertisers).

-- NETWORK_A: 11111111-1111-1111-1111-111111111111
-- NETWORK_B: 22222222-2222-2222-2222-222222222222

-- 1. Networks
INSERT INTO networks (id, name, slug, status, default_currency, settings)
VALUES
 ('11111111-1111-1111-1111-111111111111', 'Network A', 'network-a', 'active', 'USD', '{}'),
 ('22222222-2222-2222-2222-222222222222', 'Network B', 'network-b', 'active', 'USD', '{}')
ON CONFLICT (id) DO NOTHING;

-- 2. Advertisers (FK networks; must come before offers which reference them)
INSERT INTO advertisers (id, network_id, name, status)
VALUES
 ('aaa11111-aaaa-1111-aaaa-111111111111', '11111111-1111-1111-1111-111111111111', 'Adv A1', 'active'),
 ('bbb11111-bbbb-1111-bbbb-111111111111', '22222222-2222-2222-2222-222222222222', 'Adv B1', 'active')
ON CONFLICT (id) DO NOTHING;

-- 3. Publishers (FK networks)
INSERT INTO publishers (id, network_id, name, status)
VALUES
 ('ccc11111-cccc-1111-cccc-111111111111', '11111111-1111-1111-1111-111111111111', 'Pub A1', 'active'),
 ('ccc22222-cccc-2222-cccc-222222222222', '22222222-2222-2222-2222-222222222222', 'Pub B1', 'active')
ON CONFLICT (id) DO NOTHING;

-- 4. Offers (FK networks + advertisers). Offer ids are valid UUIDs.
INSERT INTO offers (id, network_id, advertiser_id, name, status, destination_url, payout_model, default_payout, default_revenue, currency)
VALUES
 ('a1100001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaa11111-aaaa-1111-aaaa-111111111111', 'Offer A1', 'active', 'https://offer-a1.example.com', 'CPA', 10.0000, 25.0000, 'USD'),
 ('a1100001-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaa11111-aaaa-1111-aaaa-111111111111', 'Offer A2', 'active', 'https://offer-a2.example.com', 'CPA', 20.0000, 50.0000, 'EUR'),
 ('b1100001-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'bbb11111-bbbb-1111-bbbb-111111111111', 'Offer B1', 'active', 'https://offer-b1.example.com', 'CPA', 5.0000, 10.0000, 'BRL')
ON CONFLICT (id) DO NOTHING;

-- 5. Clicks for NETWORK_A — 9 clicks across 5 dates → 5 batches @ batch_size=2
INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, created_at, ip, country, region, city,
 isp, device, os, browser, referrer, user_agent,
 sub1, sub2, sub3, sub4, sub5,
 is_unique, fraud_score, fraud_flags,
 resolved_payout, resolved_revenue, currency, smart_link_id)
VALUES
 ('v-clk-01', '11111111-1111-1111-1111-111111111111', 'a1100001-0000-0000-0000-000000000001', 'ccc11111-cccc-1111-cccc-111111111111', '2026-09-01 08:00:00+00', '10.0.0.1', 'US', 'CA', 'LA', 'ISP-A', 'desktop', 'macOS', 'Chrome', 'https://a.com', 'Mozilla', 's1a', 's2a', NULL, NULL, NULL, true, 0, '{}', 10.00, 25.00, 'USD', NULL),
 ('v-clk-02', '11111111-1111-1111-1111-111111111111', 'a1100001-0000-0000-0000-000000000001', 'ccc11111-cccc-1111-cccc-111111111111', '2026-09-01 09:30:00+00', '10.0.0.2', 'US', 'NY', 'NYC', 'ISP-A', 'mobile', 'iOS', 'Safari', 'https://a.com', 'Mozilla', 's1b', 's2b', NULL, NULL, NULL, false, 2, '{}', 5.00, 12.00, 'USD', NULL),
 ('v-clk-03', '11111111-1111-1111-1111-111111111111', 'a1100001-0000-0000-0000-000000000002', 'ccc11111-cccc-1111-cccc-111111111111', '2026-09-02 08:00:00+00', '10.0.0.3', 'GB', NULL, 'London', 'ISP-A', 'desktop', 'Windows', 'Firefox', 'https://b.com', 'Mozilla', NULL, NULL, NULL, NULL, NULL, true, 0, '{}', 20.00, 50.00, 'EUR', NULL),
 ('v-clk-04', '11111111-1111-1111-1111-111111111111', 'a1100001-0000-0000-0000-000000000002', 'ccc11111-cccc-1111-cccc-111111111111', '2026-09-02 10:00:00+00', '2001:db8::1', 'DE', 'BY', 'Munich', 'ISP-A', 'mobile', 'Android', 'Chrome', NULL, NULL, 's1d', NULL, NULL, NULL, NULL, true, 5, '{}', NULL, NULL, 'GBP', NULL),
 ('v-clk-05', '11111111-1111-1111-1111-111111111111', 'a1100001-0000-0000-0000-000000000001', 'ccc11111-cccc-1111-cccc-111111111111', '2026-09-03 07:00:00+00', '10.0.0.5', 'US', 'TX', 'Austin', 'ISP-A', 'desktop', 'Linux', 'Chrome', 'https://a.com', 'Mozilla', NULL, NULL, NULL, NULL, NULL, true, 10, '{bot,vpn}', 15.00, 40.00, 'USD', NULL),
 ('v-clk-06', '11111111-1111-1111-1111-111111111111', 'a1100001-0000-0000-0000-000000000001', 'ccc11111-cccc-1111-cccc-111111111111', '2026-09-03 12:00:00+00', '10.0.0.6', 'FR', NULL, 'Paris', 'ISP-A', 'mobile', 'iOS', 'Safari', NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, 0, '{}', 8.00, 18.00, 'EUR', NULL),
 ('v-clk-07', '11111111-1111-1111-1111-111111111111', 'a1100001-0000-0000-0000-000000000002', 'ccc11111-cccc-1111-cccc-111111111111', '2026-09-04 06:00:00+00', '10.0.0.7', 'JP', NULL, 'Tokyo', 'ISP-A', 'desktop', 'macOS', 'Safari', NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 0, '{}', 12.00, 30.00, 'JPY', NULL),
 ('v-clk-08', '11111111-1111-1111-1111-111111111111', 'a1100001-0000-0000-0000-000000000001', 'ccc11111-cccc-1111-cccc-111111111111', '2026-09-05 08:00:00+00', '10.0.0.8', 'US', 'FL', 'Miami', 'ISP-A', 'mobile', 'Android', 'Chrome', NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 0, '{}', 7.00, 15.00, 'USD', NULL),
 ('v-clk-09', '11111111-1111-1111-1111-111111111111', 'a1100001-0000-0000-0000-000000000002', 'ccc11111-cccc-1111-cccc-111111111111', '2026-09-05 14:00:00+00', '2001:db8::2', 'AU', 'NSW', 'Sydney', 'ISP-A', 'desktop', 'Windows', 'Edge', NULL, NULL, 's1i', 's2i', NULL, NULL, NULL, true, 1, '{}', 25.00, 60.00, 'AUD', NULL)
ON CONFLICT (click_id) DO NOTHING;

-- 6. One click for NETWORK_B — tenant isolation
INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, created_at, ip, country, isp, device, os, browser, is_unique, fraud_score, fraud_flags, resolved_payout, resolved_revenue, currency, smart_link_id)
VALUES
 ('v-clk-b1', '22222222-2222-2222-2222-222222222222', 'b1100001-0000-0000-0000-000000000001', 'ccc22222-cccc-2222-cccc-222222222222', '2026-09-03 10:00:00+00', '10.0.0.9', 'BR', 'ISP-B', 'desktop', 'Windows', 'Chrome', true, 0, '{}', 5.00, 10.00, 'BRL', NULL)
ON CONFLICT (click_id) DO NOTHING;

-- 7. Conversions for NETWORK_A — 5 rows (v-cv-04 references missing click v-clk-missing)
INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id, created_at, event_name, status, reason, payout, revenue, currency, transaction_id, source, raw_params, goal_id, fraud_score, fraud_flags)
VALUES
 ('v-cv-01', '11111111-1111-1111-1111-111111111111', 'v-clk-01', 'a1100001-0000-0000-0000-000000000001', 'ccc11111-cccc-1111-cccc-111111111111', 'aaa11111-aaaa-1111-aaaa-111111111111', '2026-09-01 10:00:00+00', 'purchase', 'approved', NULL, 10.00, 25.00, 'USD', NULL, 'postback', '{}', NULL, 0, '{}'),
 ('v-cv-02', '11111111-1111-1111-1111-111111111111', 'v-clk-02', 'a1100001-0000-0000-0000-000000000001', 'ccc11111-cccc-1111-cccc-111111111111', 'aaa11111-aaaa-1111-aaaa-111111111111', '2026-09-01 11:00:00+00', 'purchase', 'approved', NULL, 5.00, 12.00, 'USD', NULL, 'postback', '{}', NULL, 0, '{}'),
 ('v-cv-03', '11111111-1111-1111-1111-111111111111', 'v-clk-05', 'a1100001-0000-0000-0000-000000000001', 'ccc11111-cccc-1111-cccc-111111111111', 'aaa11111-aaaa-1111-aaaa-111111111111', '2026-09-03 08:00:00+00', 'purchase', 'pending', NULL, 15.00, 40.00, 'USD', NULL, 'postback', '{}', NULL, 10, '{bot,vpn}'),
 ('v-cv-04', '11111111-1111-1111-1111-111111111111', 'v-clk-missing', 'a1100001-0000-0000-0000-000000000001', 'ccc11111-cccc-1111-cccc-111111111111', 'aaa11111-aaaa-1111-aaaa-111111111111', '2026-09-04 08:00:00+00', 'purchase', 'rejected', 'outside_attribution_window', NULL, NULL, NULL, NULL, 'postback', '{}', NULL, 0, '{}'),
 ('v-cv-05', '11111111-1111-1111-1111-111111111111', 'v-clk-09', 'a1100001-0000-0000-0000-000000000002', 'ccc11111-cccc-1111-cccc-111111111111', 'aaa11111-aaaa-1111-aaaa-111111111111', '2026-09-05 15:00:00+00', 'purchase', 'approved', NULL, 25.00, 60.00, 'AUD', NULL, 'postback', '{}', NULL, 1, '{}')
ON CONFLICT (conversion_id) DO NOTHING;

-- 8. One conversion for NETWORK_B — tenant isolation
INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id, created_at, event_name, status, payout, revenue, currency, transaction_id, source, raw_params, goal_id, fraud_score, fraud_flags)
VALUES
 ('v-cv-b1', '22222222-2222-2222-2222-222222222222', 'v-clk-b1', 'b1100001-0000-0000-0000-000000000001', 'ccc22222-cccc-2222-cccc-222222222222', 'bbb11111-bbbb-1111-bbbb-111111111111', '2026-09-03 11:00:00+00', 'purchase', 'approved', 5.00, 10.00, 'BRL', NULL, 'postback', '{}', NULL, 0, '{}')
ON CONFLICT (conversion_id) DO NOTHING;
