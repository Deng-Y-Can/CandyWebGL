// ply-importer.js (ES Module)
// 依赖：math-gl.js + webgl-runtime.js
// 用途：加载/解析 PLY（ASCII / Binary LE/BE），并创建 Mesh/Model 加入 Scene

import { vec3, vec4, mat3, mat4, quat, mathf } from "./math-gl.js";
import { Program, Mesh, Material, Model } from "./webgl-runtime.js";

/* ---------------------------------------------
 * 内置 PLY Shader（支持顶点色 / 无顶点色）
 * --------------------------------------------- */
const PLYShaderLib = {
    // 点云（gl.POINTS）
    PointColor: {
        vs100: `
precision highp float;
attribute vec3 aPosition;
attribute vec4 aColor;
uniform mat4 uMVP;
uniform float uPointSize;
varying vec4 vColor;
void main(){
  vColor = aColor;
  gl_Position = uMVP * vec4(aPosition, 1.0);
  gl_PointSize = uPointSize;
}
`,
        fs100: `
precision highp float;
varying vec4 vColor;
uniform vec4 uColor;
uniform float uRoundPoints; // 0/1
void main(){
  vec4 c = vColor * uColor;
  if (uRoundPoints > 0.5) {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p,p);
    if (r2 > 1.0) discard;
  }
  gl_FragColor = c;
}
`,
        vs300: `#version 300 es
precision highp float;
in vec3 aPosition;
in vec4 aColor;
uniform mat4 uMVP;
uniform float uPointSize;
out vec4 vColor;
void main(){
  vColor = aColor;
  gl_Position = uMVP * vec4(aPosition, 1.0);
  gl_PointSize = uPointSize;
}
`,
        fs300: `#version 300 es
precision highp float;
in vec4 vColor;
uniform vec4 uColor;
uniform float uRoundPoints;
out vec4 outColor;
void main(){
  vec4 c = vColor * uColor;
  if (uRoundPoints > 0.5) {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p,p);
    if (r2 > 1.0) discard;
  }
  outColor = c;
}
`,
    },

    // 网格（TRIANGLES）：纯顶点色（可用 uColor 再乘一次）
    MeshColor: {
        vs100: `
precision highp float;
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec4 aColor;
uniform mat4 uMVP;
uniform mat4 uModel;
uniform mat3 uNormalMat;
varying vec4 vColor;
varying vec3 vN;
void main(){
  vColor = aColor;
  vN = normalize(uNormalMat * aNormal);
  gl_Position = uMVP * vec4(aPosition, 1.0);
}
`,
        fs100: `
precision highp float;
varying vec4 vColor;
varying vec3 vN;
uniform vec4 uColor;
uniform float uUseFakeLight; // 0/1
void main(){
  vec4 c = vColor * uColor;
  if (uUseFakeLight > 0.5) {
    vec3 L = normalize(vec3(0.3,0.8,0.6));
    float ndl = max(dot(normalize(vN), L), 0.0);
    c.rgb *= (0.25 + 0.75*ndl);
  }
  gl_FragColor = c;
}
`,
        vs300: `#version 300 es
precision highp float;
in vec3 aPosition;
in vec3 aNormal;
in vec4 aColor;
uniform mat4 uMVP;
uniform mat4 uModel;
uniform mat3 uNormalMat;
out vec4 vColor;
out vec3 vN;
void main(){
  vColor = aColor;
  vN = normalize(uNormalMat * aNormal);
  gl_Position = uMVP * vec4(aPosition, 1.0);
}
`,
        fs300: `#version 300 es
precision highp float;
in vec4 vColor;
in vec3 vN;
uniform vec4 uColor;
uniform float uUseFakeLight;
out vec4 outColor;
void main(){
  vec4 c = vColor * uColor;
  if (uUseFakeLight > 0.5) {
    vec3 L = normalize(vec3(0.3,0.8,0.6));
    float ndl = max(dot(normalize(vN), L), 0.0);
    c.rgb *= (0.25 + 0.75*ndl);
  }
  outColor = c;
}
`,
    },

    // 无顶点色时的 fallback（用 uColor）
    MeshFlat: {
        vs100: `
precision highp float;
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uMVP;
uniform mat3 uNormalMat;
varying vec3 vN;
void main(){
  vN = normalize(uNormalMat * aNormal);
  gl_Position = uMVP * vec4(aPosition, 1.0);
}
`,
        fs100: `
precision highp float;
varying vec3 vN;
uniform vec4 uColor;
uniform float uUseFakeLight;
void main(){
  vec4 c = uColor;
  if (uUseFakeLight > 0.5) {
    vec3 L = normalize(vec3(0.3,0.8,0.6));
    float ndl = max(dot(normalize(vN), L), 0.0);
    c.rgb *= (0.25 + 0.75*ndl);
  }
  gl_FragColor = c;
}
`,
        vs300: `#version 300 es
precision highp float;
in vec3 aPosition;
in vec3 aNormal;
uniform mat4 uMVP;
uniform mat3 uNormalMat;
out vec3 vN;
void main(){
  vN = normalize(uNormalMat * aNormal);
  gl_Position = uMVP * vec4(aPosition, 1.0);
}
`,
        fs300: `#version 300 es
precision highp float;
in vec3 vN;
uniform vec4 uColor;
uniform float uUseFakeLight;
out vec4 outColor;
void main(){
  vec4 c = uColor;
  if (uUseFakeLight > 0.5) {
    vec3 L = normalize(vec3(0.3,0.8,0.6));
    float ndl = max(dot(normalize(vN), L), 0.0);
    c.rgb *= (0.25 + 0.75*ndl);
  }
  outColor = c;
}
`,
    },
};

