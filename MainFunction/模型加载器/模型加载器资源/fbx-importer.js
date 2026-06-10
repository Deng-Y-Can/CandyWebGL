// fbx-importer.js (ES Module)
// 纯解析工具：不依赖 gl，不创建 Mesh/Model
// 输出统一 Geometry：submeshes[{positions,normals,uvs,colors,indices,bbox,vertexCount,triangleCount,name}]
// 重点支持 Binary FBX；ASCII FBX 尽力而为（仅抓常见数组块，复杂连接/变换可能缺失）

import { vec3 } from "./math-gl.js";

/**
 * @typedef {{
 *  center?: boolean,
 *  scaleToUnit?: boolean,
 *  computeNormals?: boolean,
 *  preferLayer?: number,        // LayerElementUV/Normal/Color 多层时选第几层（默认0）
 *  flipUVY?: boolean,           // 翻转 V
 *  triangulate?: boolean,       // 多边形三角化（默认 true）
 *  forceUint32?: boolean,       // 强制 Uint32 indices
 *  applyModelTransform?: boolean,// 应用 Model 变换（默认 true；需要 Connections）
 * }} FBXImportOptions
 */

/**
 * 解析 FBX（binary / ascii）
 * @param {ArrayBuffer|Uint8Array|string|Blob|File} source
 * @param {FBXImportOptions} options
 * @returns {Promise<{
 *   format: "binary"|"ascii",
 *   version?: number,
 *   submeshes: Array<{
 *     name: string,
 *     positions: Float32Array,
 *     normals: Float32Array,
 *     uvs: Float32Array|null,
 *     colors: Float32Array|null,
 *     indices: Uint16Array|Uint32Array,
 *     bbox: {min: Float32Array, max: Float32Array},
 *     vertexCount: number,
 *     triangleCount: number
 *   }>,
 *   bbox: {min: Float32Array, max: Float32Array} | null,
 *   vertexCount: number,
 *   triangleCount: number
 * }>}
 */
export async function parseFBX(source, options = {}) {
    const opt = {
        center: options.center ?? false,
        scaleToUnit: options.scaleToUnit ?? false,
        computeNormals: options.computeNormals ?? true,
        preferLayer: options.preferLayer ?? 0,
        flipUVY: options.flipUVY ?? false,
        triangulate: options.triangulate ?? true,
        forceUint32: options.forceUint32 ?? false,
        applyModelTransform: options.applyModelTransform ?? true,
    };

    // 1) 读入内容
    if (typeof source === "string") {
        // 可能是 URL，也可能是 ASCII 文本
        if (_looksLikeASCIIText(source)) {
            const asciiRes = _parseASCIIFBXText(source, opt);
            return _postProcessScene(asciiRes, opt);
        } else {
            const r = await fetch(source);
            if (!r.ok) throw new Error(`FBX URL 加载失败：HTTP ${r.status}`);
            const buf = await r.arrayBuffer();
            const res = await _parseFBXArrayBuffer(buf, opt);
            return _postProcessScene(res, opt);
        }
    }

    if (source instanceof Uint8Array) {
        const buf = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
        const res = await _parseFBXArrayBuffer(buf, opt);
        return _postProcessScene(res, opt);
    }

    if (source instanceof ArrayBuffer) {
        const res = await _parseFBXArrayBuffer(source, opt);
        return _postProcessScene(res, opt);
    }

    // Blob/File
    if (source && typeof source.arrayBuffer === "function") {
        const buf = await source.arrayBuffer();
        const res = await _parseFBXArrayBuffer(buf, opt);
        return _postProcessScene(res, opt);
    }

    throw new Error("parseFBX：不支持的 source 类型（请传 ArrayBuffer/Uint8Array/string/Blob/File）");
}

/* ----------------------------------------------------- */
/* 入口：binary/ascii 判定                                */
/* ----------------------------------------------------- */

async function _parseFBXArrayBuffer(buf, opt) {
    if (_isBinaryFBX(buf)) {
        const parsed = await _parseBinaryFBX(buf, opt);
        return parsed;
    }
    // 非 binary：当作 ASCII 文本尝试
    const txt = new TextDecoder("utf-8").decode(new Uint8Array(buf));
    if (_looksLikeASCIIText(txt)) {
        const asciiRes = _parseASCIIFBXText(txt, opt);
        return asciiRes;
    }
    throw new Error("FBX 解析失败：无法判定 binary/ascii（文件头不匹配）");
}

function _isBinaryFBX(buf) {
    if (!(buf instanceof ArrayBuffer)) return false;
    if (buf.byteLength < 27) return false;
    const u8 = new Uint8Array(buf, 0, 27);
    // "Kaydara FBX Binary  \0\x1a\0"
    const sig = "Kaydara FBX Binary  ";
    for (let i = 0; i < sig.length; i++) {
        if (u8[i] !== sig.charCodeAt(i)) return false;
    }
    return true;
}

function _looksLikeASCIIText(s) {
    const t = s.slice(0, 512);
    return t.includes("FBXHeaderExtension") || t.includes("Kaydara FBX ASCII") || t.includes("Objects:") || t.includes("Connections:");
}

/* ----------------------------------------------------- */
/* Binary FBX Parser（节点树 + 抽取 mesh）                */
/* ----------------------------------------------------- */

