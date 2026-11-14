/* 摸鱼台 3D 场景工作台（v68）
 *
 * v67 是只读查看器；v68 加了「摆放 + 存回工程」。为什么这不算编辑能力降级：
 *   编辑器（v3）挂掉的原因是初始化路径 ProjectedSplatRenderer → StorageBuffer
 *   硬依赖 WebGPU 的 createBufferImpl。而「往场景放人偶/道具、拖动、缩放、旋转、
 *   删掉、存回 project.json」全是纯实体变换 + 字节写盘，跟那条路径毫无关系，
 *   WebGL2 下完全跑得动。所以这里给的是真能用的摆放，不是摆设。
 *
 * 仍然做不到的（需要 WebGPU）：泼溅高斯排序计算、着色器编辑、骨骼姿态微调。
 *
 * 数据契约必须和 src/director.ts 的 projectSnapshot() 一致，否则工程在
 * WebGPU 设备和本机之间来回打开会丢东西：
 *   { version:1, model:{name,path}, puppets:[{name,charId,pos,rot,scale,tint,clip,locked,visible}],
 *     props:[{name,file,pos,rot,scale,locked,visible}], shots, camera:{pos,target,fov,clip}, cursor }
 */
import * as pc from './pc.min.mjs';

const STATUS = document.getElementById('v3-status');
const ERRB = document.getElementById('v3-error');
const TITLE = document.getElementById('v3-title');
const STAGE = document.getElementById('v3-stage');
const TOOLBAR = document.getElementById('v3-tools');
const HINT = document.getElementById('v3-hint');

/* spz 解码器（部署目录里已有的 wasm 模块，体积 0.9MB，不用另装依赖） */
const SPZ_MODULE = './spz-DEYRea_v-BKWZnoXF.js';

/* 内置角色表必须和 src/director.ts 的 CHARACTERS 一致：工程存档里只存 charId，
 * 打开时必须能找回同一个 GLB，否则人偶会消失。 */
const CHARACTERS = {
    woman: { url: 'static/director/woman.glb', scale: 1.0, label: '女人' },
    man: { url: 'static/director/male.glb', scale: 1.0, label: '男人' },
    shiba: { url: 'static/director/shiba.glb', scale: 0.225, label: '柴犬' },
    tuxedo: { url: 'static/director/tuxedo.glb', scale: 0.19, label: '西装猫' },
    box: { url: 'static/director/box.glb', scale: 0.4, label: '方块人' }
};

/* 默认姿态：和导演台的 defaultClipIndex 一致，否则打开工程时角色是 T-pose */
const DEFAULT_CLIP = {
    woman: 'idle_loop', man: 'idle_loop', shiba: 'idle', tuxedo: 'idlenorm'
};

function setStatus(msg) {
    if (!STATUS) return;
    if (!msg) { STATUS.hidden = true; return; }
    STATUS.hidden = false;
    STATUS.textContent = msg;
}

function showHint(msg, ms) {
    if (!HINT) return;
    HINT.textContent = msg;
    HINT.hidden = false;
    clearTimeout(showHint._t);
    showHint._t = setTimeout(() => { HINT.hidden = true; }, ms || 2600);
}

function fail(msg) {
    setStatus('');
    if (ERRB) {
        ERRB.hidden = false;
        ERRB.textContent = msg;
    }
    console.error('[viewer3d] ' + msg);
}

function params() {
    const q = new URLSearchParams(location.search);
    return {
        project: q.get('project') || '',
        file: q.get('file') || '',
        readonly: q.get('readonly') === '1'
    };
}

/* ---------- 工程读取（复用 projects.js 的 store：原生走 Filesystem，网页走 IndexedDB） ---------- */

function projectLogic() {
    if (!window.__projectLogic) throw new Error('projects.js 未加载');
    return window.__projectLogic;
}

async function readProjectState(name) {
    const L = projectLogic();
    const p = L.pathsFor(name);
    const bytes = await L.store().read(p.state);
    const state = JSON.parse(new TextDecoder().decode(bytes));
    return { paths: p, state };
}

async function readFileBytes(paths, relPath) {
    const L = projectLogic();
    return await L.store().readViaUri(paths.dir + '/' + relPath);
}

/* ---------- spz → binary PLY ----------
 * playcanvas 的 gsplat handler 只认 ply / sog(json) / lod，没有 spz 解析器。
 * 但部署目录里本来就有官方 spz wasm 模块（编辑器用它做 spz 读写），
 * 这里直接拿来解出 gaussian cloud，再在内存里拼一个 binary_little_endian PLY 喂给引擎。
 * 实测数值约定：colors 是 0..1 线性（直接减 0.5 除以 SH_C0）、scales 已是 log、
 * alphas 0..1（要转 logit）、rotations 是 (x,y,z,w)（PLY 要 w 在前）。
 */
const SH_C0 = 0.28209479177387814;

function logistic(a) {
    const x = Math.min(1 - 1e-6, Math.max(1e-6, a));
    return Math.log(x / (1 - x));
}

