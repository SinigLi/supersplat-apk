// set_secret.mjs — 用仓库公钥加密并写入一个 Actions secret
//
// 用法: node tools/ci/set_secret.mjs <SECRET_NAME> <valueFile>
//
// 只打印状态码，绝不打印 secret 的值。
import { readFileSync } from 'node:fs';
import sodium from 'libsodium-wrappers';

const TOKEN_FILE = 'F:/openclawhome/openclaw/fullstack_workspace/githubapi.txt';
const REPO = 'SinigLi/supersplat-apk';

const [name, valuePath] = process.argv.slice(2);
if (!name || !valuePath) {
    console.error('usage: node set_secret.mjs <NAME> <valueFile>');
    process.exit(1);
}

const token = readFileSync(TOKEN_FILE, 'utf8').trim().split(/\r?\n/)[0].trim();
const H = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };

const value = readFileSync(valuePath, 'utf8').trim();

const pkRes = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/public-key`, { headers: H });
if (!pkRes.ok) {
    console.error('public-key failed:', pkRes.status);
    process.exit(1);
}
const pk = await pkRes.json();

await sodium.ready;
const binKey = sodium.from_base64(pk.key.split('\n').join(''), sodium.base64_variants.ORIGINAL);
const binValue = sodium.from_string(value);
const sealed = sodium.crypto_box_seal(binValue, binKey);
const encrypted = sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);

const put = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ encrypted_value: encrypted, key_id: pk.key_id })
});

console.log(`${name}: put ${put.status} (value length ${value.length})`);
if (!put.ok) {
    console.log(await put.text());
    process.exit(1);
}
