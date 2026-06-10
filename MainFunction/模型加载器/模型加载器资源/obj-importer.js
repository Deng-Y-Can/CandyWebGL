// obj-importer.js (ES Module)
// 依赖：math-gl.js + webgl-runtime.js
// 用途：加载/解析 OBJ（可选 MTL/贴图），并创建 Mesh/Model 加入 Scene

import { vec3, vec4, mat3, mat4, mathf } from "./math-gl.js";
import { Program, Mesh, Material, Model, Texture2D, Assets } from "./webgl-runtime.js";

/* ---------------------------------------------
 * 默认 Shader：网格（带法线 + 可选贴图）
 * 约定 uniform：
 *  uMVP, uNormalMat, uColor, uUseFakeLight, uMainTex, uHasTex
 * --------------------------------------------- */
const OBJShaderLib = {
    MeshLit: {
        vs100: `
precision highp float;
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUV;
uniform mat4 uMVP;
uniform mat3 uNormalMat;
varying vec3 vN;
varying vec2 vUV;
void main(){
  vN = normalize(uNormalMat * aNormal);
  vUV = aUV;
  gl_Position = uMVP * vec4(aPosition, 1.0);
}
`,
        fs100: `
precision highp float;
varying vec3 vN;
varying vec2 vUV;
uniform vec4 uColor;
uniform sampler2D uMainTex;
uniform float uHasTex;        // 0/1
uniform float uUseFakeLight;  // 0/1
void main(){
  vec4 base = uColor;
  if (uHasTex > 0.5) {
    base *= texture2D(uMainTex, vUV);
  }
  if (uUseFakeLight > 0.5) {
    vec3 L = normalize(vec3(0.35,0.85,0.55));
    float ndl = max(dot(normalize(vN), L), 0.0);
    base.rgb *= (0.22 + 0.78*ndl);
  }
  gl_FragColor = base;
}
`,
        vs300: `#version 300 es
precision highp float;
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUV;
uniform mat4 uMVP;
uniform mat3 uNormalMat;
out vec3 vN;
out vec2 vUV;
void main(){
  vN = normalize(uNormalMat * aNormal);
  vUV = aUV;
  gl_Position = uMVP * vec4(aPosition, 1.0);
}
`,
        fs300: `#version 300 es
precision highp float;
in vec3 vN;
in vec2 vUV;
uniform vec4 uColor;
uniform sampler2D uMainTex;
uniform float uHasTex;
uniform float uUseFakeLight;
out vec4 outColor;
void main(){
  vec4 base = uColor;
  if (uHasTex > 0.5) {
    base *= texture(uMainTex, vUV);
  }
  if (uUseFakeLight > 0.5) {
    vec3 L = normalize(vec3(0.35,0.85,0.55));
    float ndl = max(dot(normalize(vN), L), 0.0);
    base.rgb *= (0.22 + 0.78*ndl);
  }
  outColor = base;
}
`,
    },
};

/* ---------------------------------------------
 * Public API
 * --------------------------------------------- */

/**
 * 导入 OBJ 并加入场景。
 * @param {GLDevice} device
 * @param {Scene} scene
 * @param {string|File|Blob|ArrayBuffer|Uint8Array} source
 * @param {object} options
 * @returns {Promise<Model|Model[]>} 默认按材质分多个 Model；若 options.singleModel=true 则返回一个父 Model（Node）
 */
