/* math-glx.js (ES Module)
 * 纯数学工具库：vec2/3/4, mat2/3/4, quat + mathf/easing/color/random/geom
 * - Float32Array
 * - 矩阵 column-major（列主序）
 */

const EPS = 1e-8;
const TAU = Math.PI * 2;

function f32(n) { return new Float32Array(n); }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function nearly(a, b, eps = EPS) { return Math.abs(a - b) <= eps; }

export const mathf = {
    EPS, TAU,
    degToRad: (deg) => deg * Math.PI / 180,
    radToDeg: (rad) => rad * 180 / Math.PI,
    clamp,
    saturate: (x) => clamp(x, 0, 1),
    signNotZero: (x) => (x < 0 ? -1 : 1),
    fract: (x) => x - Math.floor(x),
    step: (edge, x) => (x < edge ? 0 : 1),
    lerp: (a, b, t) => a + (b - a) * t,
    inverseLerp: (a, b, v) => (a === b ? 0 : (v - a) / (b - a)),
    remap: (inMin, inMax, outMin, outMax, v) => {
        const t = (inMin === inMax) ? 0 : (v - inMin) / (inMax - inMin);
        return outMin + (outMax - outMin) * t;
    },
    smoothstep: (a, b, x) => {
        const t = clamp((x - a) / (b - a), 0, 1);
        return t * t * (3 - 2 * t);
    },
    smootherstep: (a, b, x) => {
        const t = clamp((x - a) / (b - a), 0, 1);
        return t * t * t * (t * (t * 6 - 15) + 10);
    },
    repeat: (t, length) => t - Math.floor(t / length) * length,
    pingpong: (t, length) => {
        t = mathf.repeat(t, length * 2);
        return length - Math.abs(t - length);
    },
    wrapAngleRad: (rad) => {
        rad = (rad + Math.PI) % TAU;
        if (rad < 0) rad += TAU;
        return rad - Math.PI;
    },
    wrapAngleDeg: (deg) => {
        deg = (deg + 180) % 360;
        if (deg < 0) deg += 360;
        return deg - 180;
    },
    nearlyEqual: nearly,
};

export const easing = {
    linear: (t) => t,
    inQuad: (t) => t * t,
    outQuad: (t) => t * (2 - t),
    inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
    inCubic: (t) => t * t * t,
    outCubic: (t) => (--t, t * t * t + 1),
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t -= 1, 1 + 4 * t * t * t)),
    inSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
    outSine: (t) => Math.sin((t * Math.PI) / 2),
    inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    inExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1))),
    outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    inOutExpo: (t) => {
        if (t === 0) return 0;
        if (t === 1) return 1;
        return t < 0.5
            ? Math.pow(2, 20 * t - 10) / 2
            : (2 - Math.pow(2, -20 * t + 10)) / 2;
    },
};

export class Random {
    constructor(seed = 0x12345678) {
        this._s = seed >>> 0;
    }
    /** mulberry32 */
    nextU32() {
        let t = (this._s += 0x6D2B79F5) >>> 0;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0);
    }
    next() { return this.nextU32() / 0x100000000; } // [0,1)
    range(min, max) { return min + (max - min) * this.next(); }
    int(min, maxInclusive) {
        const r = this.nextU32();
        const span = (maxInclusive - min + 1) >>> 0;
        return min + (r % span);
    }
    normal(mean = 0, std = 1) {
        // Box–Muller
        let u = 0, v = 0;
        while (u === 0) u = this.next();
        while (v === 0) v = this.next();
        const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
        return mean + z * std;
    }
    pick(arr) { return arr[this.int(0, arr.length - 1)]; }
    shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = this.int(0, i);
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }
}

