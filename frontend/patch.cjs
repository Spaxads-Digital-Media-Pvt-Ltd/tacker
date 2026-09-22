const fs = require('fs');

let ui = fs.readFileSync('src/shared-components/primitives/ui.tsx', 'utf8');

if (!ui.includes('useIntersectionObserver')) {
  ui = ui.replace(
    "import { X } from 'lucide-react';",
    "import { X } from 'lucide-react';\nimport { useIntersectionObserver } from '../../lib/useIntersectionObserver';"
  );
}

// Remove the garbage I just appended
ui = ui.replace(/export function ScrollReveal.*\n.*\n.*\n.*\n\}/s, '');

// Append the real ScrollReveal
ui += `\nexport function ScrollReveal({ children, animation = 'animate-fade-in', delay = 0, className = '', rootMargin = '50px' }: { children: ReactNode; animation?: string; delay?: number; className?: string; rootMargin?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useIntersectionObserver(ref, { threshold: 0.1, rootMargin });
  return (
    <div ref={ref} className={\`\${className} \${inView ? animation : 'opacity-0'}\`} style={{ animationDelay: \`\${delay}ms\` }}>
      {children}
    </div>
  );
}\n`;

fs.writeFileSync('src/shared-components/primitives/ui.tsx', ui);

let dash = fs.readFileSync('src/pages/DashboardHome.tsx', 'utf8');

if (!dash.includes('ScrollReveal')) {
  dash = dash.replace(
    "import { PageHeader, StatCard, Spinner, StateBlock, AnimatedNumber } from '../shared-components/primitives/ui';",
    "import { PageHeader, StatCard, Spinner, StateBlock, AnimatedNumber, ScrollReveal } from '../shared-components/primitives/ui';"
  );
}

// Replace the bottom metrics tables wrappers
dash = dash.replace(
  /<div className="mt-12 pt-8 border-t border-border\/60 animate-fade-in delay-200">/g,
  '<ScrollReveal className="mt-12 pt-8 border-t border-border/60" delay={200}>'
);
dash = dash.replace(
  /<\/div>\n\s*\{\/\* Bottom Stats \*\/\}/g,
  '</ScrollReveal>\n\n      {/* Bottom Stats */}'
);

dash = dash.replace(
  /<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in delay-100">/g,
  '<ScrollReveal className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" delay={100}>'
);
dash = dash.replace(
  /<\/div>\n\s*<\/div>\n\s*<\/div>\n\s*<\/PageTitleProvider>/,
  '</ScrollReveal>\n        </div>\n      </div>\n    </PageTitleProvider>'
);

// Replace the animate-unwrap divs
dash = dash.replace(
  /\{visible\.offers && <div className="animate-unwrap delay-300">(.+?)<\/div>\}/,
  '{visible.offers && <ScrollReveal animation="animate-unwrap" delay={300}>$1</ScrollReveal>}'
);
dash = dash.replace(
  /\{visible\.publishers && <div className="animate-unwrap delay-500">(.+?)<\/div>\}/,
  '{visible.publishers && <ScrollReveal animation="animate-unwrap" delay={500}>$1</ScrollReveal>}'
);
dash = dash.replace(
  /\{visible\.advertisers && <div className="animate-unwrap delay-700">(.+?)<\/div>\}/,
  '{visible.advertisers && <ScrollReveal animation="animate-unwrap" delay={700}>$1</ScrollReveal>}'
);

fs.writeFileSync('src/pages/DashboardHome.tsx', dash);
