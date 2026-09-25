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

  // 1. thead standardisation -> strip classes entirely since .premium-table handles it
  content = content.replace(/<thead className="sticky top-0 z-20 bg-page text-tiny uppercase tracking-wide text-fg-secondary \[\&_th\]:border-b \[\&_th\]:border-border">/g, '<thead>');
  content = content.replace(/<thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">/g, '<thead>');

  // 2. table standardisation
  content = content.replace(/<table className="[^"]*w-full[^"]*"/g, '<table className="premium-table"');
  
  // 3. strip tbody divide-y
  content = content.replace(/<tbody className="divide-y divide-border">/g, '<tbody>');
  
  // 4. strip tr hover state (premium-table handles it globally)
  content = content.replace(/<tr className="bg-surface text-fg transition-colors hover:bg-accent-subtle\/40">/g, '<tr>');
  content = content.replace(/<tr className="hover:bg-accent-subtle\/40">/g, '<tr>');

  // 5. strip whitespace-nowrap and px-4 py-3 from th and td since premium-table td/th handles it globally!
  content = content.replace(/className="whitespace-nowrap px-4 py-3([^"]*)"/g, (match, p1) => {
    if (p1.trim() === 'font-semibold' || p1.trim() === '') {
      return ''; // Strip completely if it was just font-semibold (which is now handled by td:first-child or th)
    }
    return `className="${p1.trim()}"`; // keep other classes like text-right
  });

  // Strip empty className=""
  content = content.replace(/ className=""/g, '');

  if (content !== original) {
    fs.writeFileSync(file, content);
    modifiedCount++;
  }
}

console.log(`Modified ${modifiedCount} files.`);