export const color = {
    rgbToHsv(out, rgb) {
        const r = rgb[0], g = rgb[1], b = rgb[2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const d = max - min;

        let h = 0;
        if (d !== 0) {
            if (max === r) h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h /= 6;
            if (h < 0) h += 1;
        }
        const s = (max === 0) ? 0 : d / max;
        const v = max;
        out[0] = h; out[1] = s; out[2] = v;
        return out;
    },
    hsvToRgb(out, hsv) {
        let h = hsv[0], s = hsv[1], v = hsv[2];
        h = ((h % 1) + 1) % 1;
        const i = Math.floor(h * 6);
        const f = h * 6 - i;
        const p = v * (1 - s);
        const q = v * (1 - f * s);
        const t = v * (1 - (1 - f) * s);

        switch (i % 6) {
            case 0: out[0] = v; out[1] = t; out[2] = p; break;
            case 1: out[0] = q; out[1] = v; out[2] = p; break;
            case 2: out[0] = p; out[1] = v; out[2] = t; break;
            case 3: out[0] = p; out[1] = q; out[2] = v; break;
            case 4: out[0] = t; out[1] = p; out[2] = v; break;
            case 5: out[0] = v; out[1] = p; out[2] = q; break;
        }
        return out;
    },
    srgbToLinear(c) {
        // c in [0,1]
        return (c <= 0.04045) ? (c / 12.92) : Math.pow((c + 0.055) / 1.055, 2.4);
    },
    linearToSrgb(c) {
        return (c <= 0.0031308) ? (12.92 * c) : (1.055 * Math.pow(c, 1 / 2.4) - 0.055);
    },
    parseHexToRgba(out, hex) {
        // "#RRGGBB" or "#RRGGBBAA"
        const s = hex.startsWith("#") ? hex.slice(1) : hex;
        if (s.length !== 6 && s.length !== 8) throw new Error("hex must be RRGGBB or RRGGBBAA");
        const r = parseInt(s.slice(0, 2), 16) / 255;
        const g = parseInt(s.slice(2, 4), 16) / 255;
        const b = parseInt(s.slice(4, 6), 16) / 255;
        const a = (s.length === 8) ? parseInt(s.slice(6, 8), 16) / 255 : 1;
        out[0] = r; out[1] = g; out[2] = b; out[3] = a;
        return out;
    },
    rgbaToHex(rgba) {
        const r = clamp(Math.round(rgba[0] * 255), 0, 255);
        const g = clamp(Math.round(rgba[1] * 255), 0, 255);
        const b = clamp(Math.round(rgba[2] * 255), 0, 255);
        const a = clamp(Math.round((rgba[3] ?? 1) * 255), 0, 255);
        const to2 = (x) => x.toString(16).padStart(2, "0");
        return "#" + to2(r) + to2(g) + to2(b) + to2(a);
    },
    packRGBA8(rgba) {
        const r = clamp(Math.round(rgba[0] * 255), 0, 255);
        const g = clamp(Math.round(rgba[1] * 255), 0, 255);
        const b = clamp(Math.round(rgba[2] * 255), 0, 255);
        const a = clamp(Math.round((rgba[3] ?? 1) * 255), 0, 255);
        return (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
    },
    unpackRGBA8(out, u32) {
        out[0] = (u32 & 255) / 255;
        out[1] = ((u32 >>> 8) & 255) / 255;
        out[2] = ((u32 >>> 16) & 255) / 255;
        out[3] = ((u32 >>> 24) & 255) / 255;
        return out;
    },
};

export const vec2 = {
    create: () => f32(2),
    fromValues: (x = 0, y = 0) => new Float32Array([x, y]),
    clone: (a) => new Float32Array(a),
    copy: (out, a) => (out[0] = a[0], out[1] = a[1], out),
    set: (out, x, y) => (out[0] = x, out[1] = y, out),
    zero: (out) => (out[0] = 0, out[1] = 0, out),

    add: (out, a, b) => (out[0] = a[0] + b[0], out[1] = a[1] + b[1], out),
    sub: (out, a, b) => (out[0] = a[0] - b[0], out[1] = a[1] - b[1], out),
    mul: (out, a, b) => (out[0] = a[0] * b[0], out[1] = a[1] * b[1], out),
    div: (out, a, b) => (out[0] = a[0] / b[0], out[1] = a[1] / b[1], out),

    scale: (out, a, s) => (out[0] = a[0] * s, out[1] = a[1] * s, out),
    scaleAndAdd: (out, a, b, s) => (out[0] = a[0] + b[0] * s, out[1] = a[1] + b[1] * s, out),
    negate: (out, a) => (out[0] = -a[0], out[1] = -a[1], out),

    dot: (a, b) => a[0] * b[0] + a[1] * b[1],
    len: (a) => Math.hypot(a[0], a[1]),
    lenSq: (a) => a[0] * a[0] + a[1] * a[1],
    dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
    normalize: (out, a) => {
        const l = Math.hypot(a[0], a[1]);
        if (l > EPS) { out[0] = a[0] / l; out[1] = a[1] / l; } else { out[0] = 0; out[1] = 0; }
        return out;
    },
    lerp: (out, a, b, t) => (out[0] = a[0] + (b[0] - a[0]) * t, out[1] = a[1] + (b[1] - a[1]) * t, out),

    min: (out, a, b) => (out[0] = Math.min(a[0], b[0]), out[1] = Math.min(a[1], b[1]), out),
    max: (out, a, b) => (out[0] = Math.max(a[0], b[0]), out[1] = Math.max(a[1], b[1]), out),
    equalsApprox: (a, b, eps = EPS) => (Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps),
};

export const vec3 = {
    create: () => f32(3),
    fromValues: (x = 0, y = 0, z = 0) => new Float32Array([x, y, z]),
    clone: (a) => new Float32Array(a),
    copy: (out, a) => (out[0] = a[0], out[1] = a[1], out[2] = a[2], out),
    set: (out, x, y, z) => (out[0] = x, out[1] = y, out[2] = z, out),
    zero: (out) => (out[0] = 0, out[1] = 0, out[2] = 0, out),

    add: (out, a, b) => (out[0] = a[0] + b[0], out[1] = a[1] + b[1], out[2] = a[2] + b[2], out),
    sub: (out, a, b) => (out[0] = a[0] - b[0], out[1] = a[1] - b[1], out[2] = a[2] - b[2], out),
    mul: (out, a, b) => (out[0] = a[0] * b[0], out[1] = a[1] * b[1], out[2] = a[2] * b[2], out),
    div: (out, a, b) => (out[0] = a[0] / b[0], out[1] = a[1] / b[1], out[2] = a[2] / b[2], out),

    scale: (out, a, s) => (out[0] = a[0] * s, out[1] = a[1] * s, out[2] = a[2] * s, out),
    scaleAndAdd: (out, a, b, s) => (out[0] = a[0] + b[0] * s, out[1] = a[1] + b[1] * s, out[2] = a[2] + b[2] * s, out),
    negate: (out, a) => (out[0] = -a[0], out[1] = -a[1], out[2] = -a[2], out),

    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (out, a, b) => {
        const ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2];
        out[0] = ay * bz - az * by;
        out[1] = az * bx - ax * bz;
        out[2] = ax * by - ay * bx;
        return out;
    },

    len: (a) => Math.hypot(a[0], a[1], a[2]),
    lenSq: (a) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2],
    dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),

    normalize: (out, a) => {
        const l = Math.hypot(a[0], a[1], a[2]);
        if (l > EPS) { out[0] = a[0] / l; out[1] = a[1] / l; out[2] = a[2] / l; }
        else { out[0] = 0; out[1] = 0; out[2] = 0; }
        return out;
    },

    lerp: (out, a, b, t) => (out[0] = a[0] + (b[0] - a[0]) * t, out[1] = a[1] + (b[1] - a[1]) * t, out[2] = a[2] + (b[2] - a[2]) * t, out),

    min: (out, a, b) => (out[0] = Math.min(a[0], b[0]), out[1] = Math.min(a[1], b[1]), out[2] = Math.min(a[2], b[2]), out),
    max: (out, a, b) => (out[0] = Math.max(a[0], b[0]), out[1] = Math.max(a[1], b[1]), out[2] = Math.max(a[2], b[2]), out),
    equalsApprox: (a, b, eps = EPS) => (Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps && Math.abs(a[2] - b[2]) <= eps),

    angle: (a, b) => {
        const la = Math.hypot(a[0], a[1], a[2]);
        const lb = Math.hypot(b[0], b[1], b[2]);
        if (la < EPS || lb < EPS) return 0;
        const d = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
        return Math.acos(clamp(d, -1, 1));
    },

    project: (out, a, b) => {
        // proj a onto b
        const denom = b[0] * b[0] + b[1] * b[1] + b[2] * b[2];
        if (denom < EPS) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
        const s = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / denom;
        out[0] = b[0] * s; out[1] = b[1] * s; out[2] = b[2] * s;
        return out;
    },

    reject: (out, a, b) => {
        // a - proj(a,b)
        const p = vec3.project(_scratch.v3a, a, b);
        out[0] = a[0] - p[0]; out[1] = a[1] - p[1]; out[2] = a[2] - p[2];
        return out;
    },

    reflect: (out, I, N) => {
        // I - 2*dot(N,I)*N
        const d = (I[0] * N[0] + I[1] * N[1] + I[2] * N[2]) * 2;
        out[0] = I[0] - d * N[0];
        out[1] = I[1] - d * N[1];
        out[2] = I[2] - d * N[2];
        return out;
    },

    refract: (out, I, N, eta) => {
        // GLSL refract
        const d = I[0] * N[0] + I[1] * N[1] + I[2] * N[2];
        const k = 1.0 - eta * eta * (1.0 - d * d);
        if (k < 0) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
        const a = eta;
        const b = eta * d + Math.sqrt(k);
        out[0] = a * I[0] - b * N[0];
        out[1] = a * I[1] - b * N[1];
        out[2] = a * I[2] - b * N[2];
        return out;
    },

    transformMat4: (out, a, m) => {
        const x = a[0], y = a[1], z = a[2];
        const w = m[3] * x + m[7] * y + m[11] * z + m[15];
        const iw = w ? 1 / w : 1;
        out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) * iw;
        out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) * iw;
        out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) * iw;
        return out;
    },

    transformDirectionMat4: (out, a, m) => {
        const x = a[0], y = a[1], z = a[2];
        out[0] = m[0] * x + m[4] * y + m[8] * z;
        out[1] = m[1] * x + m[5] * y + m[9] * z;
        out[2] = m[2] * x + m[6] * y + m[10] * z;
        return out;
    },

    transformQuat: (out, v, q) => {
        // v' = q * (v,0) * q^-1
        const x = v[0], y = v[1], z = v[2];
        const qx = q[0], qy = q[1], qz = q[2], qw = q[3];

        // t = 2 * cross(q.xyz, v)
        const tx = 2 * (qy * z - qz * y);
        const ty = 2 * (qz * x - qx * z);
        const tz = 2 * (qx * y - qy * x);

        // v' = v + qw*t + cross(q.xyz, t)
        out[0] = x + qw * tx + (qy * tz - qz * ty);
        out[1] = y + qw * ty + (qz * tx - qx * tz);
        out[2] = z + qw * tz + (qx * ty - qy * tx);
        return out;
    },
};