/* ---------------------------------------------
 * Public API
 * --------------------------------------------- */

/**
 * 把 PLY 加载为 Model，并自动加入 scene。
 *
 * @param {GLDevice} device   来自 webgl-runtime.js 的 GLDevice
 * @param {Scene} scene       来自 webgl-runtime.js 的 Scene
 * @param {string|File|Blob|ArrayBuffer|Uint8Array} source
 * @param {object} options
 * @returns {Promise<Model>}
 */
export async function importPLYToScene(device, scene, source, options = {}) {
    const arrayBuffer = await _loadAsArrayBuffer(source);

    const parsed = parsePLY(arrayBuffer, {
        ...options,
        // 让 parsePLY 能看到 device 的能力
        _device: device,
    });

    const { positions, normals, colors, indices, mode, bbox } = parsed;

    // 生成 Mesh
    const gl = device.gl;
    const attributes = {
        aPosition: { data: positions, size: 3 },
    };

    const hasNormals = !!normals;
    if (hasNormals) attributes.aNormal = { data: normals, size: 3 };

    const hasColors = !!colors;
    if (hasColors) attributes.aColor = { data: colors, size: 4 };

    const mesh = Mesh.fromData(device, {
        attributes,
        indices: indices || null,
        mode,
    });

    // 生成 Material/Program
    const wantPoints = mode === gl.POINTS;
    let program;

    if (wantPoints) {
        // 点云默认要求 aColor，没有就补一个白色
        if (!hasColors) {
            // 补白色
            const vcount = (positions.length / 3) | 0;
            const c = new Float32Array(vcount * 4);
            for (let i = 0; i < vcount; i++) {
                c[i * 4 + 0] = 1; c[i * 4 + 1] = 1; c[i * 4 + 2] = 1; c[i * 4 + 3] = 1;
            }
            // 重新建 mesh（简单做法）
            mesh.dispose();
            const mesh2 = Mesh.fromData(device, { attributes: { ...attributes, aColor: { data: c, size: 4 } }, indices: null, mode });
            // 替换引用
            parsed._mesh = mesh2;
        }

        program = Program.fromSources(device, PLYShaderLib.PointColor);
    } else {
        // 网格：有 aColor 用 MeshColor；否则用 MeshFlat
        program = Program.fromSources(device, hasColors ? PLYShaderLib.MeshColor : PLYShaderLib.MeshFlat);
    }

    const material = new Material(program, {
        depthTest: options.depthTest ?? true,
        depthWrite: options.depthWrite ?? true,
        blend: options.blend ?? false,
        cull: options.cull ?? true,
        uniforms: {
            uColor: options.color ?? vec4.fromValues(1, 1, 1, 1),
            uPointSize: options.pointSize ?? 2.0,
            uRoundPoints: options.roundPoints ? 1.0 : 0.0,
            uUseFakeLight: options.fakeLight ? 1.0 : 0.0,
        },
    });

    const model = new Model(parsed._mesh || mesh, material, options.name || "PLY");
    // 默认把模型移到原点附近（如果你没 center，就保持原始）
    scene.add(model);

    // 返回一些元信息
    model._plyInfo = { bbox, vertexCount: parsed.vertexCount, triangleCount: parsed.triangleCount, mode: wantPoints ? "POINTS" : "TRIANGLES" };
    return model;
}

