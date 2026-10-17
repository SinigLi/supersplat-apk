/* compress_glb.cjs <file.glb> [quality] [maxSide] - 逐贴图转 WebP 压缩 */
const fs = require('fs');
const path = require('path');
const { NodeIO } = require('@gltf-transform/core');
const sharp = require('sharp');

const FILE = path.resolve(process.argv[2]);
const Q = +(process.argv[3] || 82);
const MAX = +(process.argv[4] || 1024);

async function main() {
  const io = new NodeIO();
  const doc = await io.read(FILE);
  console.log('in:', (fs.statSync(FILE).size / 1048576).toFixed(2), 'MB', FILE);

  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img || !img.length) continue;
    const before = img.length / 1048576;
    if (before < 0.12) { console.log(`  skip ${tex.getName()} (${before.toFixed(2)}MB)`); continue; }
    const meta = await sharp(Buffer.from(img)).metadata();
    const maxSide = Math.max(meta.width || 1024, meta.height || 1024);
    const target = Math.min(maxSide, MAX);
    const out = await sharp(Buffer.from(img))
      .resize(target, target, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: Q })
      .toBuffer();
    tex.setImage(new Uint8Array(out));
    tex.setMimeType('image/webp');
    tex.setURI(tex.getName().replace(/\.(png|jpg|jpeg)$/i, '') + '.webp');
    console.log(`  ${tex.getName()}: ${before.toFixed(2)}MB -> ${(out.length / 1048576).toFixed(2)}MB (${target}px)`);
  }

  await io.write(FILE, doc);
  console.log('out:', (fs.statSync(FILE).size / 1048576).toFixed(2), 'MB');
}
main().catch(e => { console.error(e); process.exit(1); });
