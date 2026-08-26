export function ComingSoon({ addLabel = '+ Add' }: { addLabel?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-small text-fg-muted">No custom settings configured.</p>
      <button title="Not available yet" className="btn-primary !py-1.5 !px-3 text-tiny">{addLabel}</button>
    </div>
  );
}