export const vec4 = {
    create: () => f32(4),
    fromValues: (x = 0, y = 0, z = 0, w = 0) => new Float32Array([x, y, z, w]),
    clone: (a) => new Float32Array(a),
    copy: (out, a) => (out[0] = a[0], out[1] = a[1], out[2] = a[2], out[3] = a[3], out),
    set: (out, x, y, z, w) => (out[0] = x, out[1] = y, out[2] = z, out[3] = w, out),
    zero: (out) => (out[0] = 0, out[1] = 0, out[2] = 0, out[3] = 0, out),

    add: (out, a, b) => (out[0] = a[0] + b[0], out[1] = a[1] + b[1], out[2] = a[2] + b[2], out[3] = a[3] + b[3], out),
    sub: (out, a, b) => (out[0] = a[0] - b[0], out[1] = a[1] - b[1], out[2] = a[2] - b[2], out[3] = a[3] - b[3], out),
    scale: (out, a, s) => (out[0] = a[0] * s, out[1] = a[1] * s, out[2] = a[2] * s, out[3] = a[3] * s, out),

    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3],
    len: (a) => Math.hypot(a[0], a[1], a[2], a[3]),
    normalize: (out, a) => {
        const l = Math.hypot(a[0], a[1], a[2], a[3]);
        if (l > EPS) { out[0] = a[0] / l; out[1] = a[1] / l; out[2] = a[2] / l; out[3] = a[3] / l; }
        else { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0; }
        return out;
    },
};

export const mat2 = {
    create: () => { const out = f32(4); out[0] = 1; out[3] = 1; return out; },
    identity: (out) => (out[0] = 1, out[1] = 0, out[2] = 0, out[3] = 1, out),
    copy: (out, a) => (out.set(a), out),
    determinant: (a) => a[0] * a[3] - a[2] * a[1],
    transpose: (out, a) => {
        if (out === a) { const t = a[1]; out[1] = a[2]; out[2] = t; return out; }
        out[0] = a[0]; out[1] = a[2];
        out[2] = a[1]; out[3] = a[3];
        return out;
    },
    invert: (out, a) => {
        const det = a[0] * a[3] - a[2] * a[1];
        if (Math.abs(det) < EPS) return null;
        const inv = 1 / det;
        out[0] = a[3] * inv; out[1] = -a[1] * inv;
        out[2] = -a[2] * inv; out[3] = a[0] * inv;
        return out;
    },
    mul: (out, a, b) => {
        const a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
        const b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
        out[0] = a0 * b0 + a2 * b1;
        out[1] = a1 * b0 + a3 * b1;
        out[2] = a0 * b2 + a2 * b3;
        out[3] = a1 * b2 + a3 * b3;
        return out;
    },
};

export const mat3 = {
    create: () => { const out = f32(9); out[0] = 1; out[4] = 1; out[8] = 1; return out; },
    identity: (out) => (out[0] = 1, out[1] = 0, out[2] = 0, out[3] = 0, out[4] = 1, out[5] = 0, out[6] = 0, out[7] = 0, out[8] = 1, out),
    copy: (out, a) => (out.set(a), out),
    fromMat4: (out, m) => (
        out[0] = m[0], out[1] = m[1], out[2] = m[2],
        out[3] = m[4], out[4] = m[5], out[5] = m[6],
        out[6] = m[8], out[7] = m[9], out[8] = m[10],
        out
    ),
    mul: (out, a, b) => {
        const a00 = a[0], a01 = a[1], a02 = a[2], a10 = a[3], a11 = a[4], a12 = a[5], a20 = a[6], a21 = a[7], a22 = a[8];
        const b00 = b[0], b01 = b[1], b02 = b[2], b10 = b[3], b11 = b[4], b12 = b[5], b20 = b[6], b21 = b[7], b22 = b[8];
        out[0] = a00 * b00 + a10 * b01 + a20 * b02;
        out[1] = a01 * b00 + a11 * b01 + a21 * b02;
        out[2] = a02 * b00 + a12 * b01 + a22 * b02;
        out[3] = a00 * b10 + a10 * b11 + a20 * b12;
        out[4] = a01 * b10 + a11 * b11 + a21 * b12;
        out[5] = a02 * b10 + a12 * b11 + a22 * b12;
        out[6] = a00 * b20 + a10 * b21 + a20 * b22;
        out[7] = a01 * b20 + a11 * b21 + a21 * b22;
        out[8] = a02 * b20 + a12 * b21 + a22 * b22;
        return out;
    },
    transpose: (out, a) => {
        if (out === a) {
            const a01 = a[1], a02 = a[2], a12 = a[5];
            out[1] = a[3]; out[2] = a[6];
            out[3] = a01; out[5] = a[7];
            out[6] = a02; out[7] = a12;
            return out;
        }
        out[0] = a[0]; out[1] = a[3]; out[2] = a[6];
        out[3] = a[1]; out[4] = a[4]; out[5] = a[7];
        out[6] = a[2]; out[7] = a[5]; out[8] = a[8];
        return out;
    },
    determinant: (a) => {
        const a00 = a[0], a01 = a[1], a02 = a[2], a10 = a[3], a11 = a[4], a12 = a[5], a20 = a[6], a21 = a[7], a22 = a[8];
        return a00 * (a22 * a11 - a12 * a21) - a10 * (a22 * a01 - a02 * a21) + a20 * (a12 * a01 - a02 * a11);
    },
    invert: (out, a) => {
        const a00 = a[0], a01 = a[1], a02 = a[2], a10 = a[3], a11 = a[4], a12 = a[5], a20 = a[6], a21 = a[7], a22 = a[8];
        const b01 = a22 * a11 - a12 * a21;
        const b11 = -a22 * a10 + a12 * a20;
        const b21 = a21 * a10 - a11 * a20;
        let det = a00 * b01 + a01 * b11 + a02 * b21;
        if (Math.abs(det) < EPS) return null;
        det = 1 / det;
        out[0] = b01 * det;
        out[1] = (-a22 * a01 + a02 * a21) * det;
        out[2] = (a12 * a01 - a02 * a11) * det;
        out[3] = b11 * det;
        out[4] = (a22 * a00 - a02 * a20) * det;
        out[5] = (-a12 * a00 + a02 * a10) * det;
        out[6] = b21 * det;
        out[7] = (-a21 * a00 + a01 * a20) * det;
        out[8] = (a11 * a00 - a01 * a10) * det;
        return out;
    },
    normalFromMat4: (out, m4) => {
        const a = mat3.fromMat4(_scratch.m3a, m4);
        if (!mat3.invert(out, a)) return null;
        return mat3.transpose(out, out);
    },
};