export async function importOBJToScene(device, scene, source, options = {}) {
    const objText = await _loadAsText(source);

    // 解析 OBJ（CPU）
    const parsed = parseOBJ(objText, {
        ...options,
    });

    // 可选：解析 MTL + 加载贴图
    const mtlDict = options.loadMTL ? await _loadAndParseMTL(source, parsed.mtllibs, options) : null;

    // 创建 Program（复用）
    const program = Program.fromSources(device, OBJShaderLib.MeshLit);

    // 创建 Model(s)
    const models = [];
    const gl = device.gl;

    for (const sm of parsed.submeshes) {
        if (!sm.positions || sm.positions.length === 0) continue;

        // 若缺法线则根据开关计算
        if ((!sm.normals || sm.normals.length === 0) && (options.computeNormals ?? true) && sm.indices) {
            sm.normals = _computeVertexNormals(sm.positions, sm.indices);
        }
        // 若仍没法线，给默认
        if (!sm.normals) {
            const vCount = (sm.positions.length / 3) | 0;
            sm.normals = new Float32Array(vCount * 3);
            for (let i = 0; i < vCount; i++) sm.normals[i * 3 + 1] = 1;
        }
        // 若没 UV，补 0（shader要求 aUV）
        if (!sm.uvs) {
            const vCount = (sm.positions.length / 3) | 0;
            sm.uvs = new Float32Array(vCount * 2);
        }

        // indices 位宽检查（WebGL1）
        if (sm.indices instanceof Uint32Array && !device.extUint32) {
            throw new Error("OBJ 索引超过 65535，需要 WebGL2 或 WebGL1 扩展 OES_element_index_uint");
        }

        const mesh = Mesh.fromData(device, {
            attributes: {
                aPosition: { data: sm.positions, size: 3 },
                aNormal: { data: sm.normals, size: 3 },
                aUV: { data: sm.uvs, size: 2 },
            },
            indices: sm.indices || null,
            mode: gl.TRIANGLES,
        });

        // Material：从 MTL 提取 Kd / alpha / map_Kd
        const mtl = mtlDict ? (mtlDict[sm.materialName] || null) : null;
        const baseColor = mtl?.Kd ? vec4.fromValues(mtl.Kd[0], mtl.Kd[1], mtl.Kd[2], (mtl.alpha ?? 1)) :
            (options.color ? _toVec4(options.color) : vec4.fromValues(1, 1, 1, 1));
        const alpha = baseColor[3];

        const textures = {};
        let hasTex = 0;

        if (mtl?.map_Kd) {
            const tex = await _loadTexture2D(device, mtl.map_Kd, source, options);
            if (tex) {
                textures.uMainTex = tex;
                hasTex = 1;
            }
        }

        const mat = new Material(program, {
            depthTest: options.depthTest ?? true,
            depthWrite: options.depthWrite ?? (alpha >= 0.999),
            blend: options.blend ?? (alpha < 0.999),
            cull: options.cull ?? true,
            uniforms: {
                uColor: baseColor,
                uHasTex: hasTex,
                uUseFakeLight: (options.fakeLight ?? true) ? 1.0 : 0.0,
            },
            textures,
        });

        const model = new Model(mesh, mat, sm.name || sm.materialName || "OBJ");
        scene.add(model);

        model._objInfo = {
            material: sm.materialName || "",
            vertexCount: (sm.positions.length / 3) | 0,
            triangleCount: sm.indices ? (sm.indices.length / 3) | 0 : 0,
        };

        models.push(model);
    }

    if (options.singleModel) {
        // 简单返回数组也行；这里给你保持一致：singleModel 直接返回第一个（或数组）
        // 你如果需要“父节点容器”，后续可以在 runtime 里加 Group/Node 作为容器。
        return models;
    }

    // 默认：若只有一个就返回单个，否则返回数组
    return models.length === 1 ? models[0] : models;
}

/**
 * 仅解析 OBJ 文本（不创建 WebGL 资源）
 * @returns {{
 *   submeshes: Array<{name:string, materialName:string, positions:Float32Array, normals?:Float32Array, uvs?:Float32Array, indices?:Uint16Array|Uint32Array}>,
 *   bbox: {min:Float32Array, max:Float32Array},
 *   mtllibs: string[],
 *   vertexCount: number,
 *   triangleCount: number
 * }}
 */
