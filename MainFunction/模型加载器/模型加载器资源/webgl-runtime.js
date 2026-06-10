// webgl-runtime.js (ES Module)
// 依赖：math-gl.js（你已有的纯数学库）
// WebGL1/WebGL2 兼容的渲染基础层：Scene/Model/Mesh/Shader/Camera/Texture/Renderer

import { vec2, vec3, vec4, mat3, mat4, quat, mathf } from "./math-gl.js";

// ==============================
// GLDevice：封装 WebGL1/2 + 扩展能力
// ==============================
export class GLDevice {
    constructor(gl) {
        this.gl = gl;
        this.isWebGL2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;

        // Extensions for WebGL1
        this.extVAO = this.isWebGL2 ? null : gl.getExtension("OES_vertex_array_object");
        this.extInstanced = this.isWebGL2 ? null : gl.getExtension("ANGLE_instanced_arrays");
        this.extUint32 = this.isWebGL2 ? true : !!gl.getExtension("OES_element_index_uint");

        this.maxTextureUnits = gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) | 0;

        // State cache
        this._state = {
            program: null,
            vao: null,
            arrayBuffer: null,
            elementArrayBuffer: null,
            activeTexUnit: -1,
            textures: new Map(), // key: unit -> texture
            depthTest: null,
            depthWrite: null,
            blend: null,
            cull: null,
        };
    }

    static createFromCanvas(canvas, opts = {}) {
        const gl =
            canvas.getContext("webgl2", opts) ||
            canvas.getContext("webgl", opts) ||
            canvas.getContext("experimental-webgl", opts);
        if (!gl) throw new Error("无法创建 WebGL 上下文（webgl/webgl2）");
        return new GLDevice(gl);
    }

    // VAO wrapper
    createVertexArray() {
        const gl = this.gl;
        if (this.isWebGL2) return gl.createVertexArray();
        if (!this.extVAO) return null;
        return this.extVAO.createVertexArrayOES();
    }
    bindVertexArray(vao) {
        const gl = this.gl;
        if (this._state.vao === vao) return;
        this._state.vao = vao;
        if (this.isWebGL2) gl.bindVertexArray(vao);
        else if (this.extVAO) this.extVAO.bindVertexArrayOES(vao);
    }
    deleteVertexArray(vao) {
        const gl = this.gl;
        if (this.isWebGL2) gl.deleteVertexArray(vao);
        else if (this.extVAO) this.extVAO.deleteVertexArrayOES(vao);
    }

    // Instancing wrapper
    vertexAttribDivisor(loc, divisor) {
        const gl = this.gl;
        if (this.isWebGL2) gl.vertexAttribDivisor(loc, divisor);
        else if (this.extInstanced) this.extInstanced.vertexAttribDivisorANGLE(loc, divisor);
        else if (divisor !== 0) throw new Error("当前上下文不支持 instancing（ANGLE_instanced_arrays）");
    }
    drawElementsInstanced(mode, count, type, offset, instanceCount) {
        const gl = this.gl;
        if (this.isWebGL2) gl.drawElementsInstanced(mode, count, type, offset, instanceCount);
        else if (this.extInstanced) this.extInstanced.drawElementsInstancedANGLE(mode, count, type, offset, instanceCount);
        else throw new Error("当前上下文不支持 instancing（ANGLE_instanced_arrays）");
    }
    drawArraysInstanced(mode, first, count, instanceCount) {
        const gl = this.gl;
        if (this.isWebGL2) gl.drawArraysInstanced(mode, first, count, instanceCount);
        else if (this.extInstanced) this.extInstanced.drawArraysInstancedANGLE(mode, first, count, instanceCount);
        else throw new Error("当前上下文不支持 instancing（ANGLE_instanced_arrays）");
    }

    // Buffer bind cache
    bindArrayBuffer(buf) {
        const gl = this.gl;
        if (this._state.arrayBuffer === buf) return;
        this._state.arrayBuffer = buf;
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    }
    bindElementArrayBuffer(buf) {
        const gl = this.gl;
        if (this._state.elementArrayBuffer === buf) return;
        this._state.elementArrayBuffer = buf;
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
    }

    useProgram(program) {
        const gl = this.gl;
        const p = program ? program.handle : null;
        if (this._state.program === p) return;
        this._state.program = p;
        gl.useProgram(p);
    }

    activeTexture(unit) {
        const gl = this.gl;
        if (this._state.activeTexUnit === unit) return;
        this._state.activeTexUnit = unit;
        gl.activeTexture(gl.TEXTURE0 + unit);
    }

    bindTexture2D(unit, tex) {
        const gl = this.gl;
        this.activeTexture(unit);
        const prev = this._state.textures.get(unit) || null;
        const h = tex ? tex.handle : null;
        if (prev === h) return;
        this._state.textures.set(unit, h);
        gl.bindTexture(gl.TEXTURE_2D, h);
    }

    setDepthTest(enabled) {
        const gl = this.gl;
        if (this._state.depthTest === enabled) return;
        this._state.depthTest = enabled;
        if (enabled) gl.enable(gl.DEPTH_TEST);
        else gl.disable(gl.DEPTH_TEST);
    }

    setDepthWrite(enabled) {
        const gl = this.gl;
        if (this._state.depthWrite === enabled) return;
        this._state.depthWrite = enabled;
        gl.depthMask(!!enabled);
    }

    setBlend(enabled) {
        const gl = this.gl;
        if (this._state.blend === enabled) return;
        this._state.blend = enabled;
        if (enabled) gl.enable(gl.BLEND);
        else gl.disable(gl.BLEND);
    }

    setCull(enabled) {
        const gl = this.gl;
        if (this._state.cull === enabled) return;
        this._state.cull = enabled;
        if (enabled) gl.enable(gl.CULL_FACE);
        else gl.disable(gl.CULL_FACE);
    }
}

