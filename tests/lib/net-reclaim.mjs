/* tests/lib/net-reclaim.mjs —— 端口回收工具
 *
 * 背景（2026-11-05）：
 * 连续跑 18 套回归时，probe-v42 偶发 13/14（安全框不更新）。根因不是产品 bug，
 * 而是上一套测试的 staticsrv / headless Edge 残留，后一套连到了旧页面：
 *   - 多个测试端口重复（4199 被 v30/v32 共用，4205/9265 被 v35/v42 共用）
 *   - 编排脚本只清 9xxx（CDP），从不碰 4xxx（HTTP 静态服务）
 *   - 「检查端口是否空闲」只退出、不回收，残留一多就必然撞车
 *
 * 本模块提供确定性回收：按端口找占用 PID → taskkill /T /F → 轮询到真正释放。
 * 只用标准库，Windows 优先（netstat/taskkill），其它平台退化为 lsof/kill。
 */
import { execSync } from 'node:child_process';
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

/** 端口当前是否可绑定 */
export function isFree(port, host = '127.0.0.1') {
    return new Promise((resolve) => {
        const s = net.createServer();
        let done = false;
        const finish = (v) => { if (!done) { done = true; try { s.close(); } catch { } resolve(v); } };
        s.once('error', () => finish(false));
        s.once('listening', () => finish(true));
        try { s.listen(port, host); } catch { finish(false); }
        setTimeout(() => finish(false), 3000);
    });
}

/** 找出监听指定端口的 PID 列表（Windows） */
function pidsByPortWindows(port) {
    const pids = new Set();
    const self = String(process.pid);
    try {
        const out = execSync('netstat -ano -p tcp', { shell: 'cmd.exe', encoding: 'utf8', timeout: 20000 });
        const re = new RegExp('127\\.0\\.0\\.1:' + port + '\\s|0\\.0\\.0\\.0:' + port + '\\s|\\[::\\]:' + port + '\\s');
        out.split(/\r?\n/).forEach((line) => {
            if (!re.test(line)) return;
            if (!/LISTENING/i.test(line)) return;
            const pid = line.trim().split(/\s+/).pop();
            // 绝不杀自己：回收逻辑可能恰好跑在“占用者”所在进程里（如进程内起的测试服务）
            if (/^\d+$/.test(pid) && pid !== '0' && pid !== self) pids.add(pid);
        });
    } catch { }
    return [...pids];
}

function killPid(pid) {
    try { execSync('taskkill /PID ' + pid + ' /T /F', { shell: 'cmd.exe', stdio: 'ignore', timeout: 15000 }); return true; }
    catch { return false; }
}

/**
 * 回收单个端口：杀掉监听者并等待释放。
 * @returns {Promise<{port:number, killed:string[], freed:boolean}>}
 */
export async function reclaimPort(port, opts = {}) {
    const timeoutMs = opts.timeoutMs || 15000;
    const killed = [];
    if (await isFree(port)) return { port, killed, freed: true };

    if (process.platform === 'win32') {
        for (let round = 0; round < 3; round++) {
            const pids = pidsByPortWindows(port);
            if (!pids.length) break;
            for (const pid of pids) {
                if (!killed.includes(pid)) { killPid(pid); killed.push(pid); }
            }
            await sleep(400);
            if (await isFree(port)) return { port, killed, freed: true };
        }
    } else {
        try {
            const out = execSync('lsof -ti tcp:' + port, { encoding: 'utf8', timeout: 15000 });
            out.split(/\s+/).filter(Boolean).forEach((pid) => {
                if (pid === String(process.pid)) return;   // 不杀自己
                try { execSync('kill -9 ' + pid); killed.push(pid); } catch { }
            });
        } catch { }
    }

    // 最后一搏：轮询等待
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await isFree(port)) return { port, killed, freed: true };
        await sleep(250);
    }
    return { port, killed, freed: false };
}

/** 批量回收；返回失败的端口 */
export async function reclaimPorts(ports, opts = {}) {
    const results = [];
    for (const p of ports) results.push(await reclaimPort(p, opts));
    const failed = results.filter((r) => !r.freed).map((r) => r.port);
    return { results, failed, killed: [...new Set(results.flatMap((r) => r.killed))] };
}

/** 由 OS 分配一个空闲端口（用完可能被复用，仅适合单次短用） */
export function ephemeralPort(host = '127.0.0.1') {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.once('error', reject);
        s.listen(0, host, () => {
            const p = s.address().port;
            s.close(() => resolve(p));
        });
    });
}

/** 一次性申请一组互不相同的空闲端口 */
export async function ephemeralPorts(n, host = '127.0.0.1') {
    const got = new Set();
    let guard = 0;
    while (got.size < n && guard++ < 200) got.add(await ephemeralPort(host));
    return [...got];
}
