// stl-importer.js (ES Module)
// 纯解析工具：不依赖 gl，不创建 Mesh/Model
// 输出统一 Geometry：positions/normals/colors/indices/bbox/vertexCount/triangleCount/format

import { vec3 } from "./math-gl.js";

/**
 * 解析 STL（binary 或 ascii），增强兼容：
 * - binary STL header 可能以 "solid" 开头（容易被误判成 ASCII）
 * - header triCount 可能不准
 * - 文件尾部可能多出 padding/附加数据
 *
 * @param {ArrayBuffer|Uint8Array|string|Blob|File} source
 * @param {{
 *   center?: boolean,
 *   scaleToUnit?: boolean,
 *   computeNormals?: boolean,
 *   readColor?: boolean,
 *   defaultColor?: [number,number,number,number],
 *   forceUint32?: boolean
 * }} options
 */
export async function parseSTL(source, options = {}) {
    const opt = {
        center: options.center ?? false,
        scaleToUnit: options.scaleToUnit ?? false,
        computeNormals: options.computeNormals ?? true,
        readColor: options.readColor ?? false,
        defaultColor: options.defaultColor ?? [1, 1, 1, 1],
        forceUint32: options.forceUint32 ?? false,
    };

    // 1) 取内容
    if (typeof source === "string") {
        // URL or ASCII text
        if (_looksLikeAsciiSTLText(source)) {
            // 直接当 ASCII 文本
            return _parseAsciiSTL(source, opt);
        } else {
            // 当 URL
            const r = await fetch(source);
            if (!r.ok) throw new Error(`STL URL 加载失败：HTTP ${r.status}`);
            const buf = await r.arrayBuffer();
            return _parseArrayBuffer(buf, opt);
        }
    }

    if (source instanceof Uint8Array) {
        return _parseArrayBuffer(
            source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
            opt
        );
    }

    if (source instanceof ArrayBuffer) {
        return _parseArrayBuffer(source, opt);
    }

    // Blob/File
    if (source && typeof source.arrayBuffer === "function") {
        const buf = await source.arrayBuffer();
        return _parseArrayBuffer(buf, opt);
    }

    throw new Error("parseSTL：不支持的 source 类型（请传 ArrayBuffer/Uint8Array/string/Blob/File）");
}

/* ----------------------------- */
/* Binary/ASCII 判定与解析入口    */
/* ----------------------------- */

function _parseArrayBuffer(buf, opt) {
    if (!(buf instanceof ArrayBuffer)) throw new Error("STL：buf 不是 ArrayBuffer");
    if (buf.byteLength < 5) throw new Error("STL：文件太小");

    // 先用“强二进制”判定
    const binInfo = _analyzeBinarySTL(buf);

    // 如果强烈像 binary：直接 binary
    if (binInfo.isBinaryLikely) {
        return _parseBinarySTL(buf, opt, binInfo);
    }

    // 尝试 ASCII（但要 try-catch，失败要回落 binary）
    const txt = _safeDecodeUtf8Preview(buf, 2 * 1024 * 1024); // 最多预览 2MB（够 ASCII STL）
    if (_looksLikeAsciiSTLText(txt)) {
        try {
            return _parseAsciiSTL(txt, opt);
        } catch (e) {
            // ASCII 解析失败 => 回落 binary
            try {
                return _parseBinarySTL(buf, opt, binInfo);
            } catch (e2) {
                throw new Error(`STL 解析失败：ASCII 与 Binary 都失败。\nASCII: ${e?.message || e}\nBinary: ${e2?.message || e2}`);
            }
        }
    }

    // 不像 ASCII => 尝试 binary
    return _parseBinarySTL(buf, opt, binInfo);
}

function _safeDecodeUtf8Preview(buf, maxBytes) {
    const u8 = new Uint8Array(buf, 0, Math.min(buf.byteLength, maxBytes));
    return new TextDecoder("utf-8", { fatal: false }).decode(u8);
}

function _looksLikeAsciiSTLText(s) {
    const t = s.slice(0, 2048).toLowerCase();
    // ASCII STL 通常包含这些关键字组合
    return t.includes("solid") && (t.includes("facet") || t.includes("vertex") || t.includes("endsolid"));
}