export function parseOBJ(objText, options = {}) {
    const opt = {
        mergeByMaterial: options.mergeByMaterial ?? true,
        center: options.center ?? true,
        scaleToUnit: options.scaleToUnit ?? true,
        upAxis: options.upAxis || "y", // 若源是 z-up，用 "z"
        swapYZ: !!options.swapYZ,
        flipX: !!options.flipX,
        flipY: !!options.flipY,
        flipZ: !!options.flipZ,
        flipUVY: options.flipUVY ?? true,
    };

    // raw pools（OBJ 的索引指向这些）
    const V = [];  // positions [x,y,z,...]
    const VN = []; // normals
    const VT = []; // uvs [u,v,...]
    const VC = []; // 可选 vertex color [r,g,b]（部分 OBJ 扩展会在 v 后跟颜色）

    // materials libs
    const mtllibs = [];

    // submesh 管理
    const submeshes = [];
    const submeshMap = new Map(); // key -> Submesh

    let currentName = "default";
    let currentMtl = "default";

    function getSubmesh(name, mtlName) {
        const key = opt.mergeByMaterial ? (mtlName || "default") : `${name || "default"}|${mtlName || "default"}`;
        let sm = submeshMap.get(key);
        if (!sm) {
            sm = _createSubmesh(name || "default", mtlName || "default");
            submeshMap.set(key, sm);
            submeshes.push(sm);
        }
        return sm;
    }

    let sm = getSubmesh(currentName, currentMtl);

    // fast line iteration
    const lines = objText.split(/\r?\n/);

    for (let li = 0; li < lines.length; li++) {
        const line = lines[li].trim();
        if (!line || line.startsWith("#")) continue;

        const parts = line.split(/\s+/);
        const tag = parts[0];

        if (tag === "v") {
            const x = parseFloat(parts[1]);
            const y = parseFloat(parts[2]);
            const z = parseFloat(parts[3]);
            V.push(x, y, z);

            // 某些 OBJ 扩展：v x y z r g b
            if (parts.length >= 7) {
                const r = parseFloat(parts[4]);
                const g = parseFloat(parts[5]);
                const b = parseFloat(parts[6]);
                VC.push(r, g, b);
            }
        }
        else if (tag === "vn") {
            VN.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
        }
        else if (tag === "vt") {
            // vt u v [w]
            let u = parseFloat(parts[1]);
            let v = parseFloat(parts[2]);
            if (opt.flipUVY) v = 1 - v;
            VT.push(u, v);
        }
        else if (tag === "f") {
            // face: v, v/vt, v//vn, v/vt/vn
            const verts = parts.slice(1);
            if (verts.length < 3) continue;

            // triangulate fan: (0,i,i+1)
            for (let k = 1; k + 1 < verts.length; k++) {
                const a = _parseObjVert(verts[0], V.length / 3, VT.length / 2, VN.length / 3);
                const b = _parseObjVert(verts[k], V.length / 3, VT.length / 2, VN.length / 3);
                const c = _parseObjVert(verts[k + 1], V.length / 3, VT.length / 2, VN.length / 3);

                sm = getSubmesh(currentName, currentMtl);
                _emitTri(sm, a, b, c, V, VT, VN);
            }
        }
        else if (tag === "usemtl") {
            currentMtl = parts.slice(1).join(" ") || "default";
            sm = getSubmesh(currentName, currentMtl);
        }
        else if (tag === "mtllib") {
            // 可能多个
            const libs = parts.slice(1);
            for (const lib of libs) mtllibs.push(lib);
        }
        else if (tag === "o" || tag === "g") {
            currentName = parts.slice(1).join(" ") || "default";
            sm = getSubmesh(currentName, currentMtl);
        }
        // 其他：s / l 等忽略
    }

    // finalize typed arrays + bbox
    let allPos = null;
    let vertexCount = 0;
    let triangleCount = 0;

    for (const s of submeshes) {
        s.positions = new Float32Array(s._pos);
        s.uvs = s._uv.length ? new Float32Array(s._uv) : null;
        s.normals = s._nrm.length ? new Float32Array(s._nrm) : null;
        s.indices = _makeBestIndexArray(s._idx);

        vertexCount += (s.positions.length / 3) | 0;
        triangleCount += s.indices ? (s.indices.length / 3) | 0 : 0;

        // collect bbox over all
        if (!allPos) allPos = s.positions;
        else {
            // 仅用于 bbox：简单拼接会耗内存；这里不拼接，只在 bbox 阶段遍历所有 submesh
        }

        // 清理临时
        delete s._pos; delete s._uv; delete s._nrm; delete s._idx; delete s._map;
    }

    // bbox over all submeshes
    const bbox = _computeBBoxFromSubmeshes(submeshes);

    // post transform（对每个 submesh 的 positions）
    _postTransformSubmeshes(submeshes, bbox, opt);

    // 变换后重算 bbox
    const bbox2 = _computeBBoxFromSubmeshes(submeshes);

    return {
        submeshes,
        bbox: bbox2,
        mtllibs,
        vertexCount,
        triangleCount,
    };
}