async function _parseBinaryFBX(buf, opt) {
    const dv = new DataView(buf);
    // 版本号：binary header 后的 int32（通常 offset=23）
    // header: 23 bytes signature + 2 bytes (0x00 0x1a) + 1 byte 0x00? 实际常用 offset=23
    // 这里做容错：在 20~27 范围找一个合理版本
    let version = null;
    for (let off of [23, 24, 25, 26, 27, 20, 21, 22]) {
        if (off + 4 <= dv.byteLength) {
            const v = dv.getInt32(off, true);
            if (v > 5000 && v < 100000) { version = v; break; }
        }
    }
    if (version == null) version = dv.getInt32(23, true);

    // FBX 7.5+ 使用 64bit record（endOffset 等）
    const use64 = version >= 7500;

    // 解析 root nodes：从 header 后开始（一般 27）
    let offset = 27;
    const root = { name: "Root", props: [], children: [] };

    while (offset < dv.byteLength) {
        const node = await _readNode(dv, offset, use64);
        if (!node) break;
        root.children.push(node);
        offset = node._end;
    }

    // 抽取 Objects / Connections
    const objectsNode = _findChild(root, "Objects");
    const connectionsNode = _findChild(root, "Connections");

    if (!objectsNode) {
        throw new Error("Binary FBX：未找到 Objects 节点（文件结构不标准或解析失败）");
    }

    const geometries = _parseGeometries(objectsNode, opt);
    const models = _parseModels(objectsNode);
    const links = _parseConnections(connectionsNode);

    // 建 parent 关系：model->parentModel
    for (const c of links.modelToModel) {
        const child = models.get(c.childId);
        if (child) child.parentId = c.parentId;
    }
    // geometry->model
    for (const c of links.geoToModel) {
        const geo = geometries.get(c.geoId);
        if (geo) geo.modelId = c.modelId;
    }

    // 计算 model world matrix（可选）
    if (opt.applyModelTransform) {
        for (const m of models.values()) {
            if (!m.world) m.world = _computeWorldMatrix(m, models);
        }
    }

    // 生成 submeshes
    const submeshes = [];
    for (const geo of geometries.values()) {
        if (!geo.vertices || !geo.polyIndex) continue;
        const model = (opt.applyModelTransform && geo.modelId != null) ? models.get(geo.modelId) : null;
        const world = model?.world || null;

        const built = _buildMeshFromFBXGeometry(geo, opt, world);
        for (const sm of built) submeshes.push(sm);
    }

    // 全局统计
    let allBBox = null;
    let vSum = 0, triSum = 0;
    for (const sm of submeshes) {
        allBBox = _unionBBox(allBBox, sm.bbox);
        vSum += sm.vertexCount;
        triSum += sm.triangleCount;
    }

    return {
        format: "binary",
        version,
        submeshes,
        bbox: allBBox,
        vertexCount: vSum,
        triangleCount: triSum
    };
}

// 读一个 node record
async function _readNode(dv, offset, use64) {
    const start = offset;

    const endOffset = use64 ? _getUint64(dv, offset, true) : dv.getUint32(offset, true);
    offset += use64 ? 8 : 4;

    const numProps = use64 ? _getUint64(dv, offset, true) : dv.getUint32(offset, true);
    offset += use64 ? 8 : 4;

    const propListLen = use64 ? _getUint64(dv, offset, true) : dv.getUint32(offset, true);
    offset += use64 ? 8 : 4;

    const nameLen = dv.getUint8(offset); offset += 1;

    // null record：endOffset==0
    if (endOffset === 0) return null;

    const name = _readString(dv, offset, nameLen);
    offset += nameLen;

    const props = [];
    for (let i = 0; i < numProps; i++) {
        const { value, nextOffset } = await _readProperty(dv, offset);
        props.push(value);
        offset = nextOffset;
    }

    const node = { name, props, children: [], _start: start, _end: Number(endOffset) };

    // children：直到接近 endOffset（末尾通常有 13 bytes null-record，但 64bit 是 25 bytes）
    while (offset < node._end) {
        const child = await _readNode(dv, offset, use64);
        if (!child) {
            // null record：跳过终止符
            // 32bit null record = 13 bytes；64bit null record = 25 bytes
            offset += use64 ? 25 : 13;
            break;
        }
        node.children.push(child);
        offset = child._end;
    }

    return node;
}

function _readString(dv, off, len) {
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(dv.getUint8(off + i));
    return s;
}

function _getUint64(dv, off, little) {
    // JS 安全整数范围内够用（FBX offset 一般不超过 2^53）
    const lo = dv.getUint32(off + (little ? 0 : 4), little);
    const hi = dv.getUint32(off + (little ? 4 : 0), little);
    return hi * 4294967296 + lo;
}