function cloudToPly(cloud) {
    const n = cloud.numPoints;
    const props = [
        ['x', 'float'], ['y', 'float'], ['z', 'float'],
        ['nx', 'float'], ['ny', 'float'], ['nz', 'float'],
        ['f_dc_0', 'float'], ['f_dc_1', 'float'], ['f_dc_2', 'float'],
        ['opacity', 'float'],
        ['scale_0', 'float'], ['scale_1', 'float'], ['scale_2', 'float'],
        ['rot_0', 'float'], ['rot_1', 'float'], ['rot_2', 'float'], ['rot_3', 'float']
    ];

    const header = 'ply\n' +
        'format binary_little_endian 1.0\n' +
        'element vertex ' + n + '\n' +
        props.map((p) => 'property ' + p[1] + ' ' + p[0]).join('\n') + '\n' +
        'end_header\n';

    const head = new TextEncoder().encode(header);
    const stride = props.length * 4;
    const buf = new Uint8Array(head.length + n * stride);
    buf.set(head, 0);
    const dv = new DataView(buf.buffer, head.length);

    for (let i = 0; i < n; i++) {
        const o = i * stride;
        dv.setFloat32(o + 0, cloud.positions[i * 3], true);
        dv.setFloat32(o + 4, cloud.positions[i * 3 + 1], true);
        dv.setFloat32(o + 8, cloud.positions[i * 3 + 2], true);
        dv.setFloat32(o + 12, 0, true);
        dv.setFloat32(o + 16, 0, true);
        dv.setFloat32(o + 20, 0, true);
        dv.setFloat32(o + 24, (cloud.colors[i * 3] - 0.5) / SH_C0, true);
        dv.setFloat32(o + 28, (cloud.colors[i * 3 + 1] - 0.5) / SH_C0, true);
        dv.setFloat32(o + 32, (cloud.colors[i * 3 + 2] - 0.5) / SH_C0, true);
        dv.setFloat32(o + 36, logistic(cloud.alphas[i]), true);
        dv.setFloat32(o + 40, cloud.scales[i * 3], true);
        dv.setFloat32(o + 44, cloud.scales[i * 3 + 1], true);
        dv.setFloat32(o + 48, cloud.scales[i * 3 + 2], true);
        dv.setFloat32(o + 52, cloud.rotations[i * 4 + 3], true);
        dv.setFloat32(o + 56, cloud.rotations[i * 4], true);
        dv.setFloat32(o + 60, cloud.rotations[i * 4 + 1], true);
        dv.setFloat32(o + 64, cloud.rotations[i * 4 + 2], true);
    }
    return buf;
}

let spzModulePromise = null;
function loadSpzModule() {
    if (!spzModulePromise) {
        spzModulePromise = import(SPZ_MODULE)
            .then((m) => m.default())
            .catch((err) => {
                spzModulePromise = null;
                throw new Error('spz 解码器加载失败：' + (err && err.message ? err.message : err));
            });
    }
    return spzModulePromise;
}

async function spzToPly(bytes) {
    const spz = await loadSpzModule();
    const cloud = await spz.loadSpzFromBuffer(bytes, { to: spz.CoordinateSystem.UNSPECIFIED });
    if (!cloud || !cloud.numPoints) throw new Error('spz 解析结果为空');
    return cloudToPly(cloud);
}

/* ---------- 资产装载 ----------
 * 两个坑（都是实测出来的）：
 *   1. gsplat 的 PLY 解析器走 response.body.getReader()，contents 必须是 Response
 *   2. container 走 Asset.fetchArrayBuffer，contents 必须直接是 ArrayBuffer
 * 另外 url 必须带扩展名，否则 handler 选不到 parser（会报 No parser found）。
 */
function makeAsset(app, name, type, filename, contents) {
    const asset = new pc.Asset(name, type, { url: filename, filename, contents });
    return new Promise((resolve, reject) => {
        asset.on('load', () => resolve(asset));
        asset.on('error', (err) => reject(new Error(type + ' ' + filename + ': ' + err)));
        app.assets.add(asset);
        app.assets.load(asset);
    });
}

function extOf(name) {
    const m = String(name || '').match(/\.([^.]+)$/);
    return m ? m[1].toLowerCase() : '';
}

