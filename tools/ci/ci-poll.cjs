const fs = require('fs');
const t = fs.readFileSync('F:\\openclawhome\\openclaw\\fullstack_workspace\\githubapi.txt', 'utf8').trim();
const H = { Authorization: 'Bearer ' + t };
const sha = process.argv[2] || '2897087';

async function j(url) {
  const r = await fetch(url, { headers: H });
  return r.json();
}

(async () => {
  let run = null;
  for (let i = 0; i < 20 && !run; i++) {
    const d = await j('https://api.github.com/repos/SinigLi/supersplat-apk/actions/workflows/build-apk.yml/runs?per_page=5');
    run = d.workflow_runs.find(r => r.head_sha.startsWith(sha));
    if (!run) await new Promise(s => setTimeout(s, 10000));
  }
  if (!run) { console.log('NO RUN'); process.exit(1); }
  console.log('run=' + run.id + ' status=' + run.status);
  while (run.status !== 'completed') {
    await new Promise(s => setTimeout(s, 15000));
    run = await j('https://api.github.com/repos/SinigLi/supersplat-apk/actions/runs/' + run.id);
  }
  console.log('CI: ' + run.conclusion);
})();
