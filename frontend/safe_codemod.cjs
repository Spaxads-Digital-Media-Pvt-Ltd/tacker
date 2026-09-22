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

  // 1. thead standardisation
  content = content.replace(/<thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">/g, 
    '<thead className="sticky top-0 z-20 bg-page text-tiny uppercase tracking-wide text-fg-secondary [&_th]:border-b [&_th]:border-border">');

  // 2. table typography standardisation
  content = content.replace(/<table className="([^"]*)text-body([^"]*)"/g, '<table className="$1text-small text-fg-secondary$2"');

  // 3. tbody divide-x removal
  content = content.replace(/<tbody className="divide-y divide-border">/g, '<tbody className="divide-y divide-border">'); // keeping divide-y
  content = content.replace(/<tr className="divide-x divide-border">/g, '<tr className="bg-surface text-fg transition-colors hover:bg-accent-subtle/40">');

  if (content !== original) {
    fs.writeFileSync(file, content);
    modifiedCount++;
  }
}

console.log(`Modified ${modifiedCount} files.`);