/**
 * 解析 MTL 文本
 * @returns {{[name:string]: {name:string, Kd?:number[], alpha?:number, map_Kd?:string}}}
 */
export function parseMTL(mtlText) {
    const lines = mtlText.split(/\r?\n/);
    const mats = {};
    let cur = null;

    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const parts = line.split(/\s+/);
        const tag = parts[0];

        if (tag === "newmtl") {
            const name = parts.slice(1).join(" ");
            cur = { name };
            mats[name] = cur;
        } else if (!cur) {
            continue;
        } else if (tag === "Kd") {
            cur.Kd = [parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])];
        } else if (tag === "d") {
            cur.alpha = parseFloat(parts[1]);
        } else if (tag === "Tr") {
            // Tr 是透明度的反义（有些文件这样写）
            cur.alpha = 1 - parseFloat(parts[1]);
        } else if (tag === "map_Kd") {
            // map_Kd 可能带参数：-s -o ... 这里取最后一个非 option token
            cur.map_Kd = _extractMapPath(parts.slice(1));
        }
    }
    return mats;
}

/* ---------------------------------------------
 * Internal: submesh build
 * --------------------------------------------- */

function _createSubmesh(name, materialName) {
    return {
        name,
        materialName,
        _pos: [],
        _nrm: [],
        _uv: [],
        _idx: [],
        _map: new Map(), // key-> newIndex
    };
}

function _parseObjVert(token, vCount, vtCount, vnCount) {
    // token examples:
    //  "1"
    //  "1/2"
    //  "1//3"
    //  "1/2/3"
    const a = token.split("/");
    const vi = _fixIndex(a[0], vCount);
    const vti = a[1] ? _fixIndex(a[1], vtCount) : -1;
    const vni = a[2] ? _fixIndex(a[2], vnCount) : -1;
    return { vi, vti, vni };
}

function _fixIndex(str, count) {
    let i = parseInt(str, 10);
    // OBJ: 1-based; negative means relative to end
    if (i < 0) i = count + i + 1;
    return i - 1; // to 0-based
}

function _emitTri(sm, a, b, c, V, VT, VN) {
    const ia = _emitVertex(sm, a, V, VT, VN);
    const ib = _emitVertex(sm, b, V, VT, VN);
    const ic = _emitVertex(sm, c, V, VT, VN);
    sm._idx.push(ia, ib, ic);
}

