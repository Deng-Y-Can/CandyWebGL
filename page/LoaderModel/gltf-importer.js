// gltf-importer.js (ES Module)
// 纯解析工具：不依赖 gl，不创建 Mesh/Model
// 支持 .gltf / .glb（glTF 2.0）
// 输出：{ submeshes: [...], bbox, vertexCount, triangleCount, materials, textures, images, format }

import { vec3, mat4, mat3 } from "./math-gl.js";

/**
 * 创建一个“文件选择器解析器”：用于 <input multiple> 选择 gltf+bin+贴图时，解析器能从同一批 File 里按 uri 找到依赖文件。
 * @param {File[]|FileList} files
 * @returns {{ resolve: (uri:string)=>Promise<ArrayBuffer>, has:(uri:string)=>boolean }}
 */
export function createFileResolver(files) {
    const arr = Array.from(files || []);
    const map = new Map();
    for (const f of arr) {
        if (!f) continue;
        map.set(f.name, f);
        // 如果你用 webkitdirectory 选目录，会有相对路径
        if (f.webkitRelativePath) map.set(f.webkitRelativePath, f);
    }

    function _norm(u) {
        return String(u || "").replace(/\\/g, "/").replace(/^\.\/+/, "");
    }
    function _baseName(u) {
        const s = _norm(u);
        const i = s.lastIndexOf("/");
        return i >= 0 ? s.slice(i + 1) : s;
    }

    async function resolve(uri) {
        uri = _norm(uri);
        if (!uri) throw new Error("resolve(uri): uri 为空");

        if (uri.startsWith("data:")) return _decodeDataUriToArrayBuffer(uri);

        // 先精确匹配
        let f = map.get(uri);

        // 再用 basename 匹配（gltf 里常见 'textures/a.png'，但 File 只有 'a.png'）
        if (!f) f = map.get(_baseName(uri));

        if (!f) {
            throw new Error(
                `无法从已选择文件中解析依赖资源：${uri}\n` +
                `建议：选择 gltf 时把同目录下的 .bin/贴图 一起多选导入，或用 http(s) 方式确保可 fetch。`
            );
        }
        return await f.arrayBuffer();
    }

    function has(uri) {
        uri = _norm(uri);
        if (!uri) return false;
        if (uri.startsWith("data:")) return true;
        return map.has(uri) || map.has(_baseName(uri));
    }

    return { resolve, has };
}

/**
 * 解析 glTF/GLB
 * @param {string|ArrayBuffer|Uint8Array|Blob|File|object} source
 *   - URL string（.gltf/.glb）
 *   - ArrayBuffer/Uint8Array/Blob/File
 *   - 或者 { json:object, baseUrl?:string, buffers?:ArrayBuffer[] }（高级用法）
 * @param {{
 *   baseUrl?: string,                 // 用 URL 加载 .gltf 时，依赖 buffer 的相对路径基准
 *   resolver?: (uri:string)=>Promise<ArrayBuffer>,  // 自定义依赖加载器（优先级最高）
 *   files?: File[]|FileList,          // 传入 file input 的同批文件，内部会 createFileResolver
 *   bakeNodeTransform?: boolean,      // 是否把节点 worldMatrix 烘焙到顶点（默认 true）
 *   computeNormals?: boolean,         // 缺法线时计算（默认 true）
 *   center?: boolean,                 // 导入后整体居中（默认 false）
 *   scaleToUnit?: boolean,            // 导入后整体按对角线归一化（默认 false）
 *   defaultColor?: [number,number,number,number], // 无 COLOR_0 时默认色（默认 [1,1,1,1]）
 *   forceUint32?: boolean             // 强制 indices Uint32（默认 false）
 * }} options
 */
