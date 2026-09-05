/**
 * Control Center › Segmentation Options › Labels › Add / Edit — matches the reference's real
 * dedicated "Add Label" page (verified live at /controls/segmentations/labels/add): Name* followed
 * by a dual-list picker per assignable entity type (Offers/Advertisers/Partners/Smart Links/Offer
 * Groups/Partner Tiers), each reusing the same "Select Offer(s)"-style DualListPicker already used
 * elsewhere (Offer Groups, Creatives). Saving diffs each entity type's selection against what was
 * there before and calls that entity's own real tag-assignment endpoint — Offers/Advertisers/
 * Partners/Smart Links/Offer Groups all share the generic `/:id/tags` assign/unassign endpoints
 * (attachTagRoutes); Partner Tiers manage their label set differently (a plain string[] on the
 * tier's own PATCH, not per-tag assign/unassign — see partner-tiers/routes.ts), so that one entity
 * type is diffed and saved through the tier's own update endpoint instead.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../../lib/api';
import { useQuery, useMutation } from '../../../lib/useApi';
import { PageHeader, Field } from '../../../components/ui';
import { DualListPicker } from '../../../components/DualListPicker';
import type { Offer, Advertiser, Publisher } from '../../../types';
import type { SmartLink } from '../../../data/smartLinks';

interface OfferGroupRow { id: string; name: string }
interface TierRow { id: string; name: string; labels: string[] }
interface Assignment { tagId: string; entityId: string }
interface TagDTO { id: string; name: string; color: string | null }

const GENERIC_TYPES = ['offer', 'advertiser', 'publisher', 'smart_link', 'offer_group'] as const;
const ENTITY_PATH: Record<(typeof GENERIC_TYPES)[number], string> = {
  offer: 'offers', advertiser: 'advertisers', publisher: 'publishers', smart_link: 'smart-links', offer_group: 'offer-groups',
};

export default function LabelForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const nav = useNavigate();

  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: smartLinks } = useQuery<SmartLink[]>('/api/smart-links');
  const { data: offerGroups } = useQuery<OfferGroupRow[]>('/api/offer-groups');
  const { data: tiers } = useQuery<TierRow[]>('/api/partner-tiers');
  const { data: existing } = useQuery<TagDTO>(isEdit ? `/api/tags/${id}` : null);
  const { data: offerAssign } = useQuery<Assignment[]>(isEdit ? '/api/tags/assignments?entityType=offer' : null);
  const { data: advAssign } = useQuery<Assignment[]>(isEdit ? '/api/tags/assignments?entityType=advertiser' : null);
  const { data: pubAssign } = useQuery<Assignment[]>(isEdit ? '/api/tags/assignments?entityType=publisher' : null);
  const { data: slAssign } = useQuery<Assignment[]>(isEdit ? '/api/tags/assignments?entityType=smart_link' : null);
  const { data: ogAssign } = useQuery<Assignment[]>(isEdit ? '/api/tags/assignments?entityType=offer_group' : null);

  const [name, setName] = useState('');
  const [offerIds, setOfferIds] = useState<string[]>([]);
  const [advertiserIds, setAdvertiserIds] = useState<string[]>([]);
  const [publisherIds, setPublisherIds] = useState<string[]>([]);
  const [smartLinkIds, setSmartLinkIds] = useState<string[]>([]);
  const [offerGroupIds, setOfferGroupIds] = useState<string[]>([]);
  const [tierIds, setTierIds] = useState<string[]>([]);
  const [initial, setInitial] = useState<Record<string, string[]>>({});
  const hydrated = useRef(false);

  useEffect(() => {
    if (!isEdit) return;
    if (hydrated.current) return;
    if (!existing || !offerAssign || !advAssign || !pubAssign || !slAssign || !ogAssign || !tiers) return;
    hydrated.current = true;
    setName(existing.name);
    const oIds = offerAssign.filter((a) => a.tagId === id).map((a) => a.entityId);
    const aIds = advAssign.filter((a) => a.tagId === id).map((a) => a.entityId);
    const pIds = pubAssign.filter((a) => a.tagId === id).map((a) => a.entityId);
    const sIds = slAssign.filter((a) => a.tagId === id).map((a) => a.entityId);
    const gIds = ogAssign.filter((a) => a.tagId === id).map((a) => a.entityId);
    const tIds = tiers.filter((t) => t.labels.includes(existing.name)).map((t) => t.id);
    setOfferIds(oIds); setAdvertiserIds(aIds); setPublisherIds(pIds); setSmartLinkIds(sIds); setOfferGroupIds(gIds); setTierIds(tIds);
    setInitial({ offer: oIds, advertiser: aIds, publisher: pIds, smart_link: sIds, offer_group: gIds, partner_tier: tIds });
  }, [isEdit, existing, offerAssign, advAssign, pubAssign, slAssign, ogAssign, tiers, id]);

  const offerOptions = (offers ?? []).map((o) => ({ value: o.id, label: o.ref != null ? `(${o.ref}) ${o.name}` : o.name, active: o.status === 'active' }));
  const advertiserOptions = (advertisers ?? []).map((a) => ({ value: a.id, label: a.ref != null ? `(${a.ref}) ${a.name}` : a.name, active: a.status === 'active' }));
  const publisherOptions = (publishers ?? []).map((p) => ({ value: p.id, label: p.ref != null ? `(${p.ref}) ${p.name}` : p.name, active: p.status === 'active' }));
  const smartLinkOptions = (smartLinks ?? []).map((s) => ({ value: s.id, label: s.name }));
  const offerGroupOptions = (offerGroups ?? []).map((g) => ({ value: g.id, label: g.name }));
  const tierOptions = (tiers ?? []).map((t) => ({ value: t.id, label: t.name }));

  const { run, busy, error } = useMutation(async () => {
    let tagId = id;
    if (!isEdit) {
      const created = await api.post<TagDTO>('/api/tags', { name });
      if (!created) throw new Error('Failed to create label');
      tagId = created.id;
    } else if (name !== existing?.name) {
      await api.patch(`/api/tags/${id}`, { name });
    }

    const diff = async (type: (typeof GENERIC_TYPES)[number], nextIds: string[]) => {
      const before = new Set(initial[type] ?? []);
      const after = new Set(nextIds);
      const path = ENTITY_PATH[type];
      for (const eid of after) if (!before.has(eid)) await api.post(`/api/${path}/${eid}/tags`, { tagId });
      for (const eid of before) if (!after.has(eid)) await api.del(`/api/${path}/${eid}/tags/${tagId}`);
    };
    await diff('offer', offerIds);
    await diff('advertiser', advertiserIds);
    await diff('publisher', publisherIds);
    await diff('smart_link', smartLinkIds);
    await diff('offer_group', offerGroupIds);

    // Partner Tiers: replace-the-whole-array PATCH, not per-tag assign/unassign.
    const beforeTiers = new Set(initial['partner_tier'] ?? []);
    const afterTiers = new Set(tierIds);
    for (const t of tiers ?? []) {
      const was = beforeTiers.has(t.id);
      const now = afterTiers.has(t.id);
      if (was === now) continue;
      const nextLabels = now ? [...t.labels, name] : t.labels.filter((l) => l !== (existing?.name ?? name));
      await api.patch(`/api/partner-tiers/${t.id}`, { labels: nextLabels });
    }
    return true;
  });

  const submit = async () => {
    const res = await run(undefined);
    if (res !== null) nav('/app/control-center/segmentations');
  };

  const valid = !!name.trim() && (!isEdit || hydrated.current);

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Label' : 'Add Label'} subtitle="Control Center › Segmentation Options › Labels" />
      <div className="card space-y-6">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>
        <div className="max-w-md"><Field label="Name *"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field></div>

        <div className="border-t border-border pt-5">
          <p className="mb-3 text-h3 font-medium text-fg">Offers</p>
          <DualListPicker options={offerOptions} selected={offerIds} onChange={setOfferIds} />
        </div>
        <div className="border-t border-border pt-5">
          <p className="mb-3 text-h3 font-medium text-fg">Advertisers</p>
          <DualListPicker options={advertiserOptions} selected={advertiserIds} onChange={setAdvertiserIds} />
        </div>
        <div className="border-t border-border pt-5">
          <p className="mb-3 text-h3 font-medium text-fg">Partners</p>
          <DualListPicker options={publisherOptions} selected={publisherIds} onChange={setPublisherIds} />
        </div>
        <div className="border-t border-border pt-5">
          <p className="mb-3 text-h3 font-medium text-fg">Smart Links</p>
          <DualListPicker options={smartLinkOptions} selected={smartLinkIds} onChange={setSmartLinkIds} />
        </div>
        <div className="border-t border-border pt-5">
          <p className="mb-3 text-h3 font-medium text-fg">Offer Groups</p>
          <DualListPicker options={offerGroupOptions} selected={offerGroupIds} onChange={setOfferGroupIds} />
        </div>
        <div className="border-t border-border pt-5">
          <p className="mb-3 text-h3 font-medium text-fg">Partner Tiers</p>
          <DualListPicker options={tierOptions} selected={tierIds} onChange={setTierIds} />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => nav('/app/control-center/segmentations')}>Cancel</button>
        <button type="button" className="btn-primary" disabled={!valid || busy} onClick={submit}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
      </div>
    </>
  );
}
