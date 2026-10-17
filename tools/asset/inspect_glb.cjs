/* inspect_glb.cjs - dump GLB JSON summary: nodes/meshes/materials/textures/anims */
const fs = require('fs');
const path = require('path');

function readGlb(p) {
  const b = fs.readFileSync(p);
  if (b.slice(0, 4).toString('ascii') !== 'glTF') return { err: 'not glb' };
  let off = 12, json = null, binLen = 0;
  while (off < b.length) {
    const len = b.readUInt32LE(off);
    const type = b.readUInt32LE(off + 4);
    const data = b.slice(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else binLen += len;
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  return { json, size: b.length, binLen };
}

for (const f of process.argv.slice(2)) {
  const r = readGlb(f);
  const g = r.json;
  if (!g) { console.log(f, r.err); continue; }
  console.log('===', path.basename(f), (r.size / 1048576).toFixed(2), 'MB', 'bin', (r.binLen / 1048576).toFixed(2), 'MB');
  console.log('  generator:', g.asset && g.asset.generator, '| extensionsUsed:', (g.extensionsUsed || []).join(','));
  console.log('  nodes:', (g.nodes || []).length, '| meshes:', (g.meshes || []).length, '| materials:', (g.materials || []).length,
    '| textures:', (g.textures || []).length, '| images:', (g.images || []).length, '| skins:', (g.skins || []).length,
    '| anims:', (g.animations || []).length);
  const meshNames = (g.meshes || []).map(m => m.name).slice(0, 12);
  console.log('  meshes:', meshNames.join(' | '));
  const matNames = (g.materials || []).map(m => m.name).slice(0, 12);
  console.log('  materials:', matNames.join(' | '));
  const imgInfo = (g.images || []).map((im, i) => `${i}:${im.name || '-'}:${im.mimeType || '-'}`).slice(0, 12);
  console.log('  images:', imgInfo.join(' | '));
  const nodeNames = (g.nodes || []).map(n => n.name).filter(Boolean);
  console.log('  node sample:', nodeNames.slice(0, 15).join(' | '), '... total named', nodeNames.length);
  const anims = (g.animations || []).map(a => a.name).slice(0, 8);
  console.log('  anims sample:', anims.join(' | '));
}
