/* tools/dev/deadcode.cjs —— 找覆盖层里的可疑死代码
 *
 * 只做静态词频统计，不做真正的数据流分析：
 *   函数定义处出现 1 次、全文只有 1 次 = 从未被调用。
 * 宁可漏报，不要误报（误报会诱导人去删活代码）。
 *
 * 用法：node tools/dev/deadcode.cjs www/dock.js [more files...]
 */
const fs = require('fs');

const files = process.argv.slice(2);
if (!files.length) {
    console.error('usage: node tools/dev/deadcode.cjs <file...>');
    process.exit(2);
}

for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const defs = new Map();

    // function name(...) / async function name(...)
    for (const m of src.matchAll(/(?:^|[\s;{}])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
        defs.set(m[1], (defs.get(m[1]) || 0) + 1);
    }
    // const name = (...) => / const name = function
    for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)/g)) {
        defs.set(m[1], (defs.get(m[1]) || 0) + 1);
    }

    const dead = [];
    for (const [name, defCount] of defs) {
        // 数全文出现次数，减去定义本身的次数
        const hits = (src.match(new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b', 'g')) || []).length;
        const uses = hits - defCount;
        if (uses <= 0) dead.push(name);
    }

    console.log('=== ' + file + ' ===');
    console.log('definitions:', defs.size);
    if (!dead.length) {
        console.log('no obvious dead functions');
    } else {
        for (const d of dead.sort()) console.log('  UNUSED  ' + d);
    }
    console.log('');
}