function _emitVertex(sm, v, V, VT, VN) {
    const key = `${v.vi}/${v.vti}/${v.vni}`;
    const existed = sm._map.get(key);
    if (existed !== undefined) return existed;

    const idx = (sm._pos.length / 3) | 0;

    // position
    const pi = v.vi * 3;
    sm._pos.push(V[pi], V[pi + 1], V[pi + 2]);

    // uv
    if (v.vti >= 0) {
        const ti = v.vti * 2;
        sm._uv.push(VT[ti], VT[ti + 1]);
    } else {
        sm._uv.push(0, 0);
    }

    // normal
    if (v.vni >= 0 && VN.length > 0) {
        const ni = v.vni * 3;
        sm._nrm.push(VN[ni], VN[ni + 1], VN[ni + 2]);
    } else {
        // 先填 0，后面可 computeNormals
        sm._nrm.push(0, 0, 0);
    }

    sm._map.set(key, idx);
    return idx;
}

/* ---------------------------------------------
 * Internal: transforms / bbox / normals
 * --------------------------------------------- */

function _computeBBoxFromSubmeshes(submeshes) {
    const min = vec3.fromValues(Infinity, Infinity, Infinity);
    const max = vec3.fromValues(-Infinity, -Infinity, -Infinity);

    for (const sm of submeshes) {
        const p = sm.positions;
        if (!p) continue;
        const n = (p.length / 3) | 0;
        for (let i = 0; i < n; i++) {
            const x = p[i * 3 + 0], y = p[i * 3 + 1], z = p[i * 3 + 2];
            if (x < min[0]) min[0] = x;
            if (y < min[1]) min[1] = y;
            if (z < min[2]) min[2] = z;
            if (x > max[0]) max[0] = x;
            if (y > max[1]) max[1] = y;
            if (z > max[2]) max[2] = z;
        }
    }
    return { min, max };
}

function _postTransformSubmeshes(submeshes, bbox, opt) {
    const swapYZ = opt.swapYZ;
    const flipX = opt.flipX;
    const flipY = opt.flipY;
    const flipZ = opt.flipZ;
    const convertZUpToYUp = opt.upAxis === "z";

    // center / scale factor 先按 bbox 计算
    let cx = 0, cy = 0, cz = 0;
    if (opt.center) {
        cx = (bbox.min[0] + bbox.max[0]) * 0.5;
        cy = (bbox.min[1] + bbox.max[1]) * 0.5;
        cz = (bbox.min[2] + bbox.max[2]) * 0.5;
    }

    let scale = 1;
    if (opt.scaleToUnit) {
        const sx = bbox.max[0] - bbox.min[0];
        const sy = bbox.max[1] - bbox.min[1];
        const sz = bbox.max[2] - bbox.min[2];
        const m = Math.max(1e-9, Math.hypot(sx, sy, sz));
        scale = 1 / m;
    }

    // 应用到每个 submesh
    for (const sm of submeshes) {
        const p = sm.positions;
        if (!p) continue;
        const n = (p.length / 3) | 0;

        for (let i = 0; i < n; i++) {
            let x = p[i * 3 + 0];
            let y = p[i * 3 + 1];
            let z = p[i * 3 + 2];

            if (opt.center) { x -= cx; y -= cy; z -= cz; }
            if (opt.scaleToUnit) { x *= scale; y *= scale; z *= scale; }

            if (convertZUpToYUp) {
                const oy = y, oz = z;
                y = oz;
                z = -oy;
            }
            if (swapYZ) {
                const t = y; y = z; z = t;
            }
            if (flipX) x = -x;
            if (flipY) y = -y;
            if (flipZ) z = -z;

            p[i * 3 + 0] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
        }

        // 法线同样需要做轴变换（如果已有法线）
        if (sm.normals) {
            const nn = sm.normals;
            const vn = (nn.length / 3) | 0;
            for (let i = 0; i < vn; i++) {
                let x = nn[i * 3 + 0], y = nn[i * 3 + 1], z = nn[i * 3 + 2];

                if (convertZUpToYUp) {
                    const oy = y, oz = z;
                    y = oz;
                    z = -oy;
                }
                if (swapYZ) { const t = y; y = z; z = t; }
                if (flipX) x = -x;
                if (flipY) y = -y;
                if (flipZ) z = -z;

                // 归一化
                const l = Math.hypot(x, y, z) || 1;
                nn[i * 3 + 0] = x / l; nn[i * 3 + 1] = y / l; nn[i * 3 + 2] = z / l;
            }
        }
    }
}

