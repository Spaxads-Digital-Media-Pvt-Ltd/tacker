/**
 * Offer thumbnail: paste an image URL, or drag-and-drop / browse to upload a file. With an
 * `offerId` the file uploads immediately (POST /api/offers/:id/thumbnail → storage); on the Create
 * form there's no id yet, so the file is handed back via `onPendingFile` and uploaded after create.
 */
import { useEffect, useRef, useState } from 'react';
import { ImageIcon, X } from 'lucide-react';
import { api, ApiError } from '../../../lib/api';
import type { Offer } from '../../../types';

const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_BYTES = 2 * 1024 * 1024;

function checkImage(file: File): string | null {
  if (!TYPES.includes(file.type)) return 'Use a PNG, JPEG, WebP or GIF image.';
  if (file.size > MAX_BYTES) return 'Image must be 2 MB or smaller.';
  return null;
}

export function ThumbnailField({ offerId, url, onUrlChange, onPendingFile }: {
  offerId?: string;
  url: string;
  onUrlChange: (url: string) => void;
  onPendingFile?: (file: File | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview); }, [localPreview]);
  useEffect(() => { setBroken(false); }, [url]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const problem = checkImage(file);
    if (problem) { setErr(problem); return; }
    setErr(null);
    if (!offerId) {
      setLocalPreview(URL.createObjectURL(file));
      onPendingFile?.(file);
      return;
    }
    setBusy(true);
    try {
      const updated = await api.upload<Offer>(`/api/offers/${offerId}/thumbnail`, file);
      onUrlChange(updated.thumbnailUrl ?? '');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const clear = () => { onUrlChange(''); onPendingFile?.(null); setLocalPreview(null); setErr(null); };
  const preview = localPreview ?? (url && !broken ? url : null);

  return (
    <div>
      <label className="label mb-2 block">Thumbnail</label>
      <div
        role="button" tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void handleFile(e.dataTransfer.files[0]); }}
        className={`relative flex min-h-[110px] cursor-pointer items-center justify-center rounded-card border border-dashed p-3 text-tiny transition-colors ${dragging ? 'border-accent bg-accent-subtle' : 'border-border hover:bg-page'}`}>
        {preview ? (
          <>
            <img src={preview} alt="Offer thumbnail" className="max-h-24 max-w-full rounded object-contain" onError={() => setBroken(true)} />
            <button type="button" aria-label="Remove thumbnail" onClick={(e) => { e.stopPropagation(); clear(); }}
              className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-elevated text-fg-secondary shadow hover:text-fg"><X size={13} /></button>
          </>
        ) : (
          <span className="flex flex-col items-center gap-1 text-fg-muted">
            <ImageIcon size={18} />
            {busy ? 'Uploading…' : <>Drag and drop or <span className="font-medium text-accent-text">Browse</span></>}
            <span className="text-[11px]">PNG, JPEG, WebP or GIF · max 2 MB</span>
          </span>
        )}
        <input ref={input} type="file" accept={TYPES.join(',')} className="hidden" onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <input className="input mt-2" placeholder="…or paste an image URL (https://…)" value={localPreview ? '' : url} disabled={Boolean(localPreview)}
        onChange={(e) => { setErr(null); onUrlChange(e.target.value); }} />
      {broken && url && <p className="mt-1 text-tiny text-warning-text">That URL didn’t load as an image.</p>}
      {err && <p className="mt-1 text-tiny text-danger-text">{err}</p>}
      {localPreview && <p className="mt-1 text-tiny text-fg-muted">Uploads when the offer is created.</p>}
    </div>
  );
}
