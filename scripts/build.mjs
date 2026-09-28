import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
for (const name of ['index.html', 'style.css', 'app.js', 'analysis.js']) copyFileSync(`src/${name}`, `dist/${name}`);
mkdirSync('dist/assets', { recursive: true });
copyFileSync('src/assets/ledger-city.webp', 'dist/assets/ledger-city.webp');