export async function parseGLTF(source, options = {}) {
    const opt = {
        baseUrl: options.baseUrl ?? "",
        resolver: options.resolver ?? null,
        files: options.files ?? null,
        bakeNodeTransform: options.bakeNodeTransform ?? true,
        computeNormals: options.computeNormals ?? true,
        center: options.center ?? false,
        scaleToUnit: options.scaleToUnit ?? false,
        defaultColor: options.defaultColor ?? [1, 1, 1, 1],
        forceUint32: options.forceUint32 ?? false,
    };

    // files -> resolver（如果没显式给 resolver）
    if (!opt.resolver && opt.files) {
        const fr = createFileResolver(opt.files);
        opt.resolver = fr.resolve;
    }

    // 1) 取 json + buffers
    const loaded = await _loadGltfOrGlb(source, opt);
    const gltf = loaded.gltf;
    const buffers = loaded.buffers; // ArrayBuffer[]

    // 2) 快速拒绝：压缩扩展
    _throwIfCompressed(gltf);

    // 3) 构建访问器读取上下文
    const ctx = new _GLTFContext(gltf, buffers);

    // 4) 计算节点 world 矩阵（按默认 scene 或全部 scene）
    const sceneIndex = gltf.scene ?? 0;
    const scene = (gltf.scenes && gltf.scenes[sceneIndex]) ? gltf.scenes[sceneIndex] : null;

    const worldMats = _computeWorldMatrices(gltf, scene);

    // 5) 遍历 node->mesh->primitive，生成 submeshes
    const submeshes = [];
    let globalBBox = null;
    let vSum = 0;
    let triSum = 0;

    const nodeIndices = scene?.nodes ?? (gltf.nodes ? gltf.nodes.map((_, i) => i) : []);
    for (const ni of nodeIndices) {
        _collectNodeMeshesRecursive(gltf, ni, worldMats, (nodeIndex, meshIndex, worldMat) => {
            const node = gltf.nodes[nodeIndex];
            const mesh = gltf.meshes?.[meshIndex];
            if (!mesh || !mesh.primitives) return;

            const nodeName = node?.name || `node_${nodeIndex}`;
            const meshName = mesh?.name || `mesh_${meshIndex}`;

            for (let pi = 0; pi < mesh.primitives.length; pi++) {
                const prim = mesh.primitives[pi];
                const built = _buildPrimitiveGeometry(ctx, gltf, prim, opt);

                // 模式转换：strip/fan -> triangles
                _ensureTriangles(built, prim);

                // 缺法线则计算
                if ((!built.normals || built.normals.length === 0) && opt.computeNormals) {
                    built.normals = _computeNormals(built.positions, built.indices);
                } else if (built.normals) {
                    _normalizeNormalsInPlace(built.normals);
                }

                // 颜色补齐
                if (!built.colors) {
                    built.colors = _makeSolidColors((built.positions.length / 3) | 0, opt.defaultColor);
                } else if (built.colors.length === ((built.positions.length / 3) | 0) * 3) {
                    // 如果是 RGB，补 A
                    built.colors = _rgbToRgba(built.colors);
                }

                // 节点变换：可烘焙
                let bakedBBox = built.bbox || _computeBBox(built.positions);
                if (opt.bakeNodeTransform && worldMat) {
                    const res = _bakeTransform(worldMat, built.positions, built.normals);
                    bakedBBox = res.bbox;
                }

                const smName = `${loaded.name || "gltf"} | ${nodeName} | ${meshName} | prim_${pi}`;
                const vCount = (built.positions.length / 3) | 0;
                const tCount = built.indices ? ((built.indices.length / 3) | 0) : ((vCount / 3) | 0);

                submeshes.push({
                    name: smName,
                    nodeIndex,
                    meshIndex,
                    primitiveIndex: pi,
                    materialIndex: prim.material ?? -1,
                    mode: 4, // triangles
                    positions: built.positions,
                    normals: built.normals || null,
                    uvs0: built.uvs0 || null,
                    colors: built.colors || null,
                    indices: built.indices,
                    bbox: bakedBBox,
                    vertexCount: vCount,
                    triangleCount: tCount,
                });

                globalBBox = _unionBBox(globalBBox, bakedBBox);
                vSum += vCount;
                triSum += tCount;
            }
        });
    }

    if (submeshes.length === 0) {
        throw new Error("glTF 解析完成，但没有找到任何可渲染 primitive（可能 scene/nodes/meshes 为空）");
    }

    // 6) center/scaleToUnit（对所有 submesh 做同一变换，保持多模型相对位置）
    if (opt.center || opt.scaleToUnit) {
        const t = _makeCenterScaleTransform(globalBBox, opt.center, opt.scaleToUnit);
        for (const sm of submeshes) {
            _applyPosTransform(sm.positions, t);
            if (sm.normals) _normalizeNormalsInPlace(sm.normals);
            sm.bbox = _computeBBox(sm.positions);
        }
        // new global bbox
        globalBBox = null;
        for (const sm of submeshes) globalBBox = _unionBBox(globalBBox, sm.bbox);
    }

    // 7) 材质/贴图信息（先解析元数据，贴图字节可后续再扩展）
    const materials = _parseMaterials(gltf);
    const textures = _parseTextures(gltf);
    const images = _parseImagesMeta(gltf);

    return {
        format: loaded.format,          // "gltf" | "glb"
        name: loaded.name || "glTF",
        version: gltf.asset?.version || "2.0",
        submeshes,
        bbox: globalBBox,
        vertexCount: vSum,
        triangleCount: triSum,
        materials,
        textures,
        images,
        // 你后面如果要做贴图加载，可以用 gltf + baseUrl/resolver 再去取 image uri
        _gltf: gltf,
        _buffers: buffers,
    };
}

/* ========================================================================== */
/* Loaders                                                                    */
/* ========================================================================== */

