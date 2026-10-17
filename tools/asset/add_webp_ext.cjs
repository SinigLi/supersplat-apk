/* add_webp_ext.cjs <file.glb> - 手动压缩贴图后补 EXT_texture_webp 扩展声明 */
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(process.argv[2]);

const buf = fs.readFileSync(FILE);
const jsonLen = buf.readUInt32LE(12);
const jsonStart = 20;
const jsonEnd = jsonStart + jsonLen;
let jsonStr = buf.slice(jsonStart, jsonEnd).toString('utf8').replace(/\u0000+$/g, '').trimEnd();
const gltf = JSON.parse(jsonStr);

// find BIN chunk right after JSON chunk
const binLen = buf.readUInt32LE(jsonEnd);
const binType = buf.readUInt32LE(jsonEnd + 4);
if (binType !== 0x004E4942) { console.error('unexpected chunk order', binType.toString(16)); process.exit(1); }
const binData = buf.slice(jsonEnd + 8, jsonEnd + 8 + binLen);

const hasWebp = (gltf.images || []).some(i => i.mimeType === 'image/webp');
if (hasWebp) {
  gltf.extensionsUsed = Array.from(new Set([...(gltf.extensionsUsed || []), 'EXT_texture_webp']));
  (gltf.textures || []).forEach((t) => {
    if (t.source !== undefined) t.extensions = { ...(t.extensions || {}), EXT_texture_webp: { source: t.source } };
  });
  console.log('webp images found, extension declared');
} else {
  console.log('no webp images - skipped');
}

let newJson = JSON.stringify(gltf);
while (newJson.length % 4 !== 0) newJson += ' ';
const jsonBuf = Buffer.from(newJson, 'utf8');

const total = 12 + 8 + jsonBuf.length + 8 + binData.length;
const out = Buffer.alloc(total);
out.write('glTF', 0, 'ascii');
out.writeUInt32LE(2, 4);
out.writeUInt32LE(total, 8);
out.writeUInt32LE(jsonBuf.length, 12);
out.writeUInt32LE(0x4E4F534A, 16);
jsonBuf.copy(out, 20);
const p = 20 + jsonBuf.length;
out.writeUInt32LE(binData.length, p);
out.writeUInt32LE(0x004E4942, p + 4);
binData.copy(out, p + 8);
fs.writeFileSync(FILE, out);

console.log('written', (out.length / 1048576).toFixed(2), 'MB');
const chk = JSON.parse(fs.readFileSync(FILE).slice(20, 20 + fs.readFileSync(FILE).readUInt32LE(12)).toString('utf8').trimEnd());
console.log('extensionsUsed:', JSON.stringify(chk.extensionsUsed));
console.log('images:', (chk.images || []).map(i => i.mimeType).join(','));
console.log('textures[0].extensions:', JSON.stringify((chk.textures || [])[0].extensions));
console.log('animations:', (chk.animations || []).length, 'meshes:', (chk.meshes || []).length, 'skins:', (chk.skins || []).length);
