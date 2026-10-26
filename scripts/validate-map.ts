/**
 * Step 4 of the data pipeline: validate generated chunk files.
 * Exits with code 1 if any hard error is found.
 *
 * Usage: npm run data:validate
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chunkFileName, type ChunkData, type WorldManifest } from '../src/geo/chunkFormat';
import { validateChunk } from '../src/geo/validateChunk';

const PUB = join(import.meta.dirname, '..', 'public', 'data');

function main(): void {
  const manifestPath = join(PUB, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error('manifest.json not found — run `npm run data:all`.');
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as WorldManifest;
  let errors = 0;
  let warnings = 0;
  const totals = { roads: 0, buildings: 0, water: 0, landuse: 0, trees: 0, landmarks: 0, estimatedHeights: 0 };
  for (const c of manifest.chunks) {
    const path = join(PUB, 'chunks', chunkFileName(c.cx, c.cz));
    if (!existsSync(path)) {
      console.error(`✗ missing chunk file ${path}`);
      errors++;
      continue;
    }
    const data = JSON.parse(readFileSync(path, 'utf8')) as ChunkData;
    const res = validateChunk(data, manifest.chunkSize);
    for (const e of res.errors) console.error(`✗ [${c.key}] ${e}`);
    for (const w of res.warnings.slice(0, 5)) console.warn(`! [${c.key}] ${w}`);
    if (res.warnings.length > 5) console.warn(`! [${c.key}] … ${res.warnings.length - 5} more warnings`);
    errors += res.errors.length;
    warnings += res.warnings.length;
    totals.roads += data.roads.length;
    totals.buildings += data.buildings.length;
    totals.water += data.water.length;
    totals.landuse += data.landuse.length;
    totals.trees += data.trees.length / 2;
    totals.landmarks += data.landmarks.length;
    totals.estimatedHeights += data.buildings.filter((b) => b.hs === 'e').length;
  }
  const sp = manifest.spawn.player;
  if (!Number.isFinite(sp.x) || !Number.isFinite(sp.z)) {
    console.error('✗ invalid player spawn');
    errors++;
  }
  console.log('Totals:', totals);
  console.log(`Chunks: ${manifest.chunks.length}, errors: ${errors}, warnings: ${warnings}`);
  if (errors > 0) process.exit(1);
  console.log('✓ Map data valid.');
}

main();