async function _loadGltfOrGlb(source, opt) {
    // 高级传参：{json, buffers}
    if (source && typeof source === "object" && source.json) {
        return {
            format: "gltf",
            name: source.name || "glTF",
            gltf: source.json,
            buffers: source.buffers || [],
        };
    }

    // string URL
    if (typeof source === "string") {
        const url = source;
        const lower = url.toLowerCase();
        if (lower.endsWith(".glb")) {
            const r = await fetch(url);
            if (!r.ok) throw new Error(`GLB URL 加载失败：HTTP ${r.status}`);
            const buf = await r.arrayBuffer();
            const parsed = _parseGLB(buf);
            return { format: "glb", name: _fileNameFromUrl(url), gltf: parsed.gltf, buffers: parsed.buffers };
        } else {
            // .gltf
            const r = await fetch(url);
            if (!r.ok) throw new Error(`glTF URL 加载失败：HTTP ${r.status}`);
            const txt = await r.text();
            const gltf = JSON.parse(txt);
            const baseUrl = opt.baseUrl || _dirOfUrl(url);
            const buffers = await _loadBuffersForGLTF(gltf, baseUrl, opt.resolver);
            return { format: "gltf", name: _fileNameFromUrl(url), gltf, buffers };
        }
    }

    // Uint8Array / ArrayBuffer / Blob / File
    if (source instanceof Uint8Array) {
        return _loadGltfOrGlb(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), opt);
    }
    if (source instanceof ArrayBuffer) {
        // 判断是否 GLB
        if (_looksLikeGLB(source)) {
            const parsed = _parseGLB(source);
            return { format: "glb", name: "model.glb", gltf: parsed.gltf, buffers: parsed.buffers };
        } else {
            // 当成 glTF JSON 文本
            const txt = new TextDecoder("utf-8").decode(new Uint8Array(source));
            const gltf = JSON.parse(txt);
            const buffers = await _loadBuffersForGLTF(gltf, opt.baseUrl || "", opt.resolver);
            return { format: "gltf", name: "model.gltf", gltf, buffers };
        }
    }
    if (source && typeof source.arrayBuffer === "function") {
        const name = source.name || "model";
        const buf = await source.arrayBuffer();
        if (_looksLikeGLB(buf) || name.toLowerCase().endsWith(".glb")) {
            const parsed = _parseGLB(buf);
            return { format: "glb", name, gltf: parsed.gltf, buffers: parsed.buffers };
        } else {
            // File 里是 .gltf（text）
            const txt = await source.text?.() ?? new TextDecoder("utf-8").decode(new Uint8Array(buf));
            const gltf = JSON.parse(txt);
            const buffers = await _loadBuffersForGLTF(gltf, opt.baseUrl || "", opt.resolver);
            return { format: "gltf", name, gltf, buffers };
        }
    }

    throw new Error("parseGLTF：不支持的 source 类型（请传 URL / ArrayBuffer / File / Uint8Array 等）");
}

function _looksLikeGLB(buf) {
    if (!(buf instanceof ArrayBuffer) || buf.byteLength < 12) return false;
    const dv = new DataView(buf);
    const magic = dv.getUint32(0, true);
    // 'glTF' little endian => 0x46546C67
    return magic === 0x46546C67;
}

function _parseGLB(buf) {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546C67) throw new Error("GLB magic 不正确");
    const version = dv.getUint32(4, true);
    if (version !== 2) throw new Error(`仅支持 GLB v2（当前 ${version}）`);
    const length = dv.getUint32(8, true);
    if (length > buf.byteLength) throw new Error("GLB length 字段大于实际文件长度");

    let off = 12;
    let jsonChunk = null;
    let binChunk = null;

    while (off + 8 <= buf.byteLength) {
        const chunkLen = dv.getUint32(off + 0, true);
        const chunkType = dv.getUint32(off + 4, true);
        off += 8;
        const chunkData = buf.slice(off, off + chunkLen);
        off += chunkLen;

        // 'JSON' => 0x4E4F534A, 'BIN\0' => 0x004E4942
        if (chunkType === 0x4E4F534A) jsonChunk = chunkData;
        else if (chunkType === 0x004E4942) binChunk = chunkData;
    }

    if (!jsonChunk) throw new Error("GLB 缺少 JSON chunk");
    const jsonText = new TextDecoder("utf-8").decode(new Uint8Array(jsonChunk));
    const gltf = JSON.parse(jsonText);

    // GLB 的 buffer[0] 通常指向 BIN chunk
    const buffers = [];
    if (gltf.buffers && gltf.buffers.length > 0) {
        // 只要有 buffers，就按其数量准备；其中第一个通常是 binChunk
        for (let i = 0; i < gltf.buffers.length; i++) buffers[i] = null;
        buffers[0] = binChunk || new ArrayBuffer(0);
    } else {
        buffers[0] = binChunk || new ArrayBuffer(0);
    }
    return { gltf, buffers };
}

