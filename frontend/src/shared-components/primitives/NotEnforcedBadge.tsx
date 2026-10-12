/**
 * Offer-group caps are stored and reported (Pacing) but nothing reads them on the click or
 * conversion path — no traffic or conversion is ever blocked by one. Everywhere they're shown or
 * edited they carry this label, so they're never mistaken for the (enforced) offer and goal caps.
 */
const TITLE = 'Offer-group caps are shown for planning only — no traffic or conversion is blocked when they are reached';

/** Small muted "Not enforced" badge; the full explanation is its tooltip. */
export function NotEnforcedBadge({ className = '' }: { className?: string }) {
  return (
    <span title={TITLE}
      className={`inline-flex items-center whitespace-nowrap rounded-full border border-border px-1.5 py-px align-middle text-[10px] font-medium normal-case tracking-normal text-fg-muted ${className}`}>
      Not enforced
    </span>
  );
}

/** The same explanation spelled out, for next to the caps section of the Offer Group pages. */
export function NotEnforcedNote({ className = '' }: { className?: string }) {
  return (
    <p className={`flex flex-wrap items-center gap-1.5 text-[11px] text-fg-muted ${className}`}>
      <NotEnforcedBadge /> {TITLE}.
    </p>
  );
}