async function _readProperty(dv, offset) {
    const type = String.fromCharCode(dv.getUint8(offset)); offset += 1;

    switch (type) {
        case "Y": { // int16
            const v = dv.getInt16(offset, true); offset += 2;
            return { value: v, nextOffset: offset };
        }
        case "C": { // bool
            const v = dv.getUint8(offset) !== 0; offset += 1;
            return { value: v, nextOffset: offset };
        }
        case "I": { // int32
            const v = dv.getInt32(offset, true); offset += 4;
            return { value: v, nextOffset: offset };
        }
        case "F": { // float32
            const v = dv.getFloat32(offset, true); offset += 4;
            return { value: v, nextOffset: offset };
        }
        case "D": { // float64
            const v = dv.getFloat64(offset, true); offset += 8;
            return { value: v, nextOffset: offset };
        }
        case "L": { // int64
            const v = _getInt64(dv, offset, true); offset += 8;
            return { value: v, nextOffset: offset };
        }
        case "R": { // raw bytes
            const len = dv.getUint32(offset, true); offset += 4;
            const bytes = new Uint8Array(dv.buffer, dv.byteOffset + offset, len);
            offset += len;
            return { value: bytes.slice(), nextOffset: offset };
        }
        case "S": { // string
            const len = dv.getUint32(offset, true); offset += 4;
            const s = new TextDecoder("utf-8").decode(new Uint8Array(dv.buffer, dv.byteOffset + offset, len));
            offset += len;
            return { value: s, nextOffset: offset };
        }

        // Array types
        case "f":
        case "d":
        case "i":
        case "l":
        case "b":
        case "c": {
            const arrayLength = dv.getUint32(offset, true); offset += 4;
            const encoding = dv.getUint32(offset, true); offset += 4;
            const compLen = dv.getUint32(offset, true); offset += 4;

            const dataBytes = new Uint8Array(dv.buffer, dv.byteOffset + offset, compLen);
            offset += compLen;

            let raw;
            if (encoding === 0) {
                raw = dataBytes.slice();
            } else {
                raw = await _inflateZlibBytes(dataBytes);
            }

            const value = _bytesToTypedArray(type, raw, arrayLength);
            return { value, nextOffset: offset };
        }

        default:
            throw new Error(`Binary FBX：未知 property type '${type}'`);
    }
}

function _getInt64(dv, off, little) {
    const lo = dv.getUint32(off + (little ? 0 : 4), little);
    const hi = dv.getInt32(off + (little ? 4 : 0), little);
    return hi * 4294967296 + lo;
}

// 解压 zlib（优先用浏览器原生 DecompressionStream('deflate')；否则使用全局 pako.inflate）
async function _inflateZlibBytes(u8) {
    // DecompressionStream('deflate')：在多数 Chromium 新版可用
    if (typeof DecompressionStream !== "undefined") {
        const ds = new DecompressionStream("deflate");
        const stream = new Blob([u8]).stream().pipeThrough(ds);
        const ab = await new Response(stream).arrayBuffer();
        return new Uint8Array(ab);
    }
    // fallback: pako
    if (globalThis.pako && typeof globalThis.pako.inflate === "function") {
        const out = globalThis.pako.inflate(u8);
        return out instanceof Uint8Array ? out : new Uint8Array(out);
    }
    throw new Error("FBX 数组为压缩编码（encoding=1），但当前环境不支持 DecompressionStream，也没有引入 pako.inflate");
}

function _bytesToTypedArray(type, rawBytes, arrayLength) {
    const dv = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
    let out;

    switch (type) {
        case "f": {
            out = new Float32Array(arrayLength);
            for (let i = 0; i < arrayLength; i++) out[i] = dv.getFloat32(i * 4, true);
            return out;
        }
        case "d": {
            // 顶点常用 double，最终我们再转 float32
            out = new Float64Array(arrayLength);
            for (let i = 0; i < arrayLength; i++) out[i] = dv.getFloat64(i * 8, true);
            return out;
        }
        case "i": {
            out = new Int32Array(arrayLength);
            for (let i = 0; i < arrayLength; i++) out[i] = dv.getInt32(i * 4, true);
            return out;
        }
        case "l": {
            // int64 -> JS number（精度在 2^53 内通常够用）
            out = new Float64Array(arrayLength);
            for (let i = 0; i < arrayLength; i++) out[i] = _getInt64(dv, i * 8, true);
            return out;
        }
        case "b":
        case "c": {
            // b: bool array, c: byte array
            out = new Uint8Array(arrayLength);
            for (let i = 0; i < arrayLength; i++) out[i] = dv.getUint8(i);
            return out;
        }
        default:
            throw new Error("bytesToTypedArray：不支持的数组类型 " + type);
    }
}

/* ----------------------------------------------------- */
/* Objects: Geometry / Model / Connections 抽取           */
/* ----------------------------------------------------- */

function _findChild(node, name) {
    if (!node?.children) return null;
    return node.children.find(c => c.name === name) || null;
}
function _findChildren(node, name) {
    if (!node?.children) return [];
    return node.children.filter(c => c.name === name);
}
function _findChildValue(node, childName) {
    const c = _findChild(node, childName);
    if (!c) return null;
    // 常见：该 node 的 props[0] 就是数据
    return c.props?.[0] ?? null;
}