async function _loadBuffersForGLTF(gltf, baseUrl, resolver) {
    const buffers = [];
    const list = gltf.buffers || [];
    for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (!b.uri) {
            // glTF 也允许没有 uri（但这种一般是 GLB）
            buffers[i] = new ArrayBuffer(0);
            continue;
        }

        if (b.uri.startsWith("data:")) {
            buffers[i] = await _decodeDataUriToArrayBuffer(b.uri);
            continue;
        }

        // 走 resolver（优先）
        if (resolver) {
            buffers[i] = await resolver(b.uri);
            continue;
        }

        // 否则 fetch baseUrl + uri
        const url = _joinUrl(baseUrl, b.uri);
        const r = await fetch(url);
        if (!r.ok) throw new Error(`buffer 加载失败：${url} HTTP ${r.status}`);
        buffers[i] = await r.arrayBuffer();
    }
    return buffers;
}

/* ========================================================================== */
/* Context + Accessors                                                        */
/* ========================================================================== */

class _GLTFContext {
    constructor(gltf, buffers) {
        this.gltf = gltf;
        this.buffers = buffers || [];
    }

    getBufferViewBytes(bvIndex) {
        const bv = this.gltf.bufferViews?.[bvIndex];
        if (!bv) throw new Error(`bufferView[${bvIndex}] 不存在`);
        const buf = this.buffers[bv.buffer ?? 0];
        if (!buf) throw new Error(`bufferView[${bvIndex}] 引用的 buffer 未加载`);
        const byteOffset = (bv.byteOffset ?? 0);
        const byteLength = (bv.byteLength ?? 0);
        return {
            arrayBuffer: buf,
            byteOffset,
            byteLength,
            byteStride: bv.byteStride ?? 0,
        };
    }

    /**
     * 读取 accessor，默认转 Float32Array（属性）；indices 会按其 componentType 输出 Uint16/Uint32 等。
     * @param {number} accIndex
     * @param {{ asIndices?: boolean }} options
     */
    readAccessor(accIndex, options = {}) {
        const acc = this.gltf.accessors?.[accIndex];
        if (!acc) throw new Error(`accessor[${accIndex}] 不存在`);

        const count = acc.count ?? 0;
        const type = acc.type;
        const numComp = _NUM_COMP[type];
        if (!numComp) throw new Error(`不支持 accessor.type: ${type}`);

        const normalized = !!acc.normalized;
        const componentType = acc.componentType;

        // base array：可能没有 bufferView（允许 sparse-only）
        let out = null;

        if (acc.bufferView != null) {
            const bvBytes = this.getBufferViewBytes(acc.bufferView);
            const stride = bvBytes.byteStride || (numComp * _BYTES_PER_COMPONENT[componentType]);
            const start = bvBytes.byteOffset + (acc.byteOffset ?? 0);

            out = _readAccessorGeneric(
                bvBytes.arrayBuffer,
                start,
                count,
                numComp,
                componentType,
                stride,
                normalized,
                !!options.asIndices
            );
        } else {
            // 没有 bufferView：全 0
            out = options.asIndices
                ? _makeZeroIndices(count, componentType)
                : new Float32Array(count * numComp);
        }

        // sparse 覆盖
        if (acc.sparse) {
            out = _applySparseAccessor(this, acc, out, options);
        }

        return out;
    }
}

function _readAccessorGeneric(buffer, byteOffset, count, numComp, componentType, stride, normalized, asIndices) {
    const bpc = _BYTES_PER_COMPONENT[componentType];
    if (!bpc) throw new Error(`不支持 componentType: ${componentType}`);

    if (asIndices) {
        // indices：输出整数 typed array
        const Ctor = _INDEX_CTOR[componentType];
        if (!Ctor) throw new Error(`indices 不支持 componentType: ${componentType}`);
        const out = new Ctor(count * numComp); // indices 的 numComp 应该是 1
        // stride 对 indices 也可能存在（一般不会）
        const dv = new DataView(buffer);
        let o = 0;
        for (let i = 0; i < count; i++) {
            const base = byteOffset + i * stride;
            out[o++] = _readScalar(dv, base, componentType, false);
        }
        return out;
    }

    // attributes：统一转 Float32Array
    const out = new Float32Array(count * numComp);
    const dv = new DataView(buffer);
    let o = 0;

    for (let i = 0; i < count; i++) {
        const base = byteOffset + i * stride;
        for (let c = 0; c < numComp; c++) {
            const v = _readScalar(dv, base + c * bpc, componentType, normalized);
            out[o++] = v;
        }
    }
    return out;
}

