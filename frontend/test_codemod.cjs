const fs = require('fs');

let content = fs.readFileSync('src/pages/admin/EventReport.tsx', 'utf8');

content = content.replace(/<div className="overflow-x-auto[^>]*>(\s*)<table/g, '<TableScroll>$1<table');
content = content.replace(/<\/table>(\s*)<\/div>/g, '</table>$1</TableScroll>');
content = content.replace(/<thead className="[^"]*">/g, '<thead className="sticky top-0 z-20 bg-page text-tiny uppercase tracking-wide text-fg-secondary [&_th]:border-b [&_th]:border-border">');
content = content.replace(/<table className="([^"]*)text-body([^"]*)"/g, '<table className="$1text-small text-fg-secondary$2"');
content = content.replace(/<tr(?! className)/g, '<tr className="bg-surface text-fg transition-colors hover:bg-accent-subtle/40"');

// Ensure import for TableScroll
if (content.includes('<TableScroll>') && !content.includes('TableScroll')) {
  content = content.replace("import { StateBlock } from '../../shared-components/primitives/ui';", "import { StateBlock, TableScroll } from '../../shared-components/primitives/ui';");
}

fs.writeFileSync('src/pages/admin/EventReport.tsx', content);
console.log('Modified EventReport.tsx');
