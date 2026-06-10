/*
 * Copyright 2021 GFXFundamentals.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of GFXFundamentals. nor the names of his
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * Various 3d math functions.
 *
 * @module webgl-3d-math
 */
(function(root, factory) {  // eslint-disable-line
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.m4 = factory();
  }
}(this, function() {
  "use strict";

  let MatType = Float32Array;

  function setDefaultType(Ctor) {
    const OldType = MatType;
    MatType = Ctor;
    return OldType;
  }

  function multiply(a, b, dst) {
    dst = dst || new MatType(16);
    var b00 = b[0 * 4 + 0];
    var b01 = b[0 * 4 + 1];
    var b02 = b[0 * 4 + 2];
    var b03 = b[0 * 4 + 3];
    var b10 = b[1 * 4 + 0];
    var b11 = b[1 * 4 + 1];
    var b12 = b[1 * 4 + 2];
    var b13 = b[1 * 4 + 3];
    var b20 = b[2 * 4 + 0];
    var b21 = b[2 * 4 + 1];
    var b22 = b[2 * 4 + 2];
    var b23 = b[2 * 4 + 3];
    var b30 = b[3 * 4 + 0];
    var b31 = b[3 * 4 + 1];
    var b32 = b[3 * 4 + 2];
    var b33 = b[3 * 4 + 3];
    var a00 = a[0 * 4 + 0];
    var a01 = a[0 * 4 + 1];
    var a02 = a[0 * 4 + 2];
    var a03 = a[0 * 4 + 3];
    var a10 = a[1 * 4 + 0];
    var a11 = a[1 * 4 + 1];
    var a12 = a[1 * 4 + 2];
    var a13 = a[1 * 4 + 3];
    var a20 = a[2 * 4 + 0];
    var a21 = a[2 * 4 + 1];
    var a22 = a[2 * 4 + 2];
    var a23 = a[2 * 4 + 3];
    var a30 = a[3 * 4 + 0];
    var a31 = a[3 * 4 + 1];
    var a32 = a[3 * 4 + 2];
    var a33 = a[3 * 4 + 3];
    dst[ 0] = b00 * a00 + b01 * a10 + b02 * a20 + b03 * a30;
    dst[ 1] = b00 * a01 + b01 * a11 + b02 * a21 + b03 * a31;
    dst[ 2] = b00 * a02 + b01 * a12 + b02 * a22 + b03 * a32;
    dst[ 3] = b00 * a03 + b01 * a13 + b02 * a23 + b03 * a33;
    dst[ 4] = b10 * a00 + b11 * a10 + b12 * a20 + b13 * a30;
    dst[ 5] = b10 * a01 + b11 * a11 + b12 * a21 + b13 * a31;
    dst[ 6] = b10 * a02 + b11 * a12 + b12 * a22 + b13 * a32;
    dst[ 7] = b10 * a03 + b11 * a13 + b12 * a23 + b13 * a33;
    dst[ 8] = b20 * a00 + b21 * a10 + b22 * a20 + b23 * a30;
    dst[ 9] = b20 * a01 + b21 * a11 + b22 * a21 + b23 * a31;
    dst[10] = b20 * a02 + b21 * a12 + b22 * a22 + b23 * a32;
    dst[11] = b20 * a03 + b21 * a13 + b22 * a23 + b23 * a33;
    dst[12] = b30 * a00 + b31 * a10 + b32 * a20 + b33 * a30;
    dst[13] = b30 * a01 + b31 * a11 + b32 * a21 + b33 * a31;
    dst[14] = b30 * a02 + b31 * a12 + b32 * a22 + b33 * a32;
    dst[15] = b30 * a03 + b31 * a13 + b32 * a23 + b33 * a33;
    return dst;
  }

  function addVectors(a, b, dst) {
    dst = dst || new MatType(3);
    dst[0] = a[0] + b[0];
    dst[1] = a[1] + b[1];
    dst[2] = a[2] + b[2];
    return dst;
  }

  function subtractVectors(a, b, dst) {
    dst = dst || new MatType(3);
    dst[0] = a[0] - b[0];
    dst[1] = a[1] - b[1];
    dst[2] = a[2] - b[2];
    return dst;
  }

  function scaleVector(v, s, dst) {
    dst = dst || new MatType(3);
    dst[0] = v[0] * s;
    dst[1] = v[1] * s;
    dst[2] = v[2] * s;
    return dst;
  }

  function normalize(v, dst) {
    dst = dst || new MatType(3);
    var length = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (length > 0.00001) {
      dst[0] = v[0] / length;
      dst[1] = v[1] / length;
      dst[2] = v[2] / length;
    }
    return dst;
  }

  function length(v) {
    return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  }

  function cross(a, b, dst) {
    dst = dst || new MatType(3);
    dst[0] = a[1] * b[2] - a[2] * b[1];
    dst[1] = a[2] * b[0] - a[0] * b[2];
    dst[2] = a[0] * b[1] - a[1] * b[0];
    return dst;
  }

  function dot(a, b) {
    return (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
  }

  function identity(dst) {
    dst = dst || new MatType(16);
    dst[ 0] = 1; dst[ 1] = 0; dst[ 2] = 0; dst[ 3] = 0;
    dst[ 4] = 0; dst[ 5] = 1; dst[ 6] = 0; dst[ 7] = 0;
    dst[ 8] = 0; dst[ 9] = 0; dst[10] = 1; dst[11] = 0;
    dst[12] = 0; dst[13] = 0; dst[14] = 0; dst[15] = 1;
    return dst;
  }

  function lookAt(cameraPosition, target, up, dst) {
    dst = dst || new MatType(16);
    var zAxis = normalize(subtractVectors(cameraPosition, target));
    var xAxis = normalize(cross(up, zAxis));
    var yAxis = normalize(cross(zAxis, xAxis));
    dst[ 0] = xAxis[0]; dst[ 1] = xAxis[1]; dst[ 2] = xAxis[2]; dst[ 3] = 0;
    dst[ 4] = yAxis[0]; dst[ 5] = yAxis[1]; dst[ 6] = yAxis[2]; dst[ 7] = 0;
    dst[ 8] = zAxis[0]; dst[ 9] = zAxis[1]; dst[10] = zAxis[2]; dst[11] = 0;
    dst[12] = cameraPosition[0]; dst[13] = cameraPosition[1]; dst[14] = cameraPosition[2]; dst[15] = 1;
    return dst;
  }

  function perspective(fieldOfViewInRadians, aspect, near, far, dst) {
    dst = dst || new MatType(16);
    var f = Math.tan(Math.PI * 0.5 - 0.5 * fieldOfViewInRadians);
    var rangeInv = 1.0 / (near - far);
    dst[ 0] = f / aspect; dst[ 1] = 0; dst[ 2] = 0; dst[ 3] = 0;
    dst[ 4] = 0; dst[ 5] = f; dst[ 6] = 0; dst[ 7] = 0;
    dst[ 8] = 0; dst[ 9] = 0; dst[10] = (near + far) * rangeInv; dst[11] = -1;
    dst[12] = 0; dst[13] = 0; dst[14] = near * far * rangeInv * 2; dst[15] = 0;
    return dst;
  }

  function translation(tx, ty, tz, dst) {
    dst = dst || new MatType(16);
    dst[ 0] = 1; dst[ 1] = 0; dst[ 2] = 0; dst[ 3] = 0;
    dst[ 4] = 0; dst[ 5] = 1; dst[ 6] = 0; dst[ 7] = 0;
    dst[ 8] = 0; dst[ 9] = 0; dst[10] = 1; dst[11] = 0;
    dst[12] = tx; dst[13] = ty; dst[14] = tz; dst[15] = 1;
    return dst;
  }

  function xRotation(angleInRadians, dst) {
    dst = dst || new MatType(16);
    var c = Math.cos(angleInRadians);
    var s = Math.sin(angleInRadians);
    dst[ 0] = 1; dst[ 1] = 0; dst[ 2] = 0; dst[ 3] = 0;
    dst[ 4] = 0; dst[ 5] = c; dst[ 6] = s; dst[ 7] = 0;
    dst[ 8] = 0; dst[ 9] = -s; dst[10] = c; dst[11] = 0;
    dst[12] = 0; dst[13] = 0; dst[14] = 0; dst[15] = 1;
    return dst;
  }

  function yRotation(angleInRadians, dst) {
    dst = dst || new MatType(16);
    var c = Math.cos(angleInRadians);
    var s = Math.sin(angleInRadians);
    dst[ 0] = c; dst[ 1] = 0; dst[ 2] = -s; dst[ 3] = 0;
    dst[ 4] = 0; dst[ 5] = 1; dst[ 6] = 0; dst[ 7] = 0;
    dst[ 8] = s; dst[ 9] = 0; dst[10] = c; dst[11] = 0;
    dst[12] = 0; dst[13] = 0; dst[14] = 0; dst[15] = 1;
    return dst;
  }

  function scaling(sx, sy, sz, dst) {
    dst = dst || new MatType(16);
    dst[ 0] = sx; dst[ 1] = 0; dst[ 2] = 0; dst[ 3] = 0;
    dst[ 4] = 0; dst[ 5] = sy; dst[ 6] = 0; dst[ 7] = 0;
    dst[ 8] = 0; dst[ 9] = 0; dst[10] = sz; dst[11] = 0;
    dst[12] = 0; dst[13] = 0; dst[14] = 0; dst[15] = 1;
    return dst;
  }

  return {
    copy: function(src, dst) {
      dst = dst || new MatType(16);
      for (let i = 0; i < 16; i++) dst[i] = src[i];
      return dst;
    },
    lookAt: lookAt,
    addVectors: addVectors,
    subtractVectors: subtractVectors,
    scaleVector: scaleVector,
    normalize: normalize,
    cross: cross,
    dot: dot,
    identity: identity,
    length: length,
    perspective: perspective,
    translation: translation,
    xRotation: xRotation,
    yRotation: yRotation,
    scaling: scaling,
    multiply: multiply,
  };
}));