function _parseGeometries(objectsNode, opt) {
    const geometries = new Map(); // id -> geo
    const geoNodes = _findChildren(objectsNode, "Geometry");

    for (const g of geoNodes) {
        const id = Number(g.props?.[0] ?? NaN);
        if (!Number.isFinite(id)) continue;
        const name = String(g.props?.[1] ?? `Geometry_${id}`);
        const kind = String(g.props?.[2] ?? "");

        if (!kind.includes("Mesh")) continue;

        // Vertices / PolygonVertexIndex
        const vertices = _findChildValue(g, "Vertices");
        const polyIndex = _findChildValue(g, "PolygonVertexIndex");

        // Layer elements
        const normalsLayer = _pickLayerElement(g, "LayerElementNormal", opt.preferLayer);
        const uvsLayer = _pickLayerElement(g, "LayerElementUV", opt.preferLayer);
        const colorsLayer = _pickLayerElement(g, "LayerElementColor", opt.preferLayer);

        geometries.set(id, {
            id, name,
            vertices, polyIndex,
            normalsLayer, uvsLayer, colorsLayer,
            modelId: null
        });
    }
    return geometries;
}

function _pickLayerElement(geoNode, layerName, preferIndex = 0) {
    const layers = _findChildren(geoNode, layerName);
    if (!layers.length) return null;
    // 有些 LayerElementXX 的 props[0] 是 layer index（0/1/2）
    // preferIndex 优先匹配 props[0]，否则按顺序取
    const hit = layers.find(l => Number(l.props?.[0]) === preferIndex);
    return hit || layers[0];
}

function _parseModels(objectsNode) {
    const models = new Map(); // id -> modelData
    const modelNodes = _findChildren(objectsNode, "Model");
    for (const m of modelNodes) {
        const id = Number(m.props?.[0] ?? NaN);
        if (!Number.isFinite(id)) continue;
        const name = String(m.props?.[1] ?? `Model_${id}`);
        const type = String(m.props?.[2] ?? "");
        // 我们主要关心 Mesh 的 Model
        // 但也允许 Null/Root，做 parent 链
        const props70 = _findChild(m, "Properties70");
        const trs = _readTRSFromProperties70(props70);

        models.set(id, {
            id, name, type,
            parentId: null,
            t: trs.t,
            r: trs.r,
            s: trs.s,
            world: null
        });
    }
    return models;
}

function _readTRSFromProperties70(props70Node) {
    const t = [0, 0, 0];
    const r = [0, 0, 0]; // degrees
    const s = [1, 1, 1];

    if (!props70Node) return { t, r, s };

    // Properties70 里有多个 "P" child
    const ps = _findChildren(props70Node, "P");
    for (const p of ps) {
        // p.props: ["Lcl Translation","Lcl Translation","","A", x,y,z]（常见）
        const key = String(p.props?.[0] ?? "");
        if (key === "Lcl Translation") {
            t[0] = Number(p.props?.[4] ?? 0);
            t[1] = Number(p.props?.[5] ?? 0);
            t[2] = Number(p.props?.[6] ?? 0);
        } else if (key === "Lcl Rotation") {
            r[0] = Number(p.props?.[4] ?? 0);
            r[1] = Number(p.props?.[5] ?? 0);
            r[2] = Number(p.props?.[6] ?? 0);
        } else if (key === "Lcl Scaling") {
            s[0] = Number(p.props?.[4] ?? 1);
            s[1] = Number(p.props?.[5] ?? 1);
            s[2] = Number(p.props?.[6] ?? 1);
        }
    }
    return { t, r, s };
}

function _parseConnections(connectionsNode) {
    const geoToModel = [];
    const modelToModel = [];
    if (!connectionsNode) return { geoToModel, modelToModel };

    const cs = _findChildren(connectionsNode, "C");
    for (const c of cs) {
        // props: ["OO", childId, parentId, ""] 或类似
        const rel = String(c.props?.[0] ?? "");
        const childId = Number(c.props?.[1] ?? NaN);
        const parentId = Number(c.props?.[2] ?? NaN);
        if (!Number.isFinite(childId) || !Number.isFinite(parentId)) continue;
        if (rel !== "OO") continue;

        // 这里无法直接知道 child/parent 是哪类对象（Geometry/Model）
        // 我们先都记录，后面用 map 是否存在来判断
        geoToModel.push({ geoId: childId, modelId: parentId });
        modelToModel.push({ childId, parentId });
    }
    return { geoToModel, modelToModel };
}

/* ----------------------------------------------------- */
/* 构建 Mesh：三角化 + attributes 解码                    */
/* ----------------------------------------------------- */

// 从 model 链递归算 world matrix
function _computeWorldMatrix(m, models) {
    const local = _mat4FromTRS(m.t, m.r, m.s);
    if (!m.parentId) return local;
    const p = models.get(m.parentId);
    if (!p) return local;
    if (!p.world) p.world = _computeWorldMatrix(p, models);
    return _mat4Mul(p.world, local);
}

