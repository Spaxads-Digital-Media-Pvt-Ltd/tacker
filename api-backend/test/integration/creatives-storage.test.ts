/**
 * Creatives live in object storage — on a real Postgres (INTEGRATION_DB=1, as in CI) with the storage
 * upload mocked (the real one when a case wants "storage not configured") — audit F-27.
 *
 * A creative file is uploaded raw (POST /api/creatives/upload) to object storage and the creative keeps
 * only its URL; inline data: URLs are refused on both creatives APIs. Lists never carry file bytes:
 * a creative from before (its file inline as a data: URI) lists as url null + urlInline, and only its
 * detail serves the file. The backfill moves those files to storage once per distinct file.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';

vi.mock('../../src/lib/storage/supabase-storage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/storage/supabase-storage.js')>();
  return { ...actual, uploadPublicObject: vi.fn(actual.uploadPublicObject) };
});

import { uploadPublicObject } from '../../src/lib/storage/supabase-storage.js';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { query } from '../../src/lib/db/pool.js';
import { backfillInlineCreatives } from '../../src/lib/creatives/backfill.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
const STORAGE = 'https://storage.example.test/storage/v1/object/public';

d('creatives in object storage (live DB, storage mocked)', () => {
  const upload = vi.mocked(uploadPublicObject);
  let dash: Express;
  let fx: Fixture;
  let admin: Record<string, string>;
  const as = (role: string, networkId = fx.networkA) => bearer(operatorToken({ userId: randomUUID(), networkId, role }));
  const stored = () => upload.mockImplementation(async (bucket, path) => `${STORAGE}/${bucket}/${path}`);
  const dataUri = (type: string, content: string | Buffer) => `data:${type};base64,${Buffer.from(content).toString('base64')}`;
  /** A creative row written the old way (file inline), straight into the table. */
  const legacy = async (networkId: string, offerId: string, url: string, name = `Legacy ${randomUUID().slice(0, 6)}`) =>
    (await query<{ id: string }>(
      `INSERT INTO offer_creatives (network_id, offer_id, name, type, url) VALUES ($1, $2, $3, 'image', $4) RETURNING id`,
      [networkId, offerId, name, url])).rows[0]!.id;
  const urlOf = async (id: string) => (await query<{ url: string | null }>('SELECT url FROM offer_creatives WHERE id = $1', [id])).rows[0]!.url;

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`f27-${randomUUID().slice(0, 8)}`);
    dash = buildDashboardApp();
    admin = as('admin');
  });
  beforeEach(() => { upload.mockReset(); stored(); });

  it('upload a creative → the file goes to object storage and the creative keeps only its URL', async () => {
    const bytes = Buffer.from('\x89PNG fake image bytes');
    const up = await request(dash).post('/api/creatives/upload').set(admin).set('content-type', 'image/png').send(bytes);
    expect(up.status).toBe(201);
    expect(up.body.data).toMatchObject({ contentType: 'image/png', bytes: bytes.length });
    expect(upload).toHaveBeenCalledTimes(1);
    const [bucket, path, body, type, opts] = upload.mock.calls[0]!;
    expect(bucket).toBe('offer-creatives');
    expect(path).toMatch(new RegExp(`^${fx.networkA}/[0-9a-f-]{36}\\.png$`));
    expect(Buffer.compare(body, bytes)).toBe(0);
    expect([type, opts]).toEqual(['image/png', { bucketMaxBytes: 5 * 1024 * 1024 }]);
    expect(up.body.data.url).toBe(`${STORAGE}/offer-creatives/${path}`);

    const created = await request(dash).post('/api/creatives').set(admin)
      .send({ name: 'Banner 300x250', type: 'image', url: up.body.data.url, offerIds: [fx.offerA] });
    expect(created.status).toBe(201);
    const id = created.body.data[0].id as string;
    expect(await urlOf(id)).toBe(up.body.data.url);

    const list = (await request(dash).get('/api/creatives').set(admin)).body.data as { id: string; url: string; urlInline: boolean }[];
    expect(list.find((c) => c.id === id)).toMatchObject({ url: up.body.data.url, urlInline: false });
    const audit = await query(`SELECT 1 FROM audit_log WHERE network_id = $1 AND action = 'offer.creative.upload'`, [fx.networkA]);
    expect(audit.rowCount).toBeGreaterThan(0);
  });

  it('inline data: URLs are refused on both creatives APIs; a hosted http(s) URL is accepted', async () => {
    const inline = dataUri('image/png', 'x'.repeat(1000));
    const viaNetwork = await request(dash).post('/api/creatives').set(admin).send({ name: 'n', type: 'image', url: inline, offerIds: [fx.offerA] });
    expect(viaNetwork.status).toBe(422);
    expect(JSON.stringify(viaNetwork.body.error)).toMatch(/POST \/api\/creatives\/upload/);
    const viaOffer = await request(dash).post(`/api/offers/${fx.offerA}/creatives`).set(admin).send({ name: 'n', type: 'image', url: inline });
    expect(viaOffer.status).toBe(422);
    expect((await request(dash).post(`/api/offers/${fx.offerA}/creatives`).set(admin).send({ name: 'n', type: 'link', url: 'javascript:alert(1)' })).status).toBe(422);

    const hosted = await request(dash).post(`/api/offers/${fx.offerA}/creatives`).set(admin)
      .send({ name: 'Hosted', type: 'link', url: 'https://cdn.example.com/landing?click={click_id}' });
    expect(hosted.status).toBe(201);
    const patched = await request(dash).patch(`/api/creatives/${hosted.body.data.id}`).set(admin).send({ url: inline });
    expect(patched.status).toBe(422);
  });

  it('upload refuses other types, empty and over-2 MB files, and non-writers; storage not configured → a clear 400', async () => {
    const send = (type: string, body: Buffer, auth = admin) => request(dash).post('/api/creatives/upload').set(auth).set('content-type', type).send(body);
    const svg = await send('image/svg+xml', Buffer.from('<svg onload="alert(1)"/>'));
    expect(svg.status).toBe(400);
    expect(svg.body.error.message).toMatch(/PNG, JPEG, WebP, GIF, MP4, WebM, MOV, ZIP or TXT/);
    expect((await send('image/png', Buffer.alloc(0))).status).toBe(400);
    expect((await send('video/mp4', Buffer.alloc(2 * 1024 * 1024 + 1, 1))).status).toBe(413);
    expect((await send('image/png', Buffer.from('x'), as('read_only'))).status).toBe(403);
    expect(upload).not.toHaveBeenCalled();

    // The real storage client: tests have no SUPABASE_SERVICE_ROLE_KEY.
    const actual = await vi.importActual<typeof import('../../src/lib/storage/supabase-storage.js')>('../../src/lib/storage/supabase-storage.js');
    upload.mockImplementationOnce(actual.uploadPublicObject);
    const unconfigured = await send('image/png', Buffer.from('png'));
    expect(unconfigured.status).toBe(400);
    expect(unconfigured.body.error.message).toBe('File storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  });

  it('lists never carry file bytes: old inline creatives list as url null + urlInline; the detail still serves the file', async () => {
    const big = dataUri('image/png', Buffer.alloc(150_000, 7)); // ~200 KB each, 30 of them ≈ 6 MB inline
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push(await legacy(fx.networkA, fx.offerA, big));

    const list = await request(dash).get('/api/creatives').set(admin);
    expect(list.status).toBe(200);
    expect(list.text.length).toBeLessThan(100_000); // the whole list, not 6 MB
    const row = (list.body.data as { id: string; url: string | null; urlInline: boolean }[]).find((c) => c.id === ids[0]);
    expect(row).toMatchObject({ url: null, urlInline: true });

    const perOffer = await request(dash).get(`/api/offers/${fx.offerA}/creatives`).set(admin);
    expect(perOffer.status).toBe(200);
    expect(perOffer.text.length).toBeLessThan(100_000);
    expect((perOffer.body.data as { id: string }[]).find((c) => c.id === ids[0])).toMatchObject({ url: null, urlInline: true });

    const catalog = await request(dash).get('/api/catalog/creatives').set(admin);
    expect(catalog.status).toBe(200);
    expect(catalog.text.length).toBeLessThan(100_000);
    expect((catalog.body.data as { id: string }[]).find((c) => c.id === ids[0])).toMatchObject({ url: null, url_inline: true });

    const detail = await request(dash).get(`/api/creatives/${ids[0]}`).set(admin);
    expect(detail.body.data).toMatchObject({ url: big, urlInline: true });

    // Editing other fields keeps the inline file (it isn't sent back).
    expect((await request(dash).patch(`/api/creatives/${ids[1]}`).set(admin).send({ name: 'Renamed' })).status).toBe(200);
    expect(await urlOf(ids[1]!)).toBe(big);

    await query('DELETE FROM offer_creatives WHERE id = ANY($1)', [ids]);
  });

  it('backfill: each distinct inline file goes to storage once, siblings share it; unsupported types stay inline; re-runs are no-ops', async () => {
    const own = await seedFixture(`f27b-${randomUUID().slice(0, 8)}`);
    const png = Buffer.from(`png-${randomUUID()}`);
    const gif = Buffer.from(`gif-${randomUUID()}`);
    const a = await legacy(own.networkA, own.offerA, dataUri('image/png', png));
    const b = await legacy(own.networkA, own.offerA, dataUri('image/png', png)); // a fanned-out sibling
    const c = await legacy(own.networkA, own.offerA, dataUri('image/gif', gif));
    const svgUri = dataUri('image/svg+xml', '<svg/>');
    const s = await legacy(own.networkA, own.offerA, svgUri);
    const ours = () => upload.mock.calls.filter((call) => String(call[1]).startsWith(`${own.networkA}/`));

    const dry = await backfillInlineCreatives({ dryRun: true });
    expect(ours()).toHaveLength(0);
    expect(await urlOf(a)).toMatch(/^data:/);
    expect(dry.skipped.find((x) => x.ids.includes(s))?.reason).toMatch(/image\/svg\+xml files aren't stored/);

    const run = await backfillInlineCreatives();
    expect(ours()).toHaveLength(2); // png once (for both siblings) + gif
    const [ua, ub, uc] = [await urlOf(a), await urlOf(b), await urlOf(c)];
    expect(ua).toMatch(new RegExp(`^${STORAGE}/offer-creatives/${own.networkA}/sha256-[0-9a-f]{40}\\.png$`));
    expect(ub).toBe(ua);
    expect(uc).toMatch(/\.gif$/);
    expect(await urlOf(s)).toBe(svgUri); // left inline, reported
    expect(run.skipped.find((x) => x.ids.includes(s))).toBeTruthy();

    const audits = await query<{ entity_id: string; before: Record<string, unknown>; after: Record<string, unknown> }>(
      `SELECT entity_id, before, after FROM audit_log WHERE network_id = $1 AND action = 'offer.creative.backfill' ORDER BY entity_id`, [own.networkA]);
    expect(audits.rows.map((r) => r.entity_id).sort()).toEqual([a, b, c].sort());
    expect(audits.rows.find((r) => r.entity_id === a)).toMatchObject({ before: { inline: true, contentType: 'image/png', bytes: png.length }, after: { url: ua } });
    expect(JSON.stringify(audits.rows)).not.toContain('base64'); // never the file itself

    upload.mockClear();
    await backfillInlineCreatives();
    expect(ours()).toHaveLength(0); // nothing left to move but the SVG
  });

  it('backfill: a failed upload leaves that file inline (reported) and moves the rest', async () => {
    const own = await seedFixture(`f27c-${randomUUID().slice(0, 8)}`);
    const first = await legacy(own.networkA, own.offerA, dataUri('image/png', `one-${randomUUID()}`));
    const second = await legacy(own.networkA, own.offerA, dataUri('image/png', `two-${randomUUID()}`));
    upload.mockImplementation(async (bucket, path) => {
      if (String(path).startsWith(`${own.networkA}/`) && upload.mock.calls.filter((c) => String(c[1]).startsWith(`${own.networkA}/`)).length === 1) {
        throw new Error('Upload failed (HTTP 500)');
      }
      return `${STORAGE}/${bucket}/${path}`;
    });
    const r = await backfillInlineCreatives();
    const urls = [await urlOf(first), await urlOf(second)];
    expect(urls.filter((u) => u!.startsWith('data:'))).toHaveLength(1);
    expect(urls.filter((u) => u!.startsWith(STORAGE))).toHaveLength(1);
    expect(r.skipped.some((x) => x.networkId === own.networkA && x.reason === 'Upload failed (HTTP 500)')).toBe(true);
  });
});