function _applySparseAccessor(ctx, acc, baseArray, options) {
    const sparse = acc.sparse;
    const count = sparse.count ?? 0;
    if (count <= 0) return baseArray;

    const type = acc.type;
    const numComp = _NUM_COMP[type];
    const componentType = acc.componentType;
    const normalized = !!acc.normalized;

    // indices
    const idxAcc = sparse.indices;
    const idxBV = ctx.getBufferViewBytes(idxAcc.bufferView);
    const idxStride = idxBV.byteStride || _BYTES_PER_COMPONENT[idxAcc.componentType];
    const idxStart = idxBV.byteOffset + (idxAcc.byteOffset ?? 0);
    const idx = _readAccessorGeneric(
        idxBV.arrayBuffer,
        idxStart,
        count,
        1,
        idxAcc.componentType,
        idxStride,
        false,
        true
    );

    // values
    const valAcc = sparse.values;
    const valBV = ctx.getBufferViewBytes(valAcc.bufferView);
    const valStride = valBV.byteStride || (numComp * _BYTES_PER_COMPONENT[componentType]);
    const valStart = valBV.byteOffset + (valAcc.byteOffset ?? 0);
    const values = _readAccessorGeneric(
        valBV.arrayBuffer,
        valStart,
        count,
        numComp,
        componentType,
        valStride,
        normalized,
        !!options.asIndices
    );

    // apply
    if (options.asIndices) {
        // indices sparse：很少见，这里按 int 写入
        const out = baseArray.slice ? baseArray.slice() : new baseArray.constructor(baseArray);
        for (let i = 0; i < count; i++) {
            const dst = idx[i];
            out[dst] = values[i];
        }
        return out;
    } else {
        const out = baseArray.slice ? baseArray.slice() : new Float32Array(baseArray);
        for (let i = 0; i < count; i++) {
            const dst = idx[i];
            const dstOff = dst * numComp;
            const srcOff = i * numComp;
            for (let c = 0; c < numComp; c++) out[dstOff + c] = values[srcOff + c];
        }
        return out;
    }
}

/* ========================================================================== */
/* Build primitives                                                            */
/* ========================================================================== */

function _buildPrimitiveGeometry(ctx, gltf, prim, opt) {
    const attrs = prim.attributes || {};
    const posAcc = attrs.POSITION;
    if (posAcc == null) throw new Error("primitive 缺少 POSITION");

    const positions = ctx.readAccessor(posAcc, { asIndices: false });
    let normals = null;
    if (attrs.NORMAL != null) normals = ctx.readAccessor(attrs.NORMAL, { asIndices: false });

    let uvs0 = null;
    if (attrs.TEXCOORD_0 != null) uvs0 = ctx.readAccessor(attrs.TEXCOORD_0, { asIndices: false });

    let colors = null;
    if (attrs.COLOR_0 != null) {
        colors = ctx.readAccessor(attrs.COLOR_0, { asIndices: false });
        // glTF 允许 VEC3/VEC4
        const acc = gltf.accessors[attrs.COLOR_0];
        if (acc.type === "VEC3") {
            colors = _rgbToRgba(colors);
        }
    }

    let indices = null;
    if (prim.indices != null) {
        const idxAcc = gltf.accessors[prim.indices];
        const idxArr = ctx.readAccessor(prim.indices, { asIndices: true });
        indices = _ensureIndexType(idxArr, idxAcc.componentType, opt.forceUint32);
    } else {
        // 没 indices：按顺序生成
        const vCount = (positions.length / 3) | 0;
        indices = _makeSequentialIndices(vCount, opt.forceUint32);
    }

    const bbox = _computeBBox(positions);

    return { positions, normals, uvs0, colors, indices, bbox };
}

function _ensureTriangles(geo, prim) {
    const mode = prim.mode ?? 4;
    if (mode === 4) return; // TRIANGLES

    // TRIANGLE_STRIP (5) / TRIANGLE_FAN (6) 转 TRIANGLES
    const idx = geo.indices;
    if (!idx) return;

    if (mode === 5) {
        geo.indices = _trianglesFromStrip(idx);
    } else if (mode === 6) {
        geo.indices = _trianglesFromFan(idx);
    } else if (mode === 0) {
        // POINTS：你现有 runtime 也能渲染点，但这里统一输出 triangles 比较麻烦
        // 直接保留 indices，调用方可以改成 POINTS 模式渲染
        // 这里不强转
    } else {
        // 其它线段模式先不处理
    }
}

function _trianglesFromStrip(indices) {
    const n = indices.length;
    if (n < 3) return indices.constructor.from(indices);
    const triCount = n - 2;
    const out = new indices.constructor(triCount * 3);
    let o = 0;
    for (let i = 0; i < triCount; i++) {
        const a = indices[i], b = indices[i + 1], c = indices[i + 2];
        // strip 奇偶翻转
        if ((i & 1) === 0) {
            out[o++] = a; out[o++] = b; out[o++] = c;
        } else {
            out[o++] = b; out[o++] = a; out[o++] = c;
        }
    }
    return out;
}

function _trianglesFromFan(indices) {
    const n = indices.length;
    if (n < 3) return indices.constructor.from(indices);
    const triCount = n - 2;
    const out = new indices.constructor(triCount * 3);
    const a0 = indices[0];
    let o = 0;
    for (let i = 0; i < triCount; i++) {
        out[o++] = a0;
        out[o++] = indices[i + 1];
        out[o++] = indices[i + 2];
    }
    return out;
}

/* ========================================================================== */
/* World matrices                                                              */
/* ========================================================================== */