function _buildMeshFromFBXGeometry(geo, opt, worldMat4OrNull) {
    const verts = geo.vertices;        // Float64Array（常见）或 Float32Array
    const poly = geo.polyIndex;        // Int32Array
    if (!verts || !poly) return [];

    // 控制点转 Float32
    const cpCount = (verts.length / 3) | 0;
    const controlPoints = new Float32Array(cpCount * 3);
    if (verts instanceof Float64Array) {
        for (let i = 0; i < controlPoints.length; i++) controlPoints[i] = verts[i];
    } else {
        for (let i = 0; i < controlPoints.length; i++) controlPoints[i] = verts[i];
    }

    // layer 解码器
    const normalElem = _decodeLayerElement(geo.normalsLayer, "Normal", 3);
    const uvElem = _decodeLayerElement(geo.uvsLayer, "UV", 2);
    const colorElem = _decodeLayerElement(geo.colorsLayer, "Color", 4);

    // 三角化并构建“顶点去重”的 indexed geometry
    const map = new Map();
    const outPos = [];
    const outNrm = [];
    const outUV = [];
    const outCol = [];
    const outIdx = [];

    let pvIndex = 0;
    let polyIndex = 0;
    let face = [];      // control point indices
    let facePV = [];    // polygon-vertex indices (for ByPolygonVertex)

    const pushCorner = (cpIdx, pvIdx, polyIdx) => {
        const nInfo = normalElem ? normalElem.get(pvIdx, cpIdx, polyIdx) : null;
        const uvInfo = uvElem ? uvElem.get(pvIdx, cpIdx, polyIdx) : null;
        const cInfo = colorElem ? colorElem.get(pvIdx, cpIdx, polyIdx) : null;

        const nKey = nInfo ? nInfo.di : -1;
        const uvKey = uvInfo ? uvInfo.di : -1;
        const cKey = cInfo ? cInfo.di : -1;
        const key = `${cpIdx}|${nKey}|${uvKey}|${cKey}`;

        let vi = map.get(key);
        if (vi == null) {
            vi = (outPos.length / 3) | 0;
            map.set(key, vi);

            // position from control point
            outPos.push(
                controlPoints[cpIdx * 3 + 0],
                controlPoints[cpIdx * 3 + 1],
                controlPoints[cpIdx * 3 + 2]
            );

            // normal
            if (nInfo?.v) outNrm.push(nInfo.v[0], nInfo.v[1], nInfo.v[2]);
            else outNrm.push(0, 1, 0);

            // uv
            if (uvInfo?.v) {
                const u = uvInfo.v[0], v = uvInfo.v[1];
                outUV.push(u, opt.flipUVY ? (1 - v) : v);
            } else {
                // 若全体都没 UV，最后会整体置 null
                outUV.push(0, 0);
            }

            // color
            if (cInfo?.v) {
                const c = cInfo.v;
                // 可能是 rgb 或 rgba
                if (c.length >= 4) outCol.push(c[0], c[1], c[2], c[3]);
                else outCol.push(c[0], c[1], c[2], 1);
            } else {
                outCol.push(1, 1, 1, 1);
            }
        }
        return vi;
    };

    const flushFace = () => {
        const n = face.length;
        if (n < 3) { face.length = 0; facePV.length = 0; polyIndex++; return; }

        if (!opt.triangulate && n !== 3) {
            // 不三角化就丢弃非三角面（多数渲染管线仍需要三角形）
            face.length = 0; facePV.length = 0; polyIndex++; return;
        }

        // fan triangulation: (0, i-1, i)
        for (let i = 2; i < n; i++) {
            const a = pushCorner(face[0], facePV[0], polyIndex);
            const b = pushCorner(face[i - 1], facePV[i - 1], polyIndex);
            const c = pushCorner(face[i], facePV[i], polyIndex);
            outIdx.push(a, b, c);
        }

        face.length = 0;
        facePV.length = 0;
        polyIndex++;
    };

    for (let i = 0; i < poly.length; i++) {
        const raw = poly[i];
        const cp = raw < 0 ? (-raw - 1) : raw;
        face.push(cp);
        facePV.push(pvIndex);
        pvIndex++;

        if (raw < 0) {
            flushFace();
        }
    }
    if (face.length) flushFace();

    // typed arrays
    let positions = new Float32Array(outPos);
    let normals = new Float32Array(outNrm);
    const indices = _makeIndices(outIdx, opt.forceUint32);

    // UV：如果源里根本没有 UV element，置 null
    let uvs = null;
    if (uvElem) {
        uvs = new Float32Array(outUV);
    }

    // Color：如果源里根本没有 Color element，置 null（你渲染侧可补白色）
    let colors = null;
    if (colorElem) {
        colors = new Float32Array(outCol);
    }

    // 若 normals 不可靠/缺失，计算一次
    if (opt.computeNormals) {
        _computeVertexNormals(positions, indices, normals);
    } else {
        _normalizeNormals(normals);
    }

    // 应用 model world transform（位置 + 法线）
    if (worldMat4OrNull) {
        positions = _applyMat4ToPositions(positions, worldMat4OrNull);
        normals = _applyMat4ToNormals(normals, worldMat4OrNull);
    }

    // bbox
    let bbox = _computeBBox(positions);

    // 可选：center / scaleToUnit（一般多模型对齐建议关闭）
    if (opt.center || opt.scaleToUnit) {
        const t = _makeCenterScaleTransform(bbox, opt.center, opt.scaleToUnit);
        positions = _applyCenterScaleToPositions(positions, t);
        bbox = _computeBBox(positions);
        _normalizeNormals(normals);
    }

    const vertexCount = (positions.length / 3) | 0;
    const triangleCount = (indices.length / 3) | 0;

    return [{
        name: geo.name || "FBXMesh",
        positions,
        normals,
        uvs,
        colors,
        indices,
        bbox,
        vertexCount,
        triangleCount
    }];
}