export const mat4 = {
    create: () => { const out = f32(16); out[0] = 1; out[5] = 1; out[10] = 1; out[15] = 1; return out; },
    identity: (out) => (
        out[0] = 1, out[1] = 0, out[2] = 0, out[3] = 0,
        out[4] = 0, out[5] = 1, out[6] = 0, out[7] = 0,
        out[8] = 0, out[9] = 0, out[10] = 1, out[11] = 0,
        out[12] = 0, out[13] = 0, out[14] = 0, out[15] = 1,
        out
    ),
    copy: (out, a) => (out.set(a), out),

    mul: (out, a, b) => {
        const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
        const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
        const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
        const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

        const b00 = b[0], b01 = b[1], b02 = b[2], b03 = b[3];
        const b10 = b[4], b11 = b[5], b12 = b[6], b13 = b[7];
        const b20 = b[8], b21 = b[9], b22 = b[10], b23 = b[11];
        const b30 = b[12], b31 = b[13], b32 = b[14], b33 = b[15];

        out[0] = a00 * b00 + a10 * b01 + a20 * b02 + a30 * b03;
        out[1] = a01 * b00 + a11 * b01 + a21 * b02 + a31 * b03;
        out[2] = a02 * b00 + a12 * b01 + a22 * b02 + a32 * b03;
        out[3] = a03 * b00 + a13 * b01 + a23 * b02 + a33 * b03;

        out[4] = a00 * b10 + a10 * b11 + a20 * b12 + a30 * b13;
        out[5] = a01 * b10 + a11 * b11 + a21 * b12 + a31 * b13;
        out[6] = a02 * b10 + a12 * b11 + a22 * b12 + a32 * b13;
        out[7] = a03 * b10 + a13 * b11 + a23 * b12 + a33 * b13;

        out[8] = a00 * b20 + a10 * b21 + a20 * b22 + a30 * b23;
        out[9] = a01 * b20 + a11 * b21 + a21 * b22 + a31 * b23;
        out[10] = a02 * b20 + a12 * b21 + a22 * b22 + a32 * b23;
        out[11] = a03 * b20 + a13 * b21 + a23 * b22 + a33 * b23;

        out[12] = a00 * b30 + a10 * b31 + a20 * b32 + a30 * b33;
        out[13] = a01 * b30 + a11 * b31 + a21 * b32 + a31 * b33;
        out[14] = a02 * b30 + a12 * b31 + a22 * b32 + a32 * b33;
        out[15] = a03 * b30 + a13 * b31 + a23 * b32 + a33 * b33;
        return out;
    },

    transpose: (out, a) => {
        if (out === a) {
            const a01 = a[1], a02 = a[2], a03 = a[3], a12 = a[6], a13 = a[7], a23 = a[11];
            out[1] = a[4]; out[2] = a[8]; out[3] = a[12];
            out[4] = a01; out[6] = a[9]; out[7] = a[13];
            out[8] = a02; out[9] = a12; out[11] = a[14];
            out[12] = a03; out[13] = a13; out[14] = a23;
            return out;
        }
        out[0] = a[0]; out[1] = a[4]; out[2] = a[8]; out[3] = a[12];
        out[4] = a[1]; out[5] = a[5]; out[6] = a[9]; out[7] = a[13];
        out[8] = a[2]; out[9] = a[6]; out[10] = a[10]; out[11] = a[14];
        out[12] = a[3]; out[13] = a[7]; out[14] = a[11]; out[15] = a[15];
        return out;
    },

    determinant: (a) => {
        const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
        const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
        const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
        const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

        const b00 = a00 * a11 - a01 * a10;
        const b01 = a00 * a12 - a02 * a10;
        const b02 = a00 * a13 - a03 * a10;
        const b03 = a01 * a12 - a02 * a11;
        const b04 = a01 * a13 - a03 * a11;
        const b05 = a02 * a13 - a03 * a12;
        const b06 = a20 * a31 - a21 * a30;
        const b07 = a20 * a32 - a22 * a30;
        const b08 = a20 * a33 - a23 * a30;
        const b09 = a21 * a32 - a22 * a31;
        const b10 = a21 * a33 - a23 * a31;
        const b11 = a22 * a33 - a23 * a32;

        return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    },

    invert: (out, a) => {
        const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
        const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
        const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
        const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

        const b00 = a00 * a11 - a01 * a10;
        const b01 = a00 * a12 - a02 * a10;
        const b02 = a00 * a13 - a03 * a10;
        const b03 = a01 * a12 - a02 * a11;
        const b04 = a01 * a13 - a03 * a11;
        const b05 = a02 * a13 - a03 * a12;
        const b06 = a20 * a31 - a21 * a30;
        const b07 = a20 * a32 - a22 * a30;
        const b08 = a20 * a33 - a23 * a30;
        const b09 = a21 * a32 - a22 * a31;
        const b10 = a21 * a33 - a23 * a31;
        const b11 = a22 * a33 - a23 * a32;

        let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
        if (Math.abs(det) < EPS) return null;
        det = 1 / det;

        out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
        out[1] = (-a01 * b11 + a02 * b10 - a03 * b09) * det;
        out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
        out[3] = (-a21 * b05 + a22 * b04 - a23 * b03) * det;

        out[4] = (-a10 * b11 + a12 * b08 - a13 * b07) * det;
        out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
        out[6] = (-a30 * b05 + a32 * b02 - a33 * b01) * det;
        out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;

        out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
        out[9] = (-a00 * b10 + a01 * b08 - a03 * b06) * det;
        out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
        out[11] = (-a20 * b04 + a21 * b02 - a23 * b00) * det;

        out[12] = (-a10 * b09 + a11 * b07 - a12 * b06) * det;
        out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
        out[14] = (-a30 * b03 + a31 * b01 - a32 * b00) * det;
        out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;

        return out;
    },

    /** 更快：仅适用于 TRS / 仿射矩阵（无投影） */
    invertAffine: (out, m) => {
        // 取 3x3，求逆，再算平移
        const m00 = m[0], m01 = m[1], m02 = m[2];
        const m10 = m[4], m11 = m[5], m12 = m[6];
        const m20 = m[8], m21 = m[9], m22 = m[10];
        const tx = m[12], ty = m[13], tz = m[14];

        // inv3x3 = inverse(mat3)
        const b01 = m22 * m11 - m12 * m21;
        const b11 = -m22 * m10 + m12 * m20;
        const b21 = m21 * m10 - m11 * m20;

        let det = m00 * b01 + m01 * b11 + m02 * b21;
        if (Math.abs(det) < EPS) return null;
        det = 1 / det;

        const i00 = b01 * det;
        const i01 = (-m22 * m01 + m02 * m21) * det;
        const i02 = (m12 * m01 - m02 * m11) * det;

        const i10 = b11 * det;
        const i11 = (m22 * m00 - m02 * m20) * det;
        const i12 = (-m12 * m00 + m02 * m10) * det;

        const i20 = b21 * det;
        const i21 = (-m21 * m00 + m01 * m20) * det;
        const i22 = (m11 * m00 - m01 * m10) * det;

        out[0] = i00; out[1] = i01; out[2] = i02; out[3] = 0;
        out[4] = i10; out[5] = i11; out[6] = i12; out[7] = 0;
        out[8] = i20; out[9] = i21; out[10] = i22; out[11] = 0;

        // t' = -inv3x3 * t
        out[12] = -(i00 * tx + i10 * ty + i20 * tz);
        out[13] = -(i01 * tx + i11 * ty + i21 * tz);
        out[14] = -(i02 * tx + i12 * ty + i22 * tz);
        out[15] = 1;
        return out;
    },

    fromTRS: (out, t, q, s) => {
        // out = T * R * S
        const x = q[0], y = q[1], z = q[2], w = q[3];
        const x2 = x + x, y2 = y + y, z2 = z + z;
        const xx = x * x2, xy = x * y2, xz = x * z2;
        const yy = y * y2, yz = y * z2, zz = z * z2;
        const wx = w * x2, wy = w * y2, wz = w * z2;

        const sx = s[0], sy = s[1], sz = s[2];

        // column 0
        out[0] = (1 - (yy + zz)) * sx;
        out[1] = (xy + wz) * sx;
        out[2] = (xz - wy) * sx;
        out[3] = 0;

        // column 1
        out[4] = (xy - wz) * sy;
        out[5] = (1 - (xx + zz)) * sy;
        out[6] = (yz + wx) * sy;
        out[7] = 0;

        // column 2
        out[8] = (xz + wy) * sz;
        out[9] = (yz - wx) * sz;
        out[10] = (1 - (xx + yy)) * sz;
        out[11] = 0;

        // translation
        out[12] = t[0]; out[13] = t[1]; out[14] = t[2]; out[15] = 1;
        return out;
    },

    compose: (out, position, rotationQuat, scale) => mat4.fromTRS(out, position, rotationQuat, scale),

    decompose: (outPos, outQuat, outScale, m) => {
        // pos
        outPos[0] = m[12]; outPos[1] = m[13]; outPos[2] = m[14];

        // scale = length of columns
        let sx = Math.hypot(m[0], m[1], m[2]);
        let sy = Math.hypot(m[4], m[5], m[6]);
        let sz = Math.hypot(m[8], m[9], m[10]);

        // handle possible reflection
        // if dot(cross(c0,c1),c2) < 0 => flip one axis
        const c0x = m[0] / (sx || 1), c0y = m[1] / (sx || 1), c0z = m[2] / (sx || 1);
        const c1x = m[4] / (sy || 1), c1y = m[5] / (sy || 1), c1z = m[6] / (sy || 1);
        const c2x = m[8] / (sz || 1), c2y = m[9] / (sz || 1), c2z = m[10] / (sz || 1);
        const cx = c0y * c1z - c0z * c1y;
        const cy = c0z * c1x - c0x * c1z;
        const cz = c0x * c1y - c0y * c1x;
        const handed = cx * c2x + cy * c2y + cz * c2z;
        if (handed < 0) sx = -sx;

        outScale[0] = sx; outScale[1] = sy; outScale[2] = sz;

        // rotation matrix = columns normalized by scale
        const invSx = sx ? 1 / sx : 1;
        const invSy = sy ? 1 / sy : 1;
        const invSz = sz ? 1 / sz : 1;

        const r = _scratch.m3a;
        r[0] = m[0] * invSx; r[1] = m[1] * invSx; r[2] = m[2] * invSx;
        r[3] = m[4] * invSy; r[4] = m[5] * invSy; r[5] = m[6] * invSy;
        r[6] = m[8] * invSz; r[7] = m[9] * invSz; r[8] = m[10] * invSz;

        quat.fromMat3(outQuat, r);
        return { position: outPos, rotation: outQuat, scale: outScale };
    },

    perspective: (out, fovy, aspect, near, far) => {
        const f = 1 / Math.tan(fovy / 2);
        out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
        out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
        out[8] = 0; out[9] = 0; out[11] = -1;
        out[12] = 0; out[13] = 0; out[15] = 0;
        if (far != null && far !== Infinity) {
            const nf = 1 / (near - far);
            out[10] = (far + near) * nf;
            out[14] = (2 * far * near) * nf;
        } else {
            out[10] = -1;
            out[14] = -2 * near;
        }
        return out;
    },

    ortho: (out, l, r, b, t, n, f) => {
        const lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
        out[0] = -2 * lr; out[1] = 0; out[2] = 0; out[3] = 0;
        out[4] = 0; out[5] = -2 * bt; out[6] = 0; out[7] = 0;
        out[8] = 0; out[9] = 0; out[10] = 2 * nf; out[11] = 0;
        out[12] = (l + r) * lr;
        out[13] = (t + b) * bt;
        out[14] = (f + n) * nf;
        out[15] = 1;
        return out;
    },

    lookAt: (out, eye, center, up) => {
        const ex = eye[0], ey = eye[1], ez = eye[2];
        let zx = ex - center[0], zy = ey - center[1], zz = ez - center[2];
        let len = Math.hypot(zx, zy, zz);
        if (len < EPS) { zz = 1; len = 1; }
        zx /= len; zy /= len; zz /= len;

        let xx = up[1] * zz - up[2] * zy;
        let xy = up[2] * zx - up[0] * zz;
        let xz = up[0] * zy - up[1] * zx;
        len = Math.hypot(xx, xy, xz);
        if (len < EPS) { xx = 1; xy = 0; xz = 0; len = 1; }
        xx /= len; xy /= len; xz /= len;

        const yx = zy * xz - zz * xy;
        const yy = zz * xx - zx * xz;
        const yz = zx * xy - zy * xx;

        out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
        out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
        out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
        out[12] = -(xx * ex + xy * ey + xz * ez);
        out[13] = -(yx * ex + yy * ey + yz * ez);
        out[14] = -(zx * ex + zy * ey + zz * ez);
        out[15] = 1;
        return out;
    },
};