function _computeWorldMatrices(gltf, scene) {
    const nodes = gltf.nodes || [];
    const world = new Array(nodes.length);
    const visited = new Uint8Array(nodes.length);

    const roots = scene?.nodes ?? nodes.map((_, i) => i);

    const I = mat4.create();

    function dfs(nodeIndex, parentMat) {
        if (nodeIndex == null || nodeIndex < 0 || nodeIndex >= nodes.length) return;
        const node = nodes[nodeIndex];
        const local = _nodeLocalMatrix(node);
        const wm = mat4.create();
        mat4.mul(wm, parentMat, local);
        world[nodeIndex] = wm;
        visited[nodeIndex] = 1;

        const children = node.children || [];
        for (const ci of children) dfs(ci, wm);
    }

    for (const ri of roots) dfs(ri, I);

    // 有些 gltf scene.nodes 不全，补齐未访问节点（不影响已访问）
    for (let i = 0; i < nodes.length; i++) {
        if (!visited[i]) dfs(i, I);
    }

    return world;
}

function _nodeLocalMatrix(node) {
    if (!node) return mat4.create();
    if (node.matrix && node.matrix.length === 16) {
        const m = mat4.create();
        for (let i = 0; i < 16; i++) m[i] = node.matrix[i];
        return m;
    }

    const t = node.translation || [0, 0, 0];
    const r = node.rotation || [0, 0, 0, 1]; // quat x,y,z,w
    const s = node.scale || [1, 1, 1];

    // mat4 = T * R * S
    const m = mat4.create();
    _mat4FromTRS(m, t, r, s);
    return m;
}

function _mat4FromTRS(out, t, q, s) {
    // quat -> mat3
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;

    const sx = s[0], sy = s[1], sz = s[2];

    out[0] = (1 - (yy + zz)) * sx;
    out[1] = (xy + wz) * sx;
    out[2] = (xz - wy) * sx;
    out[3] = 0;

    out[4] = (xy - wz) * sy;
    out[5] = (1 - (xx + zz)) * sy;
    out[6] = (yz + wx) * sy;
    out[7] = 0;

    out[8] = (xz + wy) * sz;
    out[9] = (yz - wx) * sz;
    out[10] = (1 - (xx + yy)) * sz;
    out[11] = 0;

    out[12] = t[0];
    out[13] = t[1];
    out[14] = t[2];
    out[15] = 1;

    return out;
}

function _collectNodeMeshesRecursive(gltf, nodeIndex, worldMats, cb) {
    const node = gltf.nodes?.[nodeIndex];
    if (!node) return;
    if (node.mesh != null) cb(nodeIndex, node.mesh, worldMats[nodeIndex] || mat4.create());
    const children = node.children || [];
    for (const ci of children) _collectNodeMeshesRecursive(gltf, ci, worldMats, cb);
}

/* ========================================================================== */
/* Bake transform                                                              */
/* ========================================================================== */

function _bakeTransform(worldMat, positions, normals) {
    // positions: vec3, normals: vec3 (optional)
    const n = (positions.length / 3) | 0;
    const outMin = vec3.fromValues(Infinity, Infinity, Infinity);
    const outMax = vec3.fromValues(-Infinity, -Infinity, -Infinity);
    const tmp = new Float32Array(4);

    // normal matrix = inverseTranspose(mat3(world))
    let nmat = null;
    if (normals) {
        nmat = mat3.create();
        if (mat3.normalFromMat4) {
            mat3.normalFromMat4(nmat, worldMat);
        } else {
            // fallback：自己算 inverseTranspose
            nmat = _normalMat3FromMat4Fallback(worldMat);
        }
    }

    for (let i = 0; i < n; i++) {
        const x = positions[i * 3 + 0];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];

        _mulMat4Vec4(tmp, worldMat, x, y, z, 1);
        const iw = tmp[3] || 1;
        const px = tmp[0] / iw;
        const py = tmp[1] / iw;
        const pz = tmp[2] / iw;

        positions[i * 3 + 0] = px;
        positions[i * 3 + 1] = py;
        positions[i * 3 + 2] = pz;

        _bboxAcc(outMin, outMax, px, py, pz);

        if (normals && nmat) {
            const nx = normals[i * 3 + 0];
            const ny = normals[i * 3 + 1];
            const nz = normals[i * 3 + 2];
            const tx = nmat[0] * nx + nmat[3] * ny + nmat[6] * nz;
            const ty = nmat[1] * nx + nmat[4] * ny + nmat[7] * nz;
            const tz = nmat[2] * nx + nmat[5] * ny + nmat[8] * nz;
            const l = Math.hypot(tx, ty, tz) || 1;
            normals[i * 3 + 0] = tx / l;
            normals[i * 3 + 1] = ty / l;
            normals[i * 3 + 2] = tz / l;
        }
    }

    return { bbox: { min: outMin, max: outMax } };
}