/* 右对齐的 ArrayBuffer：有些字节串是别的 buffer 的视图，直接取 .buffer 会错位 */
function toArrayBuffer(bytes) {
    if (bytes instanceof ArrayBuffer) return bytes;
    if (!bytes || !bytes.byteLength) return bytes;
    if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes.buffer;
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function makeSplatAsset(app, name, filename, bytes) {
    const ext = extOf(filename);
    if (ext === 'spz') {
        const ply = await spzToPly(new Uint8Array(toArrayBuffer(bytes)));
        return makeAsset(app, name, 'gsplat', 'converted.ply', new Response(new Blob([ply])));
    }
    if (ext === 'ply' || ext === 'json' || ext === 'sog') {
        return makeAsset(app, name, 'gsplat', filename, new Response(new Blob([bytes])));
    }
    throw new Error('不支持该泼溅格式：.' + (ext || '未知') + '（支持 .ply / .sog / .spz）');
}

/* ---------- 相机 / 场景 ---------- */

function createApp(canvas) {
    const app = new pc.Application(canvas, {
        deviceTypes: [],          // 只要 WebGL2：这个页面存在的意义就是绕开 WebGPU
        antialias: true,
        depth: true,
        stencil: false,
        powerPreference: 'high-performance'
    });
    /* 不设 fill mode 的话 canvas 会一直是默认 300x150（实测），等于没渲染到屏幕上 */
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    window.addEventListener('resize', () => app.resizeCanvas());
    window.addEventListener('orientationchange', () => setTimeout(() => app.resizeCanvas(), 120));
    app.scene.ambientLight = new pc.Color(0.55, 0.56, 0.60);
    app.start();
    return app;
}

function createCamera(app) {
    const cam = new pc.Entity('viewer-camera');
    cam.addComponent('camera', {
        clearColor: new pc.Color(0.10, 0.11, 0.13),
        farClip: 3000,
        nearClip: 0.01,
        fov: 55
    });
    app.root.addChild(cam);
    return cam;
}

function createLights(app) {
    const sun = new pc.Entity('viewer-sun');
    sun.addComponent('light', { type: 'directional', intensity: 1.0 });
    sun.setEulerAngles(-45, 30, 0);
    app.root.addChild(sun);

    const fill = new pc.Entity('viewer-fill');
    fill.addComponent('light', { type: 'omni', range: 80, intensity: 0.55 });
    fill.setPosition(6, 10, 8);
    app.root.addChild(fill);
}

/* 地面网格：摆放时没有参照物根本判断不了「放在哪、离多远」 */
function createGrid(app) {
    const N = 24, STEP = 1, half = (N * STEP) / 2;
    const verts = [];
    for (let i = 0; i <= N; i++) {
        const p = -half + i * STEP;
        verts.push(-half, 0, p, half, 0, p);
        verts.push(p, 0, -half, p, 0, half);
    }
    const mesh = new pc.Mesh(app.graphicsDevice);
    mesh.setPositions(verts);
    mesh.update(pc.PRIMITIVE_LINES);
    const mat = new pc.StandardMaterial();
    mat.diffuse = new pc.Color(0.28, 0.30, 0.34);
    mat.emissive = new pc.Color(0.16, 0.17, 0.20);
    mat.useLighting = false;
    mat.update();
    const mi = new pc.MeshInstance(mesh, mat);
    const ent = new pc.Entity('viewer-grid');
    ent.addComponent('render', { meshInstances: [mi] });
    app.root.addChild(ent);
    return ent;
}

/* 轨道相机：单指旋转 / 双指缩放 / 滚轮。编辑模式下由控制器优先吃掉指针。 */
function attachOrbit(canvas, camera) {
    const state = {
        target: new pc.Vec3(0, 0, 0),
        distance: 4,
        azim: 0,
        elev: 20,
        minDistance: 0.02,
        maxDistance: 8000,
        busy: false          // 编辑拖拽时置 true，轨道相机让位
    };

    const apply = () => {
        const az = state.azim * Math.PI / 180;
        const el = state.elev * Math.PI / 180;
        const r = state.distance;
        camera.setPosition(
            state.target.x + r * Math.cos(el) * Math.sin(az),
            state.target.y + r * Math.sin(el),
            state.target.z + r * Math.cos(el) * Math.cos(az)
        );
        camera.lookAt(state.target);
    };

    const pointers = new Map();
    let lastDist = 0;

    canvas.addEventListener('pointerdown', (e) => {
        if (state.busy) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            lastDist = Math.hypot(a.x - b.x, a.y - b.y);
        }
        if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
        if (state.busy) return;
        const prev = pointers.get(e.pointerId);
        if (!prev) return;
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointers.size === 1) {
            state.azim -= dx * 0.35;
            state.elev = Math.max(-89, Math.min(89, state.elev + dy * 0.35));
            apply();
        } else if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (lastDist > 0 && d > 0) {
                state.distance = Math.max(state.minDistance,
                    Math.min(state.maxDistance, state.distance * (lastDist / d)));
            }
            lastDist = d;
            apply();
        }
    });

    const onUp = (e) => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) lastDist = 0;
    };
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const k = Math.exp(e.deltaY * 0.001);
        state.distance = Math.max(state.minDistance, Math.min(state.maxDistance, state.distance * k));
        apply();
    }, { passive: false });

    return {
        state,
        apply,
        frame(box) {
            if (!box) return;
            const c = box.center;
            const half = box.halfExtents;
            const radius = Math.max(0.001, Math.hypot(half.x, half.y, half.z));
            state.target.set(c.x, c.y, c.z);
            state.distance = radius / Math.sin(38 * Math.PI / 180) * 1.15;
            state.azim = 0;
            state.elev = 20;
            apply();
        }
    };
}

/* ---------- 场景包围盒 ---------- */

function makeSceneBox(app) {
    return () => {
        const box = new pc.BoundingBox();
        let any = false;
        const visit = (entity) => {
            /* 地面网格不参与取景：它是参照物，不是场景内容。
             * 否则一张 24 单位的网格会把包围盒撑大，泼溅被推得极小
             * （实测彩色像素从 1944 掉到 36）。 */
            if (entity.name === 'viewer-grid') return;
            ['render', 'gsplat', 'model'].forEach((type) => {
                const comp = entity[type];
                const list = comp && comp.meshInstances;
                if (!list) return;
                for (let i = 0; i < list.length; i++) {
                    const mi = list[i];
                    if (!mi || !mi.aabb) continue;
                    if (!any) { box.copy(mi.aabb); any = true; }
                    else { box.add(mi.aabb); }
                }
            });
            const kids = entity.children || [];
            for (let i = 0; i < kids.length; i++) visit(kids[i]);
        };
        visit(app.root);
        return any ? box : null;
    };
}

/* ---------- 摆放控制器（v68 核心） ----------
 * 屏幕拾取不建构 raycast 网格：把每个可操作实体的世界坐标投影到屏幕，
 * 取最近的一个。手机上手指标比一像素重要，这套更稳也更快。
 *
 * 拖动：屏幕点 → 世界点（射线与「过实体的水平面」求交）→ 设 pos。
 * 缩放：双指距离比。旋转：按钮 90° 一档（手指转角度误触太多）。
 */
