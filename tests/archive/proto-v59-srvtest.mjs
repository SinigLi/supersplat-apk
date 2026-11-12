/* 单独起服务确认 URL 200，再开 headless 手动看 title */
import { spawn } from 'node:child_process';
const PORT = 4199;
const ROOT = 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk';
const srv = spawn(process.execPath, ['tools/dev/staticsrv.cjs', ROOT, String(PORT)], { stdio: 'ignore', cwd: 'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk' });
setTimeout(async () => {
    const r = await fetch('http://127.0.0.1:' + PORT + '/prototype/cardgroups-proto.html');
    console.log('status:', r.status);
    const txt = await r.text();
    console.log('has <title>:', txt.includes('<title>角色卡库原型 r1</title>'));
    console.log('bytes:', txt.length);
    srv.kill();
    process.exit(0);
}, 800);