/**
 * 更鲁棒的 binary STL 分析：
 * - 标准 binary: size == 84 + 50*n
 * - triCount 不准: 用 floor((size-84)/50)
 * - 尾部多字节: size >= 84 + 50*n 且 (size-84) >= 50*n
 * - header 以 "solid" 开头但仍是 binary：通过是否含大量 0 字节/不可打印字符判断
 */
function _analyzeBinarySTL(buf) {
    const size = buf.byteLength;
    if (size < 84) return { isBinaryLikely: false };

    const dv = new DataView(buf);
    const triHeader = dv.getUint32(80, true);

    const payload = size - 84;
    const triDerived = payload >= 0 ? Math.floor(payload / 50) : 0;
    const rem = payload >= 0 ? (payload % 50) : 0;

    const expectedHeader = 84 + triHeader * 50;

    const headerTxt = _safeDecodeUtf8Preview(buf, 84).toLowerCase();

    // “强 binary”条件：完全匹配、或 remainder 很小但 triDerived 合理
    const exactMatch = expectedHeader === size;
    const derivedMatch = (payload >= 50) && (triDerived > 0) && (rem === 0); // 常见：triCount 不准但结构正确
    const tailBytesOk = (payload >= 50) && (triDerived > 0) && (expectedHeader < size) && (size - expectedHeader < 4096);

    // 如果 header 看起来像 ASCII（solid），但二进制里会有很多 0 或不可打印字符
    const u8 = new Uint8Array(buf, 0, Math.min(size, 1024));
    let zeros = 0, nonPrintable = 0;
    for (let i = 0; i < u8.length; i++) {
        const b = u8[i];
        if (b === 0) zeros++;
        // 允许 \t \n \r
        if (b < 32 && b !== 9 && b !== 10 && b !== 13) nonPrintable++;
    }
    const binaryNoiseLikely = (zeros + nonPrintable) > 20;

    // 若包含大量二进制噪声，且 (size-84) 接近 50*n，则倾向 binary
    const isBinaryLikely =
        exactMatch ||
        derivedMatch ||
        tailBytesOk ||
        (binaryNoiseLikely && payload >= 50 && triDerived > 0);

    return {
        isBinaryLikely,
        triHeader,
        triDerived,
        rem,
        exactMatch,
        derivedMatch,
        tailBytesOk,
        headerStartsWithSolid: headerTxt.trim().startsWith("solid"),
        size
    };
}

/* ----------------------------- */
/* Binary STL                     */
/* ----------------------------- */

