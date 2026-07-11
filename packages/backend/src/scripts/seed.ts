/**
 * Seed a SQLite database with a synthetic epic and print an inspection summary.
 *
 * Usage:
 *   npm run seed                      # writes ./data/ecp.db
 *   npm run seed -- --db /tmp/x.db --seed 7 --items 60
 *
 * Phase 1 is "verifiable via DB inspection", so this script doubles as the
 * verification tool: it reads the data back out of SQLite and reports counts,
 * point totals, the status mix, and the highest-leverage blockers.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDatabase } from '../db/database.js';
import { readDataset, writeDataset } from '../db/persist.js';
import { generateSyntheticDataset } from '../importer/synthetic.js';
import type { DomainDataset } from '@ecp/shared';

function parseArgs(argv: string[]) {
  const args = { db: './data/ecp.db', seed: 1, items: 50 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') args.db = argv[++i]!;
    else if (a === '--seed') args.seed = Number(argv[++i]);
    else if (a === '--items') args.items = Number(argv[++i]);
  }
  return args;
}

/** Rank blockers by how many items they block transitively (leverage). */
function transitiveDependents(data: DomainDataset): Map<string, number> {
  const blockedBy = new Map<string, string[]>(); // blocker -> [blocked...]
  for (const d of data.dependencies) {
    const list = blockedBy.get(d.blockerItemKey) ?? [];
    list.push(d.blockedItemKey);
    blockedBy.set(d.blockerItemKey, list);
  }
  const counts = new Map<string, number>();
  for (const item of data.workItems) {
    const seen = new Set<string>();
    const stack = [...(blockedBy.get(item.key) ?? [])];
    while (stack.length) {
      const next = stack.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...(blockedBy.get(next) ?? []));
    }
    counts.set(item.key, seen.size);
  }
  return counts;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(dirname(args.db), { recursive: true });

  const dataset = generateSyntheticDataset({ seed: args.seed, targetWorkItemCount: args.items });

  const db = openDatabase({ path: args.db });
  writeDataset(db, dataset);
  const readBack = readDataset(db);
  db.close();

  const statusMix = readBack.workItems.reduce<Record<string, number>>((acc, w) => {
    acc[w.status] = (acc[w.status] ?? 0) + 1;
    return acc;
  }, {});
  const totalPoints = readBack.workItems.reduce((s, w) => s + w.points, 0);
  const gating = readBack.milestones.find((m) => m.isGating);

  const leverage = transitiveDependents(readBack);
  const topBlockers = [...leverage.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  console.log(`\nSeeded synthetic dataset → ${args.db} (seed=${args.seed})\n`);
  console.log(`  Teams:        ${readBack.teams.length}`);
  console.log(`  Members:      ${readBack.members.length} (${readBack.members.filter((m) => m.active).length} active)`);
  console.log(`  Epic:         ${readBack.epics[0]?.key} — ${readBack.epics[0]?.title}`);
  console.log(`  Stories:      ${readBack.stories.length}`);
  console.log(`  Work items:   ${readBack.workItems.length}  (${totalPoints} points)`);
  console.log(`  Dependencies: ${readBack.dependencies.length}`);
  console.log(`  Status mix:   ${JSON.stringify(statusMix)}`);
  console.log(`  Gating day:   ${gating?.name} @ ${gating?.date}`);
  console.log(`  Top blockers (transitive dependents):`);
  for (const [key, n] of topBlockers) {
    const item = readBack.workItems.find((w) => w.key === key)!;
    console.log(`    ${key.padEnd(8)} blocks ${String(n).padStart(2)}  — ${item.title}`);
  }
  console.log('');
}

main();
