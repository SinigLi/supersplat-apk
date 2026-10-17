/* merge_male.cjs - male.glb 精简重建（映射表清掉动画库里的人偶资产） */
const fs = require('fs');
const path = require('path');
const { NodeIO } = require('@gltf-transform/core');
const { mergeDocuments, unpartition, prune } = require('@gltf-transform/functions');

const BASE = 'F:/openclawhome/openclaw/game_artist_workspace/tools/3D-models/blender-addon';
const APK = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk';
const DIR = path.join(APK, 'www/static/director');
const ANIM = path.join(APK, 'assets_src/UAL1_Standard.glb');   // UAL1 动画库（43 clips, 65 关节）
const io = new NodeIO();

async function main() {
  const maleDoc = await io.read(path.join(BASE, 'characters/Superhero_Male_FullBody.gltf'));
  const animDoc = await io.read(ANIM);

  const maleByName = new Map(maleDoc.getRoot().listNodes().map(n => [n.getName(), n]));
  // pre-merge snapshot of woman graph for cleanup
  const womanNodes = new Set(animDoc.getRoot().listNodes());

  const map = await mergeDocuments(maleDoc, animDoc);
  console.log('map size:', map.size);

  // retarget anim channels to male joints
  let retargeted = 0;
  maleDoc.getRoot().listAnimations().forEach((anim) => {
    anim.listChannels().forEach((ch) => {
      const node = ch.getTargetNode();
      if (!node) return;
      const target = maleByName.get(node.getName());
      if (target && target !== node) { ch.setTargetNode(target); retargeted++; }
    });
  });
  console.log('retargeted:', retargeted);
  if (retargeted === 0) { console.error('FATAL: no retarget'); process.exit(1); }

  // dispose merged woman nodes (they are now unreferenced: scenes+channels point at male)
  let disposed = 0;
  womanNodes.forEach((wn) => {
    const merged = map.get(wn);
    if (merged) { merged.dispose(); disposed++; }
  });
  console.log('disposed woman nodes:', disposed);

  await maleDoc.transform(unpartition(), prune());
  console.log('meshes:', maleDoc.getRoot().listMeshes().length,
    'textures:', maleDoc.getRoot().listTextures().length,
    'anims:', maleDoc.getRoot().listAnimations().length,
    'materials:', maleDoc.getRoot().listMaterials().length,
    'scenes:', maleDoc.getRoot().listScenes().length);

  const out = path.join(DIR, 'male.glb');
  await io.write(out, maleDoc);
  console.log('DONE', (fs.statSync(out).size / 1048576).toFixed(2), 'MB');

  // verify: reload and inspect
  const check = await io.read(out);
  const r = check.getRoot();
  console.log('verify anims:', r.listAnimations().length, 'meshes:', r.listMeshes().length,
    'skins:', r.listSkins().length, 'tex:', r.listTextures().length);
  const ch0 = r.listAnimations()[0].listChannels()[0];
  console.log('first channel target:', ch0.getTargetNode().getName(), 'path:', ch0.getTargetPath());
}
main().catch(e => { console.error(e); process.exit(1); });
