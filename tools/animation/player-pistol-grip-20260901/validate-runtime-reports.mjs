#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const reportRoot = path.resolve(here, '..', '..', 'verify-shots', 'pistol-grip-runtime-20260901');
const batches = [
  { name: 'levels', expected: 24, palmTolerance: 0.05 },
  { name: 'angles', expected: 10, palmTolerance: 0.05 },
  { name: 'locomotion', expected: 15, palmTolerance: 0.75 },
];

const summaries = [];
for (const batch of batches) {
  const reportPath = path.join(reportRoot, `runtime-metadata-${batch.name}.json`);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const entries = report.entries || [];
  if (entries.length !== batch.expected) {
    throw new Error(`${batch.name}: expected ${batch.expected} entries, got ${entries.length}`);
  }
  const failures = entries.filter(entry => !entry.weaponVisible
    || entry.mainContactError < 0 || entry.mainContactError > 0.05
    || entry.mainHandContactError < 0 || entry.mainHandContactError > batch.palmTolerance
    || (entry.mode === 'dual' && (!entry.offhandVisible
      || entry.offContactError < 0 || entry.offContactError > 0.05)));
  if (failures.length) {
    throw new Error(`${batch.name}: ${failures.length} contact failures`);
  }
  const dual = entries.filter(entry => entry.mode === 'dual');
  summaries.push({
    batch: batch.name,
    entries: entries.length,
    palmTolerance: batch.palmTolerance,
    maxMainGripError: Math.max(...entries.map(entry => entry.mainContactError)),
    maxMainPalmError: Math.max(...entries.map(entry => entry.mainHandContactError)),
    maxOffhandGripError: dual.length ? Math.max(...dual.map(entry => entry.offContactError)) : 0,
  });
}

console.log(JSON.stringify({ totalEntries: summaries.reduce((sum, batch) => sum + batch.entries, 0), summaries }, null, 2));
