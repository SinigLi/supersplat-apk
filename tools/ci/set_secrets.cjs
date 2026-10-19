/* set_secrets.cjs — 用 GitHub API 写入 Actions secrets
 *
 * 为什么不用 gh CLI：本机没有装。GitHub 要求 secret 用仓库公钥做 sealed box
 * 加密（libsodium crypto_box_seal），所以这里现装 libsodium-wrappers。
 *
 * 用法：
 *   node tools/ci/set_secrets.cjs <owner/repo> NAME=VALUE
 *   node tools/ci/set_secrets.cjs <owner/repo> NAME=@path/to/file
 *
 * 以 @ 开头时从文件读原始字节（keystore 是二进制，不能走命令行——
 * 参数会留在进程列表和 shell 历史里，而这是个公开仓库的签名密钥）。
 */
const fs = require('fs');
const sodium = require('libsodium-wrappers');

const REPO = process.argv[2];
const PAIRS = process.argv.slice(3).map((s) => {
    const i = s.indexOf('=');
    const name = s.slice(0, i);
    const raw = s.slice(i + 1);
    const value = raw.startsWith('@') ? fs.readFileSync(raw.slice(1)) : raw;
    return { name, value };
});

const token = () => fs.readFileSync('F:/openclawhome/openclaw/fullstack_workspace/githubapi.txt', 'utf8')
    .trim().split(/\r?\n/)[0].trim();
const H = () => ({
    Authorization: 'Bearer ' + token(),
    Accept: 'application/vnd.github+json',
    'User-Agent': 'openclaw'
});

async function main() {
    await sodium.ready;

    const pkRes = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/public-key`, { headers: H() });
    if (!pkRes.ok) throw new Error('public-key ' + pkRes.status + ' ' + (await pkRes.text()));
    const { key, key_id } = await pkRes.json();

    const binKey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);

    for (const { name, value } of PAIRS) {
        const bin = typeof value === 'string' ? sodium.from_string(value) : new Uint8Array(value);
        const enc = sodium.crypto_box_seal(bin, binKey);
        const b64 = sodium.to_base64(enc, sodium.base64_variants.ORIGINAL);

        const res = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/${name}`, {
            method: 'PUT',
            headers: { ...H(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ encrypted_value: b64, key_id })
        });
        console.log(name, res.status, res.ok ? 'OK' : await res.text());
        if (!res.ok) process.exitCode = 1;
    }

    // 回读确认存在（不含值）
    const list = await (await fetch(`https://api.github.com/repos/${REPO}/actions/secrets`, { headers: H() })).json();
    console.log('\nsecrets now:');
    for (const s of list.secrets || []) console.log('  ' + s.name + '  updated ' + s.updated_at);
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