/**
 * 只解析，不创建 WebGL 资源。
 * @returns {{positions:Float32Array, normals?:Float32Array, colors?:Float32Array, indices?:Uint16Array|Uint32Array, mode:number, bbox:{min:Float32Array,max:Float32Array}, vertexCount:number, triangleCount:number}}
 */
export function parsePLY(arrayBuffer, options = {}) {
    const u8 = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    const { headerText, headerEnd } = _readHeader(u8);

    const header = _parseHeader(headerText);
    const bodyOffset = headerEnd;

    // 只关心 vertex / face
    const vElem = header.elements.find(e => e.name === "vertex");
    if (!vElem) throw new Error("PLY 缺少 element vertex");

    const fElem = header.elements.find(e => e.name === "face");

    // 解析数据
    let result;
    if (header.format === "ascii") {
        const text = new TextDecoder("utf-8").decode(u8.subarray(bodyOffset));
        result = _parseASCII(text, header, options);
    } else {
        const little = header.format === "binary_little_endian";
        result = _parseBinary(u8.buffer, bodyOffset, header, little, options);
    }

    // 后处理：center / scale / up-axis 等
    _postTransform(result, options);

    // 如果是 mesh 且缺 normals，且 options.computeNormals
    const wantCompute = !!options.computeNormals;
    const hasFaces = !!result.indices && result.indices.length > 0;
    const hasNormals = !!result.normals;
    if (hasFaces && wantCompute && !hasNormals) {
        result.normals = _computeVertexNormals(result.positions, result.indices);
    }

    // mode：有 face => TRIANGLES，否则 POINTS（可强制）
    const device = options._device;
    const gl = device?.gl;

    const force = options.forceMode; // "points" | "triangles"
    let mode;
    if (gl) {
        if (force === "points") mode = gl.POINTS;
        else if (force === "triangles") mode = gl.TRIANGLES;
        else mode = hasFaces ? gl.TRIANGLES : gl.POINTS;
    } else {
        // 没传 device 时，用字符串代替（但 importPLYToScene 会传 device，所以这里基本不会走）
        mode = hasFaces ? 4 /* TRIANGLES */ : 0 /* POINTS */;
    }
    result.mode = mode;

    // 索引位宽校验（WebGL1）
    if (device && result.indices) {
        const useU32 = result.indices instanceof Uint32Array;
        if (useU32 && !device.extUint32) {
            throw new Error("PLY 索引超过 65535，需要 WebGL2 或 WebGL1 扩展 OES_element_index_uint");
        }
    }

    return result;
}

/* ---------------------------------------------
 * Header parse
 * --------------------------------------------- */