function _computeVertexNormals(positions, indices) {
    const vCount = (positions.length / 3) | 0;
    const nrm = new Float32Array(vCount * 3);

    const ax = vec3.create(), bx = vec3.create(), cx = vec3.create();
    const ab = vec3.create(), ac = vec3.create(), n = vec3.create();

    for (let i = 0; i < indices.length; i += 3) {
        const i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];

        ax[0] = positions[i0 * 3 + 0]; ax[1] = positions[i0 * 3 + 1]; ax[2] = positions[i0 * 3 + 2];
        bx[0] = positions[i1 * 3 + 0]; bx[1] = positions[i1 * 3 + 1]; bx[2] = positions[i1 * 3 + 2];
        cx[0] = positions[i2 * 3 + 0]; cx[1] = positions[i2 * 3 + 1]; cx[2] = positions[i2 * 3 + 2];

        vec3.sub(ab, bx, ax);
        vec3.sub(ac, cx, ax);
        vec3.cross(n, ab, ac);

        nrm[i0 * 3 + 0] += n[0]; nrm[i0 * 3 + 1] += n[1]; nrm[i0 * 3 + 2] += n[2];
        nrm[i1 * 3 + 0] += n[0]; nrm[i1 * 3 + 1] += n[1]; nrm[i1 * 3 + 2] += n[2];
        nrm[i2 * 3 + 0] += n[0]; nrm[i2 * 3 + 1] += n[1]; nrm[i2 * 3 + 2] += n[2];
    }

    for (let i = 0; i < vCount; i++) {
        const x = nrm[i * 3 + 0], y = nrm[i * 3 + 1], z = nrm[i * 3 + 2];
        const l = Math.hypot(x, y, z);
        if (l > 1e-8) {
            nrm[i * 3 + 0] = x / l;
            nrm[i * 3 + 1] = y / l;
            nrm[i * 3 + 2] = z / l;
        } else {
            nrm[i * 3 + 0] = 0; nrm[i * 3 + 1] = 1; nrm[i * 3 + 2] = 0;
        }
    }
    return nrm;
}

function _makeBestIndexArray(jsArray) {
    let max = 0;
    for (let i = 0; i < jsArray.length; i++) if (jsArray[i] > max) max = jsArray[i];
    if (max <= 65535) return new Uint16Array(jsArray);
    return new Uint32Array(jsArray);
}

/* ---------------------------------------------
 * Internal: load text / resources
 * --------------------------------------------- */

async function _loadAsText(source) {
    if (typeof source === "string") {
        const r = await fetch(source);
        if (!r.ok) throw new Error(`加载 OBJ 失败：${source}`);
        return await r.text();
    }
    if (source instanceof ArrayBuffer) return new TextDecoder("utf-8").decode(new Uint8Array(source));
    if (source instanceof Uint8Array) return new TextDecoder("utf-8").decode(source);
    if (source && typeof source.text === "function") return await source.text(); // File/Blob
    if (source && typeof source.arrayBuffer === "function") {
        const buf = await source.arrayBuffer();
        return new TextDecoder("utf-8").decode(new Uint8Array(buf));
    }
    throw new Error("source 类型不支持：请传 url / File / Blob / ArrayBuffer / Uint8Array");
}

function _toVec4(c) {
    // c 可传 [r,g,b] 或 [r,g,b,a] 或 Float32Array
    const a = (c.length >= 4) ? c[3] : 1;
    return vec4.fromValues(c[0], c[1], c[2], a);
}

