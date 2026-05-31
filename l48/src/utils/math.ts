import type { Vec3, Vec4, Mat4 } from '@/types';

export const vec3 = {
  create: (x: number = 0, y: number = 0, z: number = 0): Vec3 => [x, y, z],

  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],

  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],

  mul: (a: Vec3, b: Vec3 | number): Vec3 => {
    if (typeof b === 'number') {
      return [a[0] * b, a[1] * b, a[2] * b];
    }
    return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
  },

  div: (a: Vec3, b: Vec3 | number): Vec3 => {
    if (typeof b === 'number') {
      return [a[0] / b, a[1] / b, a[2] / b];
    }
    return [a[0] / b[0], a[1] / b[1], a[2] / b[2]];
  },

  dot: (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],

  cross: (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],

  length: (v: Vec3): number => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]),

  lengthSq: (v: Vec3): number => v[0] * v[0] + v[1] * v[1] + v[2] * v[2],

  normalize: (v: Vec3): Vec3 => {
    const len = vec3.length(v);
    if (len === 0) return [0, 0, 0];
    return vec3.div(v, len);
  },

  distance: (a: Vec3, b: Vec3): number => vec3.length(vec3.sub(a, b)),

  distanceSq: (a: Vec3, b: Vec3): number => vec3.lengthSq(vec3.sub(a, b)),

  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ],

  clamp: (v: Vec3, min: number, max: number): Vec3 => [
    Math.max(min, Math.min(max, v[0])),
    Math.max(min, Math.min(max, v[1])),
    Math.max(min, Math.min(max, v[2])),
  ],

  negate: (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]],

  reflect: (v: Vec3, normal: Vec3): Vec3 => {
    const d = vec3.dot(v, normal) * 2;
    return vec3.sub(v, vec3.mul(normal, d));
  },

  refract: (v: Vec3, normal: Vec3, eta: number): Vec3 => {
    const dot = vec3.dot(v, normal);
    const k = 1 - eta * eta * (1 - dot * dot);
    if (k < 0) return [0, 0, 0];
    return vec3.sub(
      vec3.mul(v, eta),
      vec3.mul(normal, eta * dot + Math.sqrt(k))
    );
  },

  faceForward: (n: Vec3, v: Vec3): Vec3 => {
    if (vec3.dot(v, n) < 0) return n;
    return vec3.negate(n);
  },

  min: (a: Vec3, b: Vec3): Vec3 => [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.min(a[2], b[2]),
  ],

  max: (a: Vec3, b: Vec3): Vec3 => [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.max(a[2], b[2]),
  ],

  abs: (v: Vec3): Vec3 => [Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])],

  fromArray: (arr: ArrayLike<number>, offset: number = 0): Vec3 => [
    arr[offset],
    arr[offset + 1],
    arr[offset + 2],
  ],

  toArray: (v: Vec3, arr: number[] = [], offset: number = 0): number[] => {
    arr[offset] = v[0];
    arr[offset + 1] = v[1];
    arr[offset + 2] = v[2];
    return arr;
  },
};

export const vec4 = {
  create: (x: number = 0, y: number = 0, z: number = 0, w: number = 0): Vec4 => [x, y, z, w],

  add: (a: Vec4, b: Vec4): Vec4 => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]],

  sub: (a: Vec4, b: Vec4): Vec4 => [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]],

  mul: (a: Vec4, b: Vec4 | number): Vec4 => {
    if (typeof b === 'number') {
      return [a[0] * b, a[1] * b, a[2] * b, a[3] * b];
    }
    return [a[0] * b[0], a[1] * b[1], a[2] * b[2], a[3] * b[3]];
  },

  dot: (a: Vec4, b: Vec4): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3],

  length: (v: Vec4): number => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2] + v[3] * v[3]),

  normalize: (v: Vec4): Vec4 => {
    const len = vec4.length(v);
    if (len === 0) return [0, 0, 0, 0];
    const inv = 1 / len;
    return [v[0] * inv, v[1] * inv, v[2] * inv, v[3] * inv];
  },

  lerp: (a: Vec4, b: Vec4, t: number): Vec4 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ],
};

