/**
 * Offer thumbnail: paste an image URL, or drag-and-drop / browse to upload a file. With an
 * `offerId` the file uploads immediately (POST /api/offers/:id/thumbnail → storage); on the Create
 * form there's no id yet, so the file is handed back via `onPendingFile` and uploaded after create.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { ImageIcon, Upload, X } from 'lucide-react';
import { api } from '../../../lib/api';
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
  const labelId = useId();
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
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const clear = () => { onUrlChange(''); onPendingFile?.(null); setLocalPreview(null); setErr(null); };
  const preview = localPreview ?? (url && !broken ? url : null);

  return (
    <div data-help-label="Thumbnail">
      <span id={labelId} className="label mb-1.5 block">Thumbnail</span>
      {/* Concept 05: a 56 px dashed preview + an Upload button + the file-type note. The whole row is
          the drop target; the preview square and the button both open the file picker. */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void handleFile(e.dataTransfer.files[0]); }}
        className={`flex items-center gap-3 rounded-[var(--radius)] p-1 transition-colors duration-fast ${dragging ? 'bg-accent-subtle ring-1 ring-inset ring-accent-text' : ''}`}>
        <div onClick={() => input.current?.click()}
          className={`grid h-14 w-14 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-[var(--radius)] border border-dashed bg-subtle text-fg-muted ${dragging ? 'border-accent-text' : 'border-border-strong hover:border-fg-secondary'}`}>
          {preview ? <img src={preview} alt="Offer thumbnail" className="h-full w-full object-contain" onError={() => setBroken(true)} /> : <ImageIcon size={18} aria-hidden />}
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-describedby={labelId} onClick={() => input.current?.click()} disabled={busy} className="btn-ghost !px-3 !py-1.5 text-small">
              <Upload size={15} aria-hidden /> {busy ? 'Uploading…' : 'Upload'}
            </button>
            {preview && (
              <button type="button" aria-label="Remove thumbnail" onClick={clear} className="btn-ghost !px-2.5 !py-1.5 text-small">
                <X size={14} aria-hidden />
              </button>
            )}
          </div>
          <p className="text-tiny text-fg-muted">PNG, JPEG, WebP or GIF · max 2 MB</p>
        </div>
        <input ref={input} type="file" accept={TYPES.join(',')} className="hidden" onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <input className="input mt-2" aria-labelledby={labelId} placeholder="…or paste an image URL (https://…)" value={localPreview ? '' : url} disabled={Boolean(localPreview)}
        onChange={(e) => { setErr(null); onUrlChange(e.target.value); }} />
      {broken && url && <p className="mt-1 text-tiny text-warning-text">That URL didn’t load as an image.</p>}
      {err && <p className="mt-1 text-tiny text-danger-text">{err}</p>}
      {localPreview && <p className="mt-1 text-tiny text-fg-muted">Uploads when the offer is created.</p>}
    </div>
  );
}
