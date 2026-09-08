import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Indirected through a variable: under the jsdom environment, Vite statically rewrites the literal
// `new URL('./x', import.meta.url)` pattern into a dev-server asset URL, which breaks fileURLToPath.
const here = import.meta.url;

export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./${name}`, here)), 'utf8');
}