export const mat4 = {
  create: (): Mat4 => [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ],

  identity: (): Mat4 => mat4.create(),

  clone: (m: Mat4): Mat4 => [...m],

  mul: (a: Mat4, b: Mat4): Mat4 => {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
    const m0 = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    const m1 = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    const m2 = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    const m3 = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
    const m4 = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    const m5 = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    const m6 = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    const m7 = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
    const m8 = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    const m9 = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    const m10 = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    const m11 = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
    const m12 = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    const m13 = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    const m14 = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    const m15 = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    return [m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15];
  },

  perspective: (fov: number, aspect: number, near: number, far: number): Mat4 => {
    const f = 1 / Math.tan(fov / 2);
    const nf = 1 / (near - far);
    return [
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ];
  },

  lookAt: (eye: Vec3, target: Vec3, up: Vec3): Mat4 => {
    const z = vec3.normalize(vec3.sub(eye, target));
    const x = vec3.normalize(vec3.cross(up, z));
    const y = vec3.cross(z, x);

    return [
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -vec3.dot(x, eye), -vec3.dot(y, eye), -vec3.dot(z, eye), 1,
    ];
  },

  translate: (m: Mat4, v: Vec3): Mat4 => {
    const [x, y, z] = v;
    const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3];
    const m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7];
    const m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];

    return [
      m0, m1, m2, m3,
      m4, m5, m6, m7,
      m8, m9, m10, m11,
      m0 * x + m4 * y + m8 * z + m[12],
      m1 * x + m5 * y + m9 * z + m[13],
      m2 * x + m6 * y + m10 * z + m[14],
      m3 * x + m7 * y + m11 * z + m[15],
    ];
  },

  scale: (m: Mat4, v: Vec3): Mat4 => {
    const [x, y, z] = v;
    return [
      m[0] * x, m[1] * x, m[2] * x, m[3] * x,
      m[4] * y, m[5] * y, m[6] * y, m[7] * y,
      m[8] * z, m[9] * z, m[10] * z, m[11] * z,
      m[12], m[13], m[14], m[15],
    ];
  },

  rotateX: (m: Mat4, angle: number): Mat4 => {
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    const m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7];
    const m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];

    return [
      m[0], m[1], m[2], m[3],
      m4 * c + m8 * s, m5 * c + m9 * s, m6 * c + m10 * s, m7 * c + m11 * s,
      m8 * c - m4 * s, m9 * c - m5 * s, m10 * c - m6 * s, m11 * c - m7 * s,
      m[12], m[13], m[14], m[15],
    ];
  },

  rotateY: (m: Mat4, angle: number): Mat4 => {
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3];
    const m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];

    return [
      m0 * c - m8 * s, m1 * c - m9 * s, m2 * c - m10 * s, m3 * c - m11 * s,
      m[4], m[5], m[6], m[7],
      m0 * s + m8 * c, m1 * s + m9 * c, m2 * s + m10 * c, m3 * s + m11 * c,
      m[12], m[13], m[14], m[15],
    ];
  },

  rotateZ: (m: Mat4, angle: number): Mat4 => {
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3];
    const m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7];

    return [
      m0 * c + m4 * s, m1 * c + m5 * s, m2 * c + m6 * s, m3 * c + m7 * s,
      m4 * c - m0 * s, m5 * c - m1 * s, m6 * c - m2 * s, m7 * c - m3 * s,
      m[8], m[9], m[10], m[11],
      m[12], m[13], m[14], m[15],
    ];
  },

  transpose: (m: Mat4): Mat4 => [
    m[0], m[4], m[8], m[12],
    m[1], m[5], m[9], m[13],
    m[2], m[6], m[10], m[14],
    m[3], m[7], m[11], m[15],
  ],

  ortho: (left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 => {
    const lr = 1 / (right - left);
    const bt = 1 / (top - bottom);
    const nf = 1 / (far - near);

    return [
      2 * lr, 0, 0, 0,
      0, 2 * bt, 0, 0,
      0, 0, -2 * nf, 0,
      -(right + left) * lr, -(top + bottom) * bt, -(far + near) * nf, 1,
    ];
  },

  inverse: (m: Mat4): Mat4 => {
    const m00 = m[0], m01 = m[1], m02 = m[2], m03 = m[3];
    const m10 = m[4], m11 = m[5], m12 = m[6], m13 = m[7];
    const m20 = m[8], m21 = m[9], m22 = m[10], m23 = m[11];
    const m30 = m[12], m31 = m[13], m32 = m[14], m33 = m[15];

    const tmp0 = m22 * m33 - m32 * m23;
    const tmp1 = m12 * m33 - m32 * m13;
    const tmp2 = m12 * m23 - m22 * m13;
    const tmp3 = m02 * m33 - m32 * m03;
    const tmp4 = m02 * m23 - m22 * m03;
    const tmp5 = m02 * m13 - m12 * m03;

    const t0 = tmp0 * m11 - tmp1 * m21 + tmp2 * m31;
    const t1 = tmp0 * m01 - tmp3 * m21 + tmp4 * m31;
    const t2 = tmp1 * m01 - tmp3 * m11 + tmp5 * m31;
    const t3 = tmp2 * m01 - tmp4 * m11 + tmp5 * m21;

    const det = m00 * t0 - m10 * t1 + m20 * t2 - m30 * t3;
    if (det === 0) return mat4.create();

    const invDet = 1 / det;

    const s0 = (tmp0 * m10 - tmp1 * m20 + tmp2 * m30) * invDet;
    const s1 = (tmp0 * m00 - tmp3 * m20 + tmp4 * m30) * invDet;
    const s2 = (tmp1 * m00 - tmp3 * m10 + tmp5 * m30) * invDet;
    const s3 = (tmp2 * m00 - tmp4 * m10 + tmp5 * m20) * invDet;

    const u0 = (m11 * tmp0 - m21 * tmp1 + m31 * tmp2) * invDet;
    const u1 = (m01 * tmp0 - m21 * tmp3 + m31 * tmp4) * invDet;
    const u2 = (m01 * tmp1 - m11 * tmp3 + m31 * tmp5) * invDet;
    const u3 = (m01 * tmp2 - m11 * tmp4 + m21 * tmp5) * invDet;

    const v0 = (m20 * m31 - m30 * m21) * invDet;
    const v1 = (m10 * m31 - m30 * m11) * invDet;
    const v2 = (m10 * m21 - m20 * m11) * invDet;
    const v3 = (m00 * m31 - m30 * m01) * invDet;
    const v4 = (m00 * m21 - m20 * m01) * invDet;
    const v5 = (m00 * m11 - m10 * m01) * invDet;

    const w0 = (m21 * m32 - m31 * m22) * invDet;
    const w1 = (m11 * m32 - m31 * m12) * invDet;
    const w2 = (m11 * m22 - m21 * m12) * invDet;
    const w3 = (m01 * m32 - m31 * m02) * invDet;
    const w4 = (m01 * m22 - m21 * m02) * invDet;
    const w5 = (m01 * m12 - m11 * m02) * invDet;

    return [
      s0, -u0, v0, -w0,
      -s1, u1, -v3, w3,
      s2, -u2, v4, -w4,
      -s3, u3, -v5, w5,
    ];
  },

  transformPoint: (m: Mat4, p: Vec3): Vec3 => {
    const [x, y, z] = p;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w === 0) return [0, 0, 0];
    const invW = 1 / w;
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) * invW,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) * invW,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) * invW,
    ];
  },

  transformDirection: (m: Mat4, d: Vec3): Vec3 => {
    const [x, y, z] = d;
    return [
      m[0] * x + m[4] * y + m[8] * z,
      m[1] * x + m[5] * y + m[9] * z,
      m[2] * x + m[6] * y + m[10] * z,
    ];
  },

  toArray: (m: Mat4, arr: number[] = [], offset: number = 0): number[] => {
    for (let i = 0; i < 16; i++) {
      arr[offset + i] = m[i];
    }
    return arr;
  },
};