// 解码 LayerElement：MappingInformationType + ReferenceInformationType
function _decodeLayerElement(layerNode, kindName, valueSize) {
    if (!layerNode) return null;

    // LayerElementNormal: (MappingInformationType, ReferenceInformationType, Normals, NormalIndex)
    // LayerElementUV: (MappingInformationType, ReferenceInformationType, UV, UVIndex)
    // LayerElementColor: (MappingInformationType, ReferenceInformationType, Colors, ColorIndex)
    const mapping = String(_findChildValue(layerNode, "MappingInformationType") ?? "");
    const reference = String(_findChildValue(layerNode, "ReferenceInformationType") ?? "");

    let directName = null;
    let indexName = null;
    if (kindName === "Normal") { directName = "Normals"; indexName = "NormalIndex"; }
    if (kindName === "UV") { directName = "UV"; indexName = "UVIndex"; }
    if (kindName === "Color") { directName = "Colors"; indexName = "ColorIndex"; }

    const direct = _findChildValue(layerNode, directName);
    const index = _findChildValue(layerNode, indexName);

    if (!direct) return null;

    const directArr = _ensureFloatArray(direct);
    const indexArr = index ? _ensureIntArray(index) : null;

    const getMappingIndex = (pvIndex, cpIndex, polyIndex) => {
        // 常见
        if (mapping === "ByPolygonVertex") return pvIndex;
        if (mapping === "ByControlPoint") return cpIndex;
        if (mapping === "ByPolygon") return polyIndex;
        if (mapping === "AllSame") return 0;

        // 少见/不稳定：ByVertex（在不同导出器里含义会变）
        // 兜底：按 ByPolygonVertex 处理
        if (mapping === "ByVertex") return pvIndex;

        // 未知：兜底
        return pvIndex;
    };

    const getDirectIndex = (pvIndex, cpIndex, polyIndex) => {
        const mi = getMappingIndex(pvIndex, cpIndex, polyIndex);
        if (reference === "Direct" || !indexArr) return mi;
        if (reference === "IndexToDirect") return indexArr[mi] | 0;
        // 未知：兜底 direct
        return mi;
    };

    const getValue = (di) => {
        const base = di * valueSize;
        const v = new Array(valueSize);
        for (let k = 0; k < valueSize; k++) v[k] = directArr[base + k] ?? 0;
        return v;
    };

    return {
        mapping, reference, directArr, indexArr,
        get(pvIndex, cpIndex, polyIndex) {
            const di = getDirectIndex(pvIndex, cpIndex, polyIndex);
            return { di, v: getValue(di) };
        }
    };
}

function _ensureFloatArray(arr) {
    if (arr instanceof Float32Array) return arr;
    if (arr instanceof Float64Array) {
        const f = new Float32Array(arr.length);
        for (let i = 0; i < arr.length; i++) f[i] = arr[i];
        return f;
    }
    // 有些解析器可能给普通数组
    if (Array.isArray(arr)) return new Float32Array(arr);
    return new Float32Array(arr);
}
function _ensureIntArray(arr) {
    if (arr instanceof Int32Array) return arr;
    if (arr instanceof Uint32Array) return new Int32Array(arr);
    if (Array.isArray(arr)) return new Int32Array(arr);
    return new Int32Array(arr);
}

function _makeIndices(jsArray, forceUint32) {
    const vertexMax = Math.max(0, ...jsArray);
    const need32 = forceUint32 || vertexMax > 65535;
    if (!need32) return new Uint16Array(jsArray);
    return new Uint32Array(jsArray);
}

/* ----------------------------------------------------- */
/* ASCII FBX：尽力解析（常见数组块：Vertices/PolyIndex/Normals/UV） */
/* ----------------------------------------------------- */