function _normalMat3FromMat4Fallback(m4) {
    // 取左上 3x3，求逆转置
    const a00 = m4[0], a01 = m4[4], a02 = m4[8];
    const a10 = m4[1], a11 = m4[5], a12 = m4[9];
    const a20 = m4[2], a21 = m4[6], a22 = m4[10];

    const b01 = a22 * a11 - a12 * a21;
    const b11 = -a22 * a10 + a12 * a20;
    const b21 = a21 * a10 - a11 * a20;

    let det = a00 * b01 + a01 * b11 + a02 * b21;
    if (!det) det = 1e-12;
    det = 1.0 / det;

    const out = mat3.create();
    out[0] = b01 * det;
    out[1] = (-a22 * a01 + a02 * a21) * det;
    out[2] = (a12 * a01 - a02 * a11) * det;
    out[3] = b11 * det;
    out[4] = (a22 * a00 - a02 * a20) * det;
    out[5] = (-a12 * a00 + a02 * a10) * det;
    out[6] = b21 * det;
    out[7] = (-a21 * a00 + a01 * a20) * det;
    out[8] = (a11 * a00 - a01 * a10) * det;

    // inverse 的转置，本来应再 transpose 一下；但上面构造已按常见 normalFromMat4 形式排列
    // 如果你的 math-gl mat3 是列主序，这里与上面使用一致（tx = m[0]*nx + m[3]*ny + m[6]*nz）
    return out;
}

