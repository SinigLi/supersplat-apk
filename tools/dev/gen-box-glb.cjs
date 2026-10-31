// gen-box-glb: regenerate static/director/box.glb (white unit cube, glTF 2.0).
// JSON chunk padded with 0x20, BIN with 0x00 (strict parsers reject zero-padded JSON).
// Usage: node tools/dev/gen-box-glb.cjs  (writes into BOTH repos' static/director/)
// 单位立方体（1x1x1，中心在原点），灰色 PBR 材质 —— 和 PlayCanvas 程序方块同尺寸语义，
// 由 CHARACTERS 表 scale 字段控制最终大小（与柴犬/礼服猫同机制）。
const fs = require('fs');

// 8 corners of a unit cube centered at origin
const positions = new Float32Array([
    -0.5,-0.5,-0.5,  0.5,-0.5,-0.5,  0.5, 0.5,-0.5, -0.5, 0.5,-0.5,
    -0.5,-0.5, 0.5,  0.5,-0.5, 0.5,  0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
]);
// 12 triangles (CCW outward)
const indices = new Uint16Array([
    0,2,1, 0,3,2,   // back (-z)
    4,5,6, 4,6,7,   // front (+z)
    0,1,5, 0,5,4,   // bottom
    3,7,6, 3,6,2,   // top
    0,4,7, 0,7,3,   // left
    1,6,5, 1,2,6,   // right
]);
// flat normals per face (24 verts) — simpler: per-vertex from position sign
const normals = new Float32Array(positions.length);
for (let v = 0; v < 8; v++) {
    const x = positions[v*3], y = positions[v*3+1], z = positions[v*3+2];
    // cheap: normal = normalized position (fine for a cube with smooth shading;
    // flat look not required for a placeholder block)
    const l = Math.hypot(x, y, z) || 1;
    normals[v*3] = x/l; normals[v*3+1] = y/l; normals[v*3+2] = z/l;
}

const posBin = Buffer.from(positions.buffer);
const nrmBin = Buffer.from(normals.buffer);
const idxBin = Buffer.from(indices.buffer);
// glTF 规范：JSON chunk 用空格(0x20)补齐，BIN chunk 用零补齐；零填充会被严格解析器拒绝
const padJ = b => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - b.length % 4, 0x20)]) : b);
const padB = b => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - b.length % 4, 0x00)]) : b);
const pPos = 0, pNrm = padB(posBin).length, pIdx = pNrm + padB(nrmBin).length;
const bin = Buffer.concat([padB(posBin), padB(nrmBin), padB(idxBin)]);

const gltf = {
    asset: { version: '2.0', generator: 'director-console box.glb generator' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'block' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }], name: 'blockMesh' }],
    materials: [{
        name: 'blockGray',
        pbrMetallicRoughness: {
            baseColorFactor: [1, 1, 1, 1],
            metallicFactor: 0.0,
            roughnessFactor: 0.9
        },
        doubleSided: false
    }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
        { buffer: 0, byteOffset: pPos, byteLength: posBin.length, target: 34962 },
        { buffer: 0, byteOffset: pNrm, byteLength: nrmBin.length, target: 34962 },
        { buffer: 0, byteOffset: pIdx, byteLength: idxBin.length, target: 34963 }
    ],
    accessors: [
        { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-0.5,-0.5,-0.5], max: [0.5,0.5,0.5] },
        { bufferView: 1, componentType: 5126, count: 8, type: 'VEC3' },
        { bufferView: 2, componentType: 5123, count: indices.length, type: 'SCALAR' }
    ]
};
const jsonRaw = Buffer.from(JSON.stringify(gltf), 'utf8');
const json = padJ(jsonRaw);
const total = 12 + 8 + json.length + 8 + bin.length;
const header = Buffer.alloc(12);
header.write('glTF', 0, 'ascii');
header.writeUInt32LE(2, 4);
header.writeUInt32LE(total, 8);
const jhdr = Buffer.alloc(8);
jhdr.writeUInt32LE(json.length, 0);
jhdr.writeUInt32LE(0x4E4F534A, 4); // JSON
const bhdr = Buffer.alloc(8);
bhdr.writeUInt32LE(bin.length, 0);
bhdr.writeUInt32LE(0x004E4942, 4); // BIN
const glb = Buffer.concat([header, jhdr, json, bhdr, bin]);

const targets = [
    'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-main/static/director/box.glb',
    'F:/openclawhome/openclaw/fullstack_workspace/projects/supersplat-apk/www/static/director/box.glb'
];
for (const t of targets) {
    fs.writeFileSync(t, glb);
    console.log('wrote', t, glb.length, 'bytes');
}
// 自校验：魔数 + 长度
const chk = fs.readFileSync(targets[0]);
console.log('magic:', chk.slice(0, 4).toString('ascii'), '| declared:', chk.readUInt32LE(8), '| actual:', chk.length);