// ==============================
// Shader / Program
// ==============================
export class Shader {
    constructor(device, type, source) {
        this.device = device;
        this.gl = device.gl;
        this.type = type;
        this.source = source;
        this.handle = this._compile(type, source);
    }

    _compile(type, source) {
        const gl = this.gl;
        const sh = gl.createShader(type);
        gl.shaderSource(sh, source);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(sh) || "";
            gl.deleteShader(sh);
            throw new Error(`Shader 编译失败：\n${log}\n---SOURCE---\n${source}`);
        }
        return sh;
    }

    dispose() {
        if (this.handle) {
            this.gl.deleteShader(this.handle);
            this.handle = null;
        }
    }
}

export class Program {
    constructor(device, vsSource, fsSource) {
        this.device = device;
        this.gl = device.gl;
        this.handle = this._link(vsSource, fsSource);

        this._uniformLoc = new Map();
        this._attribLoc = new Map();

        // 可选：缓存 uniform 类型（用于自动 setUniform）
        this._uniformType = new Map();
        this._introspectUniforms();
    }

    static fromSources(device, sources) {
        // sources 可给：
        // { vs100, fs100, vs300, fs300 } 或 { vs, fs }
        if (sources.vs && sources.fs) return new Program(device, sources.vs, sources.fs);

        const is2 = device.isWebGL2;
        const vs = is2 ? sources.vs300 : sources.vs100;
        const fs = is2 ? sources.fs300 : sources.fs100;
        if (!vs || !fs) throw new Error("Program.fromSources：缺少对应 GLSL 版本的源码");
        return new Program(device, vs, fs);
    }

