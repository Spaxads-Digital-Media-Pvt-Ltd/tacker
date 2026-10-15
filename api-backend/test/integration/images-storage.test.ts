/**
 * Branding images and profile photos go to storage; settings keep only the link (O12) — live DB,
 * object storage mocked at uploadPublicObject.
 *
 * Upload routes take the raw image (no SVG — D5; a favicon may be ICO) and return its URL; the config
 * / profile then store that URL. A new data: URI is refused (an unchanged legacy one may be re-sent),
 * branding fields merge, GET /api/me hands every portal the stored URLs, and JSON bodies are capped at
 * 2 MB. The backfill moves what was stored inline before, and leaves an SVG with the reason.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';

vi.mock('../../src/lib/storage/supabase-storage.js', () => ({
  uploadPublicObject: vi.fn(async (bucket: string, path: string) => `https://storage.example.test/${bucket}/${path}`),
}));

import { uploadPublicObject } from '../../src/lib/storage/supabase-storage.js';
import { buildDashboardApp } from '../../src/surfaces/dashboard/app.js';
import { backfillInlineImages } from '../../src/lib/storage/images-backfill.js';
import { query } from '../../src/lib/db/pool.js';
import { canConnect, seedFixture, type Fixture } from '../helpers/db.js';
import { operatorToken, portalToken, bearer } from '../helpers/tokens.js';

const d = process.env.INTEGRATION_DB === '1' ? describe : describe.skip;
// A 1×1 PNG, and the same as a data: URI (how logos / photos used to be stored).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const PNG_URI = `data:image/png;base64,${PNG.toString('base64')}`;
const SVG_URI = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64')}`;

d('images in storage, links in settings (live DB, storage mocked)', () => {
  let dash: Express;
  let fx: Fixture;
  let admin: Record<string, string>;
  const upload = vi.mocked(uploadPublicObject);
  const branding = async (networkId: string) => (await query<{ b: Record<string, unknown> | null }>(
    `SELECT settings->'controlCenter'->'platform'->'branding' AS b FROM networks WHERE id = $1`, [networkId])).rows[0]!.b;
  const put = (body: unknown) => request(dash).put('/api/control-center/config/platform').set(admin).send(body as object);

  beforeAll(async () => {
    if (!(await canConnect())) throw new Error('INTEGRATION_DB=1 but Postgres is unreachable.');
    fx = await seedFixture(`img-${randomUUID().slice(0, 8)}`);
    dash = buildDashboardApp();
    admin = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'admin' }));
  });

  it('a branding image uploads to storage and comes back as a URL — no SVG; a favicon may be ICO; admin / manager only', async () => {
    const logo = await request(dash).post('/api/control-center/branding/logo').set(admin).set('content-type', 'image/png').send(PNG);
    expect(logo.status).toBe(201);
    expect(logo.body.data.url).toMatch(new RegExp(`^https://storage\\.example\\.test/network-images/${fx.networkA}/logo/sha256-[0-9a-f]+\\.png$`));
    expect(upload).toHaveBeenLastCalledWith('network-images', expect.stringContaining(`${fx.networkA}/logo/`), PNG, 'image/png', expect.anything());

    const svg = await request(dash).post('/api/control-center/branding/logo').set(admin).set('content-type', 'image/svg+xml').send('<svg/>');
    expect(svg.status).toBe(400); // SVG isn't an accepted raw type: refused, never stored
    expect((await request(dash).post('/api/control-center/branding/logo').set(admin).set('content-type', 'image/x-icon').send(PNG)).status).toBe(400);
    expect((await request(dash).post('/api/control-center/branding/favicon').set(admin).set('content-type', 'image/x-icon').send(PNG)).status).toBe(201);
    expect((await request(dash).post('/api/control-center/branding/banner').set(admin).set('content-type', 'image/png').send(PNG)).status).toBe(404);
    const finance = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkA, role: 'finance' }));
    expect((await request(dash).post('/api/control-center/branding/logo').set(finance).set('content-type', 'image/png').send(PNG)).status).toBe(403);
  });

  it('settings keep only the link: a data: URI is refused, fields merge, and GET /api/me shows every portal the URLs', async () => {
    const inline = await put({ branding: { logoUrl: PNG_URI } });
    expect(inline.status).toBe(422);
    expect(inline.body.error.message).toMatch(/upload the file first/);
    expect((await put({ branding: { logoUrl: 'https://cdn.example.test/logo.png', other: 'x' } })).status).toBe(422);

    expect((await put({ branding: { logoUrl: 'https://cdn.example.test/logo.png' } })).status).toBe(200);
    expect((await put({ branding: { faviconUrl: 'https://cdn.example.test/fav.ico' } })).status).toBe(200); // logo kept
    expect(await branding(fx.networkA)).toEqual({ logoUrl: 'https://cdn.example.test/logo.png', faviconUrl: 'https://cdn.example.test/fav.ico' });

    const me = await request(dash).get('/api/me').set(admin);
    expect(me.body.data.branding).toEqual({ logoUrl: 'https://cdn.example.test/logo.png', faviconUrl: 'https://cdn.example.test/fav.ico' });
    const partner = await request(dash).get('/api/me').set(bearer(portalToken({ userId: randomUUID(), networkId: fx.networkA, kind: 'publisher', ownerId: fx.pubA1 })));
    expect(partner.body.data.branding.logoUrl).toBe('https://cdn.example.test/logo.png');
    expect((await put({ branding: { logoUrl: null } })).status).toBe(200);
    expect((await branding(fx.networkA))?.['logoUrl']).toBeNull();
  });

  it('an untouched legacy inline image can be re-sent until the backfill moves it (never a new one); /api/me never serves it', async () => {
    await query(`UPDATE networks SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{controlCenter}', $2::jsonb) WHERE id = $1`,
      [fx.networkB, JSON.stringify({ platform: { branding: { logoUrl: PNG_URI, faviconUrl: SVG_URI } } })]);
    const adminB = bearer(operatorToken({ userId: randomUUID(), networkId: fx.networkB, role: 'admin' }));
    expect((await request(dash).put('/api/control-center/config/platform').set(adminB).send({ branding: { logoUrl: PNG_URI } })).status).toBe(200);
    expect((await request(dash).put('/api/control-center/config/platform').set(adminB).send({ branding: { logoUrl: SVG_URI } })).status).toBe(422);
    expect((await request(dash).get('/api/me').set(adminB)).body.data.branding).toEqual({ logoUrl: null, faviconUrl: null });
  });

  it('a profile photo uploads to storage; the profile keeps its URL, never a data: URI', async () => {
    const userId = randomUUID();
    await query(`INSERT INTO users (network_id, auth_user_id, email, name, role, status, metadata) VALUES ($1, $2, $3, 'Pat', 'manager', 'active', '{}'::jsonb)`,
      [fx.networkA, userId, `pat-${userId.slice(0, 6)}@example.com`]);
    const me = bearer(operatorToken({ userId, networkId: fx.networkA, role: 'manager' }));
    const photo = await request(dash).post('/api/me/photo').set(me).set('content-type', 'image/png').send(PNG);
    expect(photo.status).toBe(201);
    expect(photo.body.data.url).toMatch(new RegExp(`/network-images/${fx.networkA}/photo/`));
    expect((await request(dash).patch('/api/me/profile').set(me).send({ photoUrl: PNG_URI })).status).toBe(422);
    expect((await request(dash).patch('/api/me/profile').set(me).send({ photoUrl: photo.body.data.url })).status).toBe(200);
    const meta = (await query<{ metadata: Record<string, unknown> }>('SELECT metadata FROM users WHERE auth_user_id = $1', [userId])).rows[0]!.metadata;
    expect(meta['photoUrl']).toBe(photo.body.data.url);
  });

  it('JSON bodies are capped at 2 MB (no file travels as JSON any more)', async () => {
    const big = await request(dash).put('/api/control-center/config/partners').set(admin).send({ note: 'x'.repeat(2_200_000) });
    expect(big.status).toBe(413);
    expect((await request(dash).put('/api/control-center/config/partners').set(admin).send({ note: 'x'.repeat(1_000_000) })).status).toBe(200);
  });

  it('the backfill moves inline images to storage — SVG stays, with why; a dry run changes nothing; a re-run finds nothing', async () => {
    const photoUser = randomUUID();
    await query(`INSERT INTO users (network_id, auth_user_id, email, name, role, status, metadata) VALUES ($1, $2, $3, 'Old', 'read_only', 'active', $4::jsonb)`,
      [fx.networkB, photoUser, `old-${photoUser.slice(0, 6)}@example.com`, JSON.stringify({ photoUrl: PNG_URI, title: 'kept' })]);
    await query(`UPDATE networks SET settings = jsonb_set(settings, '{controlCenter,platform,branding}', $2::jsonb) WHERE id = $1`,
      [fx.networkB, JSON.stringify({ logoUrl: PNG_URI, faviconUrl: SVG_URI })]);

    const dry = await backfillInlineImages({ dryRun: true });
    expect(dry.moved).toBeGreaterThanOrEqual(2);
    expect((await branding(fx.networkB))?.['logoUrl']).toBe(PNG_URI);

    const r = await backfillInlineImages();
    const b = await branding(fx.networkB);
    expect(b?.['logoUrl']).toMatch(new RegExp(`^https://storage\\.example\\.test/network-images/${fx.networkB}/logo/sha256-`));
    expect(b?.['faviconUrl']).toBe(SVG_URI);
    expect(r.skipped).toEqual(expect.arrayContaining([{ networkId: fx.networkB, where: 'branding.faviconUrl', reason: expect.stringMatching(/image\/svg\+xml isn't stored/) }]));
    const meta = (await query<{ metadata: Record<string, unknown> }>('SELECT metadata FROM users WHERE auth_user_id = $1', [photoUser])).rows[0]!.metadata;
    expect(meta).toMatchObject({ title: 'kept', photoUrl: expect.stringMatching(new RegExp(`/network-images/${fx.networkB}/photo/`)) });
    const audits = await query(`SELECT 1 FROM audit_log WHERE network_id = $1 AND action IN ('control_center.branding.backfill', 'user.photo.backfill')`, [fx.networkB]);
    expect(audits.rowCount).toBe(2);

    const again = await backfillInlineImages();
    expect(again.moved).toBe(0);
  });
});
