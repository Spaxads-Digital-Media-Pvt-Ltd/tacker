const fs = require('fs');

// Fix 1: useIntersectionObserver.ts
let hook = fs.readFileSync('src/lib/useIntersectionObserver.ts', 'utf8');
hook = hook.replace('if (entry.isIntersecting) {', 'if (entry?.isIntersecting) {');
fs.writeFileSync('src/lib/useIntersectionObserver.ts', hook);

// Fix 2: DashboardHome.tsx - cr.today string
let dash = fs.readFileSync('src/pages/DashboardHome.tsx', 'utf8');
dash = dash.replace(/value=\{`\$\{data\.cr\.today\}%`\}/, 'value={Number(data.cr.today)} formatFn={(v) => `${v.toFixed(1)}%`}');

// Fix 3: DashboardHome.tsx - inView variable missing? Let's check InteractiveKpi
// I will just open it and replace it correctly.
fs.writeFileSync('src/pages/DashboardHome.tsx', dash);