    _link(vsSource, fsSource) {
        const gl = this.gl;
        const vs = new Shader(this.device, gl.VERTEX_SHADER, vsSource);
        const fs = new Shader(this.device, gl.FRAGMENT_SHADER, fsSource);

        const p = gl.createProgram();
        gl.attachShader(p, vs.handle);
        gl.attachShader(p, fs.handle);
        gl.linkProgram(p);

        // shaders 可删
        vs.dispose();
        fs.dispose();

        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(p) || "";
            gl.deleteProgram(p);
            throw new Error(`Program link 失败：\n${log}`);
        }
        return p;
    }

    _introspectUniforms() {
        const gl = this.gl;
        const p = this.handle;
        const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) | 0;
        for (let i = 0; i < n; i++) {
            const info = gl.getActiveUniform(p, i);
            if (!info) continue;
            // 数组 uniform 名称会带 [0]
            const name = info.name.replace(/
0
$/, "");
            this._uniformType.set(name, info.type);
        }
    }

    use() {
        this.device.useProgram(this);
    }

    attribLocation(name) {
        if (this._attribLoc.has(name)) return this._attribLoc.get(name);
        const loc = this.gl.getAttribLocation(this.handle, name);
        this._attribLoc.set(name, loc);
        return loc;
    }

    uniformLocation(name) {
        if (this._uniformLoc.has(name)) return this._uniformLoc.get(name);
        const loc = this.gl.getUniformLocation(this.handle, name);
        this._uniformLoc.set(name, loc);
        return loc;
    }

    // 显式设置（推荐）
    setMat4(name, m) {
        const loc = this.uniformLocation(name);
        if (loc) this.gl.uniformMatrix4fv(loc, false, m);
    }
    setMat3(name, m) {
        const loc = this.uniformLocation(name);
        if (loc) this.gl.uniformMatrix3fv(loc, false, m);
    }
    setVec4(name, v) {
        const loc = this.uniformLocation(name);
        if (loc) this.gl.uniform4fv(loc, v);
    }
    setVec3(name, v) {
        const loc = this.uniformLocation(name);
        if (loc) this.gl.uniform3fv(loc, v);
    }
    setVec2(name, v) {
        const loc = this.uniformLocation(name);
        if (loc) this.gl.uniform2fv(loc, v);
    }
    set1f(name, x) {
        const loc = this.uniformLocation(name);
        if (loc) this.gl.uniform1f(loc, x);
    }
    set1i(name, x) {
        const loc = this.uniformLocation(name);
        if (loc) this.gl.uniform1i(loc, x | 0);
    }

    // 自动 set（方便快速用；复杂场景建议用显式 set）
    setUniform(name, value) {
        const gl = this.gl;
        const loc = this.uniformLocation(name);
        if (!loc) return;

        if (typeof value === "number") {
            const t = this._uniformType.get(name);
            // sampler / int
            if (t === gl.INT || t === gl.SAMPLER_2D || t === gl.SAMPLER_CUBE) gl.uniform1i(loc, value | 0);
            else gl.uniform1f(loc, value);
            return;
        }

        // TypedArray / Array
        const v = value;
        const len = v.length | 0;
        if (len === 16) gl.uniformMatrix4fv(loc, false, v);
        else if (len === 9) gl.uniformMatrix3fv(loc, false, v);
        else if (len === 4) gl.uniform4fv(loc, v);
        else if (len === 3) gl.uniform3fv(loc, v);
        else if (len === 2) gl.uniform2fv(loc, v);
        else throw new Error(`setUniform 不支持的长度：${name} len=${len}`);
    }

    dispose() {
        if (this.handle) {
            this.gl.deleteProgram(this.handle);
            this.handle = null;
        }
    }
}

// ==============================
// Texture2D / Sampler
// ==============================
export class Texture2D {
    constructor(device, opts = {}) {
        this.device = device;
        this.gl = device.gl;
        this.handle = this.gl.createTexture();

        this.width = opts.width || 1;
        this.height = opts.height || 1;
        this.format = opts.format || this.gl.RGBA;
        this.type = opts.type || this.gl.UNSIGNED_BYTE;
        this.internalFormat = opts.internalFormat || (device.isWebGL2 ? this.gl.RGBA8 : this.format);

        this.minFilter = opts.minFilter ?? this.gl.LINEAR;
        this.magFilter = opts.magFilter ?? this.gl.LINEAR;
        this.wrapS = opts.wrapS ?? this.gl.CLAMP_TO_EDGE;
        this.wrapT = opts.wrapT ?? this.gl.CLAMP_TO_EDGE;
        this.flipY = opts.flipY ?? false;
        this.premultiplyAlpha = opts.premultiplyAlpha ?? false;

        this._initEmpty();
    }