function attachEditor({ canvas, camera, app, orbit, onChange, onSelect }) {
    const st = {
        selected: null,
        candidates: [],       // [{ ent, rec, kind }]
        drag: null,           // { ent, offsetX, offsetZ, startDist }
        pinch: 0
    };

    const planeHit = (clientX, clientY, planeY) => {
        const r = canvas.getBoundingClientRect();
        const sx = clientX - r.left;
        const sy = clientY - r.top;
        /* 实测签名（压缩包里的 Camera 类）：
         *   screenToWorld(sx, sy, worldDepth, viewportWidth, viewportHeight[, result])
         * 第三个参数是"离相机的世界距离"，不是裁剪面 z；且它挂在 pc.Camera
         * （camera.camera.camera）上，CameraComponent 上没有转调。 */
        const camPlate = camera.camera && camera.camera.camera;
        if (!camPlate || !camPlate.screenToWorld) return null;
        const near = camPlate.screenToWorld(sx, sy, camPlate.nearClip,
            r.width, r.height, new pc.Vec3());
        const far = camPlate.screenToWorld(sx, sy, camPlate.farClip,
            r.width, r.height, new pc.Vec3());
        const dir = new pc.Vec3().sub2(far, near);
        if (Math.abs(dir.y) < 1e-6) return null;
        const t = (planeY - near.y) / dir.y;
        if (!isFinite(t)) return null;
        const p = new pc.Vec3().copy(near).add(dir.mulScalar(t));
        return p;
    };

    const screenPos = (ent) => {
        const r = canvas.getBoundingClientRect();
        /* Entity.getPosition() 不接受参数（传了也会被忽略），直接返回内部 vec。
         * 之前写成 getPosition(w) 且把 w 当输出，w 一直是 (0,0,0)，
         * 结果所有实体都投影到屏幕正中 —— 这才是"点谁都选中同一个"的真因。 */
        const w = ent.getPosition();
        /* 注意 CameraComponent 和 pc.Camera 的同名方法参数顺序相反（实测踩了三次）：
         *   CameraComponent.worldToScreen(point, result, width, height)  ← 这里用这个
         *   pc.Camera.worldToScreen(point, width, height, result)
         * 传错两种表现：把 width 塞进 result → "Cannot create property 'x' on
         * number"；或者全部投到屏幕正中（因为 viewProj 没更新）。
         * 而且必须走 worldToScreen：它内部会 _updateViewProjMat，自己读
         * projectionMatrix 拿到的是上一帧的过期值。 */
        const comp = camera.camera;
        if (!comp || !comp.worldToScreen) return { x: 0, y: 0 };
        const out = comp.worldToScreen(w, new pc.Vec3(), r.width, r.height);
        return { x: out.x, y: out.y };
    };

    const pick = (clientX, clientY) => {
      try {
        const r = canvas.getBoundingClientRect();
        const px = clientX - r.left;
        const py = clientY - r.top;
        /* 阈值按屏幕尺寸缩放：固定 70px 在相机拉远时会让两个物体重叠命中，
         * 实测就是「点人偶选中了道具」。取短边 9%，上下夹在 28~90 之间。 */
        const thresh = Math.max(28, Math.min(90, Math.min(r.width, r.height) * 0.09));
        const camPos = camera.getPosition();
        const hits = [];
        const near = [];
        for (const c of st.candidates) {
            if (!c.ent.enabled) continue;
            const s = screenPos(c.ent);
            const d = Math.hypot(s.x - px, s.y - py);
            near.push({ name: c.ent.name, kind: c.kind, d: +d.toFixed(1),
                sx: Math.round(s.x), sy: Math.round(s.y) });
            if (d > thresh) continue;
            /* 命中范围内按「离相机更近」优先：手机屏幕上手指点下去，
             * 用户想选的永远是挡在前面的那个。 */
            const w = c.ent.getPosition();
            hits.push({ c, screenD: d, sx: s.x, sy: s.y,
                depth: new pc.Vec3().sub2(w, camPos).length() });
        }
        if (!hits.length) return null;
        st.lastNear = near.sort((a, b) => a.d - b.d);
        st.lastHits = hits.map((h) => ({ name: h.c.ent.name, kind: h.c.kind,
            d: +h.screenD.toFixed(1), sx: Math.round(h.sx), sy: Math.round(h.sy),
            depth: +h.depth.toFixed(2) }));
        st.lastPickPoint = [Math.round(px), Math.round(py)];
        /* 先按屏幕距离：点在谁身上就是谁。只有两个目标屏幕距离几乎相同
         * （差 < 14px，肉眼分不出来）才按离相机更近的优先。
         * 直接按深度排会出事——实测点到人偶身上却选中了几十像素外的道具。 */
        hits.sort((a, b) => {
            if (Math.abs(a.screenD - b.screenD) < 14) return a.depth - b.depth;
            return a.screenD - b.screenD;
        });
        return hits[0].c;
      } catch (err) {
        st.lastPickError = String((err && (err.stack || err.message)) || err);
        console.error('[viewer3d] pick failed', err);
        return null;
      }
    };

    const select = (cand) => {
        st.selected = cand;
        if (onSelect) onSelect(cand);
    };

    const onDown = (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (st.pinch > 0) return;
        /* 双指：进缩放手势，不拾取 */
        if (e.pointerId !== undefined && canvas._ptrs) { /* noop */ }
        canvas._ptrs = (canvas._ptrs || new Set());
        canvas._ptrs.add(e.pointerId);
        if (canvas._ptrs.size >= 2) {
            st.pinch = 1;
            st.drag = null;
            orbit.state.busy = true;
            const list = [...canvas._ptrs];
            return;
        }

        const hit = pick(e.clientX, e.clientY);
        if (!hit) { select(null); return; }

        select(hit);
        /* getPosition() 无参、返回内部 vec（传参会被忽略）。之前写 getPosition(w)
         * 导致 w 恒为 (0,0,0)，抬起来的物体拖动平面被错当成 y=0。 */
        const w = hit.ent.getPosition();
        const p = planeHit(e.clientX, e.clientY, w.y);
        if (!p) return;
        st.drag = { ent: hit.ent, offX: w.x - p.x, offZ: w.z - p.z };
        orbit.state.busy = true;    // 拖实体时不转相机
        canvas.setPointerCapture?.(e.pointerId);
        e.preventDefault();
    };

    const onMove = (e) => {
        if (!st.drag) return;
        const w = st.drag.ent.getPosition();
        const p = planeHit(e.clientX, e.clientY, w.y);
        if (!p) return;
        st.drag.ent.setPosition(p.x + st.drag.offX, w.y, p.z + st.drag.offZ);
        if (onChange) onChange();
        e.preventDefault();
    };

    const onUp = (e) => {
        if (canvas._ptrs) canvas._ptrs.delete(e.pointerId);
        if (canvas._ptrs && canvas._ptrs.size < 2) st.pinch = 0;
        if (st.drag) {
            st.drag = null;
            orbit.state.busy = false;
            if (onChange) onChange();
        } else if (st.pinch === 0) {
            orbit.state.busy = false;
        }
    };

    /* 双指缩放选中实体：用 pointermove 里跟踪的两指距离 */
    const onPinchMove = (e) => {
        if (!st.pinch || !st.selected) return;
        const pts = [...canvas._ptrs];
        if (pts.length < 2) return;
        const a = canvas._pos[pts[0]];
        const b = canvas._pos[pts[1]];
        if (!a || !b) return;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (!canvas._lastPinch) { canvas._lastPinch = d; return; }
        const k = d / canvas._lastPinch;
        canvas._lastPinch = d;
        const cur = st.selected.ent.getLocalScale();
        const base = st.selected.baseScale || 1;
        const ns = Math.max(0.01, Math.min(50, cur.x * k));
        st.selected.ent.setLocalScale(ns, ns, ns);
        if (onChange) onChange();
    };

    /* 记录每个指针位置，供捏合使用 */
    const trackPos = (e) => {
        canvas._pos = canvas._pos || {};
        canvas._pos[e.pointerId] = { x: e.clientX, y: e.clientY };
    };

    canvas.addEventListener('pointerdown', (e) => { trackPos(e); onDown(e); }, true);
    canvas.addEventListener('pointermove', (e) => {
        trackPos(e);
        if (st.pinch) onPinchMove(e);
        else onMove(e);
    }, true);
    canvas.addEventListener('pointerup', (e) => {
        canvas._lastPinch = 0;
        onUp(e);
    }, true);
    canvas.addEventListener('pointercancel', (e) => {
        canvas._lastPinch = 0;
        onUp(e);
    }, true);

    return {
        state: st,
        register(ent, rec, kind) {
            st.candidates.push({ ent, rec, kind });
        },
        unregister(ent) {
            st.candidates = st.candidates.filter((c) => c.ent !== ent);
        },
        clearSelection() { select(null); },
        deleteSelected() {
            if (!st.selected) return false;
            st.selected.ent.destroy();
            this.unregister(st.selected.ent);
            const r = st.selected.rec;
            st.selected = null;
            if (onSelect) onSelect(null);
            if (onChange) onChange();
            return r;
        },
        rotateSelected(deg) {
            if (!st.selected) return false;
            const e = st.selected.ent;
            const cur = e.getLocalEulerAngles();
            e.setLocalEulerAngles(cur.x, cur.y + (deg || 90), cur.z);
            if (onChange) onChange();
            return true;
        },
        selectedEntity() { return st.selected ? st.selected.ent : null; }
    };
}