export const quat = {
    create: () => new Float32Array([0, 0, 0, 1]),
    identity: (out) => (out[0] = 0, out[1] = 0, out[2] = 0, out[3] = 1, out),
    clone: (a) => new Float32Array(a),
    copy: (out, a) => (out.set(a), out),

    setAxisAngle: (out, axis, rad) => {
        rad *= 0.5;
        const s = Math.sin(rad);
        out[0] = axis[0] * s;
        out[1] = axis[1] * s;
        out[2] = axis[2] * s;
        out[3] = Math.cos(rad);
        return out;
    },

    fromEulerXYZ: (out, xRad, yRad, zRad) => {
        // q = qx * qy * qz (XYZ)
        const hx = xRad * 0.5, hy = yRad * 0.5, hz = zRad * 0.5;
        const sx = Math.sin(hx), cx = Math.cos(hx);
        const sy = Math.sin(hy), cy = Math.cos(hy);
        const sz = Math.sin(hz), cz = Math.cos(hz);

        // 组合（XYZ）
        out[0] = sx * cy * cz + cx * sy * sz;
        out[1] = cx * sy * cz - sx * cy * sz;
        out[2] = cx * cy * sz + sx * sy * cz;
        out[3] = cx * cy * cz - sx * sy * sz;
        return out;
    },

    mul: (out, a, b) => {
        const ax = a[0], ay = a[1], az = a[2], aw = a[3];
        const bx = b[0], by = b[1], bz = b[2], bw = b[3];
        out[0] = ax * bw + aw * bx + ay * bz - az * by;
        out[1] = ay * bw + aw * by + az * bx - ax * bz;
        out[2] = az * bw + aw * bz + ax * by - ay * bx;
        out[3] = aw * bw - ax * bx - ay * by - az * bz;
        return out;
    },

    conjugate: (out, q) => (out[0] = -q[0], out[1] = -q[1], out[2] = -q[2], out[3] = q[3], out),

    invert: (out, q) => {
        const x = q[0], y = q[1], z = q[2], w = q[3];
        const d = x * x + y * y + z * z + w * w;
        if (d < EPS) { return quat.identity(out); }
        const inv = 1 / d;
        out[0] = -x * inv; out[1] = -y * inv; out[2] = -z * inv; out[3] = w * inv;
        return out;
    },

    normalize: (out, q) => {
        const l = Math.hypot(q[0], q[1], q[2], q[3]);
        if (l > EPS) { out[0] = q[0] / l; out[1] = q[1] / l; out[2] = q[2] / l; out[3] = q[3] / l; }
        return out;
    },

    slerp: (out, a, b, t) => {
        let ax = a[0], ay = a[1], az = a[2], aw = a[3];
        let bx = b[0], by = b[1], bz = b[2], bw = b[3];

        let cos = ax * bx + ay * by + az * bz + aw * bw;
        if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }

        if (cos > 0.9995) {
            // 线性近似
            out[0] = ax + (bx - ax) * t;
            out[1] = ay + (by - ay) * t;
            out[2] = az + (bz - az) * t;
            out[3] = aw + (bw - aw) * t;
            return quat.normalize(out, out);
        }

        const theta = Math.acos(clamp(cos, -1, 1));
        const sin = Math.sin(theta);
        const w1 = Math.sin((1 - t) * theta) / sin;
        const w2 = Math.sin(t * theta) / sin;

        out[0] = ax * w1 + bx * w2;
        out[1] = ay * w1 + by * w2;
        out[2] = az * w1 + bz * w2;
        out[3] = aw * w1 + bw * w2;
        return out;
    },

    fromMat3: (out, m) => {
        // m: column-major mat3
        const m00 = m[0], m11 = m[4], m22 = m[8];
        const trace = m00 + m11 + m22;
        if (trace > 0) {
            const s = Math.sqrt(trace + 1.0) * 2; // 4*w
            out[3] = 0.25 * s;
            out[0] = (m[5] - m[7]) / s;
            out[1] = (m[6] - m[2]) / s;
            out[2] = (m[1] - m[3]) / s;
        } else if (m00 > m11 && m00 > m22) {
            const s = Math.sqrt(1.0 + m00 - m11 - m22) * 2; // 4*x
            out[3] = (m[5] - m[7]) / s;
            out[0] = 0.25 * s;
            out[1] = (m[1] + m[3]) / s;
            out[2] = (m[6] + m[2]) / s;
        } else if (m11 > m22) {
            const s = Math.sqrt(1.0 + m11 - m00 - m22) * 2; // 4*y
            out[3] = (m[6] - m[2]) / s;
            out[0] = (m[1] + m[3]) / s;
            out[1] = 0.25 * s;
            out[2] = (m[5] + m[7]) / s;
        } else {
            const s = Math.sqrt(1.0 + m22 - m00 - m11) * 2; // 4*z
            out[3] = (m[1] - m[3]) / s;
            out[0] = (m[6] + m[2]) / s;
            out[1] = (m[5] + m[7]) / s;
            out[2] = 0.25 * s;
        }
        return quat.normalize(out, out);
    },

    rotateVec3: (out, q, v) => vec3.transformQuat(out, v, q),

    toMat4: (outMat4, q) => mat4.fromTRS(outMat4, _scratch.v3zero, q, _scratch.v3one),
};