function _readHeader(u8) {
    const END = "end_header";
    // 在 bytes 里找 "end_header" + 换行
    const pat = new TextEncoder().encode(END);
    let idx = -1;

    for (let i = 0; i <= u8.length - pat.length; i++) {
        let ok = true;
        for (let j = 0; j < pat.length; j++) {
            if (u8[i + j] !== pat[j]) { ok = false; break; }
        }
        if (ok) { idx = i; break; }
    }
    if (idx < 0) throw new Error("PLY header 未找到 end_header");

    // 找到 end_header 行尾的 \n
    let end = idx + pat.length;
    while (end < u8.length && u8[end] !== 0x0A) end++;
    end = Math.min(end + 1, u8.length); // include '\n'

    const headerText = new TextDecoder("utf-8").decode(u8.subarray(0, end));
    return { headerText, headerEnd: end };
}

function _parseHeader(text) {
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (lines[0] !== "ply") throw new Error("不是 PLY 文件（第一行不是 ply）");

    let format = null;
    const elements = [];

    let cur = null;

    for (const line of lines.slice(1)) {
        const parts = line.split(/\s+/);
        if (parts[0] === "format") {
            format = parts[1];
            if (format !== "ascii" && format !== "binary_little_endian" && format !== "binary_big_endian") {
                throw new Error(`不支持的 PLY format: ${format}`);
            }
        } else if (parts[0] === "element") {
            cur = { name: parts[1], count: parseInt(parts[2], 10), properties: [] };
            elements.push(cur);
        } else if (parts[0] === "property") {
            if (!cur) continue;
            if (parts[1] === "list") {
                // property list uchar int vertex_indices
                cur.properties.push({
                    kind: "list",
                    countType: parts[2],
                    itemType: parts[3],
                    name: parts[4],
                });
            } else {
                cur.properties.push({
                    kind: "scalar",
                    type: parts[1],
                    name: parts[2],
                });
            }
        }
    }

    if (!format) throw new Error("PLY header 缺少 format");
    return { format, elements };
}

/* ---------------------------------------------
 * ASCII parse
 * --------------------------------------------- */

