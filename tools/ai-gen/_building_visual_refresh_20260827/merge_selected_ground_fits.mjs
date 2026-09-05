import fs from 'node:fs';


const [, , baselinePath, generatedPath, ...requestedIds] = process.argv;
if (!baselinePath || !generatedPath) {
    throw new Error('usage: node merge_selected_ground_fits.mjs <baseline.json> <generated.json>');
}

const selectedIds = new Set(requestedIds.length
    ? requestedIds
    : ['steam_power_plant', 'wind_power_plant', 'grand_mall']);
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const generated = JSON.parse(fs.readFileSync(generatedPath, 'utf8'));
const generatedById = new Map(
    generated.entries.filter((entry) => selectedIds.has(entry.id)).map((entry) => [entry.id, entry])
);
for (const id of selectedIds) {
    if (!generatedById.has(id)) throw new Error(`generated ground fit missing ${id}`);
}
baseline.entries = baseline.entries.map((entry) => (
    selectedIds.has(entry.id) ? generatedById.get(entry.id) : entry
));
fs.writeFileSync(generatedPath, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`merged ${[...selectedIds].join(', ')}`);
