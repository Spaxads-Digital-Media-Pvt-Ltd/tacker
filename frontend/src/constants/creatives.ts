/** Shared types/constants for Offers › Creatives, matching the reference's real "Manage Creatives"
 * (/offers/creatives): a network-wide catalog where one creative can target several offers at once
 * (stored as one row per offer), across seven asset types. */
export interface Creative {
  id: string; ref: number; offerId: string; offerName?: string; offerRef?: number;
  name: string; type: CreativeType; url: string | null; html: string | null;
  width: number | null; height: number | null; language: string | null;
  status: 'active' | 'paused' | 'deleted';
  visibleToPartners: boolean; emailFrom: string | null; emailSubject: string | null;
  createdAt: string; updatedAt: string;
}

export type CreativeType = 'image' | 'html' | 'link' | 'email' | 'video' | 'archive' | 'thumbnail' | 'text';

export const TYPE_LABEL: Record<CreativeType, string> = {
  image: 'Image', html: 'HTML', link: 'Link', email: 'Email', video: 'Video', archive: 'Archive', thumbnail: 'Thumbnail', text: 'Text',
};

/** "+ Creative" dropdown items — matches the reference exactly. `emailOrHtml` is a single menu
 * entry that internally toggles between the `email` and `html` backend type values. */
export type MenuKey = 'archive' | 'emailOrHtml' | 'image' | 'link' | 'text' | 'thumbnail' | 'video';
export const ADD_MENU: { key: MenuKey; label: string; desc: string }[] = [
  { key: 'archive', label: 'Archive', desc: 'Add a folder of your creatives by uploading a Zip file' },
  { key: 'emailOrHtml', label: 'Email or HTML', desc: 'Add your HTML by uploading a Zip file or entering it manually' },
  { key: 'image', label: 'Image', desc: 'Add your image file' },
  { key: 'link', label: 'Link', desc: 'Add your creative link' },
  { key: 'text', label: 'Text', desc: 'Add your text file' },
  { key: 'thumbnail', label: 'Thumbnail', desc: 'Add your thumbnail file' },
  { key: 'video', label: 'Video', desc: 'Add your video file' },
];

export const FILE_ACCEPT: Partial<Record<MenuKey, string>> = {
  archive: '.zip', image: 'image/*', text: '.txt', thumbnail: 'image/*', video: 'video/*',
};

/** Maps a stored `type` (from an existing row, for Edit) back to the menu key that built it. */
export function typeToMenuKey(type: CreativeType): MenuKey {
  if (type === 'email' || type === 'html') return 'emailOrHtml';
  return type as MenuKey;
}

export const MACROS = [
  { token: '{click_id}', label: 'Click ID' },
  { token: '{offer_id}', label: 'Offer ID' },
  { token: '{publisher_id}', label: 'Partner ID' },
  { token: '{country}', label: 'Country' },
  { token: '{device}', label: 'Device' },
  { token: '{sub1}', label: 'Sub 1' },
  { token: '{sub2}', label: 'Sub 2' },
  { token: '{sub3}', label: 'Sub 3' },
  { token: '{sub4}', label: 'Sub 4' },
  { token: '{sub5}', label: 'Sub 5' },
];

/** No asset host in this app — a real uploaded file is read client-side and stored as a data: URI,
 * capped well under the backend's 6MB column limit so the request body itself stays reasonable. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      reject(new Error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)}MB.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return { date: d.toLocaleDateString(), time: `${d.toLocaleTimeString(undefined, { timeStyle: 'medium' })} ${Intl.DateTimeFormat().resolvedOptions().timeZone}` };
}