    _initEmpty() {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.handle);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, this.flipY ? 1 : 0);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, this.premultiplyAlpha ? 1 : 0);

        // WebGL1: internalFormat 必须等于 format
        if (!this.device.isWebGL2) this.internalFormat = this.format;

        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            this.internalFormat,
            this.width,
            this.height,
            0,
            this.format,
            this.type,
            null
        );

        this.applySampler();
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    applySampler() {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.handle);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.minFilter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.magFilter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.wrapS);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, this.wrapT);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    setImage(image, opts = {}) {
        const gl = this.gl;
        const flipY = opts.flipY ?? this.flipY;
        const premul = opts.premultiplyAlpha ?? this.premultiplyAlpha;

        gl.bindTexture(gl.TEXTURE_2D, this.handle);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY ? 1 : 0);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premul ? 1 : 0);

        if (!this.device.isWebGL2) this.internalFormat = this.format;

        gl.texImage2D(gl.TEXTURE_2D, 0, this.internalFormat, this.format, this.type, image);

        this.width = image.width || this.width;
        this.height = image.height || this.height;

        if (opts.generateMipmap) gl.generateMipmap(gl.TEXTURE_2D);

        this.applySampler();
        gl.bindTexture(gl.TEXTURE_2D, null);
        return this;
    }

    setData(width, height, data, opts = {}) {
        const gl = this.gl;
        this.width = width;
        this.height = height;

        const flipY = opts.flipY ?? this.flipY;
        const premul = opts.premultiplyAlpha ?? this.premultiplyAlpha;

        gl.bindTexture(gl.TEXTURE_2D, this.handle);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY ? 1 : 0);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premul ? 1 : 0);

        if (!this.device.isWebGL2) this.internalFormat = this.format;

        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            this.internalFormat,
            width,
            height,
            0,
            this.format,
            this.type,
            data
        );

        if (opts.generateMipmap) gl.generateMipmap(gl.TEXTURE_2D);

        this.applySampler();
        gl.bindTexture(gl.TEXTURE_2D, null);
        return this;
    }

    dispose() {
        if (this.handle) {
            this.gl.deleteTexture(this.handle);
            this.handle = null;
        }
    }
}

// ==============================
// Mesh：VBO/IBO + VAO（可选）+ draw
// ==============================
export class Mesh {
    constructor(device, opts = {}) {
        this.device = device;
        this.gl = device.gl;

        this.mode = opts.mode ?? this.gl.TRIANGLES;

        this.vao = null;
        this.indexBuffer = null;
        this.indexType = null;
        this.indexCount = 0;

        this.vertexCount = opts.vertexCount ?? 0;

        // attributes: [{name, buffer, size, type, normalized, stride, offset, divisor}]
        this.attributes = [];
    }

    static fromData(device, desc) {
        // desc:
        // {
        //   attributes: {
        //     aPosition: { data: Float32Array, size:3 },
        //     aNormal:   { data: Float32Array, size:3 },
        //     aUV:       { data: Float32Array, size:2 },
        //     ...
        //   },
        //   indices: Uint16Array|Uint32Array,
        //   mode: gl.TRIANGLES
        // }
        const gl = device.gl;
        const mesh = new Mesh(device, { mode: desc.mode ?? gl.TRIANGLES });

        // create buffers per attribute (简单直接，后续你也可做 interleaved）
        for (const name in desc.attributes) {
            const a = desc.attributes[name];
            const buf = gl.createBuffer();
            device.bindArrayBuffer(buf);
            gl.bufferData(gl.ARRAY_BUFFER, a.data, a.usage ?? gl.STATIC_DRAW);

            mesh.attributes.push({
                name,
                buffer: buf,
                size: a.size,
                type: a.type ?? gl.FLOAT,
                normalized: a.normalized ?? false,
                stride: a.stride ?? 0,
                offset: a.offset ?? 0,
                divisor: a.divisor ?? 0,
            });

            // 推断 vertexCount（按 position）
            if (name === "aPosition" && a.size) {
                mesh.vertexCount = (a.data.length / a.size) | 0;
            }
        }

        // indices
        if (desc.indices) {
            const idx = desc.indices;
            if (idx instanceof Uint32Array && !device.extUint32) {
                throw new Error("当前 WebGL1 上下文不支持 Uint32 索引（需要 OES_element_index_uint）");
            }
            const ibo = gl.createBuffer();
            device.bindElementArrayBuffer(ibo);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, desc.indexUsage ?? gl.STATIC_DRAW);

            mesh.indexBuffer = ibo;
            mesh.indexCount = idx.length;
            mesh.indexType = idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
        }

