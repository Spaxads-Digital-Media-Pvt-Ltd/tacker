-- Two networks
INSERT INTO networks (id, name, slug, status, timezone, currency, created_at, updated_at)
VALUES
 ('11111111-1111-1111-1111-111111111111', 'Network A', 'network-a', 'active', 'UTC', 'USD', now(), now()),
 ('22222222-2222-2222-2222-222222222222', 'Network B', 'network-b', 'active', 'UTC', 'USD', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Offers
INSERT INTO offers (id, network_id, name, status, offer_type, created_at, updated_at)
VALUES
 ('aaa11111-aaaa-1111-aaaa-111111111111', '11111111-1111-1111-1111-111111111111', 'Offer A1', 'active', 'cpa', now(), now()),
 ('aaa22222-aaaa-2222-aaaa-222222222222', '11111111-1111-1111-1111-111111111111', 'Offer A2', 'active', 'cpa', now(), now()),
 ('bbb11111-bbbb-1111-bbbb-111111111111', '22222222-2222-2222-2222-222222222222', 'Offer B1', 'active', 'cpa', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Publishers
INSERT INTO publishers (id, network_id, name, status, created_at, updated_at)
VALUES
 ('ccc11111-cccc-1111-cccc-111111111111', '11111111-1111-1111-1111-111111111111', 'Pub A1', 'active', now(), now()),
 ('ccc22222-cccc-2222-cccc-222222222222', '22222222-2222-2222-2222-222222222222', 'Pub B1', 'active', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Advertisers (FK on conversions)
INSERT INTO advertisers (id, network_id, name, status, created_at, updated_at)
VALUES
 ('ddd11111-dddd-1111-dddd-111111111111', '11111111-1111-1111-1111-111111111111', 'Adv A1', 'active', now(), now()),
 ('ddd22222-dddd-2222-dddd-222222222222', '22222222-2222-2222-2222-222222222222', 'Adv B1', 'active', now(), now())
ON CONFLICT (id) DO NOTHING;

-- 9 clicks for NETWORK_A across 5 days -> 5 batches @ batch_size=2
INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, created_at, ip, country, region, city, isp, device, os, browser, referrer, user_agent, sub1, sub2, sub3, sub4, sub5, is_unique, fraud_score, fraud_flags, resolved_payout, resolved_revenue, currency)
VALUES
 ('v-clk-01', '11111111-1111-1111-1111-111111111111', 'aaa11111-aaaa-1111-aaaa-111111111111', 'ccc11111-cccc-1111-cccc-111111111111', '2026-09-01 08:00:00+00', '10.0.0.1', 'US', 'CA', 'LA', 'ISP-A', 'desktop', 'macOS', 'Chrome', 'https://a.com', 'Mozilla', 's1a', 's2a', NULL, NULL, NULL, true, 0, '{}', '10.00', '25.00', 'USD'),
 ('v-clk-02', '11111111-1111-1111-1111-111111111111', 'aaa11111-aaaa-1111-aaaa-111111111111', 'ccc11111-cccc-1111-cccc-111111111111', '2026-09-01 09:30:00+00', '10.0.0.2', 'US', 'NY', 'NYC', 'ISP-A', 'mobile', 'iOS', 'Safari', 'https://a.com', 'Mozilla', 's1b', 's2b', NULL, NULL, NULL, false, 2, '{}', '5.00', '12.00', 'USD'),
 ('v-clk-03', '11111111-1111-1111-1111-111111111111', 'aaa22222-aaaa-2222-aaaa-222222222222', 'ccc11111-cccc-1111-cccc-111111111111', '2026-09-02 08:00:00+00', '10.0.0.3', 'GB', NULL, 'London', 'ISP-A', 'desktop', 'Windows', 'Firefox', 'https://b.com', 'Mozilla', NULL, NULL, NULL, NULL, NULL, true, 0, '{}', '20.00', '50.00', 'EUR'),
 ('v-clk-04', '11111111-1111-1111-1111-111111111111', 'aaa22222-aaaa-2222-aaaa-222222222222', 'ccc11111-cccc-1111-cccc-111111111111', '2026-09-02 10:00:00+00', '2001:db8::1', 'DE', 'BY', 'Munich', 'ISP-A', 'mobile', 'Android', 'Chrome', NULL, NULL, 's1d', NULL, NULL, NULL, NULL, true, 5, '{}', NULL, NULL, 'GBP'),
 ('v-clk-05', '11111111-1111-1111-1111-111111111111', 'aaa11111-aaaa-1111-aaaa-111111111111', 'ccc11111-cccc-1111-cccc-111111111111', '2026-09-03 07:00:00+00', '10.0.0.5', 'US', 'TX', 'Austin', 'ISP-A', 'desktop', 'Linux', 'Chrome', 'https://a.com', 'Mozilla', NULL, NULL, NULL, NULL, NULL, true, 10, '{bot,vpn}', '15.00', '40.00', 'USD'),
 ('v-clk-06', '11111111-1111-1111-1111-111111111111', 'aaa11111-aaaa-1111-aaaa-111111111111', 'ccc11111-cccc-1111-cccc-111111111111', '2026-09-03 12:00:00+00', '10.0.0.6', 'FR', NULL, 'Paris', 'ISP-A', 'mobile', 'iOS', 'Safari', NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, 0, '{}', '8.00', '18.00', 'EUR'),
 ('v-clk-07', '11111111-1111-1111-1111-111111111111', 'aaa22222-aaaa-2222-aaaa-222222222222', 'ccc11111-cccc-1111-cccc-111111111111', '2026-09-04 06:00:00+00', '10.0.0.7', 'JP', NULL, 'Tokyo', 'ISP-A', 'desktop', 'macOS', 'Safari', NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 0, '{}', '12.00', '30.00', 'JPY'),
 ('v-clk-08', '11111111-1111-1111-1111-111111111111', 'aaa11111-aaaa-1111-aaaa-111111111111', 'ccc11111-cccc-1111-cccc-111111111111', '2026-09-05 08:00:00+00', '10.0.0.8', 'US', 'FL', 'Miami', 'ISP-A', 'mobile', 'Android', 'Chrome', NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, 0, '{}', '7.00', '15.00', 'USD'),
 ('v-clk-09', '11111111-1111-1111-1111-111111111111', 'aaa22222-aaaa-2222-aaaa-222222222222', 'ccc11111-cccc-1111-cccc-111111111111', '2026-09-05 14:00:00+00', '2001:db8::2', 'AU', 'NSW', 'Sydney', 'ISP-A', 'desktop', 'Windows', 'Edge', NULL, NULL, 's1i', 's2i', NULL, NULL, true, 1, '{}', '25.00', '60.00', 'AUD');

-- 1 click for NETWORK_B (tenant isolation)
INSERT INTO clicks (click_id, network_id, offer_id, publisher_id, created_at, ip, country, isp, device, os, browser, is_unique, fraud_score, fraud_flags, resolved_payout, resolved_revenue, currency)
VALUES
 ('v-clk-b1', '22222222-2222-2222-2222-222222222222', 'bbb11111-bbbb-1111-bbbb-111111111111', 'ccc22222-cccc-2222-cccc-222222222222', '2026-09-03 10:00:00+00', '10.0.0.9', 'BR', 'ISP-B', 'desktop', 'Windows', 'Chrome', true, 0, '{}', '5.00', '10.00', 'BRL');

-- 5 conversions for NETWORK_A
INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id, created_at, status, payout, revenue, currency, source, fraud_score, fraud_flags)
VALUES
 ('v-cv-01', '11111111-1111-1111-1111-111111111111', 'v-clk-01', 'aaa11111-aaaa-1111-aaaa-111111111111', 'ccc11111-cccc-1111-cccc-111111111111', 'ddd11111-dddd-1111-dddd-111111111111', '2026-09-01 10:00:00+00', 'approved', '10.00', '25.00', 'USD', 'postback', 0, '{}'),
 ('v-cv-02', '11111111-1111-1111-1111-111111111111', 'v-clk-02', 'aaa11111-aaaa-1111-aaaa-111111111111', 'ccc11111-cccc-1111-cccc-111111111111', 'ddd11111-dddd-1111-dddd-111111111111', '2026-09-01 11:00:00+00', 'approved', '5.00', '12.00', 'USD', 'postback', 0, '{}'),
 ('v-cv-03', '11111111-1111-1111-1111-111111111111', 'v-clk-05', 'aaa11111-aaaa-1111-aaaa-111111111111', 'ccc11111-cccc-1111-cccc-111111111111', 'ddd11111-dddd-1111-dddd-111111111111', '2026-09-03 08:00:00+00', 'pending', '15.00', '40.00', 'USD', 'postback', 10, '{bot,vpn}'),
 ('v-cv-04', '11111111-1111-1111-1111-111111111111', 'v-clk-missing', 'aaa11111-aaaa-1111-aaaa-111111111111', 'ccc11111-cccc-1111-cccc-111111111111', 'ddd11111-dddd-1111-dddd-111111111111', '2026-09-04 08:00:00+00', 'rejected', NULL, NULL, NULL, 'postback', 0, '{}'),
 ('v-cv-05', '11111111-1111-1111-1111-111111111111', 'v-clk-09', 'aaa22222-aaaa-2222-aaaa-222222222222', 'ccc11111-cccc-1111-cccc-111111111111', 'ddd11111-dddd-1111-dddd-111111111111', '2026-09-05 15:00:00+00', 'approved', '25.00', '60.00', 'AUD', 'postback', 1, '{}');

-- 1 conversion for NETWORK_B (tenant isolation)
INSERT INTO conversions (conversion_id, network_id, click_id, offer_id, publisher_id, advertiser_id, created_at, status, payout, revenue, currency, source, fraud_score, fraud_flags)
VALUES
 ('v-cv-b1', '22222222-2222-2222-2222-222222222222', 'v-clk-b1', 'bbb11111-bbbb-1111-bbbb-111111111111', 'ccc22222-cccc-2222-cccc-222222222222', 'ddd22222-dddd-2222-dddd-222222222222', '2026-09-03 11:00:00+00', 'approved', '5.00', '10.00', 'BRL', 'postback', 0, '{}');