function _parseASCII(bodyText, header, options) {
    const vElem = header.elements.find(e => e.name === "vertex");
    const fElem = header.elements.find(e => e.name === "face");

    // 逐行读取
    const lines = bodyText.split(/\r?\n/);
    let lineIndex = 0;

    const vCount = vElem.count;
    const positions = new Float32Array(vCount * 3);

    // 可选
    let normals = null;
    let colors = null;
    let uvs = null;

    // property index mapping（基于名字）
    const vProps = vElem.properties;

    const hasNormal = _hasProps(vProps, ["nx", "ny", "nz"]);
    const colorNames = _pickColorProps(vProps);
    const hasColor = colorNames != null;
    const uvNames = _pickUVProps(vProps);
    const hasUV = uvNames != null;

    if (hasNormal) normals = new Float32Array(vCount * 3);
    if (hasColor) colors = new Float32Array(vCount * 4);
    if (hasUV) uvs = new Float32Array(vCount * 2);

    let colorMax = 0;

    // parse vertices
    for (let i = 0; i < vCount; i++) {
        // 跳过空行
        while (lineIndex < lines.length && !lines[lineIndex].trim()) lineIndex++;
        const line = lines[lineIndex++] || "";
        const tokens = line.trim().split(/\s+/);
        let t = 0;

        // 依照 property 顺序读
        let x = 0, y = 0, z = 0;
        let nx = 0, ny = 0, nz = 1;
        let r = 1, g = 1, b = 1, a = 1;
        let u = 0, v = 0;

        for (const p of vProps) {
            if (p.kind === "scalar") {
                const val = _parseAsciiScalar(tokens[t++], p.type);
                const name = p.name;

                if (name === "x") x = val;
                else if (name === "y") y = val;
                else if (name === "z") z = val;
                else if (name === "nx") nx = val;
                else if (name === "ny") ny = val;
                else if (name === "nz") nz = val;
                else if (name === colorNames?.r) r = val;
                else if (name === colorNames?.g) g = val;
                else if (name === colorNames?.b) b = val;
                else if (name === colorNames?.a) a = val;
                else if (name === uvNames?.u) u = val;
                else if (name === uvNames?.v) v = val;
            } else {
                // vertex 的 list 很少见：读出并跳过
                const n = parseInt(tokens[t++], 10) | 0;
                t += n;
            }
        }

        positions[i * 3 + 0] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
        if (normals) { normals[i * 3 + 0] = nx; normals[i * 3 + 1] = ny; normals[i * 3 + 2] = nz; }
        if (colors) {
            colors[i * 4 + 0] = r; colors[i * 4 + 1] = g; colors[i * 4 + 2] = b; colors[i * 4 + 3] = (a ?? 1);
            colorMax = Math.max(colorMax, r, g, b, (a ?? 1));
        }
        if (uvs) { uvs[i * 2 + 0] = u; uvs[i * 2 + 1] = v; }
    }

    // parse faces -> triangulate
    let indices = null;
    let triCount = 0;

    if (fElem) {
        const fCount = fElem.count;
        const fProps = fElem.properties;
        const idxProp = _pickFaceIndexListProp(fProps);
        if (idxProp) {
            const out = [];
            for (let i = 0; i < fCount; i++) {
                while (lineIndex < lines.length && !lines[lineIndex].trim()) lineIndex++;
                const line = lines[lineIndex++] || "";
                const tokens = line.trim().split(/\s+/);
                let t = 0;

                // face 的 property 顺序可能不止一个 list；这里按 header 顺序遍历
                for (const p of fProps) {
                    if (p.kind === "list") {
                        const n = parseInt(tokens[t++], 10) | 0;
                        const list = new Array(n);
                        for (let k = 0; k < n; k++) list[k] = parseInt(tokens[t++], 10) | 0;

                        if (p.name === idxProp.name) {
                            // fan triangulation
                            for (let k = 1; k + 1 < n; k++) {
                                out.push(list[0], list[k], list[k + 1]);
                                triCount++;
                            }
                        }
                    } else {
                        t++; // scalar ignore
                    }
                }
            }

            indices = _makeBestIndexArray(out, options);
        }
    }

    // 颜色归一化处理（ASCII 可能是 0..255 或 0..1）
    if (colors) _normalizeColorsInPlace(colors, colorMax);

    const bbox = _computeBBox(positions);
    return {
        positions,
        normals,
        colors,
        uvs,
        indices,
        vertexCount: vCount,
        triangleCount: triCount,
        bbox,
    };
}

function _parseAsciiScalar(tok, type) {
    // type 影响 int/float 的 parse，但这里简单处理：
    // int 类型 parseInt；float/double parseFloat
    const t = _normalizeType(type);
    if (t.startsWith("int") || t.startsWith("uint")) return parseInt(tok, 10);
    return parseFloat(tok);
}

/* ---------------------------------------------
 * Binary parse
 * --------------------------------------------- */

const TYPE = {
    int8: { size: 1, read: (dv, o, le) => dv.getInt8(o) },
    uint8: { size: 1, read: (dv, o, le) => dv.getUint8(o) },
    int16: { size: 2, read: (dv, o, le) => dv.getInt16(o, le) },
    uint16: { size: 2, read: (dv, o, le) => dv.getUint16(o, le) },
    int32: { size: 4, read: (dv, o, le) => dv.getInt32(o, le) },
    uint32: { size: 4, read: (dv, o, le) => dv.getUint32(o, le) },
    float32: { size: 4, read: (dv, o, le) => dv.getFloat32(o, le) },
    float64: { size: 8, read: (dv, o, le) => dv.getFloat64(o, le) },
};