function _parseBinarySTL(buf, opt, binInfo = null) {
    const dv = new DataView(buf);
    const size = buf.byteLength;
    if (size < 84) throw new Error("Binary STL 太短（<84 bytes）");

    const triHeader = dv.getUint32(80, true);
    const payload = size - 84;
    const triDerived = payload >= 0 ? Math.floor(payload / 50) : 0;

    // 选择要用的 triCount：
    // - 完全匹配 => 用 triHeader
    // - 否则优先用 triDerived（更稳）
    let triCount = triHeader;
    const expected = 84 + triHeader * 50;
    if (expected !== size) {
        if (triDerived > 0) triCount = triDerived;
    }

    const need = 84 + triCount * 50;
    if (size < need) {
        // triHeader/derived 都不够时：再兜底一次
        const triDerived2 = Math.floor((size - 84) / 50);
        if (triDerived2 <= 0) throw new Error("Binary STL：无法从文件长度推断三角形数量");
        triCount = triDerived2;
    }

    const vertexCount = triCount * 3;

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);

    const wantColor = !!opt.readColor;
    const colors = wantColor ? new Float32Array(vertexCount * 4) : null;
    const defC = opt.defaultColor;

    const bmin = vec3.fromValues(Infinity, Infinity, Infinity);
    const bmax = vec3.fromValues(-Infinity, -Infinity, -Infinity);

    let off = 84;

    for (let ti = 0; ti < triCount; ti++) {
        const nx = dv.getFloat32(off + 0, true);
        const ny = dv.getFloat32(off + 4, true);
        const nz = dv.getFloat32(off + 8, true);

        const v0x = dv.getFloat32(off + 12, true);
        const v0y = dv.getFloat32(off + 16, true);
        const v0z = dv.getFloat32(off + 20, true);

        const v1x = dv.getFloat32(off + 24, true);
        const v1y = dv.getFloat32(off + 28, true);
        const v1z = dv.getFloat32(off + 32, true);

        const v2x = dv.getFloat32(off + 36, true);
        const v2y = dv.getFloat32(off + 40, true);
        const v2z = dv.getFloat32(off + 44, true);

        const attr = dv.getUint16(off + 48, true);

        const baseV = ti * 9;
        const baseN = ti * 9;
        const baseC = ti * 12;

        positions[baseV + 0] = v0x; positions[baseV + 1] = v0y; positions[baseV + 2] = v0z;
        positions[baseV + 3] = v1x; positions[baseV + 4] = v1y; positions[baseV + 5] = v1z;
        positions[baseV + 6] = v2x; positions[baseV + 7] = v2y; positions[baseV + 8] = v2z;

        _bboxAcc(bmin, bmax, v0x, v0y, v0z);
        _bboxAcc(bmin, bmax, v1x, v1y, v1z);
        _bboxAcc(bmin, bmax, v2x, v2y, v2z);

        normals[baseN + 0] = nx; normals[baseN + 1] = ny; normals[baseN + 2] = nz;
        normals[baseN + 3] = nx; normals[baseN + 4] = ny; normals[baseN + 5] = nz;
        normals[baseN + 6] = nx; normals[baseN + 7] = ny; normals[baseN + 8] = nz;

        if (colors) {
            const c = _decodeBinaryStlColor(attr, defC, buf);
            colors[baseC + 0] = c[0]; colors[baseC + 1] = c[1]; colors[baseC + 2] = c[2]; colors[baseC + 3] = c[3];
            colors[baseC + 4] = c[0]; colors[baseC + 5] = c[1]; colors[baseC + 6] = c[2]; colors[baseC + 7] = c[3];
            colors[baseC + 8] = c[0]; colors[baseC + 9] = c[1]; colors[baseC + 10] = c[2]; colors[baseC + 11] = c[3];
        }

        off += 50;
    }

    if (opt.computeNormals) _ensureNormalsFromTriangles(positions, normals);
    else _normalizeNormals(normals);

    let bbox = { min: bmin, max: bmax };
    if (opt.center || opt.scaleToUnit) {
        const t = _makeCenterScaleTransform(bbox, opt.center, opt.scaleToUnit);
        _applyPosTransform(positions, t);
        _normalizeNormals(normals);
        bbox = _computeBBox(positions);
    }

    const indices = _makeSequentialIndices(vertexCount, opt.forceUint32);

    return {
        positions,
        normals,
        colors,
        indices,
        bbox,
        vertexCount,
        triangleCount: triCount,
        format: "binary",
    };
}

// 兼容更多 binary STL 颜色惯例（尽力而为）
// - 有的用 0x8000 表示有效
// - 有的反过来（0x8000=0 表示有效）
// - 有的完全不用
function _decodeBinaryStlColor(attr, defC, buf) {
    // 优先：0x8000 set -> color valid（常见）
    if ((attr & 0x8000) === 0x8000) {
        const r5 = (attr >> 10) & 31;
        const g5 = (attr >> 5) & 31;
        const b5 = (attr) & 31;
        return [r5 / 31, g5 / 31, b5 / 31, 1];
    }

    // 次选：如果 0x8000 未置位，但 15bit 里有明显信息，也尝试当颜色（更“宽松”）
    const rgb15 = attr & 0x7FFF;
    if (rgb15 !== 0 && rgb15 !== 0x7FFF) {
        const r5 = (attr >> 10) & 31;
        const g5 = (attr >> 5) & 31;
        const b5 = (attr) & 31;
        return [r5 / 31, g5 / 31, b5 / 31, 1];
    }

    return defC;
}

/* ----------------------------- */
/* ASCII STL                      */
/* ----------------------------- */

