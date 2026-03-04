// usd-importer.js (ES Module)
// 纯解析工具：不依赖 gl，不创建 Mesh/Model
// 重点支持：USDA(ASCII) 的常见 Mesh（points/faceVertexCounts/faceVertexIndices + normals/displayColor）
// 对于 .usd/.usdc/.usdz（二进制/压缩）：需要 options.binaryParser（WASM/外部解析器）或离线转换为 .usda/.glb
//
// 输出统一 Geometry：
// {
//   format: "usda" | "usd-binary",
//   submeshes: Array<{
//     name: string,
//     positions: Float32Array,
//     normals: Float32Array|null,
//     colors: Float32Array|null,      // RGBA 0..1
//     indices: Uint16Array|Uint32Array, // 三角形索引（顺序）
//     bbox: {min: Float32Array, max: Float32Array},
//     vertexCount: number,
//     triangleCount: number
//   }>,
//   bbox: {min: Float32Array, max: Float32Array},
//   vertexCount: number,
//   triangleCount: number
// }

import { vec3 } from "./math-gl.js";

const _numRe = /[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g;

export async function parseUSD(source, options = {}) {
    const opt = {
        center: options.center ?? false,
        scaleToUnit: options.scaleToUnit ?? false,
        computeNormals: options.computeNormals ?? true,
        defaultColor: options.defaultColor ?? [1, 1, 1, 1],
        forceUint32: options.forceUint32 ?? false,

        // 如果要支持 .usd/.usdc/.usdz，请传入 binaryParser:
        // async (arrayBuffer, options) => return parseUSD(...) same shape
        binaryParser: options.binaryParser ?? null,
    };

    // 1) 读取为 ArrayBuffer / text
    let buf = null;
    let text = null;

    if (typeof source === "string") {
        // 可能是 URL，也可能是 USDA 文本
        if (_looksLikeUSDA(source)) {
            text = source;
        } else {
            const r = await fetch(source);
            if (!r.ok) throw new Error(`USD URL 加载失败：HTTP ${r.status}`);
            // 先读一点点判断
            const ab = await r.arrayBuffer();
            buf = ab;
        }
    } else if (source instanceof ArrayBuffer) {
        buf = source;
    } else if (source instanceof Uint8Array) {
        buf = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    } else if (source && typeof source.arrayBuffer === "function") {
        buf = await source.arrayBuffer();
    } else {
        throw new Error("parseUSD：不支持的 source 类型（请传 ArrayBuffer/Uint8Array/string/Blob/File）");
    }

    // 2) 判断是不是 USDA
    if (!text && buf) {
        const head = _peekText(buf, 256).toLowerCase();
        // USDA 典型：以 "#usda" 开头
        if (head.includes("#usda") || _looksLikeUSDA(head)) {
            text = new TextDecoder("utf-8").decode(new Uint8Array(buf));
            buf = null;
        }
    }

    // 3) USDA 解析
    if (text) {
        const res = _parseUSDA(text, opt);
        return res;
    }

    // 4) 二进制 USD/USDC/USDZ 处理：需要 binaryParser
    if (buf) {
        if (typeof opt.binaryParser === "function") {
            return await opt.binaryParser(buf, opt);
        }
        throw new Error(
            "当前 usd-importer.js 仅纯 JS 支持 USDA(ASCII)。\n" +
            "你传入的是二进制 USD/USDC/USDZ（.usd/.usdc/.usdz）。\n" +
            "解决方案：\n" +
            "1) 离线把 USD 转为 USDA 或 GLB（推荐：GLB），然后用 glTF/GLB importer。\n" +
            "2) 或者提供 options.binaryParser（WASM/外部解析器）来解析二进制 USD。"
        );
    }

    throw new Error("USD 解析失败：未知输入状态");
}

/* ---------------------------------- */
/* USDA(ASCII) 解析核心               */
/* ---------------------------------- */

function _parseUSDA(text, opt) {
    const meshes = _extractDefBlocks(text, "Mesh"); // [{name, body}]
    if (!meshes.length) {
        throw new Error("USDA 解析失败：未找到 `def Mesh` 块（或文件不是 USDA）");
    }

    const submeshes = [];
    let globalBBox = null;
    let vSum = 0;
    let triSum = 0;

    for (const m of meshes) {
        const geo = _parseMeshBlockToGeometry(m.name, m.body, opt);
        if (!geo) continue;

        submeshes.push(geo);
        globalBBox = _unionBBox(globalBBox, geo.bbox);
        vSum += geo.vertexCount;
        triSum += geo.triangleCount;
    }

    if (!submeshes.length) {
        throw new Error("USDA 解析失败：Mesh 块存在，但未能提取出可用网格数据（缺 points/faceVertexCounts/faceVertexIndices？）");
    }

    return {
        format: "usda",
        submeshes,
        bbox: globalBBox ?? _emptyBBox(),
        vertexCount: vSum,
        triangleCount: triSum
    };
}

/**
 * 从 Mesh block 提取 points/faceVertexCounts/faceVertexIndices，并尽量兼容 normals/displayColor。
 * 为了最大兼容性：输出为“展开后的三角形顶点流”（每个三角形 3 顶点），然后给顺序 indices。
 */
function _parseMeshBlockToGeometry(name, body, opt) {
    // points
    const pointsStr = _getAssignedContainer(body, "points");
    const countsStr = _getAssignedContainer(body, "faceVertexCounts");
    const indicesStr = _getAssignedContainer(body, "faceVertexIndices");

    if (!pointsStr || !countsStr || !indicesStr) return null;

    const pointsNums = _parseNumbers(pointsStr);
    const countsNums = _parseNumbers(countsStr).map(x => x | 0);
    const fviNums = _parseNumbers(indicesStr).map(x => x | 0);

    if (pointsNums.length < 3 || countsNums.length === 0 || fviNums.length === 0) return null;

    const pointCount = (pointsNums.length / 3) | 0;
    const points = new Float32Array(pointCount * 3);
    for (let i = 0; i < pointCount * 3; i++) points[i] = pointsNums[i];

    // normals：可能是 normals 或 primvars:normals
    const normalsStr =
        _getAssignedContainer(body, "normals") ??
        _getAssignedContainer(body, "primvars:normals");

    // normals indices：可能是 normals:indices 或 primvars:normals:indices
    const nIdxStr =
        _getAssignedContainer(body, "normals:indices") ??
        _getAssignedContainer(body, "primvars:normals:indices");

    let normals = null;
    let nIndices = null;

    if (normalsStr) {
        const nNums = _parseNumbers(normalsStr);
        if (nNums.length >= 3) {
            const nCount = (nNums.length / 3) | 0;
            normals = new Float32Array(nCount * 3);
            for (let i = 0; i < nCount * 3; i++) normals[i] = nNums[i];
        }
    }
    if (nIdxStr) {
        const ni = _parseNumbers(nIdxStr).map(x => x | 0);
        if (ni.length) nIndices = ni;
    }

    // displayColor：一般是 primvars:displayColor（color3f[]），也可能是 displayColor
    const colorStr =
        _getAssignedContainer(body, "primvars:displayColor") ??
        _getAssignedContainer(body, "displayColor");

    const cIdxStr =
        _getAssignedContainer(body, "primvars:displayColor:indices") ??
        _getAssignedContainer(body, "displayColor:indices");

    let colors = null;      // color3f array
    let cIndices = null;

    if (colorStr) {
        const cNums = _parseNumbers(colorStr);
        if (cNums.length >= 3) {
            const cCount = (cNums.length / 3) | 0;
            colors = new Float32Array(cCount * 3);
            for (let i = 0; i < cCount * 3; i++) colors[i] = cNums[i];
        }
    }
    if (cIdxStr) {
        const ci = _parseNumbers(cIdxStr).map(x => x | 0);
        if (ci.length) cIndices = ci;
    }

    // triangulate + expand
    const posOut = [];
    const nrmOut = [];
    const colOut = [];

    const defC = opt.defaultColor;

    let fviOffset = 0;
    let triCount = 0;

    const faceVertexCountTotal = countsNums.reduce((a, b) => a + b, 0);
    // faceVertexIndices 通常应 >= faceVertexCountTotal
    // 不足就尽量用 min 兜底
    const maxFvi = Math.min(fviNums.length, faceVertexCountTotal);

    for (let fi = 0; fi < countsNums.length; fi++) {
        const c = countsNums[fi] | 0;
        if (c < 3) { fviOffset += c; continue; }
        if (fviOffset >= maxFvi) break;

        const base = fviOffset;
        const end = Math.min(fviOffset + c, maxFvi);

        // 这个 face 的顶点索引列表（指向 points）
        const face = fviNums.slice(base, end);

        // fan triangulation: (0,i,i+1)
        for (let i = 1; i < face.length - 1; i++) {
            const corners = [0, i, i + 1];
            triCount++;

            for (let k = 0; k < 3; k++) {
                const local = corners[k];
                const fvIndex = base + local;          // face-vertex 全局索引
                const pIndex = face[local] | 0;

                // position
                const px = points[pIndex * 3 + 0] ?? 0;
                const py = points[pIndex * 3 + 1] ?? 0;
                const pz = points[pIndex * 3 + 2] ?? 0;
                posOut.push(px, py, pz);

                // normal（尽量匹配不同写法）
                if (normals) {
                    const ni = _resolveAttrIndex({
                        attrCount: (normals.length / 3) | 0,
                        pointIndex: pIndex,
                        faceVertexIndex: fvIndex,
                        faceVertexIndexTotal: maxFvi,
                        indices: nIndices
                    });
                    const nx = normals[ni * 3 + 0] ?? 0;
                    const ny = normals[ni * 3 + 1] ?? 1;
                    const nz = normals[ni * 3 + 2] ?? 0;
                    nrmOut.push(nx, ny, nz);
                }

                // color（color3f -> RGBA）
                if (colors) {
                    const ci = _resolveAttrIndex({
                        attrCount: (colors.length / 3) | 0,
                        pointIndex: pIndex,
                        faceVertexIndex: fvIndex,
                        faceVertexIndexTotal: maxFvi,
                        indices: cIndices
                    });
                    const r = colors[ci * 3 + 0] ?? defC[0];
                    const g = colors[ci * 3 + 1] ?? defC[1];
                    const b = colors[ci * 3 + 2] ?? defC[2];
                    colOut.push(r, g, b, defC[3] ?? 1);
                } else {
                    // 没颜色：默认色
                    colOut.push(defC[0], defC[1], defC[2], defC[3] ?? 1);
                }
            }
        }

        fviOffset += c;
    }

    if (posOut.length === 0 || triCount === 0) return null;

    // typed arrays
    let positions = new Float32Array(posOut);
    let normalsOutArr = normals ? new Float32Array(nrmOut) : null;
    let colorsOutArr = new Float32Array(colOut);

    // 若没有 normals 或要求 computeNormals，则计算
    if (opt.computeNormals) {
        normalsOutArr = _computeNormalsForTriList(positions);
    } else if (normalsOutArr) {
        _normalizeNormals(normalsOutArr);
    }

    // bbox
    let bbox = _computeBBox(positions);

    // center / scaleToUnit
    if (opt.center || opt.scaleToUnit) {
        const t = _makeCenterScaleTransform(bbox, opt.center, opt.scaleToUnit);
        _applyPosTransform(positions, t);
        if (normalsOutArr) _normalizeNormals(normalsOutArr);
        bbox = _computeBBox(positions);
    }

    const vertexCount = (positions.length / 3) | 0;
    const indices = _makeSequentialIndices(vertexCount, opt.forceUint32);

    return {
        name,
        positions,
        normals: normalsOutArr,
        colors: colorsOutArr,
        indices,
        bbox,
        vertexCount,
        triangleCount: triCount
    };
}

/**
 * 解析 attribute 的“索引来源”：
 * - 如果 indices 存在且长度 == faceVertexIndexTotal：按 indices[faceVertexIndex]
 * - 否则如果 attrCount == pointsCount：按 pointIndex
 * - 否则如果 attrCount == faceVertexIndexTotal：按 faceVertexIndex（直接 faceVarying 无 indices）
 * - 否则 fallback 0
 */
function _resolveAttrIndex({ attrCount, pointIndex, faceVertexIndex, faceVertexIndexTotal, indices }) {
    if (indices && indices.length === faceVertexIndexTotal) {
        const v = indices[faceVertexIndex] | 0;
        return (v >= 0 && v < attrCount) ? v : 0;
    }
    // pointsCount 不直接传进来，用 pointIndex + attrCount 的关系来保守推断：
    // 如果 attrCount 足够大且 pointIndex < attrCount，就认为是 per-vertex
    if (pointIndex >= 0 && pointIndex < attrCount) {
        // 这条规则会误判一些 faceVarying 的情况，但一般 OK
        return pointIndex;
    }
    if (attrCount === faceVertexIndexTotal) {
        return faceVertexIndex;
    }
    return 0;
}

/* ---------------------------------- */
/* USDA：提取 def Mesh blocks          */
/* ---------------------------------- */

function _extractDefBlocks(text, primType) {
    const blocks = [];
    const needle = `def ${primType}`;
    let i = 0;

    while (true) {
        const idx = text.indexOf(needle, i);
        if (idx < 0) break;

        // 从 idx 开始，解析 name 与 body
        let p = idx + needle.length;
        // skip spaces
        while (p < text.length && /\s/.test(text[p])) p++;

        // name: "xxx" 或 xxx
        let name = primType;
        if (text[p] === '"') {
            p++;
            const q = text.indexOf('"', p);
            if (q > p) {
                name = text.slice(p, q);
                p = q + 1;
            }
        } else {
            // 读到空白或 {
            const start = p;
            while (p < text.length && !/\s/.test(text[p]) && text[p] !== "{") p++;
            const maybe = text.slice(start, p).trim();
            if (maybe) name = maybe;
        }

        // 找到第一个 '{'
        const brace = text.indexOf("{", p);
        if (brace < 0) { i = p; continue; }

        // 匹配到对应的 '}'
        const end = _matchBrace(text, brace);
        if (end < 0) { i = brace + 1; continue; }

        const body = text.slice(brace + 1, end);
        blocks.push({ name, body });

        i = end + 1;
    }

    return blocks;
}

function _matchBrace(s, openIndex) {
    let depth = 0;
    let inStr = false;
    let strChar = '"';

    for (let i = openIndex; i < s.length; i++) {
        const ch = s[i];

        if (inStr) {
            if (ch === strChar && s[i - 1] !== "\\") inStr = false;
            continue;
        } else {
            if (ch === '"' || ch === "'") {
                inStr = true;
                strChar = ch;
                continue;
            }
            if (ch === "{") depth++;
            else if (ch === "}") {
                depth--;
                if (depth === 0) return i;
            }
        }
    }
    return -1;
}

/* ---------------------------------- */
/* USDA：取 “prop = [ ... ] / ( ... )” */
/* ---------------------------------- */

// 从 body 中找形如： ... <propName> = [ ... ] 或 <propName> = ( ... )
function _getAssignedContainer(body, propName) {
    const key = propName;
    const idx = _findPropAssign(body, key);
    if (idx < 0) return null;

    // idx 指向 '=' 后的第一个字符
    let p = idx;
    while (p < body.length && /\s/.test(body[p])) p++;

    const ch = body[p];
    if (ch === "[") {
        const end = _matchBracket(body, p, "[", "]");
        if (end < 0) return null;
        return body.slice(p + 1, end);
    }
    if (ch === "(") {
        const end = _matchBracket(body, p, "(", ")");
        if (end < 0) return null;
        return body.slice(p + 1, end);
    }

    // 兜底：读到行尾（很少用在 mesh 数组）
    const nl = body.indexOf("\n", p);
    return (nl < 0) ? body.slice(p) : body.slice(p, nl);
}

function _findPropAssign(body, propName) {
    // 允许 propName 含 ':'，因此不用 \b
    // 规则：前面是行首或空白或分号，后面跟空白/[]/: 也都允许，最终找 '='
    const esc = _escapeRegExp(propName);
    const re = new RegExp(`(^|[\\s;])${esc}\\s*=`, "m");
    const m = re.exec(body);
    if (!m) return -1;
    const start = (m.index + m[0].length); // 指向 '=' 之后
    return start;
}

function _matchBracket(s, openIndex, openCh, closeCh) {
    let depth = 0;
    let inStr = false;
    let strChar = '"';

    for (let i = openIndex; i < s.length; i++) {
        const ch = s[i];

        if (inStr) {
            if (ch === strChar && s[i - 1] !== "\\") inStr = false;
            continue;
        } else {
            if (ch === '"' || ch === "'") {
                inStr = true;
                strChar = ch;
                continue;
            }
            if (ch === openCh) depth++;
            else if (ch === closeCh) {
                depth--;
                if (depth === 0) return i;
            }
        }
    }
    return -1;
}

function _parseNumbers(s) {
    const m = s.match(_numRe);
    if (!m) return [];
    const out = new Array(m.length);
    for (let i = 0; i < m.length; i++) out[i] = parseFloat(m[i]);
    return out;
}

function _escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function _looksLikeUSDA(s) {
    const t = s.slice(0, 512).toLowerCase();
    return t.includes("#usda") || (t.includes("def ") && t.includes("{"));
}

function _peekText(buf, n) {
    const u8 = new Uint8Array(buf, 0, Math.min(n, buf.byteLength));
    // 尝试按 latin1 方式快速看头部（避免 utf8 decode 成本）
    let out = "";
    for (let i = 0; i < u8.length; i++) out += String.fromCharCode(u8[i]);
    return out;
}

/* ---------------------------------- */
/* Geometry helpers                   */
/* ---------------------------------- */

function _emptyBBox() {
    return {
        min: vec3.fromValues(Infinity, Infinity, Infinity),
        max: vec3.fromValues(-Infinity, -Infinity, -Infinity)
    };
}

function _unionBBox(a, b) {
    if (!a) return b;
    if (!b) return a;
    return {
        min: vec3.fromValues(
            Math.min(a.min[0], b.min[0]),
            Math.min(a.min[1], b.min[1]),
            Math.min(a.min[2], b.min[2])
        ),
        max: vec3.fromValues(
            Math.max(a.max[0], b.max[0]),
            Math.max(a.max[1], b.max[1]),
            Math.max(a.max[2], b.max[2])
        )
    };
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

function _makeCenterScaleTransform(bbox, center, scaleToUnit) {
    let cx = 0, cy = 0, cz = 0;
    if (center) {
        cx = (bbox.min[0] + bbox.max[0]) * 0.5;
        cy = (bbox.min[1] + bbox.max[1]) * 0.5;
        cz = (bbox.min[2] + bbox.max[2]) * 0.5;
    }
    let s = 1;
    if (scaleToUnit) {
        const dx = bbox.max[0] - bbox.min[0];
        const dy = bbox.max[1] - bbox.min[1];
        const dz = bbox.max[2] - bbox.min[2];
        const diag = Math.max(1e-9, Math.hypot(dx, dy, dz));
        s = 1 / diag;
    }
    return { cx, cy, cz, s, center, scaleToUnit };
}

function _applyPosTransform(positions, t) {
    const n = (positions.length / 3) | 0;
    for (let i = 0; i < n; i++) {
        let x = positions[i * 3 + 0];
        let y = positions[i * 3 + 1];
        let z = positions[i * 3 + 2];
        if (t.center) { x -= t.cx; y -= t.cy; z -= t.cz; }
        if (t.scaleToUnit) { x *= t.s; y *= t.s; z *= t.s; }
        positions[i * 3 + 0] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
    }
}

function _normalizeNormals(normals) {
    const n = (normals.length / 3) | 0;
    for (let i = 0; i < n; i++) {
        const x = normals[i * 3 + 0];
        const y = normals[i * 3 + 1];
        const z = normals[i * 3 + 2];
        const l = Math.hypot(x, y, z);
        if (l > 1e-9) {
            normals[i * 3 + 0] = x / l;
            normals[i * 3 + 1] = y / l;
            normals[i * 3 + 2] = z / l;
        } else {
            normals[i * 3 + 0] = 0;
            normals[i * 3 + 1] = 1;
            normals[i * 3 + 2] = 0;
        }
    }
}

function _computeNormalsForTriList(positions) {
    // positions 是展开的三角形顶点流：每 3 个点一个三角形
    const vCount = (positions.length / 3) | 0;
    const triCount = (vCount / 3) | 0;
    const normals = new Float32Array(vCount * 3);

    for (let ti = 0; ti < triCount; ti++) {
        const i0 = (ti * 3 + 0) * 3;
        const i1 = (ti * 3 + 1) * 3;
        const i2 = (ti * 3 + 2) * 3;

        const ax = positions[i0 + 0], ay = positions[i0 + 1], az = positions[i0 + 2];
        const bx = positions[i1 + 0], by = positions[i1 + 1], bz = positions[i1 + 2];
        const cx = positions[i2 + 0], cy = positions[i2 + 1], cz = positions[i2 + 2];

        const abx = bx - ax, aby = by - ay, abz = bz - az;
        const acx = cx - ax, acy = cy - ay, acz = cz - az;

        let nx = aby * acz - abz * acy;
        let ny = abz * acx - abx * acz;
        let nz = abx * acy - aby * acx;

        const l = Math.hypot(nx, ny, nz);
        if (l > 1e-12) { nx /= l; ny /= l; nz /= l; }
        else { nx = 0; ny = 1; nz = 0; }

        // 三个顶点同法线
        normals[i0 + 0] = nx; normals[i0 + 1] = ny; normals[i0 + 2] = nz;
        normals[i1 + 0] = nx; normals[i1 + 1] = ny; normals[i1 + 2] = nz;
        normals[i2 + 0] = nx; normals[i2 + 1] = ny; normals[i2 + 2] = nz;
    }

    return normals;
}

function _makeSequentialIndices(vertexCount, forceUint32) {
    if (!forceUint32 && vertexCount <= 65535) {
        const idx = new Uint16Array(vertexCount);
        for (let i = 0; i < vertexCount; i++) idx[i] = i;
        return idx;
    } else {
        const idx = new Uint32Array(vertexCount);
        for (let i = 0; i < vertexCount; i++) idx[i] = i;
        return idx;
    }
}