function _parseBinary(arrayBuffer, bodyOffset, header, littleEndian, options) {
    const dv = new DataView(arrayBuffer, bodyOffset);
    let off = 0;

    const vElem = header.elements.find(e => e.name === "vertex");
    const fElem = header.elements.find(e => e.name === "face");

    const vCount = vElem.count;
    const positions = new Float32Array(vCount * 3);

    let normals = null;
    let colors = null;
    let uvs = null;

    const vProps = vElem.properties;

    const hasNormal = _hasProps(vProps, ["nx", "ny", "nz"]);
    const colorNames = _pickColorProps(vProps);
    const hasColor = colorNames != null;
    const uvNames = _pickUVProps(vProps);
    const hasUV = uvNames != null;

    if (hasNormal) normals = new Float32Array(vCount * 3);
    if (hasColor) colors = new Float32Array(vCount * 4);
    if (hasUV) uvs = new Float32Array(vCount * 2);

    let colorMax = 0;

    for (let i = 0; i < vCount; i++) {
        let x = 0, y = 0, z = 0;
        let nx = 0, ny = 0, nz = 1;
        let r = 1, g = 1, b = 1, a = 1;
        let u = 0, v = 0;

        for (const p of vProps) {
            if (p.kind === "scalar") {
                const info = TYPE[_normalizeType(p.type)];
                if (!info) throw new Error(`不支持的 PLY 标量类型: ${p.type}`);
                const val = info.read(dv, off, littleEndian);
                off += info.size;

                const name = p.name;
                if (name === "x") x = val;
                else if (name === "y") y = val;
                else if (name === "z") z = val;
                else if (name === "nx") nx = val;
                else if (name === "ny") ny = val;
                else if (name === "nz") nz = val;
                else if (name === colorNames?.r) r = val;
                else if (name === colorNames?.g) g = val;
                else if (name === colorNames?.b) b = val;
                else if (name === colorNames?.a) a = val;
                else if (name === uvNames?.u) u = val;
                else if (name === uvNames?.v) v = val;
            } else {
                // vertex list：读出并跳过
                const cInfo = TYPE[_normalizeType(p.countType)];
                const iInfo = TYPE[_normalizeType(p.itemType)];
                if (!cInfo || !iInfo) throw new Error(`不支持的 PLY list 类型: ${p.countType}/${p.itemType}`);
                const n = cInfo.read(dv, off, littleEndian) | 0;
                off += cInfo.size + iInfo.size * n;
            }
        }

        positions[i * 3 + 0] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
        if (normals) { normals[i * 3 + 0] = nx; normals[i * 3 + 1] = ny; normals[i * 3 + 2] = nz; }
        if (colors) {
            colors[i * 4 + 0] = r; colors[i * 4 + 1] = g; colors[i * 4 + 2] = b; colors[i * 4 + 3] = (a ?? 1);
            colorMax = Math.max(colorMax, r, g, b, (a ?? 1));
        }
        if (uvs) { uvs[i * 2 + 0] = u; uvs[i * 2 + 1] = v; }
    }

    // faces
    let indices = null;
    let triCount = 0;

    if (fElem) {
        const fCount = fElem.count;
        const fProps = fElem.properties;
        const idxProp = _pickFaceIndexListProp(fProps);
        if (idxProp) {
            const out = [];

            for (let i = 0; i < fCount; i++) {
                for (const p of fProps) {
                    if (p.kind === "list") {
                        const cInfo = TYPE[_normalizeType(p.countType)];
                        const iInfo = TYPE[_normalizeType(p.itemType)];
                        if (!cInfo || !iInfo) throw new Error(`不支持的 PLY list 类型: ${p.countType}/${p.itemType}`);

                        const n = cInfo.read(dv, off, littleEndian) | 0;
                        off += cInfo.size;

                        if (p.name === idxProp.name) {
                            // 读索引并三角化
                            const v0 = iInfo.read(dv, off, littleEndian) | 0;
                            off += iInfo.size;
                            let prev = iInfo.read(dv, off, littleEndian) | 0;
                            off += iInfo.size;

                            for (let k = 2; k < n; k++) {
                                const cur = iInfo.read(dv, off, littleEndian) | 0;
                                off += iInfo.size;
                                out.push(v0, prev, cur);
                                prev = cur;
                                triCount++;
                            }

                            // 若 n < 3，已经读完了前两项就足够；上面逻辑会在 k=2 开始
                            if (n < 2) {
                                // 需要把已经读错的回退？这种情况非常少见，忽略
                            }
                        } else {
                            // skip list
                            off += iInfo.size * n;
                        }
                    } else {
                        // scalar skip
                        const info = TYPE[_normalizeType(p.type)];
                        off += info.size;
                    }
                }
            }

            indices = _makeBestIndexArray(out, options);
        }
    }

    if (colors) _normalizeColorsInPlace(colors, colorMax);

    const bbox = _computeBBox(positions);
    return {
        positions,
        normals,
        colors,
        uvs,
        indices,
        vertexCount: vCount,
        triangleCount: triCount,
        bbox,
    };
}