        return mesh;
    }

    buildVAO(program) {
        // VAO 需要 program attribute location；WebGL1 没 VAO 时可以不建（每次 draw 绑属性）
        const vao = this.device.createVertexArray();
        if (!vao) return null;

        this.vao = vao;
        this.device.bindVertexArray(vao);

        if (this.indexBuffer) this.device.bindElementArrayBuffer(this.indexBuffer);

        for (const a of this.attributes) {
            const loc = program.attribLocation(a.name);
            if (loc < 0) continue;

            this.device.bindArrayBuffer(a.buffer);
            this.gl.enableVertexAttribArray(loc);
            this.gl.vertexAttribPointer(loc, a.size, a.type, a.normalized, a.stride, a.offset);
            if (a.divisor) this.device.vertexAttribDivisor(loc, a.divisor);
        }

        this.device.bindVertexArray(null);
        return vao;
    }

    _bindAttributes(program) {
        // 无 VAO 时每次 draw 都要绑定
        if (this.indexBuffer) this.device.bindElementArrayBuffer(this.indexBuffer);

        for (const a of this.attributes) {
            const loc = program.attribLocation(a.name);
            if (loc < 0) continue;
            this.device.bindArrayBuffer(a.buffer);
            this.gl.enableVertexAttribArray(loc);
            this.gl.vertexAttribPointer(loc, a.size, a.type, a.normalized, a.stride, a.offset);
            if (a.divisor) this.device.vertexAttribDivisor(loc, a.divisor);
        }
    }

    draw(program, opts = {}) {
        const gl = this.gl;
        const instanceCount = opts.instanceCount ?? 0;

        // VAO：如果没建过，且支持 VAO，则针对这个 program 建一次
        if (!this.vao) this.buildVAO(program);

        if (this.vao) {
            this.device.bindVertexArray(this.vao);
        } else {
            this._bindAttributes(program);
        }

        if (this.indexBuffer) {
            if (instanceCount > 0) {
                this.device.drawElementsInstanced(this.mode, this.indexCount, this.indexType, 0, instanceCount);
            } else {
                gl.drawElements(this.mode, this.indexCount, this.indexType, 0);
            }
        } else {
            const count = opts.count ?? this.vertexCount;
            if (instanceCount > 0) {
                this.device.drawArraysInstanced(this.mode, 0, count, instanceCount);
            } else {
                gl.drawArrays(this.mode, 0, count);
            }
        }

        if (this.vao) this.device.bindVertexArray(null);
    }

    dispose() {
        const gl = this.gl;
        if (this.vao) {
            this.device.deleteVertexArray(this.vao);
            this.vao = null;
        }
        if (this.indexBuffer) {
            gl.deleteBuffer(this.indexBuffer);
            this.indexBuffer = null;
        }
        for (const a of this.attributes) {
            if (a.buffer) gl.deleteBuffer(a.buffer);
            a.buffer = null;
        }
        this.attributes.length = 0;
    }
}

// ==============================
// Material：Program + uniforms + textures + render states
// ==============================
export class Material {
    constructor(program, opts = {}) {
        this.program = program;

        // uniforms: { uColor: vec4, uRoughness: 0.5, ... }
        this.uniforms = { ...(opts.uniforms || {}) };

        // textures: { uMainTex: Texture2D, uNormalTex: Texture2D, ... }
        this.textures = { ...(opts.textures || {}) };

        // states
        this.depthTest = opts.depthTest ?? true;
        this.depthWrite = opts.depthWrite ?? true;
        this.blend = opts.blend ?? false;
        this.cull = opts.cull ?? true;

        // blend func 默认（可按需扩展）
        this.blendFunc = opts.blendFunc || null; // {src, dst} or null
    }

    setUniform(name, value) {
        this.uniforms[name] = value;
        return this;
    }

    setTexture(name, texture) {
        this.textures[name] = texture;
        return this;
    }
}

// ==============================
// Node / Model / Scene
// ==============================
export class Node {
    constructor(name = "") {
        this.name = name;

        this.parent = null;
        this.children = [];

        this.position = vec3.fromValues(0, 0, 0);
        this.rotation = quat.create(); // [0,0,0,1]
        this.scale = vec3.fromValues(1, 1, 1);

        this.matrixLocal = mat4.create();
        this.matrixWorld = mat4.create();

        this._localDirty = true;
        this._worldDirty = true;
    }

