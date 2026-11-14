/* 摸鱼台 3D 只读查看器（v67，方案 B）
 *
 * 为什么单独一个页面：
 *   v3 编辑器的 ProjectedSplatRenderer 硬依赖 WebGPU 的 StorageBuffer
 *   （WebglGraphicsDevice 没有 createBufferImpl），所以在只有 WebGL2 的设备上，
 *   编辑器整体起不来。而 PlayCanvas 自带的 legacy gsplat 组件有完整 WebGL 分支
 *   （排序走 worker + orderTexture），能正常渲染泼溅。
 *
 * 这个页面因此不加载 index.js，只加载 playcanvas（pc.min.mjs），用 legacy 组件
 * + container 组件自己搭一个只读场景：泼溅 + GLB + 内置角色/道具。
 *
 * 能力边界（对老板承诺的）：
 *   - 能看：泼溅（.ply/.sog/.spz）、GLB 模型、人偶/道具摆位与机位
 *   - 不能改：不做编辑、不写回工程
 */
import * as pc from './pc.min.mjs';

const STATUS = document.getElementById('v3-status');
const ERRB = document.getElementById('v3-error');
const TITLE = document.getElementById('v3-title');
const STAGE = document.getElementById('v3-stage');

/* spz 解码器（部署目录里已有的 wasm 模块，体积 0.9MB，不用另装依赖） */
const SPZ_MODULE = './spz-DEYRea_v-BKWZnoXF.js';

/* 内置角色表必须和 src/director.ts 的 CHARACTERS 一致：工程存档里只存 charId，
 * 打开时必须能找回同一个 GLB，否则人偶会消失。 */
const CHARACTERS = {
    woman: { url: 'static/director/woman.glb', scale: 1.0 },
    man: { url: 'static/director/male.glb', scale: 1.0 },
    shiba: { url: 'static/director/shiba.glb', scale: 0.225 },
    tuxedo: { url: 'static/director/tuxedo.glb', scale: 0.19 },
    box: { url: 'static/director/box.glb', scale: 0.4 }
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

function fail(msg) {
    setStatus('');
    if (ERRB) {
        ERRB.hidden = false;
        ERRB.textContent = msg;
    }
    console.error('[viewer3d] ' + msg);
}

/* ---------- 参数 ---------- */

function params() {
    const q = new URLSearchParams(location.search);
    return {
        project: q.get('project') || '',
        file: q.get('file') || ''
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

/* 把「文件名 + 字节」变成可直接 addComponent 的 gsplat 资产。
 * spz 先转 PLY；其他交给引擎自己的 parser（ply / sog(json)）。 */
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
        deviceTypes: [],          // 只要 WebGL2：本页面存在的意义就是绕开 WebGPU
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

/* 自带一套轨道/双指控制：只要「看」的能力，自己实现比塞 orbit-camera 脚本更小可控 */
function attachOrbit(canvas, camera) {
    const state = {
        target: new pc.Vec3(0, 0, 0),
        distance: 4,
        azim: 0,
        elev: 20,
        minDistance: 0.02,
        maxDistance: 8000
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
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            lastDist = Math.hypot(a.x - b.x, a.y - b.y);
        }
        if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
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
        /* 用包围盒把相机摆到能看全的位置（就是「复位视角」） */
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

/* ---------- 主流程 ---------- */

async function boot() {
    const canvas = document.createElement('canvas');
    canvas.id = 'v3-canvas';
    STAGE.appendChild(canvas);

    const app = createApp(canvas);
    const camera = createCamera(app);
    createLights(app);
    const orbit = attachOrbit(canvas, camera);

    /* 场景包围盒：不能只看泼溅的 aabb——人偶/道具是另外的 meshInstance，
     * 只按泼溅取景会把人切在画面外（实测就是这样）。遍历所有带 meshInstances
     * 的组件取并集，且在动画求值之后算（蒙皮后的 aabb 才准）。 */
    const computeSceneBox = () => {
        const box = new pc.BoundingBox();
        let any = false;
        const visit = (entity) => {
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

    const { project, file } = params();
    if (!project && !file) {
        setStatus('');
        TITLE.textContent = '查看器';
        orbit.state.distance = 4;
        orbit.apply();
        document.getElementById('v3-fit').hidden = true;
        return;
    }

    let state = null;
    let paths = null;

    if (project) {
        TITLE.textContent = project;
        setStatus('读取工程…');
        try {
            const got = await readProjectState(project);
            state = got.state;
            paths = got.paths;
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
    window.__v3 = { app, camera, orbit, computeSceneBox };
}

document.getElementById('v3-back').addEventListener('click', () => {
    location.href = './index.html';
});

boot().catch((err) => {
    fail('查看器启动失败：' + (err && err.message ? err.message : err));
});