export const color = {
  linearToSrgb: (c: Vec3): Vec3 => [
    c[0] <= 0.0031308 ? 12.92 * c[0] : 1.055 * Math.pow(c[0], 1 / 2.4) - 0.055,
    c[1] <= 0.0031308 ? 12.92 * c[1] : 1.055 * Math.pow(c[1], 1 / 2.4) - 0.055,
    c[2] <= 0.0031308 ? 12.92 * c[2] : 1.055 * Math.pow(c[2], 1 / 2.4) - 0.055,
  ],

  srgbToLinear: (c: Vec3): Vec3 => [
    c[0] <= 0.04045 ? c[0] / 12.92 : Math.pow((c[0] + 0.055) / 1.055, 2.4),
    c[1] <= 0.04045 ? c[1] / 12.92 : Math.pow((c[1] + 0.055) / 1.055, 2.4),
    c[2] <= 0.04045 ? c[2] / 12.92 : Math.pow((c[2] + 0.055) / 1.055, 2.4),
  ],

  packRgba8: (c: Vec4): number => {
    const r = Math.max(0, Math.min(255, Math.round(c[0] * 255)));
    const g = Math.max(0, Math.min(255, Math.round(c[1] * 255)));
    const b = Math.max(0, Math.min(255, Math.round(c[2] * 255)));
    const a = Math.max(0, Math.min(255, Math.round(c[3] * 255)));
    return (a << 24) | (b << 16) | (g << 8) | r;
  },

  unpackRgba8: (v: number): Vec4 => [
    (v & 0xff) / 255,
    ((v >> 8) & 0xff) / 255,
    ((v >> 16) & 0xff) / 255,
    ((v >> 24) & 0xff) / 255,
  ],
};

export const mathUtils = {
  clamp: (v: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, v)),

  lerp: (a: number, b: number, t: number): number =>
    a + (b - a) * t,

  smoothstep: (edge0: number, edge1: number, x: number): number => {
    const t = mathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  },

  degToRad: (deg: number): number =>
    deg * Math.PI / 180,

  radToDeg: (rad: number): number =>
    rad * 180 / Math.PI,

  nextPowerOfTwo: (n: number): number =>
    Math.pow(2, Math.ceil(Math.log2(n))),

  isPowerOfTwo: (n: number): boolean =>
    (n & (n - 1)) === 0,

  randomRange: (min: number, max: number): number =>
    min + Math.random() * (max - min),

  fract: (x: number): number =>
    x - Math.floor(x),
};
