// verify_v21.cjs — 确认 v21 的原生保存能力真的进了 APK
//
// verify_v14.cjs 只看 web 资源，看不出 dex 里有没有 SaveImagePlugin。
// 这里直接解 zip 读 classes*.dex，找类名与 MediaStore 写入痕迹。
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const apk = process.argv[2] || 'dist/supersplat-v21-debug.apk';

// 极简 zip 中央目录读取
function listZip(file) {
    const buf = fs.readFileSync(file);
    // find EOCD
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('no EOCD');
    const count = buf.readUInt16LE(eocd + 10);
    let off = buf.readUInt32LE(eocd + 16);
    const entries = [];
    for (let i = 0; i < count; i++) {
        if (buf.readUInt32LE(off) !== 0x02014b50) break;
        const method = buf.readUInt16LE(off + 10);
        const csize = buf.readUInt32LE(off + 20);
        const usize = buf.readUInt32LE(off + 24);
        const nlen = buf.readUInt16LE(off + 28);
        const elen = buf.readUInt16LE(off + 30);
        const clen = buf.readUInt16LE(off + 32);
        const lho = buf.readUInt32LE(off + 42);
        const name = buf.toString('utf8', off + 46, off + 46 + nlen);
        entries.push({ name, method, csize, usize, lho });
        off += 46 + nlen + elen + clen;
    }
    return { buf, entries };
}

function readEntry(buf, e) {
    const lho = e.lho;
    if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error('bad local header ' + e.name);
    const nlen = buf.readUInt16LE(lho + 26);
    const elen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + nlen + elen;
    const data = buf.subarray(start, start + e.csize);
    return e.method === 0 ? data : zlib.inflateRawSync(data);
}

const { buf, entries } = listZip(apk);
console.log('apk:', apk, fs.statSync(apk).size, 'bytes');
console.log('entries:', entries.length);

const dexes = entries.filter(e => /^classes\d*\.dex$/.test(e.name));
console.log('dex:', dexes.map(d => `${d.name}(${d.usize})`).join(' '));

const needles = [
    'Lcom/sinigli/supersplat/SaveImagePlugin;',
    'SaveImage',
    'MediaStore',
    // MediaStore.Images.Media.RELATIVE_PATH / IS_PENDING are compile-time
    // String constants, so the dex holds the literals, not the field names
    'relative_path',
    'is_pending'
];

const found = Object.fromEntries(needles.map(n => [n, false]));
for (const d of dexes) {
    const data = readEntry(buf, d);
    // dex strings 是 MUTF-8，直接按 latin1 扫子串足够
    const s = data.toString('latin1');
    for (const n of needles) {
        if (!found[n] && s.includes(n)) found[n] = true;
    }
}

console.log('--- dex markers ---');
for (const [k, v] of Object.entries(found)) console.log((v ? 'FOUND ' : 'MISS  ') + k);

// web 侧：预览层保存按钮 + 原生调用
const dockEntry = entries.find(e => e.name === 'assets/public/dock.js');
if (!dockEntry) {
    console.log('MISS  assets/public/dock.js');
} else {
    const dock = readEntry(buf, dockEntry).toString('utf8');
    const webMarks = [
        ['save button', 'sd-shot-save'],
        ['save-as button', 'sd-shot-saveas'],
        ['share button', 'sd-shot-share'],
        // v22: calls are dispatched by method name through the plugin object
        ['native api lookup', 'Plugins.SaveImage'],
        ['method dispatch', 'api[method]({'],
        ['saveAs method', '"saveAs"'],
        ['filename passed', 'filename: r.name']
    ];
    console.log('--- web markers ---');
    for (const [label, needle] of webMarks) {
        console.log((dock.includes(needle) ? 'FOUND ' : 'MISS  ') + label);
    }
}

const ok = Object.values(found).every(Boolean);
console.log(ok ? 'DEX OK' : 'DEX INCOMPLETE');
process.exit(ok ? 0 : 1);