function _extractMapPath(tokens) {
    // 忽略常见 option：-s -o -clamp -bm 等（这里只做粗略）
    // 取最后一个看起来像路径的 token
    let last = null;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.startsWith("-")) {
            // 跳过它和若干参数（这里不严谨，但足够处理大多数）
            continue;
        }
        last = t;
    }
    return last;
}

function _getBaseURL(source, options) {
    // URL 模式：用 URL 目录作为 base
    if (typeof source === "string") {
        const u = new URL(source, location.href);
        u.hash = "";
        u.search = "";
        u.pathname = u.pathname.substring(0, u.pathname.lastIndexOf("/") + 1);
        return u.toString();
    }
    // File 模式：无法推导相对路径，交给 fileResolver
    return options.baseURL || "";
}

async function _loadAndParseMTL(source, mtllibs, options) {
    if (!mtllibs || mtllibs.length === 0) return null;

    const mats = {};
    // 可能多个 mtllib，这里逐个合并（后者覆盖同名）
    for (const lib of mtllibs) {
        const txt = await _resolveTextResource(lib, source, options);
        if (!txt) continue;
        const d = parseMTL(txt);
        Object.assign(mats, d);
    }
    return mats;
}

async function _resolveTextResource(relPath, source, options) {
    // 1) user resolver（最通用，适用于本地 File 组合导入）
    if (typeof options.fileResolver === "function") {
        // 期望返回：string / ArrayBuffer / Uint8Array / Blob / File
        const r = await options.fileResolver(relPath);
        if (!r) return null;
        if (typeof r === "string") return r;
        if (r instanceof ArrayBuffer) return new TextDecoder("utf-8").decode(new Uint8Array(r));
        if (r instanceof Uint8Array) return new TextDecoder("utf-8").decode(r);
        if (r && typeof r.text === "function") return await r.text();
        if (r && typeof r.arrayBuffer === "function") {
            const b = await r.arrayBuffer();
            return new TextDecoder("utf-8").decode(new Uint8Array(b));
        }
        return null;
    }

    // 2) URL 模式 fetch
    if (typeof source === "string") {
        const base = _getBaseURL(source, options);
        const url = new URL(relPath, base).toString();
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.text();
    }

    // 3) 无法解析
    return null;
}

async function _loadTexture2D(device, relPath, source, options) {
    // 1) resolver
    if (typeof options.fileResolver === "function") {
        const r = await options.fileResolver(relPath);
        if (!r) return null;

        // 如果直接给了 HTMLImageElement / ImageBitmap
        if (typeof ImageBitmap !== "undefined" && r instanceof ImageBitmap) {
            const tex = new Texture2D(device, { flipY: options.flipY ?? true });
            tex.setImage(r, { generateMipmap: true });
            return tex;
        }
        if (typeof HTMLImageElement !== "undefined" && r instanceof HTMLImageElement) {
            const tex = new Texture2D(device, { flipY: options.flipY ?? true });
            tex.setImage(r, { generateMipmap: true });
            return tex;
        }

        // Blob/File/ArrayBuffer/Uint8Array -> 生成 objectURL
        let blob = null;
        if (r instanceof Blob) blob = r;
        else if (r instanceof ArrayBuffer) blob = new Blob([r]);
        else if (r instanceof Uint8Array) blob = new Blob([r.buffer]);
        if (blob) {
            const url = URL.createObjectURL(blob);
            const img = await Assets.loadImage(url);
            URL.revokeObjectURL(url);
            const tex = new Texture2D(device, { flipY: options.flipY ?? true });
            tex.setImage(img, { generateMipmap: true });
            return tex;
        }
        return null;
    }

    // 2) URL 模式
    if (typeof source === "string") {
        const base = _getBaseURL(source, options);
        const url = new URL(relPath, base).toString();
        const img = await Assets.loadImage(url);
        const tex = new Texture2D(device, { flipY: options.flipY ?? true });
        tex.setImage(img, { generateMipmap: true });
        return tex;
    }

    return null;
}
 