    add(child) {
        if (child.parent) child.parent.remove(child);
        child.parent = this;
        this.children.push(child);
        child._worldDirty = true;
        return this;
    }

    remove(child) {
        const i = this.children.indexOf(child);
        if (i >= 0) {
            this.children.splice(i, 1);
            child.parent = null;
            child._worldDirty = true;
        }
        return this;
    }

    markDirty() {
        this._localDirty = true;
        this._markWorldDirtyRecursive();
    }

    _markWorldDirtyRecursive() {
        this._worldDirty = true;
        for (const c of this.children) c._markWorldDirtyRecursive();
    }

    updateLocalMatrix() {
        if (!this._localDirty) return;
        mat4.fromTRS(this.matrixLocal, this.position, this.rotation, this.scale);
        this._localDirty = false;
        this._worldDirty = true;
    }

    updateWorldMatrix(parentWorld = null) {
        this.updateLocalMatrix();
        if (!this._worldDirty && !parentWorld) return;

        if (parentWorld) mat4.mul(this.matrixWorld, parentWorld, this.matrixLocal);
        else mat4.copy(this.matrixWorld, this.matrixLocal);

        this._worldDirty = false;
        for (const c of this.children) c.updateWorldMatrix(this.matrixWorld);
    }

    traverse(fn) {
        fn(this);
        for (const c of this.children) c.traverse(fn);
    }
}

export class Model extends Node {
    constructor(mesh = null, material = null, name = "") {
        super(name);
        this.mesh = mesh;
        this.material = material;
        this.visible = true;
    }
}

export class Scene {
    constructor() {
        this.root = new Node("root");
        this.backgroundColor = vec4.fromValues(0.05, 0.05, 0.06, 1.0);
    }

    add(node) {
        this.root.add(node);
        return this;
    }

    update() {
        this.root.updateWorldMatrix(null);
    }

    traverse(fn) {
        this.root.traverse(fn);
    }
}

// ==============================
// Camera：投影/视图（你后面可单独扩展更多相机类型）
// ==============================
export class Camera extends Node {
    constructor(name = "camera") {
        super(name);

        this.projectionMatrix = mat4.create();
        this.viewMatrix = mat4.create();
        this.viewProjectionMatrix = mat4.create();

        this.near = 0.1;
        this.far = 1000;
        this.fovY = mathf.degToRad(60);
        this.aspect = 1.0;

        this._projDirty = true;
        this._viewDirty = true;
    }

    setPerspective(fovYRad, aspect, near = 0.1, far = 1000) {
        this.fovY = fovYRad;
        this.aspect = aspect;
        this.near = near;
        this.far = far;
        this._projDirty = true;
        return this;
    }

    setOrtho(left, right, bottom, top, near = 0.1, far = 1000) {
        mat4.ortho(this.projectionMatrix, left, right, bottom, top, near, far);
        this._projDirty = false;
        this.near = near;
        this.far = far;
        return this;
    }

    lookAt(eye, center, up) {
        // 直接生成 viewMatrix（不强制回写 transform）
        mat4.lookAt(this.viewMatrix, eye, center, up);
        this._viewDirty = false;
        return this;
    }

    updateMatrices() {
        // projection
        if (this._projDirty) {
            mat4.perspective(this.projectionMatrix, this.fovY, this.aspect, this.near, this.far);
            this._projDirty = false;
        }

        // view：从 worldMatrix 求逆（仿射快速逆）
        this.updateWorldMatrix(this.parent ? this.parent.matrixWorld : null);

        // viewMatrix = inverse(cameraWorld)
        // 注意：cameraWorld 包含 TRS，适用 invertAffine
        if (!mat4.invertAffine(this.viewMatrix, this.matrixWorld)) {
            // 兜底：用通用 invert
            mat4.invert(this.viewMatrix, this.matrixWorld);
        }

        mat4.mul(this.viewProjectionMatrix, this.projectionMatrix, this.viewMatrix);
    }
}

// ==============================
// Renderer：遍历 Scene/Model，绑定 Material/Program/Mesh 进行绘制
// ==============================
export class Renderer {
    constructor(device) {
        this.device = device;
        this.gl = device.gl;

        this.clearColor = vec4.fromValues(0, 0, 0, 1);
        this.clearDepth = 1.0;

        // 常用 scratch
        this._mvp = mat4.create();
        this._normalMat = mat3.create();
    }