/* ---------- 主流程 ---------- */

async function boot() {
    const canvas = document.createElement('canvas');
    canvas.id = 'v3-canvas';
    STAGE.appendChild(canvas);

    const app = createApp(canvas);
    const camera = createCamera(app);
    createLights(app);
    const grid = createGrid(app);
    const orbit = attachOrbit(canvas, camera);
    const computeSceneBox = makeSceneBox(app);

    let dirty = false;
    const markDirty = () => { dirty = true; syncSaveBtn(); };

    const { project, file, readonly } = params();
    const editable = !!project && !readonly;

    /* 编辑候选 + 记录（puppets / props 各一份，与 projectSnapshot 对齐） */
    const recs = { puppets: [], props: [] };
    let modelRef = null;
    let paths = null;
    let state = null;
    let splatEnt = null;

    /* v68：新建的 3D 工程还没有泼溅模型，工作台要能自己导入一个。
     * 支持 .ply / .sog / .spz（spz 在内存里转 PLY 后喂给 legacy gsplat）。 */
    function importModel(fileObj) {
        const ext = extOf(fileObj.name);
        if (!['ply', 'sog', 'spz', 'json'].includes(ext)) {
            showHint('只支持 .ply / .sog / .spz 泼溅文件');
            return Promise.resolve(null);
        }
        setStatus('导入模型…');
        return fileObj.arrayBuffer().then(async (buf) => {
            const asset = await makeSplatAsset(app, 'v3-splat-' + Date.now(), fileObj.name, buf);
            if (splatEnt) { splatEnt.destroy(); splatEnt = null; }
            splatEnt = new pc.Entity('splat');
            splatEnt.setLocalEulerAngles(0, 0, 180);   // 与编辑器导入一致
            splatEnt.addComponent('gsplat', { unified: true, asset });
            app.root.addChild(splatEnt);

            /* 模型字节进 files/，保存时由 putContentFile 换成内容寻址路径 */
            modelRef = { name: fileObj.name, path: '', bytes: new Uint8Array(buf), ext };
            markDirty();
            setStatus('');
            const b = computeSceneBox();
            if (b) orbit.frame(b);
            showHint('已导入「' + fileObj.name + '」');
            return splatEnt;
        }).catch((err) => {
            setStatus('');
            fail('导入模型失败：' + (err && err.message ? err.message : err));
            return null;
        });
    }

    const editor = attachEditor({
        canvas, camera, app, orbit,
        onChange: markDirty,
        onSelect: (cand) => syncSelection(cand)
    });

    /* -------- 工具栏 -------- */
    function syncSaveBtn() {
        const btn = document.getElementById('v3-save');
        if (!btn) return;
        btn.textContent = dirty ? '保存 ●' : '保存';
        btn.classList.toggle('v3-dirty', dirty);
    }

    function syncSelection(cand) {
        const del = document.getElementById('v3-del');
        const rot = document.getElementById('v3-rot');
        const has = !!cand;
        if (del) del.disabled = !has;
        if (rot) rot.disabled = !has;
        if (has) showHint('已选中，拖动可移动 · 双指可缩放');
    }

    function addPuppet(charId) {
        const def = CHARACTERS[charId] || CHARACTERS.woman;
        setStatus('载入角色…');
        // 返回 Promise：调用方（工具栏 / 自动化测试）需要能 await 到真正完成
        return makeAsset(app, 'v3-char-' + charId + '-' + Date.now(), 'container', def.url, null)
            .then((asset) => {
                const ent = asset.resource.instantiateRenderEntity();
                /* 放在相机前方一点点的地面上，免得新加的东西看不见 */
                const camPos = camera.getPosition();
                const tgt = orbit.state.target;
                const dir = new pc.Vec3().sub2(tgt, camPos).normalize();
                const p = new pc.Vec3().copy(tgt).add(dir.mulScalar(-0.5));
                ent.setPosition(p.x, 0, p.z);
                ent.setLocalScale(def.scale, def.scale, def.scale);
                ent.name = def.label + (recs.puppets.length + 1);
                app.root.addChild(ent);

                /* 定格在默认 clip 第一帧，和导演台一致 */
                const anims = asset.resource.animations || [];
                if (anims.length) {
                    const want = DEFAULT_CLIP[charId];
                    let idx = want ? anims.findIndex((a) => {
                        const n = (a.resource && a.resource.name) || '';
                        return n.toLowerCase() === want;
                    }) : -1;
                    if (idx < 0) idx = 0;
                    const track = anims[idx] && anims[idx].resource;
                    if (track) {
                        ent.addComponent('anim', { activate: true });
                        ent.anim.assignAnimation('default', track, undefined, 0, true);
                        ent.anim.playing = true;
                        ent.anim.speed = 0;
                    }
                }

                const rec = {
                    name: ent.name,
                    charId,
                    pos: ent.getLocalPosition().toArray(),
                    rot: ent.getLocalRotation().toArray(),
                    scale: ent.getLocalScale().toArray(),
                    tint: 'NONE',
                    clip: 0,
                    locked: false,
                    visible: true
                };
                recs.puppets.push({ rec, ent });
                editor.register(ent, rec, 'puppet');
                markDirty();
                setStatus('');
                showHint('已添加「' + ent.name + '」，拖动可移动');
                return ent;
            })
            .catch((err) => {
                setStatus('');
                fail('添加角色失败：' + (err && err.message ? err.message : err));
                return null;
            });
    }

    function addPropFromFile(fileObj) {
        setStatus('载入道具…');
        const ext = extOf(fileObj.name) || 'glb';
        return fileObj.arrayBuffer().then(async (buf) => {
            const asset = await makeAsset(app, 'v3-prop-new-' + Date.now(), 'container',
                'prop.' + ext, buf);
            const ent = asset.resource.instantiateRenderEntity();
            const tgt = orbit.state.target;
            ent.setPosition(tgt.x + 0.8, 0, tgt.z);
            ent.name = fileObj.name.replace(/\.[^.]+$/, '');
            app.root.addChild(ent);

            const rec = {
                name: ent.name,
                file: '',                 // 存盘时由 putContentFile 填
                pos: ent.getLocalPosition().toArray(),
                rot: ent.getLocalRotation().toArray(),
                scale: ent.getLocalScale().toArray(),
                locked: false,
                visible: true
            };
            recs.props.push({ rec, ent, bytes: new Uint8Array(buf), ext });
            editor.register(ent, rec, 'prop');
            markDirty();
            setStatus('');
            showHint('已添加「' + ent.name + '」');
            return ent;
        }).catch((err) => {
            setStatus('');
            fail('添加道具失败：' + (err && err.message ? err.message : err));
            return null;
        });
    }

    function buildSnapshot() {
        /* 把当前实体变换写回记录，再按 director 的字段顺序输出 */
        const puppets = recs.puppets.map(({ rec, ent }) => ({
            name: rec.name,
            charId: rec.charId,
            pos: ent.getLocalPosition().toArray(),
            rot: ent.getLocalRotation().toArray(),
            scale: ent.getLocalScale().toArray(),
            tint: rec.tint || 'NONE',
            clip: typeof rec.clip === 'number' ? rec.clip : 0,
            locked: !!rec.locked,
            visible: ent.enabled
        }));
        const props = recs.props.map(({ rec, ent }) => ({
            name: rec.name,
            file: rec.file,
            pos: ent.getLocalPosition().toArray(),
            rot: ent.getLocalRotation().toArray(),
            scale: ent.getLocalScale().toArray(),
            locked: !!rec.locked,
            visible: ent.enabled
        }));
        const camPos = camera.getPosition().toArray();
        const camTarget = orbit.state.target.toArray();
        return {
            version: 1,
            model: modelRef,
            puppets,
            props,
            shots: (state && state.shots) || [],
            camera: {
                pos: camPos,
                target: camTarget,
                fov: camera.camera.fov,
                clip: [camera.camera.nearClip, camera.camera.farClip]
            },
            cursor: (state && state.cursor) || null
        };
    }

    async function save() {
        if (!editable) { showHint('这个页面是只读的'); return; }
        const btn = document.getElementById('v3-save');
        const L = projectLogic();
        try {
            if (btn) btn.disabled = true;
            setStatus('保存工程…');

            /* 新导入的泼溅模型：字节先落 files/，再把 path 指过去 */
            if (modelRef && modelRef.bytes && !modelRef.path) {
                const ref = await L.putContentFile(paths, modelRef.ext || extOf(modelRef.name) || 'ply',
                    modelRef.bytes);
                modelRef = { name: modelRef.name, path: ref };
            }

            /* 新加的道具：字节先进 files/，再把 rec.file 指过去 */
            for (const item of recs.props) {
                if (item.bytes && !item.rec.file) {
                    const ref = await L.putContentFile(paths, item.ext, item.bytes);
                    item.rec.file = ref;
                }
            }

            const snap = buildSnapshot();
            /* meta.json 也要写完整：projectSnapshot 之外的字段（mode/name）在
             * projects-ui 打开时是必需的，缺了会被当成旧工程重走迁移。 */
            const stBytes = new TextEncoder().encode(JSON.stringify(snap));
            await L.store().write(paths.state, stBytes);

            /* 注册表：hasModel 置真 + 更新时间，否则首页卡片还显示"空" */
            const reg = L.loadRegistry();
            const meta = {
                name: project,
                mode: 'model',
                updatedAt: new Date().toISOString(),
                hasModel: !!(snap.model && snap.model.path)
            };
            L.saveRegistry(L.upsertProject(reg, meta));
            try {
                await L.store().write(paths.meta, new TextEncoder().encode(JSON.stringify(meta)));
            } catch (e) { /* meta 写失败不影响状态已经存好 */ }

            state = snap;
            dirty = false;
            syncSaveBtn();
            setStatus('');
            showHint('已保存 · 人偶 ' + snap.puppets.length + ' · 道具 ' + snap.props.length);
        } catch (err) {
            setStatus('');
            fail('保存失败：' + (err && err.message ? err.message : err));
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    if (editable && TOOLBAR) {
        TOOLBAR.hidden = false;
        const addWrap = document.getElementById('v3-add');
        Object.keys(CHARACTERS).forEach((id) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'v3-chip';
            b.textContent = '+' + CHARACTERS[id].label;
            b.addEventListener('click', () => addPuppet(id));
            addWrap.appendChild(b);
        });
        const fileBtn = document.createElement('button');
        fileBtn.type = 'button';
        fileBtn.className = 'v3-chip';
        fileBtn.textContent = '+道具 GLB';
        /* v68：新建工程还没有泼溅模型时，给一个导入入口（否则工作台是空网格） */
        const modelBtn = document.createElement('button');
        modelBtn.type = 'button';
        modelBtn.className = 'v3-chip';
        modelBtn.textContent = '+泼溅模型';
        const modelInp = document.createElement('input');
        modelInp.type = 'file';
        modelInp.accept = '*/*';
        modelInp.style.display = 'none';
        modelInp.addEventListener('change', () => {
            if (modelInp.files && modelInp.files[0]) importModel(modelInp.files[0]);
            modelInp.value = '';
        });
        addWrap.appendChild(modelInp);
        modelBtn.addEventListener('click', () => modelInp.click());
        addWrap.appendChild(modelBtn);
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '*/*';
        inp.style.display = 'none';
        inp.addEventListener('change', () => {
            if (inp.files && inp.files[0]) addPropFromFile(inp.files[0]);
            inp.value = '';
        });
        addWrap.appendChild(inp);
        fileBtn.addEventListener('click', () => inp.click());
        addWrap.appendChild(fileBtn);

        document.getElementById('v3-save').addEventListener('click', save);
        document.getElementById('v3-del').addEventListener('click', () => {
            const r = editor.deleteSelected();
            if (r) {
                recs.puppets = recs.puppets.filter((x) => x.rec !== r);
                recs.props = recs.props.filter((x) => x.rec !== r);
            }
        });
        document.getElementById('v3-rot').addEventListener('click', () => editor.rotateSelected(90));
        syncSaveBtn();
        syncSelection(null);
    }

    /* -------- 载入场景 -------- */
    if (!project && !file) {
        setStatus('');
        TITLE.textContent = '场景工作台';
        orbit.state.distance = 6;
        orbit.apply();
        document.getElementById('v3-fit').hidden = true;
        grid.enabled = true;
        window.__v3 = { app, camera, orbit, computeSceneBox, editor, recs,
            dirtyRef: () => dirty, _addProp: addPropFromFile, _addPuppet: addPuppet };
        return;
    }

    if (project) {
        TITLE.textContent = project;
        setStatus('读取工程…');
        try {
            const got = await readProjectState(project);
            state = got.state;
            paths = got.paths;
            modelRef = state.model || null;
        } catch (err) {
            fail('读取工程失败：' + (err && err.message ? err.message : err));
            return;
        }
    }

    /* 1) 泼溅模型 */
    if (state && state.model && state.model.path) {
        setStatus('载入泼溅…');
        try {
            const bytes = await readFileBytes(paths, state.model.path);
            const filename = state.model.name || state.model.path;
            const asset = await makeSplatAsset(app, 'v3-splat', filename, bytes);
            const ent = new pc.Entity('splat');
            ent.setLocalEulerAngles(0, 0, 180);   // 与编辑器导入保持一致
            ent.addComponent('gsplat', { unified: true, asset });
            app.root.addChild(ent);
        } catch (err) {
            fail('载入泼溅失败：' + (err && err.message ? err.message : err));
        }
    } else if (file) {
        setStatus('载入文件…');
        try {
            const resp = await fetch(file);
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const buf = await resp.arrayBuffer();
            const filename = file.split('?')[0].split('/').pop() || 'model.ply';
            const asset = await makeSplatAsset(app, 'v3-splat', filename, buf);
            const ent = new pc.Entity('splat');
            ent.setLocalEulerAngles(0, 0, 180);
            ent.addComponent('gsplat', { unified: true, asset });
            app.root.addChild(ent);
        } catch (err) {
            fail('载入文件失败：' + (err && err.message ? err.message : err));
        }
    }

    /* 2) 道具（GLB，同一份字节多个实例只装一次） */
    if (state && state.props && state.props.length) {
        setStatus('载入道具…');
        const cache = {};
        for (let i = 0; i < state.props.length; i++) {
            const rec = state.props[i];
            if (!rec || !rec.file) continue;
            try {
                let asset = cache[rec.file];
                if (!asset) {
                    const bytes = await readFileBytes(paths, rec.file);
                    const filename = rec.file.split('/').pop() || ('prop' + i + '.glb');
                    asset = await makeAsset(app, 'v3-prop-' + i, 'container', filename,
                        toArrayBuffer(bytes));
                    cache[rec.file] = asset;
                }
                const ent = asset.resource.instantiateRenderEntity();
                ent.name = rec.name || ('道具' + (i + 1));
                if (rec.pos) ent.setLocalPosition(rec.pos[0], rec.pos[1], rec.pos[2]);
                if (rec.rot) ent.setLocalRotation(new pc.Quat(rec.rot[0], rec.rot[1], rec.rot[2], rec.rot[3]));
                if (rec.scale) ent.setLocalScale(rec.scale[0], rec.scale[1], rec.scale[2]);
                if (rec.visible === false) ent.enabled = false;
                app.root.addChild(ent);
                recs.props.push({ rec, ent });
                editor.register(ent, rec, 'prop');
            } catch (err) {
                console.warn('[viewer3d] prop failed: ' + rec.file, err);
            }
        }
    }

    /* 3) 人偶（内置角色 + 存档里的摆位与姿态） */
    if (state && state.puppets && state.puppets.length) {
        setStatus('载入角色…');
        const cache = {};
        for (let i = 0; i < state.puppets.length; i++) {
            const rec = state.puppets[i];
            const def = CHARACTERS[rec.charId] || CHARACTERS.woman;
            try {
                let asset = cache[rec.charId];
                if (!asset) {
                    asset = await makeAsset(app, 'v3-char-' + rec.charId, 'container', def.url, null);
                    cache[rec.charId] = asset;
                }
                const ent = asset.resource.instantiateRenderEntity();
                ent.name = rec.name || rec.charId;
                if (rec.pos) ent.setLocalPosition(rec.pos[0], rec.pos[1], rec.pos[2]);
                if (rec.rot) ent.setLocalRotation(new pc.Quat(rec.rot[0], rec.rot[1], rec.rot[2], rec.rot[3]));
                if (rec.scale) ent.setLocalScale(rec.scale[0], rec.scale[1], rec.scale[2]);
                else if (def.scale !== 1) ent.setLocalScale(def.scale, def.scale, def.scale);
                if (rec.visible === false) ent.enabled = false;
                app.root.addChild(ent);

                /* 冻结在默认 clip 的第一帧：和导演台「生成即定格」一致
                 * （speed=0 停住时间，pose 停在第一帧，不会自己动起来） */
                const anims = asset.resource.animations || [];
                if (anims.length) {
                    const want = DEFAULT_CLIP[rec.charId];
                    let idx = want ? anims.findIndex((a) => {
                        const n = (a.resource && a.resource.name) || '';
                        return n.toLowerCase() === want;
                    }) : -1;
                    if (idx < 0) idx = 0;
                    const track = anims[idx] && anims[idx].resource;
                    if (track) {
                        ent.addComponent('anim', { activate: true });
                        ent.anim.assignAnimation('default', track, undefined, 0, true);
                        ent.anim.playing = true;
                        ent.anim.speed = 0;
                    }
                }
                recs.puppets.push({ rec, ent });
                editor.register(ent, rec, 'puppet');
            } catch (err) {
                console.warn('[viewer3d] puppet failed: ' + rec.charId, err);
            }
        }
    }

    /* 4) 相机：优先用存档机位，否则按整个场景取景。
     * 等两帧再算包围盒：蒙皮后的 aabb 要等动画求值完才准确。 */
    await new Promise((resolve) => {
        if (app.frame > 2) resolve();
        else app.once('frameend', resolve);
    });
    await new Promise((resolve) => app.once('frameend', resolve));

    const sceneBox = computeSceneBox();

    if (state && state.camera && state.camera.pos && state.camera.target) {
        const c = state.camera;
        const target = new pc.Vec3(c.target[0], c.target[1], c.target[2]);
        const pos = new pc.Vec3(c.pos[0], c.pos[1], c.pos[2]);
        orbit.state.target.copy(target);
        orbit.state.distance = pos.distance(target) || 4;
        const d = new pc.Vec3().sub2(pos, target).normalize();
        orbit.state.elev = Math.asin(Math.max(-1, Math.min(1, d.y))) * 180 / Math.PI;
        orbit.state.azim = Math.atan2(d.x, d.z) * 180 / Math.PI;
        if (c.fov) camera.camera.fov = c.fov;
        orbit.apply();
    } else if (sceneBox) {
        orbit.frame(sceneBox);
    } else {
        orbit.apply();
    }

    setStatus('');

    document.getElementById('v3-fit').addEventListener('click', () => {
        const b = computeSceneBox();
        if (b) orbit.frame(b);
        else { orbit.state.target.set(0, 0, 0); orbit.state.distance = 4; orbit.apply(); }
    });

    // 排障入口：真机上必要时可以用 console 手工调
    window.__v3 = { app, camera, orbit, computeSceneBox, editor, recs, buildSnapshot, save,
        dirtyRef: () => dirty, _addProp: addPropFromFile, _addPuppet: addPuppet };
}

document.getElementById('v3-back').addEventListener('click', () => {
    location.href = './index.html';
});

boot().catch((err) => {
    fail('场景工作台启动失败：' + (err && err.message ? err.message : err));
});
