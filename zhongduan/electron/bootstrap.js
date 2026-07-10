import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundledMain = join(__dirname, '../dist-electron/main.js');

if (existsSync(bundledMain)) {
  await import(bundledMain);
} else {
  await import('./main.js');
}