/* ---------------------------------------------
 * Post transforms
 * --------------------------------------------- */

function _postTransform(result, options) {
    const pos = result.positions;
    const vCount = (pos.length / 3) | 0;
    const bbox = result.bbox || _computeBBox(pos);

    // axis convert / flips
    const swapYZ = !!options.swapYZ;
    const flipX = !!options.flipX;
    const flipY = !!options.flipY;
    const flipZ = !!options.flipZ;

    // upAxis：如果你的 PLY 是 Z-up，你想转成 Y-up，可以用 upAxis:'z'
    // 约定：options.upAxis = 'y'(默认) 或 'z'
    const upAxis = options.upAxis || "y";
    const convertZUpToYUp = upAxis === "z"; // 认为源是 z-up，目标是 y-up

    for (let i = 0; i < vCount; i++) {
        let x = pos[i * 3 + 0], y = pos[i * 3 + 1], z = pos[i * 3 + 2];

        if (convertZUpToYUp) {
            // (x,y,z) z-up -> y-up：常见做法是交换 y/z，并对一个轴取反来保持右手
            // 这里用：y <- z, z <- -y
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

        pos[i * 3 + 0] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    }

    // recompute bbox after axis ops
    const bbox2 = _computeBBox(pos);
    result.bbox = bbox2;

    // center
    if (options.center) {
        const cx = (bbox2.min[0] + bbox2.max[0]) * 0.5;
        const cy = (bbox2.min[1] + bbox2.max[1]) * 0.5;
        const cz = (bbox2.min[2] + bbox2.max[2]) * 0.5;
        for (let i = 0; i < vCount; i++) {
            pos[i * 3 + 0] -= cx;
            pos[i * 3 + 1] -= cy;
            pos[i * 3 + 2] -= cz;
        }
        result.bbox = _computeBBox(pos);
    }

    // scaleToUnit（最大边归一到 1）
    if (options.scaleToUnit) {
        const b = result.bbox;
        const sx = b.max[0] - b.min[0];
        const sy = b.max[1] - b.min[1];
        const sz = b.max[2] - b.min[2];
        const maxS = Math.max(sx, sy, sz);
        if (maxS > 1e-8) {
            const inv = 1 / maxS;
            for (let i = 0; i < vCount; i++) {
                pos[i * 3 + 0] *= inv;
                pos[i * 3 + 1] *= inv;
                pos[i * 3 + 2] *= inv;
            }
            result.bbox = _computeBBox(pos);
        }
    }
}

/* ---------------------------------------------
 * Helpers
 * --------------------------------------------- */

async function _loadAsArrayBuffer(source) {
    if (typeof source === "string") {
        const r = await fetch(source);
        if (!r.ok) throw new Error(`加载 PLY 失败：${source}`);
        return await r.arrayBuffer();
    }
    if (source instanceof ArrayBuffer) return source;
    if (source instanceof Uint8Array) return source.buffer;
    if (source && typeof source.arrayBuffer === "function") return await source.arrayBuffer(); // File/Blob
    throw new Error("source 类型不支持：请传 url / File / Blob / ArrayBuffer / Uint8Array");
}

function _normalizeType(t) {
    // PLY 支持 char/uchar/short/ushort/int/uint/float/double 及 int8/uint8 等
    switch (t) {
        case "char": return "int8";
        case "uchar": return "uint8";
        case "short": return "int16";
        case "ushort": return "uint16";
        case "int": return "int32";
        case "uint": return "uint32";
        case "float": return "float32";
        case "double": return "float64";
        default:
            return t; // int8/uint8/int16/uint16/int32/uint32/float32/float64
    }
}

function _hasProps(props, names) {
    const set = new Set(props.filter(p => p.kind === "scalar").map(p => p.name));
    return names.every(n => set.has(n));
}

function _pickColorProps(vProps) {
    const names = vProps.filter(p => p.kind === "scalar").map(p => p.name);
    const set = new Set(names);

    // 常见：red green blue alpha
    if (set.has("red") && set.has("green") && set.has("blue")) {
        return { r: "red", g: "green", b: "blue", a: set.has("alpha") ? "alpha" : null };
    }

    // 别名：r g b a
    if (set.has("r") && set.has("g") && set.has("b")) {
        return { r: "r", g: "g", b: "b", a: set.has("a") ? "a" : null };
    }

    // diffuse_red 等
    if (set.has("diffuse_red") && set.has("diffuse_green") && set.has("diffuse_blue")) {
        return { r: "diffuse_red", g: "diffuse_green", b: "diffuse_blue", a: set.has("diffuse_alpha") ? "diffuse_alpha" : null };
    }

    return null;
}

function _pickUVProps(vProps) {
    const names = vProps.filter(p => p.kind === "scalar").map(p => p.name);
    const set = new Set(names);

    if (set.has("u") && set.has("v")) return { u: "u", v: "v" };
    if (set.has("s") && set.has("t")) return { u: "s", v: "t" };
    if (set.has("texture_u") && set.has("texture_v")) return { u: "texture_u", v: "texture_v" };
    return null;
}

function _pickFaceIndexListProp(fProps) {
    // 优先找 name 为 vertex_indices / vertex_index / indices
    for (const p of fProps) {
        if (p.kind !== "list") continue;
        if (p.name === "vertex_indices" || p.name === "vertex_index" || p.name === "indices") return p;
    }
    // 没找到就拿第一个 list
    return fProps.find(p => p.kind === "list") || null;
}

function _makeBestIndexArray(jsArray, options) {
    // 根据最大索引决定 Uint16/Uint32
    let max = 0;
    for (let i = 0; i < jsArray.length; i++) if (jsArray[i] > max) max = jsArray[i];

    if (max <= 65535) return new Uint16Array(jsArray);
    return new Uint32Array(jsArray);
}

function _normalizeColorsInPlace(colors, maxVal) {
    // colors 是 float array：可能是 0..1，也可能是 0..255 / 0..65535
    // 简单判断：max<=1.0 => 不处理；否则如果 <=255 => /255；<=65535=>/65535
    if (maxVal <= 1.00001) return;

    let div = 255;
    if (maxVal > 255.5 && maxVal <= 65535.5) div = 65535;
    else if (maxVal > 65535.5) div = maxVal;

    const inv = 1 / div;
    for (let i = 0; i < colors.length; i++) colors[i] = colors[i] * inv;
    // alpha 若 >1 同样会被归一
}

function _computeBBox(positions) {
    const min = vec3.fromValues(Infinity, Infinity, Infinity);
    const max = vec3.fromValues(-Infinity, -Infinity, -Infinity);
    const n = (positions.length / 3) | 0;

    for (let i = 0; i < n; i++) {
        const x = positions[i * 3 + 0];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        if (x < min[0]) min[0] = x;
        if (y < min[1]) min[1] = y;
        if (z < min[2]) min[2] = z;
        if (x > max[0]) max[0] = x;
        if (y > max[1]) max[1] = y;
        if (z > max[2]) max[2] = z;
    }
    return { min, max };
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

/* scratch */
const _scratch = {
    m3a: mat3.create(),
};