function _parseASCIIFBXText(text, opt) {
    // 这是“弱解析”：抓常见结构块，连接/模型变换不保证
    // 对很多导出器足够（尤其只是为了把 mesh 显示出来）
    const submeshes = [];

    // 抓每个 Geometry: ... { Vertices: *N { a,b,c } PolygonVertexIndex:*M {...} ... }
    // 简化：用全局搜索抓第一组数组，可能只适合单 mesh 的 ASCII FBX
    const geoName = _matchFirst(text, /Geometry:\s*\d+,\s*"([^"]+)"/) || "FBX_ASCII_Mesh";

    const vArr = _matchArrayBlock(text, /Vertices:\s*\*\d+\s*\{/);
    const pArr = _matchArrayBlock(text, /PolygonVertexIndex:\s*\*\d+\s*\{/);

    if (!vArr || !pArr) {
        throw new Error("ASCII FBX：未找到 Vertices 或 PolygonVertexIndex（此 ASCII 结构可能不兼容该简易解析器）");
    }

    const verts = new Float64Array(vArr.map(Number));
    const poly = new Int32Array(pArr.map(Number));

    // Normals / UV（可选）
    const nArr = _matchArrayBlock(text, /Normals:\s*\*\d+\s*\{/);
    const uvArr = _matchArrayBlock(text, /UV:\s*\*\d+\s*\{/);
    const uvIdxArr = _matchArrayBlock(text, /UVIndex:\s*\*\d+\s*\{/);

    // 构造“伪 layer node”以复用 build
    const fakeGeo = {
        id: 1,
        name: geoName,
        vertices: verts,
        polyIndex: poly,
        normalsLayer: nArr ? _makeFakeLayer("ByPolygonVertex", "Direct", "Normals", new Float32Array(nArr.map(Number))) : null,
        uvsLayer: (uvArr && uvIdxArr)
            ? _makeFakeLayer("ByPolygonVertex", "IndexToDirect", "UV", new Float32Array(uvArr.map(Number)), "UVIndex", new Int32Array(uvIdxArr.map(Number)))
            : (uvArr ? _makeFakeLayer("ByPolygonVertex", "Direct", "UV", new Float32Array(uvArr.map(Number))) : null),
        colorsLayer: null,
        modelId: null
    };

    const built = _buildMeshFromFBXGeometry(fakeGeo, opt, null);
    for (const sm of built) submeshes.push(sm);

    // 统计
    let allBBox = null, vSum = 0, triSum = 0;
    for (const sm of submeshes) {
        allBBox = _unionBBox(allBBox, sm.bbox);
        vSum += sm.vertexCount;
        triSum += sm.triangleCount;
    }

    return {
        format: "ascii",
        submeshes,
        bbox: allBBox,
        vertexCount: vSum,
        triangleCount: triSum
    };
}

function _matchFirst(text, re) {
    const m = text.match(re);
    return m ? m[1] : null;
}

function _matchArrayBlock(text, startRe) {
    const m = text.match(startRe);
    if (!m) return null;
    const start = m.index + m[0].length;
    // 从 start 开始找配对的 '}'（ASCII FBX 数组块通常没有嵌套）
    const end = text.indexOf("}", start);
    if (end < 0) return null;
    const body = text.slice(start, end);
    // body 里是 "a,b,c\n" 这种
    const nums = body.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
    return nums || null;
}

function _makeFakeLayer(mapping, reference, directName, directArray, indexName = null, indexArray = null) {
    // 构造一个“类似 node”的结构，让 _decodeLayerElement 可用
    const node = {
        name: "LayerElementFake",
        props: [],
        children: [
            { name: "MappingInformationType", props: [mapping], children: [] },
            { name: "ReferenceInformationType", props: [reference], children: [] },
            { name: directName, props: [directArray], children: [] }
        ]
    };
    if (indexName && indexArray) {
        node.children.push({ name: indexName, props: [indexArray], children: [] });
    }
    return node;
}

/* ----------------------------------------------------- */
/* 后处理：全局 bbox/统计（目前 binary/ascii 都已做，这里兜底） */
/* ----------------------------------------------------- */

function _postProcessScene(sceneRes, opt) {
    // 保持结构
    return sceneRes;
}

/* ----------------------------------------------------- */
/* 数学与几何工具（不依赖你的 runtime/mat4）               */
/* ----------------------------------------------------- */

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

function _unionBBox(a, b) {
    if (!a) return b;
    if (!b) return a;
    const min = vec3.fromValues(
        Math.min(a.min[0], b.min[0]),
        Math.min(a.min[1], b.min[1]),
        Math.min(a.min[2], b.min[2])
    );
    const max = vec3.fromValues(
        Math.max(a.max[0], b.max[0]),
        Math.max(a.max[1], b.max[1]),
        Math.max(a.max[2], b.max[2])
    );
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

function _applyCenterScaleToPositions(positions, t) {
    const out = new Float32Array(positions.length);
    const n = (positions.length / 3) | 0;
    for (let i = 0; i < n; i++) {
        let x = positions[i * 3 + 0];
        let y = positions[i * 3 + 1];
        let z = positions[i * 3 + 2];
        if (t.center) { x -= t.cx; y -= t.cy; z -= t.cz; }
        if (t.scaleToUnit) { x *= t.s; y *= t.s; z *= t.s; }
        out[i * 3 + 0] = x;
        out[i * 3 + 1] = y;
        out[i * 3 + 2] = z;
    }
    return out;
}

function _computeVertexNormals(positions, indices, outNormals) {
    // outNormals 必须与 positions 同长度
    outNormals.fill(0);

    const vCount = (positions.length / 3) | 0;
    const triCount = (indices.length / 3) | 0;

    for (let t = 0; t < triCount; t++) {
        const i0 = indices[t * 3 + 0];
        const i1 = indices[t * 3 + 1];
        const i2 = indices[t * 3 + 2];

        const ax = positions[i0 * 3 + 0], ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2];
        const bx = positions[i1 * 3 + 0], by = positions[i1 * 3 + 1], bz = positions[i1 * 3 + 2];
        const cx = positions[i2 * 3 + 0], cy = positions[i2 * 3 + 1], cz = positions[i2 * 3 + 2];

        const abx = bx - ax, aby = by - ay, abz = bz - az;
        const acx = cx - ax, acy = cy - ay, acz = cz - az;

        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;

        outNormals[i0 * 3 + 0] += nx; outNormals[i0 * 3 + 1] += ny; outNormals[i0 * 3 + 2] += nz;
        outNormals[i1 * 3 + 0] += nx; outNormals[i1 * 3 + 1] += ny; outNormals[i1 * 3 + 2] += nz;
        outNormals[i2 * 3 + 0] += nx; outNormals[i2 * 3 + 1] += ny; outNormals[i2 * 3 + 2] += nz;
    }

    _normalizeNormals(outNormals);

    // 如果某些点没被任何面影响（孤立点），给默认
    for (let i = 0; i < vCount; i++) {
        const x = outNormals[i * 3 + 0], y = outNormals[i * 3 + 1], z = outNormals[i * 3 + 2];
        if (Math.hypot(x, y, z) < 1e-9) {
            outNormals[i * 3 + 0] = 0;
            outNormals[i * 3 + 1] = 1;
            outNormals[i * 3 + 2] = 0;
        }
    }
}

function _normalizeNormals(normals) {
    const n = (normals.length / 3) | 0;
    for (let i = 0; i < n; i++) {
        const x = normals[i * 3 + 0];
        const y = normals[i * 3 + 1];
        const z = normals[i * 3 + 2];
        const l = Math.hypot(x, y, z);
        if (l > 1e-12) {
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

/* ---------------- Mat4 minimal ---------------- */

function _mat4Identity() {
    return new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
    ]);
}

function _mat4Mul(a, b) {
    const out = new Float32Array(16);
    // out = a*b
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
            out[c + r * 4] =
                a[0 + r * 4] * b[c + 0 * 4] +
                a[1 + r * 4] * b[c + 1 * 4] +
                a[2 + r * 4] * b[c + 2 * 4] +
                a[3 + r * 4] * b[c + 3 * 4];
        }
    }
    return out;
}

function _mat4FromTRS(t, rDeg, s) {
    const rx = rDeg[0] * Math.PI / 180;
    const ry = rDeg[1] * Math.PI / 180;
    const rz = rDeg[2] * Math.PI / 180;

    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);

    // R = Rz * Ry * Rx（常见兜底）
    const Rz = new Float32Array([
        cz, -sz, 0, 0,
        sz, cz, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
    ]);
    const Ry = new Float32Array([
        cy, 0, sy, 0,
        0, 1, 0, 0,
        -sy, 0, cy, 0,
        0, 0, 0, 1
    ]);
    const Rx = new Float32Array([
        1, 0, 0, 0,
        0, cx, -sx, 0,
        0, sx, cx, 0,
        0, 0, 0, 1
    ]);

    const S = new Float32Array([
        s[0], 0, 0, 0,
        0, s[1], 0, 0,
        0, 0, s[2], 0,
        0, 0, 0, 1
    ]);

    const T = new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        t[0], t[1], t[2], 1
    ]);

    const R = _mat4Mul(_mat4Mul(Rz, Ry), Rx);
    const RS = _mat4Mul(R, S);
    return _mat4Mul(T, RS);
}