function _parseAsciiSTL(text, opt) {
    const lines = text.split(/\r?\n/);

    const pos = [];
    const nrm = [];

    const bmin = vec3.fromValues(Infinity, Infinity, Infinity);
    const bmax = vec3.fromValues(-Infinity, -Infinity, -Infinity);

    let curN = [0, 0, 0];
    let vTmp = [];

    const numRe = /[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g;

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i].trim();
        if (!raw) continue;

        const low = raw.toLowerCase();

        if (low.startsWith("facet normal")) {
            const m = raw.match(numRe);
            curN = (m && m.length >= 3) ? [parseFloat(m[0]), parseFloat(m[1]), parseFloat(m[2])] : [0, 0, 0];
            vTmp.length = 0;
        } else if (low.startsWith("vertex")) {
            const m = raw.match(numRe);
            if (m && m.length >= 3) {
                const x = parseFloat(m[0]), y = parseFloat(m[1]), z = parseFloat(m[2]);
                vTmp.push(x, y, z);
                _bboxAcc(bmin, bmax, x, y, z);

                if (vTmp.length === 9) {
                    pos.push(...vTmp);
                    nrm.push(
                        curN[0], curN[1], curN[2],
                        curN[0], curN[1], curN[2],
                        curN[0], curN[1], curN[2]
                    );
                    vTmp.length = 0;
                }
            }
        }
    }

    if (pos.length === 0) throw new Error("ASCII STL 解析失败：未找到任何三角形（可能其实是 binary STL）");

    const positions = new Float32Array(pos);
    const normals = new Float32Array(nrm);

    if (opt.computeNormals) _ensureNormalsFromTriangles(positions, normals);
    else _normalizeNormals(normals);

    let bbox = { min: bmin, max: bmax };
    if (opt.center || opt.scaleToUnit) {
        const t = _makeCenterScaleTransform(bbox, opt.center, opt.scaleToUnit);
        _applyPosTransform(positions, t);
        _normalizeNormals(normals);
        bbox = _computeBBox(positions);
    }

    const vertexCount = (positions.length / 3) | 0;
    const triCount = (vertexCount / 3) | 0;
    const indices = _makeSequentialIndices(vertexCount, opt.forceUint32);

    return {
        positions,
        normals,
        colors: null,
        indices,
        bbox,
        vertexCount,
        triangleCount: triCount,
        format: "ascii",
    };
}

/* ----------------------------- */
/* Helpers                        */
/* ----------------------------- */

function _bboxAcc(min, max, x, y, z) {
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
}

function _computeBBox(positions) {
    const min = vec3.fromValues(Infinity, Infinity, Infinity);
    const max = vec3.fromValues(-Infinity, -Infinity, -Infinity);
    const n = (positions.length / 3) | 0;
    for (let i = 0; i < n; i++) {
        const x = positions[i * 3 + 0];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        _bboxAcc(min, max, x, y, z);
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

function _ensureNormalsFromTriangles(positions, normals) {
    const triCount = ((positions.length / 9) | 0);

    for (let ti = 0; ti < triCount; ti++) {
        const p0 = ti * 9 + 0;
        const p1 = ti * 9 + 3;
        const p2 = ti * 9 + 6;

        const ax = positions[p0 + 0], ay = positions[p0 + 1], az = positions[p0 + 2];
        const bx = positions[p1 + 0], by = positions[p1 + 1], bz = positions[p1 + 2];
        const cx = positions[p2 + 0], cy = positions[p2 + 1], cz = positions[p2 + 2];

        const abx = bx - ax, aby = by - ay, abz = bz - az;
        const acx = cx - ax, acy = cy - ay, acz = cz - az;

        let nx = aby * acz - abz * acy;
        let ny = abz * acx - abx * acz;
        let nz = abx * acy - aby * acx;

        const l = Math.hypot(nx, ny, nz);
        if (l > 1e-12) {
            nx /= l; ny /= l; nz /= l;
        } else {
            const ex = normals[p0 + 0], ey = normals[p0 + 1], ez = normals[p0 + 2];
            const el = Math.hypot(ex, ey, ez);
            if (el > 1e-9) { nx = ex / el; ny = ey / el; nz = ez / el; }
            else { nx = 0; ny = 1; nz = 0; }
        }

        normals[p0 + 0] = nx; normals[p0 + 1] = ny; normals[p0 + 2] = nz;
        normals[p1 + 0] = nx; normals[p1 + 1] = ny; normals[p1 + 2] = nz;
        normals[p2 + 0] = nx; normals[p2 + 1] = ny; normals[p2 + 2] = nz;
    }
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