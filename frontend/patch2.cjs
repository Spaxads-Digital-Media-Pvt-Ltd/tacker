const fs = require('fs');

let dash = fs.readFileSync('src/pages/DashboardHome.tsx', 'utf8');

dash = dash.replace(
  /<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 mb-6 animate-fade-in">/g,
  '<ScrollReveal className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 mb-6">'
);
dash = dash.replace(
  /<\/div>\n\s*\{\/\* Charts \*\/\}/g,
  '</ScrollReveal>\n\n                {/* Charts */}'
);

dash = dash.replace(
  /<div className="grid grid-cols-1 gap-6 lg:grid-cols-5 animate-fade-in delay-200">/g,
  '<ScrollReveal className="grid grid-cols-1 gap-6 lg:grid-cols-5" delay={200}>'
);
dash = dash.replace(
  /<\/div>\n\s*\{\/\* Top Performers Section \*\/\}/g,
  '</ScrollReveal>\n\n            {/* Top Performers Section */}'
);

fs.writeFileSync('src/pages/DashboardHome.tsx', dash);
