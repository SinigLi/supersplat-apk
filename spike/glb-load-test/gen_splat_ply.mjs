// 合成 3DGS 格式 PLY：地面盘 + 彩色球壳 + 背景墙
// 用途：spike 真泼溅混渲验证（含深度遮挡测试场景构造）
// 格式：binary_little_endian，11 float 属性（x,y,z,f_dc_0..2,opacity,scale_0..2,rot_0..3）
import { writeFileSync } from 'fs';

const SH_C0 = 0.28209479177387814;
const logit = (p) => Math.log(p / (1 - p));

let pts = [];
const push = (x, y, z, r, g, b, op, sx, sy, sz) => {
  // 颜色 → SH DC 系数；opacity/scale 存激活前的原始值
  pts.push({
    x, y, z,
    f_dc_0: (r - 0.5) / SH_C0, f_dc_1: (g - 0.5) / SH_C0, f_dc_2: (b - 0.5) / SH_C0,
    opacity: logit(op),
    scale_0: Math.log(sx), scale_1: Math.log(sy), scale_2: Math.log(sz),
    rot: [1, 0, 0, 0]
  });
};
const rnd = (a, b) => a + Math.random() * (b - a);

// 1) 地面盘：半径6，灰绿色，贴地
for (let i = 0; i < 40000; i++) {
  const r = 6 * Math.sqrt(Math.random()), th = Math.random() * Math.PI * 2;
  const shade = rnd(0.75, 1.0);
  push(r * Math.cos(th), rnd(-0.012, 0.012), r * Math.sin(th),
    0.18 * shade, 0.26 * shade, 0.20 * shade,
    rnd(0.82, 0.95), rnd(0.05, 0.13), rnd(0.02, 0.04), rnd(0.05, 0.13));
}

// 2) 彩色球壳：中心(-2.2,1.6,-1.5) 半径1.2，在角色侧后方（初始相机 azim=0 时部分被角色遮挡）
for (let i = 0; i < 20000; i++) {
  const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  const rad = 1.2 + rnd(-0.12, 0.12);
  const hue = (th / (Math.PI * 2) + u * 0.15 + 1) % 1;
  const [r, g, b] = hsv(hue, 0.75, 0.95);
  push(-2.2 + rad * s * Math.cos(th), 1.6 + rad * u, -1.5 + rad * s * Math.sin(th),
    r, g, b, rnd(0.7, 0.95), rnd(0.03, 0.07), rnd(0.03, 0.07), rnd(0.03, 0.07));
}

// 3) 背景墙：z=-3，蓝灰渐变（角色正后方，遮挡关系一目了然）
for (let i = 0; i < 25000; i++) {
  const x = rnd(-4, 4), y = rnd(0, 3.5);
  const t = (x + 4) / 8;
  push(x + rnd(-0.02, 0.02), y, -3 + rnd(-0.03, 0.03),
    0.22 + 0.25 * t, 0.28 + 0.12 * t, 0.42,
    rnd(0.8, 0.95), rnd(0.08, 0.14), rnd(0.08, 0.14), rnd(0.02, 0.04));
}

function hsv(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
}

// 写二进制
const N = pts.length;
const header = `ply
format binary_little_endian 1.0
element vertex ${N}
property float x
property float y
property float z
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
`;
const hb = Buffer.from(header, 'ascii');
// 14 个 float 属性 × 4B = 56 字节/点，必须与头部声明严格一致（此前 44B 缺 rot_1..3 会数据错位）
const body = Buffer.alloc(N * 56);
const dv = new DataView(body.buffer);
pts.forEach((p, i) => {
  const o = i * 56;
  dv.setFloat32(o, p.x, true); dv.setFloat32(o + 4, p.y, true); dv.setFloat32(o + 8, p.z, true);
  dv.setFloat32(o + 12, p.f_dc_0, true); dv.setFloat32(o + 16, p.f_dc_1, true); dv.setFloat32(o + 20, p.f_dc_2, true);
  dv.setFloat32(o + 24, p.opacity, true);
  dv.setFloat32(o + 28, p.scale_0, true); dv.setFloat32(o + 32, p.scale_1, true); dv.setFloat32(o + 36, p.scale_2, true);
  dv.setFloat32(o + 40, p.rot[0], true); dv.setFloat32(o + 44, p.rot[1], true);
  dv.setFloat32(o + 48, p.rot[2], true); dv.setFloat32(o + 52, p.rot[3], true);
});
writeFileSync(new URL('./splat.ply', import.meta.url), Buffer.concat([hb, body]));
console.log(`splat.ply: ${N} gaussians, ${((hb.length + body.length) / 1048576).toFixed(2)}MB (header ${hb.length}B + body ${body.length}B)`);
