const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(filePath));
    } else if (filePath.endsWith('.tsx')) {
      results.push(filePath);
    }
  });
  return results;
}

const files = walk('src/pages');
let modifiedCount = 0;

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  content = content.replace(/<div className="overflow-x-auto[^>]*>(\s*)<table/g, '<TableScroll>$1<table');
  content = content.replace(/<\/table>(\s*)<\/div>/g, '</table>$1</TableScroll>');
  content = content.replace(/<thead className="[^"]*">/g, '<thead className="sticky top-0 z-20 bg-page text-tiny uppercase tracking-wide text-fg-secondary [&_th]:border-b [&_th]:border-border">');
  content = content.replace(/<table className="([^"]*)text-body([^"]*)"/g, '<table className="$1text-small text-fg-secondary$2"');
  content = content.replace(/<tr(?! className)/g, '<tr className="bg-surface text-fg transition-colors hover:bg-accent-subtle/40"');

  if (content !== original) {
    // Add TableScroll import if missing
    if (content.includes('<TableScroll>') && !content.includes('TableScroll')) {
      // Find the ui.tsx import and add it. If it has 'StateBlock' or similar, inject.
      if (content.includes("from '../../shared-components/primitives/ui';")) {
         content = content.replace(/import \{ ([^}]+) \} from '\.\.\/\.\.\/shared-components\/primitives\/ui';/, "import { $1, TableScroll } from '../../shared-components/primitives/ui';");
      } else if (content.includes("from '../shared-components/primitives/ui';")) {
         content = content.replace(/import \{ ([^}]+) \} from '\.\.\/shared-components\/primitives\/ui';/, "import { $1, TableScroll } from '../shared-components/primitives/ui';");
      }
    }
    fs.writeFileSync(file, content);
    modifiedCount++;
  }
}

console.log(`Modified ${modifiedCount} files.`);
