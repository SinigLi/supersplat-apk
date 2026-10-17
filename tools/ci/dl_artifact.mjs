// 下载 supersplat-debug-apk artifact（Bearer 认证 + 1MB 分片可续传）
// 用法: node dl_artifact.cjs <run_id> <out_zip>
import { readFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';

const [runId, outPath] = process.argv.slice(2);
if (!runId || !outPath) { console.error('usage: node dl_artifact.cjs <run_id> <out_zip>'); process.exit(1); }

const TOKEN_FILE = 'F:/openclawhome/openclaw/fullstack_workspace/githubapi.txt';
const repo = 'SinigLi/supersplat-apk';
const token = () => readFileSync(TOKEN_FILE, 'utf8').trim().split(/\r?\n/)[0].trim();
const H = () => ({ 'Authorization': 'Bearer ' + token() });
const j = async (u) => (await fetch(u, { headers: H() })).json();

// 1. run 状态 + artifact 元数据（注意：字段是 size_in_bytes，不是 size）
const run = await j(`https://api.github.com/repos/${repo}/actions/runs/${runId}`);
if (run.conclusion !== 'success') { console.log('run not success:', run.conclusion); process.exit(1); }
const arts = await j(`https://api.github.com/repos/${repo}/actions/runs/${runId}/artifacts`);
const art = arts.artifacts.find(a => a.name === 'supersplat-debug-apk');
if (!art) { console.log('artifact not found:', JSON.stringify(arts.artifacts?.map(a => a.name))); process.exit(1); }
const total = art.size_in_bytes;
console.log(`artifact ${art.id}: ${total} bytes`);

// 2. 分片下载：每次拿新签名 URL（redirect manual 取 Location），对签名 URL 发 Range
const partsDir = outPath + '.parts';
if (!existsSync(partsDir)) mkdirSync(partsDir);
const CHUNK = 1024 * 1024;
const nChunks = Math.ceil(total / CHUNK);
console.log(`chunks: ${nChunks}, already done: ${readdirSync(partsDir).length}`);

for (let idx = 0; idx < nChunks; idx++) {
  const pf = `${partsDir}/p${idx}`;
  if (existsSync(pf)) continue;
  const start = idx * CHUNK;
  const end = Math.min(start + CHUNK - 1, total - 1);
  let ok = false, tries = 0;
  while (!ok && tries < 8) {
    tries++;
    try {
      const loc = await fetch(`https://api.github.com/repos/${repo}/actions/artifacts/${art.id}/zip`, {
        headers: H(), redirect: 'manual'
      });
      const signed = loc.headers.get('location');
      if (!signed) { throw new Error('no signed url (status ' + loc.status + ')'); }
      const r = await fetch(signed, { headers: { 'Range': `bytes=${start}-${end}` } });
      if (r.status === 206 || r.status === 200) {
        const ab = await r.arrayBuffer();
        writeFileSync(pf, Buffer.from(ab));
        ok = true;
        process.stdout.write(`p${idx} ${r.status} ${ab.byteLength}B  `);
      } else { throw new Error('chunk status ' + r.status); }
    } catch (e) {
      console.log(`\nchunk ${idx} try${tries}: ${e.message}`);
      await new Promise(res => setTimeout(res, 1200 * tries));
    }
  }
  if (!ok) { console.log(`chunk ${idx} FAILED permanently`); process.exit(1); }
}
console.log('');

// 3. 合并 + 校验
const files = readdirSync(partsDir).filter(f => f.startsWith('p')).map(f => parseInt(f.slice(1))).sort((a, b) => a - b);
const all = Buffer.concat(files.map(f => readFileSync(`${partsDir}/p${f}`)));
if (all.length !== total) { console.log(`SIZE MISMATCH: ${all.length} != ${total}`); process.exit(1); }
writeFileSync(outPath, all);
console.log(`DONE: ${outPath} = ${all.length} bytes MATCH`);
