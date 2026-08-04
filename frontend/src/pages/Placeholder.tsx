import { PageHeader, PhaseNotice } from '../components/ui';

/** Generic sub-route page until its phase lands. Title/phase passed per route. */
export default function Placeholder({ title, phase, note }: { title: string; phase: string; note: string }) {
  return (
    <>
      <PageHeader title={title} />
      <PhaseNotice phase={phase}>{note}</PhaseNotice>
    </>
  );
}
