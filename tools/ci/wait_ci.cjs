/* wait_ci.cjs <runId> [timeoutSec] - poll a CI run until it finishes */
const fs = require('fs');
const tok = fs.readFileSync('F:/openclawhome/openclaw/fullstack_workspace/githubapi.txt', 'utf8').split(/\r?\n/)[0].trim();
const H = { Authorization: 'Bearer ' + tok, 'User-Agent': 'x', Accept: 'application/vnd.github+json' };
const RUN = process.argv[2];
const TIMEOUT = +(process.argv[3] || 900);
const t0 = Date.now();

(async () => {
  while ((Date.now() - t0) / 1000 < TIMEOUT) {
    try {
      const r = await fetch(`https://api.github.com/repos/SinigLi/supersplat-apk/actions/runs/${RUN}`, { headers: H, signal: AbortSignal.timeout(30000) });
      const j = await r.json();
      console.log(new Date().toISOString(), j.status, j.conclusion || '-');
      if (j.status === 'completed') {
        console.log('RESULT', j.conclusion, 'artifact_count', (j.artifacts || []).length);
        process.exit(j.conclusion === 'success' ? 0 : 1);
      }
    } catch (e) {
      console.log('poll error', e.message);
    }
    await new Promise(s => setTimeout(s, 20000));
  }
  console.log('TIMEOUT');
  process.exit(2);
})();
