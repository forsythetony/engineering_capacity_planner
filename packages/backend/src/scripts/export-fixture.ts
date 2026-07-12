/**
 * Write a synthetic dataset to a JSON file for the frontend to load.
 *
 * The timeline UI runs the pure `@ecp/engine` in the browser for instant
 * what-if recompute, so it needs a `DomainDataset` to work with. Rather than
 * require a running backend for every review, we bundle a generated fixture
 * (committed) that the UI loads by default. A future API path can replace this
 * fixture behind the same `loadDataset()` seam without changing the UI.
 *
 * Usage:
 *   npm run export:fixture -- --out ../frontend/src/fixtures/dataset.json --seed 1
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generateSyntheticDataset } from '../importer/synthetic.js';

function parseArgs(argv: string[]) {
  const args = { out: '../frontend/src/fixtures/dataset.json', seed: 1, items: 50 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i]!;
    else if (a === '--seed') args.seed = Number(argv[++i]);
    else if (a === '--items') args.items = Number(argv[++i]);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const out = resolve(process.cwd(), args.out);
const dataset = generateSyntheticDataset({ seed: args.seed, targetWorkItemCount: args.items });

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(dataset, null, 2)}\n`);
console.log(`Wrote synthetic dataset (seed=${args.seed}, ${dataset.workItems.length} items) → ${out}`);