function _applyMat4ToPositions(positions, m) {
    const out = new Float32Array(positions.length);
    const n = (positions.length / 3) | 0;
    for (let i = 0; i < n; i++) {
        const x = positions[i * 3 + 0];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        const nx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const ny = m[1] * x + m[5] * y + m[9] * z + m[13];
        const nz = m[2] * x + m[6] * y + m[10] * z + m[14];
        out[i * 3 + 0] = nx;
        out[i * 3 + 1] = ny;
        out[i * 3 + 2] = nz;
    }
    return out;
}

function _applyMat4ToNormals(normals, m) {
    // normal matrix = inverseTranspose(upper3x3)
    const nmat = _mat3NormalFromMat4(m);
    const out = new Float32Array(normals.length);
    const n = (normals.length / 3) | 0;
    for (let i = 0; i < n; i++) {
        const x = normals[i * 3 + 0];
        const y = normals[i * 3 + 1];
        const z = normals[i * 3 + 2];
        let nx = nmat[0] * x + nmat[3] * y + nmat[6] * z;
        let ny = nmat[1] * x + nmat[4] * y + nmat[7] * z;
        let nz = nmat[2] * x + nmat[5] * y + nmat[8] * z;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        out[i * 3 + 0] = nx;
        out[i * 3 + 1] = ny;
        out[i * 3 + 2] = nz;
    }
    return out;
}

function _mat3NormalFromMat4(m) {
    // 取 upper3x3，求逆转置
    const a00 = m[0], a01 = m[4], a02 = m[8];
    const a10 = m[1], a11 = m[5], a12 = m[9];
    const a20 = m[2], a21 = m[6], a22 = m[10];

    const b01 = a22 * a11 - a12 * a21;
    const b11 = -a22 * a10 + a12 * a20;
    const b21 = a21 * a10 - a11 * a20;

    let det = a00 * b01 + a01 * b11 + a02 * b21;
    if (Math.abs(det) < 1e-12) {
        // 退化：直接用 upper3x3（至少能跑）
        return new Float32Array([
            a00, a10, a20,
            a01, a11, a21,
            a02, a12, a22
        ]);
    }
    det = 1.0 / det;

    // inverse(upper3x3)
    const i00 = b01 * det;
    const i01 = (-a22 * a01 + a02 * a21) * det;
    const i02 = (a12 * a01 - a02 * a11) * det;
    const i10 = b11 * det;
    const i11 = (a22 * a00 - a02 * a20) * det;
    const i12 = (-a12 * a00 + a02 * a10) * det;
    const i20 = b21 * det;
    const i21 = (-a21 * a00 + a01 * a20) * det;
    const i22 = (a11 * a00 - a01 * a10) * det;

    // transpose(inverse)
    return new Float32Array([
        i00, i10, i20,
        i01, i11, i21,
        i02, i12, i22
    ]);
}