    resizeToDisplaySize(canvas, pixelRatio = (window.devicePixelRatio || 1)) {
        const w = Math.floor(canvas.clientWidth * pixelRatio);
        const h = Math.floor(canvas.clientHeight * pixelRatio);
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
            this.gl.viewport(0, 0, w, h);
            return true;
        }
        return false;
    }

    beginFrame(scene) {
        const gl = this.gl;
        const bg = scene?.backgroundColor || this.clearColor;
        gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
        gl.clearDepth(this.clearDepth);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    render(scene, camera) {
        if (!scene || !camera) return;

        // 更新矩阵
        scene.update();
        camera.updateMatrices();

        this.beginFrame(scene);

        const device = this.device;

        // 遍历模型
        scene.traverse((node) => {
            if (!(node instanceof Model)) return;
            if (!node.visible || !node.mesh || !node.material) return;

            const mesh = node.mesh;
            const mat = node.material;
            const program = mat.program;

            // states
            device.setDepthTest(mat.depthTest);
            device.setDepthWrite(mat.depthWrite);
            device.setBlend(mat.blend);
            device.setCull(mat.cull);

            if (mat.blend && mat.blendFunc) {
                this.gl.blendFunc(mat.blendFunc.src, mat.blendFunc.dst);
            }

            // program
            program.use();

            // 常用内建 uniform（你也可以约定命名）
            // uModel, uView, uProj, uMVP, uNormalMat
            // mvp = VP * M
            mat4.mul(this._mvp, camera.viewProjectionMatrix, node.matrixWorld);

            program.setMat4("uModel", node.matrixWorld);
            program.setMat4("uView", camera.viewMatrix);
            program.setMat4("uProj", camera.projectionMatrix);
            program.setMat4("uMVP", this._mvp);

            // normal matrix：inverse-transpose(mat3(model))（这里用 normalFromMat4）
            if (mat3.normalFromMat4(this._normalMat, node.matrixWorld)) {
                program.setMat3("uNormalMat", this._normalMat);
            }

            // user uniforms
            for (const k in mat.uniforms) {
                program.setUniform(k, mat.uniforms[k]);
            }

            // textures：按出现顺序绑定到 unit
            let unit = 0;
            for (const k in mat.textures) {
                const tex = mat.textures[k];
                if (!tex) continue;
                if (unit >= device.maxTextureUnits) throw new Error("纹理单元不足，超过 MAX_COMBINED_TEXTURE_IMAGE_UNITS");
                device.bindTexture2D(unit, tex);
                program.set1i(k, unit);
                unit++;
            }

            // draw
            mesh.draw(program);
        });
    }
}

// ==============================
// 可选：一些默认 shader（WebGL1/2 双版本）
// ==============================
export const ShaderLib = {
    // 简单纹理+顶点色（可扩展）
    UnlitTexture: {
        vs100: `
precision highp float;
attribute vec3 aPosition;
attribute vec2 aUV;
uniform mat4 uMVP;
varying vec2 vUV;
void main(){
  vUV = aUV;
  gl_Position = uMVP * vec4(aPosition, 1.0);
}
`,
        fs100: `
precision highp float;
varying vec2 vUV;
uniform sampler2D uMainTex;
uniform vec4 uColor;
void main(){
  vec4 tex = texture2D(uMainTex, vUV);
  gl_FragColor = tex * uColor;
}
`,
        vs300: `#version 300 es
precision highp float;
in vec3 aPosition;
in vec2 aUV;
uniform mat4 uMVP;
out vec2 vUV;
void main(){
  vUV = aUV;
  gl_Position = uMVP * vec4(aPosition, 1.0);
}
`,
        fs300: `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uMainTex;
uniform vec4 uColor;
out vec4 outColor;
void main(){
  vec4 tex = texture(uMainTex, vUV);
  outColor = tex * uColor;
}
`,
    },
};

// ==============================
// 可选：资源加载工具（不强依赖）
// ==============================
export const Assets = {
    loadText: async (url) => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`loadText failed: ${url}`);
        return await r.text();
    },
    loadImage: (url) =>
        new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        }),
};