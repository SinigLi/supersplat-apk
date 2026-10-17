/* merge_woman.cjs - 女人角色资产合并
 * 网格/骨骼/贴图来自 Superhero_Female_FullBody.gltf(+bin+png)
 * 动画来自 assets_src/UAL1_Standard.glb（43 clips，65 关节，与女人骨骼同名同序）
 * 输出: www/static/director/woman.glb
 *
 * 用法: node tools/asset/merge_woman.cjs
 * 之后跑 compress_glb + add_webp_ext 压贴图（见 docs/DIRECTOR.md）
 */
const fs = require('fs');
const path = require('path');
const { NodeIO } = require('@gltf-transform/core');
const { mergeDocuments, unpartition, prune } = require('@gltf-transform/functions');

const BASE = 'F:/openclawhome/openclaw/game_artist_workspace/tools/3D-models/blender-addon';
const APK = path.resolve(__dirname, '../..');
const DIR = path.join(APK, 'www/static/director');
const ANIM = path.join(APK, 'assets_src/UAL1_Standard.glb');
const io = new NodeIO();

async function main() {
  const femDoc = await io.read(path.join(BASE, 'characters/Superhero_Female_FullBody.gltf'));
  const animDoc = await io.read(ANIM);

  console.log('female:', femDoc.getRoot().listMeshes().map(m => m.getName()).join(','),
    '| skins', femDoc.getRoot().listSkins().length,
    '| anims', femDoc.getRoot().listAnimations().length,
    '| tex', femDoc.getRoot().listTextures().length);
  console.log('anim lib: anims', animDoc.getRoot().listAnimations().length,
    '| meshes', animDoc.getRoot().listMeshes().map(m => m.getName()).join(','));

  const femJoints = femDoc.getRoot().listSkins()[0].listJoints().map(n => n.getName());
  const animJoints = animDoc.getRoot().listSkins()[0].listJoints().map(n => n.getName());
  const same = femJoints.length === animJoints.length && femJoints.every((n, i) => n === animJoints[i]);
  if (!same) { console.error('FATAL: skeleton mismatch'); process.exit(1); }
  console.log('skeleton match OK (' + femJoints.length + ' joints)');

  const femByName = new Map(femDoc.getRoot().listNodes().map(n => [n.getName(), n]));
  const animNodes = new Set(animDoc.getRoot().listNodes());
  const animScenes = new Set(animDoc.getRoot().listScenes());

  const map = await mergeDocuments(femDoc, animDoc);
  console.log('merge map:', map.size);

  // 把每条动画通道重定向到女人骨骼同名节点
  let retargeted = 0, dropped = 0;
  femDoc.getRoot().listAnimations().forEach((anim) => {
    anim.listChannels().forEach((ch) => {
      const node = ch.getTargetNode();
      if (!node) return;
      const target = femByName.get(node.getName());
      if (target && target !== node) { ch.setTargetNode(target); retargeted++; }
      else if (!target) { ch.dispose(); dropped++; }
    });
  });
  console.log('retargeted:', retargeted, 'dropped:', dropped);
  if (retargeted === 0) { console.error('FATAL: no retarget'); process.exit(1); }

  // 丢掉动画库里自带的人偶场景与节点，只留女人
  animScenes.forEach((s) => { const m = map.get(s); if (m) m.dispose(); });
  let disposed = 0;
  animNodes.forEach((n) => { const m = map.get(n); if (m) { m.dispose(); disposed++; } });
  console.log('disposed anim-lib nodes:', disposed);

  await femDoc.transform(unpartition(), prune());
  const r = femDoc.getRoot();
  console.log('result meshes:', r.listMeshes().map(m => m.getName()).join(','),
    '| mats', r.listMaterials().length,
    '| tex', r.listTextures().length,
    '| anims', r.listAnimations().length,
    '| skins', r.listSkins().length,
    '| scenes', r.listScenes().length);

  const out = path.join(DIR, 'woman.glb');
  await io.write(out, femDoc);
  console.log('WROTE', out, (fs.statSync(out).size / 1048576).toFixed(2), 'MB');
}
main().catch(e => { console.error(e); process.exit(1); });
