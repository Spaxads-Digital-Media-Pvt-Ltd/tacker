const fs = require('fs');

// Patch ui.tsx
let ui = fs.readFileSync('src/shared-components/primitives/ui.tsx', 'utf8');

ui = ui.replace(
  /export function StatCard\(\{ label, value, hint \}: \{ label: string; value: string; hint\?: string \}\) \{\n  return \(\n    <div className="card transition-all/g,
  `export function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {\n  return (\n    <ScrollReveal className="card transition-all`
);
ui = ui.replace(
  /      \{hint && <p className="mt-1 text-tiny text-fg-muted">\{hint\}<\/p>\}\n    <\/div>\n  \);\n\}/g,
  `      {hint && <p className="mt-1 text-tiny text-fg-muted">{hint}</p>}\n    </ScrollReveal>\n  );\n}`
);

ui = ui.replace(
  /export function PhaseNotice\(\{ phase, children \}: \{ phase: string; children: ReactNode \}\) \{\n  return \(\n    <div className="card border-dashed">/g,
  `export function PhaseNotice({ phase, children }: { phase: string; children: ReactNode }) {\n  return (\n    <ScrollReveal className="card border-dashed">`
);
ui = ui.replace(
  /        <\/span>\n      <\/div>\n      <p className="mt-3 text-small text-fg-secondary">\{children\}<\/p>\n    <\/div>\n  \);\n\}/g,
  `        </span>\n      </div>\n      <p className="mt-3 text-small text-fg-secondary">{children}</p>\n    </ScrollReveal>\n  );\n}`
);

ui = ui.replace(
  /export function StateBlock\(\{ icon: Icon, title, desc, action \}: \{ icon: React\.ElementType; title: string; desc: string; action\?: ReactNode \}\) \{\n  return \(\n    <div className="card flex flex-col items-center justify-center p-12 text-center">/g,
  `export function StateBlock({ icon: Icon, title, desc, action }: { icon: React.ElementType; title: string; desc: string; action?: ReactNode }) {\n  return (\n    <ScrollReveal className="card flex flex-col items-center justify-center p-12 text-center">`
);
ui = ui.replace(
  /      <h3 className="mt-4 text-large font-bold text-fg">\{title\}<\/h3>\n      <p className="mt-1 text-small text-fg-muted">\{desc\}<\/p>\n      \{action && <div className="mt-6">\{action\}<\/div>\}\n    <\/div>\n  \);\n\}/g,
  `      <h3 className="mt-4 text-large font-bold text-fg">{title}</h3>\n      <p className="mt-1 text-small text-fg-muted">{desc}</p>\n      {action && <div className="mt-6">{action}</div>}\n    </ScrollReveal>\n  );\n}`
);

fs.writeFileSync('src/shared-components/primitives/ui.tsx', ui);

// Patch EmptyShellTable.tsx
let est = fs.readFileSync('src/shared-components/primitives/EmptyShellTable.tsx', 'utf8');

if (!est.includes('ScrollReveal')) {
  est = est.replace(
    "import { ChevronRight, Info, MoreVertical, Search } from 'lucide-react';",
    "import { ChevronRight, Info, MoreVertical, Search } from 'lucide-react';\nimport { ScrollReveal } from './ui';"
  );
}

est = est.replace(
  /  const filtered = \(rows \?\? \[\]\)\.filter\(\(row\) => \{\n    if \(\!q\.trim\(\)\) return true;\n    const needle = q\.toLowerCase\(\);\n    return Object\.values\(row\.cells\)\.some\(\(v\) => v\.toLowerCase\(\)\.includes\(needle\)\);\n  \}\);\n\n  return \(\n    <div>/g,
  `  const filtered = (rows ?? []).filter((row) => {\n    if (!q.trim()) return true;\n    const needle = q.toLowerCase();\n    return Object.values(row.cells).some((v) => v.toLowerCase().includes(needle));\n  });\n\n  return (\n    <ScrollReveal>`
);

est = est.replace(
  /      <div className="mt-2 flex justify-end">\n        <Pagination total=\{wired \? filtered\.length : 0\} page=\{1\} pageSize=\{25\} onPageChange=\{\(\) => \{\}\} \/>\n      <\/div>\n    <\/div>\n  \);\n\}/g,
  `      <div className="mt-2 flex justify-end">\n        <Pagination total={wired ? filtered.length : 0} page={1} pageSize={25} onPageChange={() => {}} />\n      </div>\n    </ScrollReveal>\n  );\n}`
);

fs.writeFileSync('src/shared-components/primitives/EmptyShellTable.tsx', est);