/* ============ Geometry primitives & intersections (no camera) ============ */

export const geom = {
    ray: {
        create: () => ({ origin: vec3.create(), dir: vec3.fromValues(0, 0, 1) }),
        set: (out, origin, dir, normalizeDir = true) => {
            vec3.copy(out.origin, origin);
            if (normalizeDir) vec3.normalize(out.dir, dir);
            else vec3.copy(out.dir, dir);
            return out;
        },
        at: (out, ray, t) => (
            out[0] = ray.origin[0] + ray.dir[0] * t,
            out[1] = ray.origin[1] + ray.dir[1] * t,
            out[2] = ray.origin[2] + ray.dir[2] * t,
            out
        ),
        intersectPlaneT: (ray, plane) => {
            // plane: n·x + d = 0
            const nx = plane.n[0], ny = plane.n[1], nz = plane.n[2];
            const denom = nx * ray.dir[0] + ny * ray.dir[1] + nz * ray.dir[2];
            if (Math.abs(denom) < EPS) return null;
            const t = -(nx * ray.origin[0] + ny * ray.origin[1] + nz * ray.origin[2] + plane.d) / denom;
            return t >= 0 ? t : null;
        },
        intersectSphereT: (ray, sphere) => {
            const ox = ray.origin[0] - sphere.c[0];
            const oy = ray.origin[1] - sphere.c[1];
            const oz = ray.origin[2] - sphere.c[2];
            const dx = ray.dir[0], dy = ray.dir[1], dz = ray.dir[2];
            const b = ox * dx + oy * dy + oz * dz;
            const c = ox * ox + oy * oy + oz * oz - sphere.r * sphere.r;
            const disc = b * b - c;
            if (disc < 0) return null;
            const t = -b - Math.sqrt(disc);
            return t >= 0 ? t : (-b + Math.sqrt(disc) >= 0 ? -b + Math.sqrt(disc) : null);
        },
        intersectAABBT: (ray, aabb) => {
            // slab method
            const ox = ray.origin[0], oy = ray.origin[1], oz = ray.origin[2];
            const dx = ray.dir[0], dy = ray.dir[1], dz = ray.dir[2];
            let tmin = -Infinity, tmax = Infinity;

            // x
            if (Math.abs(dx) < EPS) {
                if (ox < aabb.min[0] || ox > aabb.max[0]) return null;
            } else {
                const inv = 1 / dx;
                let t1 = (aabb.min[0] - ox) * inv;
                let t2 = (aabb.max[0] - ox) * inv;
                if (t1 > t2) [t1, t2] = [t2, t1];
                tmin = Math.max(tmin, t1);
                tmax = Math.min(tmax, t2);
                if (tmin > tmax) return null;
            }

            // y
            if (Math.abs(dy) < EPS) {
                if (oy < aabb.min[1] || oy > aabb.max[1]) return null;
            } else {
                const inv = 1 / dy;
                let t1 = (aabb.min[1] - oy) * inv;
                let t2 = (aabb.max[1] - oy) * inv;
                if (t1 > t2) [t1, t2] = [t2, t1];
                tmin = Math.max(tmin, t1);
                tmax = Math.min(tmax, t2);
                if (tmin > tmax) return null;
            }

            // z
            if (Math.abs(dz) < EPS) {
                if (oz < aabb.min[2] || oz > aabb.max[2]) return null;
            } else {
                const inv = 1 / dz;
                let t1 = (aabb.min[2] - oz) * inv;
                let t2 = (aabb.max[2] - oz) * inv;
                if (t1 > t2) [t1, t2] = [t2, t1];
                tmin = Math.max(tmin, t1);
                tmax = Math.min(tmax, t2);
                if (tmin > tmax) return null;
            }

            if (tmax < 0) return null;
            return tmin >= 0 ? tmin : tmax;
        },
        intersectTriangleT: (ray, tri) => {
            // Möller–Trumbore
            const o = ray.origin, d = ray.dir;
            const v0 = tri.a, v1 = tri.b, v2 = tri.c;

            const e1 = vec3.sub(_scratch.v3a, v1, v0);
            const e2 = vec3.sub(_scratch.v3b, v2, v0);
            const p = vec3.cross(_scratch.v3c, d, e2);
            const det = vec3.dot(e1, p);
            if (Math.abs(det) < EPS) return null;
            const inv = 1 / det;

            const tvec = vec3.sub(_scratch.v3d, o, v0);
            const u = vec3.dot(tvec, p) * inv;
            if (u < 0 || u > 1) return null;

            const q = vec3.cross(_scratch.v3e, tvec, e1);
            const v = vec3.dot(d, q) * inv;
            if (v < 0 || u + v > 1) return null;

            const t = vec3.dot(e2, q) * inv;
            return t >= 0 ? t : null;
        },
    },

    plane: {
        create: () => ({ n: vec3.fromValues(0, 1, 0), d: 0 }), // n·x + d = 0
        fromNormalPoint: (out, normal, point) => {
            vec3.normalize(out.n, normal);
            out.d = -(out.n[0] * point[0] + out.n[1] * point[1] + out.n[2] * point[2]);
            return out;
        },
        fromCoplanarPoints: (out, a, b, c) => {
            const ab = vec3.sub(_scratch.v3a, b, a);
            const ac = vec3.sub(_scratch.v3b, c, a);
            vec3.cross(out.n, ab, ac);
            vec3.normalize(out.n, out.n);
            out.d = -(out.n[0] * a[0] + out.n[1] * a[1] + out.n[2] * a[2]);
            return out;
        },
        distanceToPoint: (plane, p) => plane.n[0] * p[0] + plane.n[1] * p[1] + plane.n[2] * p[2] + plane.d,
        projectPoint: (out, plane, p) => {
            const dist = geom.plane.distanceToPoint(plane, p);
            out[0] = p[0] - plane.n[0] * dist;
            out[1] = p[1] - plane.n[1] * dist;
            out[2] = p[2] - plane.n[2] * dist;
            return out;
        },
    },

    aabb: {
        create: () => ({ min: vec3.fromValues(Infinity, Infinity, Infinity), max: vec3.fromValues(-Infinity, -Infinity, -Infinity) }),
        set: (out, min, max) => (vec3.copy(out.min, min), vec3.copy(out.max, max), out),
        fromCenterExtents: (out, c, e) => {
            out.min[0] = c[0] - e[0]; out.min[1] = c[1] - e[1]; out.min[2] = c[2] - e[2];
            out.max[0] = c[0] + e[0]; out.max[1] = c[1] + e[1]; out.max[2] = c[2] + e[2];
            return out;
        },
        expandByPoint: (out, p) => {
            out.min[0] = Math.min(out.min[0], p[0]); out.min[1] = Math.min(out.min[1], p[1]); out.min[2] = Math.min(out.min[2], p[2]);
            out.max[0] = Math.max(out.max[0], p[0]); out.max[1] = Math.max(out.max[1], p[1]); out.max[2] = Math.max(out.max[2], p[2]);
            return out;
        },
        union: (out, a, b) => {
            out.min[0] = Math.min(a.min[0], b.min[0]); out.min[1] = Math.min(a.min[1], b.min[1]); out.min[2] = Math.min(a.min[2], b.min[2]);
            out.max[0] = Math.max(a.max[0], b.max[0]); out.max[1] = Math.max(a.max[1], b.max[1]); out.max[2] = Math.max(a.max[2], b.max[2]);
            return out;
        },
        intersect: (out, a, b) => {
            out.min[0] = Math.max(a.min[0], b.min[0]); out.min[1] = Math.max(a.min[1], b.min[1]); out.min[2] = Math.max(a.min[2], b.min[2]);
            out.max[0] = Math.min(a.max[0], b.max[0]); out.max[1] = Math.min(a.max[1], b.max[1]); out.max[2] = Math.min(a.max[2], b.max[2]);
            return out;
        },
        isEmpty: (a) => (a.min[0] > a.max[0] || a.min[1] > a.max[1] || a.min[2] > a.max[2]),
        containsPoint: (a, p) => (
            p[0] >= a.min[0] && p[0] <= a.max[0] &&
            p[1] >= a.min[1] && p[1] <= a.max[1] &&
            p[2] >= a.min[2] && p[2] <= a.max[2]
        ),
        closestPoint: (out, a, p) => (
            out[0] = clamp(p[0], a.min[0], a.max[0]),
            out[1] = clamp(p[1], a.min[1], a.max[1]),
            out[2] = clamp(p[2], a.min[2], a.max[2]),
            out
        ),
        distanceToPoint: (a, p) => {
            const c = geom.aabb.closestPoint(_scratch.v3a, a, p);
            return vec3.dist(c, p);
        },
    },

    sphere: {
        create: () => ({ c: vec3.create(), r: 1 }),
        set: (out, c, r) => (vec3.copy(out.c, c), out.r = r, out),
        containsPoint: (s, p) => vec3.dist(s.c, p) <= s.r,
        intersectSphere: (a, b) => vec3.dist(a.c, b.c) <= (a.r + b.r),
        closestPoint: (out, s, p) => {
            const dir = vec3.sub(_scratch.v3a, p, s.c);
            const l = vec3.len(dir);
            if (l < EPS) { out[0] = s.c[0] + s.r; out[1] = s.c[1]; out[2] = s.c[2]; return out; }
            vec3.scale(dir, dir, 1 / l);
            out[0] = s.c[0] + dir[0] * s.r;
            out[1] = s.c[1] + dir[1] * s.r;
            out[2] = s.c[2] + dir[2] * s.r;
            return out;
        },
    },

    triangle: {
        create: () => ({ a: vec3.create(), b: vec3.create(), c: vec3.create() }),
        set: (out, a, b, c) => (vec3.copy(out.a, a), vec3.copy(out.b, b), vec3.copy(out.c, c), out),
        normal: (out, tri) => {
            const ab = vec3.sub(_scratch.v3a, tri.b, tri.a);
            const ac = vec3.sub(_scratch.v3b, tri.c, tri.a);
            vec3.cross(out, ab, ac);
            return vec3.normalize(out, out);
        },
        barycentric: (outUVW, tri, p) => {
            // returns (u,v,w) where u+v+w=1
            const v0 = vec3.sub(_scratch.v3a, tri.b, tri.a);
            const v1 = vec3.sub(_scratch.v3b, tri.c, tri.a);
            const v2 = vec3.sub(_scratch.v3c, p, tri.a);

            const d00 = vec3.dot(v0, v0);
            const d01 = vec3.dot(v0, v1);
            const d11 = vec3.dot(v1, v1);
            const d20 = vec3.dot(v2, v0);
            const d21 = vec3.dot(v2, v1);

            const denom = d00 * d11 - d01 * d01;
            if (Math.abs(denom) < EPS) { outUVW[0] = 1; outUVW[1] = 0; outUVW[2] = 0; return outUVW; }

            const v = (d11 * d20 - d01 * d21) / denom;
            const w = (d00 * d21 - d01 * d20) / denom;
            const u = 1 - v - w;
            outUVW[0] = u; outUVW[1] = v; outUVW[2] = w;
            return outUVW;
        },
        closestPointToPoint: (out, tri, p) => {
            // Real-Time Collision Detection (Christer Ericson) 版本
            const a = tri.a, b = tri.b, c = tri.c;

            const ab = vec3.sub(_scratch.v3a, b, a);
            const ac = vec3.sub(_scratch.v3b, c, a);
            const ap = vec3.sub(_scratch.v3c, p, a);

            const d1 = vec3.dot(ab, ap);
            const d2 = vec3.dot(ac, ap);
            if (d1 <= 0 && d2 <= 0) return vec3.copy(out, a);

            const bp = vec3.sub(_scratch.v3c, p, b);
            const d3 = vec3.dot(ab, bp);
            const d4 = vec3.dot(ac, bp);
            if (d3 >= 0 && d4 <= d3) return vec3.copy(out, b);

            const vc = d1 * d4 - d3 * d2;
            if (vc <= 0 && d1 >= 0 && d3 <= 0) {
                const v = d1 / (d1 - d3);
                out[0] = a[0] + ab[0] * v;
                out[1] = a[1] + ab[1] * v;
                out[2] = a[2] + ab[2] * v;
                return out;
            }

            const cp = vec3.sub(_scratch.v3c, p, c);
            const d5 = vec3.dot(ab, cp);
            const d6 = vec3.dot(ac, cp);
            if (d6 >= 0 && d5 <= d6) return vec3.copy(out, c);

            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) {
                const w = d2 / (d2 - d6);
                out[0] = a[0] + ac[0] * w;
                out[1] = a[1] + ac[1] * w;
                out[2] = a[2] + ac[2] * w;
                return out;
            }

            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
                const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
                out[0] = b[0] + (c[0] - b[0]) * w;
                out[1] = b[1] + (c[1] - b[1]) * w;
                out[2] = b[2] + (c[2] - b[2]) * w;
                return out;
            }

            // inside face region
            const denom = 1 / (va + vb + vc);
            const v = vb * denom;
            const w = vc * denom;
            out[0] = a[0] + ab[0] * v + ac[0] * w;
            out[1] = a[1] + ab[1] * v + ac[1] * w;
            out[2] = a[2] + ab[2] * v + ac[2] * w;
            return out;
        },
    },
};