function _mulMat4Vec4(out4, m, x, y, z, w) {
    out4[0] = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
    out4[1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
    out4[2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
    out4[3] = m[3] * x + m[7] * y + m[11] * z + m[15] * w;
    return out4;
}

/* ========================================================================== */
/* Normals                                                                     */
/* ========================================================================== */

function _computeNormals(positions, indices) {
    const vCount = (positions.length / 3) | 0;
    const out = new Float32Array(vCount * 3);

    const triCount = indices ? ((indices.length / 3) | 0) : ((vCount / 3) | 0);

    for (let t = 0; t < triCount; t++) {
        const i0 = indices ? indices[t * 3 + 0] : (t * 3 + 0);
        const i1 = indices ? indices[t * 3 + 1] : (t * 3 + 1);
        const i2 = indices ? indices[t * 3 + 2] : (t * 3 + 2);

        const ax = positions[i0 * 3 + 0], ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2];
        const bx = positions[i1 * 3 + 0], by = positions[i1 * 3 + 1], bz = positions[i1 * 3 + 2];
        const cx = positions[i2 * 3 + 0], cy = positions[i2 * 3 + 1], cz = positions[i2 * 3 + 2];

        const abx = bx - ax, aby = by - ay, abz = bz - az;
        const acx = cx - ax, acy = cy - ay, acz = cz - az;

        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;

        out[i0 * 3 + 0] += nx; out[i0 * 3 + 1] += ny; out[i0 * 3 + 2] += nz;
        out[i1 * 3 + 0] += nx; out[i1 * 3 + 1] += ny; out[i1 * 3 + 2] += nz;
        out[i2 * 3 + 0] += nx; out[i2 * 3 + 1] += ny; out[i2 * 3 + 2] += nz;
    }

    _normalizeNormalsInPlace(out);
    return out;
}

function _normalizeNormalsInPlace(normals) {
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

/* ========================================================================== */
/* Materials meta                                                              */
/* ========================================================================== */

function _parseMaterials(gltf) {
    const mats = gltf.materials || [];
    return mats.map((m, i) => {
        const pbr = m.pbrMetallicRoughness || {};
        return {
            index: i,
            name: m.name || `mat_${i}`,
            doubleSided: !!m.doubleSided,
            alphaMode: m.alphaMode || "OPAQUE",
            alphaCutoff: m.alphaCutoff ?? 0.5,
            baseColorFactor: pbr.baseColorFactor || [1, 1, 1, 1],
            baseColorTexture: pbr.baseColorTexture?.index ?? -1,
            metallicFactor: pbr.metallicFactor ?? 1,
            roughnessFactor: pbr.roughnessFactor ?? 1,
            metallicRoughnessTexture: pbr.metallicRoughnessTexture?.index ?? -1,
            normalTexture: m.normalTexture?.index ?? -1,
            occlusionTexture: m.occlusionTexture?.index ?? -1,
            emissiveTexture: m.emissiveTexture?.index ?? -1,
            emissiveFactor: m.emissiveFactor || [0, 0, 0],
        };
    });
}

function _parseTextures(gltf) {
    const tx = gltf.textures || [];
    return tx.map((t, i) => ({
        index: i,
        name: t.name || `tex_${i}`,
        source: t.source ?? -1,
        sampler: t.sampler ?? -1,
    }));
}

function _parseImagesMeta(gltf) {
    const imgs = gltf.images || [];
    return imgs.map((im, i) => ({
        index: i,
        name: im.name || `img_${i}`,
        uri: im.uri ?? null,
        mimeType: im.mimeType ?? null,
        bufferView: im.bufferView ?? null,
    }));
}

/* ========================================================================== */
/* Utils                                                                       */
/* ========================================================================== */

function _throwIfCompressed(gltf) {
    // primitive.extensions 里若包含 draco/meshopt，我们直接报错
    const meshes = gltf.meshes || [];
    for (const mesh of meshes) {
        for (const prim of (mesh.primitives || [])) {
            const ext = prim.extensions || {};
            if (ext.KHR_draco_mesh_compression) {
                throw new Error("不支持 KHR_draco_mesh_compression（需要 Draco 解码器）");
            }
            if (ext.EXT_meshopt_compression) {
                throw new Error("不支持 EXT_meshopt_compression（需要 meshopt 解码器）");
            }
        }
    }
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

function _bboxAcc(min, max, x, y, z) {
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
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
        const diag = Math.max(1e-12, Math.hypot(dx, dy, dz));
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

function _makeSolidColors(vCount, rgba) {
    const out = new Float32Array(vCount * 4);
    for (let i = 0; i < vCount; i++) out.set(rgba, i * 4);
    return out;
}

function _rgbToRgba(rgbFloat3) {
    const vCount = (rgbFloat3.length / 3) | 0;
    const out = new Float32Array(vCount * 4);
    for (let i = 0; i < vCount; i++) {
        out[i * 4 + 0] = rgbFloat3[i * 3 + 0];
        out[i * 4 + 1] = rgbFloat3[i * 3 + 1];
        out[i * 4 + 2] = rgbFloat3[i * 3 + 2];
        out[i * 4 + 3] = 1.0;
    }
    return out;
}

function _ensureIndexType(idxArr, componentType, forceUint32) {
    if (forceUint32) {
        if (idxArr instanceof Uint32Array) return idxArr;
        const out = new Uint32Array(idxArr.length);
        for (let i = 0; i < idxArr.length; i++) out[i] = idxArr[i];
        return out;
    }
    // 否则保持原样（常见 Uint16/Uint32）
    return idxArr;
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

function _makeZeroIndices(count, componentType) {
    const Ctor = _INDEX_CTOR[componentType] || Uint16Array;
    return new Ctor(count);
}

function _readScalar(dv, byteOffset, componentType, normalized) {
    let v;
    switch (componentType) {
        case 5120: v = dv.getInt8(byteOffset); break;
        case 5121: v = dv.getUint8(byteOffset); break;
        case 5122: v = dv.getInt16(byteOffset, true); break;
        case 5123: v = dv.getUint16(byteOffset, true); break;
        case 5125: v = dv.getUint32(byteOffset, true); break;
        case 5126: v = dv.getFloat32(byteOffset, true); break;
        default: throw new Error(`不支持 componentType: ${componentType}`);
    }

    if (!normalized) return v;

    // normalized 整数 -> 0..1 or -1..1
    if (componentType === 5121) return v / 255;
    if (componentType === 5123) return v / 65535;
    if (componentType === 5120) return Math.max(-1, v / 127);
    if (componentType === 5122) return Math.max(-1, v / 32767);
    return v;
}

async function _decodeDataUriToArrayBuffer(dataUri) {
    // data:[<mime>][;base64],<data>
    const comma = dataUri.indexOf(",");
    if (comma < 0) throw new Error("data URI 无逗号分隔");
    const head = dataUri.slice(0, comma);
    const data = dataUri.slice(comma + 1);
    const isB64 = head.includes(";base64");
    if (!isB64) {
        // percent-encoded
        const txt = decodeURIComponent(data);
        const u8 = new Uint8Array(txt.length);
        for (let i = 0; i < txt.length; i++) u8[i] = txt.charCodeAt(i) & 255;
        return u8.buffer;
    }
    const bin = atob(data);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i) & 255;
    return u8.buffer;
}

function _joinUrl(baseUrl, uri) {
    if (!baseUrl) return uri;
    if (/^https?:\/\//i.test(uri)) return uri;
    if (uri.startsWith("/")) return uri; // 绝对路径交给调用者
    return baseUrl.replace(/\/+$/, "") + "/" + uri.replace(/^\/+/, "");
}

function _dirOfUrl(url) {
    const i = url.lastIndexOf("/");
    return i >= 0 ? url.slice(0, i + 1) : "";
}

function _fileNameFromUrl(url) {
    const s = String(url);
    const i = s.lastIndexOf("/");
    return i >= 0 ? s.slice(i + 1) : s;
}

/* ========================================================================== */
/* Constants                                                                   */
/* ========================================================================== */

const _NUM_COMP = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT2: 4,
    MAT3: 9,
    MAT4: 16,
};

const _BYTES_PER_COMPONENT = {
    5120: 1, // BYTE
    5121: 1, // UNSIGNED_BYTE
    5122: 2, // SHORT
    5123: 2, // UNSIGNED_SHORT
    5125: 4, // UNSIGNED_INT
    5126: 4, // FLOAT
};

const _INDEX_CTOR = {
    5121: Uint8Array,
    5123: Uint16Array,
    5125: Uint32Array,
};

const _INDEX_CTOR_SAFE = _INDEX_CTOR;