/** 内部 scratch：避免频繁 new */
const _scratch = {
    v3a: vec3.create(),
    v3b: vec3.create(),
    v3c: vec3.create(),
    v3d: vec3.create(),
    v3e: vec3.create(),
    m3a: mat3.create(),
    v3zero: vec3.fromValues(0, 0, 0),
    v3one: vec3.fromValues(1, 1, 1),
};

/* ---------------------------------------------
 * 兜底补丁：如果 math-gl.js 缺少一些常用函数，这里补上
 * （让 webgl-runtime.js 的 Node/Camera/Renderer 更稳）
 * --------------------------------------------- */
(function ensureMathPatches() {
    // mat4.fromTRS
    if (!mat4.fromTRS) {
        mat4.fromTRS = (out, t, q, s) => {
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

            out[12] = t[0]; out[13] = t[1]; out[14] = t[2]; out[15] = 1;
            return out;
        };
    }

    // mat4.invertAffine（只适用于仿射矩阵 TRS，无投影）
    if (!mat4.invertAffine) {
        mat4.invertAffine = (out, m) => {
            const m00 = m[0], m01 = m[1], m02 = m[2];
            const m10 = m[4], m11 = m[5], m12 = m[6];
            const m20 = m[8], m21 = m[9], m22 = m[10];
            const tx = m[12], ty = m[13], tz = m[14];

            const b01 = m22 * m11 - m12 * m21;
            const b11 = -m22 * m10 + m12 * m20;
            const b21 = m21 * m10 - m11 * m20;

            let det = m00 * b01 + m01 * b11 + m02 * b21;
            if (Math.abs(det) < 1e-8) return null;
            det = 1 / det;

            const i00 = b01 * det;
            const i01 = (-m22 * m01 + m02 * m21) * det;
            const i02 = (m12 * m01 - m02 * m11) * det;

            const i10 = b11 * det;
            const i11 = (m22 * m00 - m02 * m20) * det;
            const i12 = (-m12 * m00 + m02 * m10) * det;

            const i20 = b21 * det;
            const i21 = (-m21 * m00 + m01 * m20) * det;
            const i22 = (m11 * m00 - m01 * m10) * det;

            out[0] = i00; out[1] = i01; out[2] = i02; out[3] = 0;
            out[4] = i10; out[5] = i11; out[6] = i12; out[7] = 0;
            out[8] = i20; out[9] = i21; out[10] = i22; out[11] = 0;

            out[12] = -(i00 * tx + i10 * ty + i20 * tz);
            out[13] = -(i01 * tx + i11 * ty + i21 * tz);
            out[14] = -(i02 * tx + i12 * ty + i22 * tz);
            out[15] = 1;
            return out;
        };
    }

    // mat3.normalFromMat4
    if (!mat3.normalFromMat4) {
        mat3.normalFromMat4 = (out, m4) => {
            const a = _scratch.m3a;
            // fromMat4 (column-major)
            a[0] = m4[0]; a[1] = m4[1]; a[2] = m4[2];
            a[3] = m4[4]; a[4] = m4[5]; a[5] = m4[6];
            a[6] = m4[8]; a[7] = m4[9]; a[8] = m4[10];
            if (!mat3.invert(out, a)) return null;
            return mat3.transpose(out, out);
        };
    }
})();

/** 总出口 */
export const glm = { mathf, easing, Random, color, vec2, vec3, vec4, mat2, mat3, mat4, quat, geom };