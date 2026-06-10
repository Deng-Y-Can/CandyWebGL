/*
 * Copyright 2021 GFXFundamentals.
 * All rights reserved.
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.m4 = factory();
  }
}(this, function() {
  "use strict";

  let MatType = Float32Array;

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

  function identity(dst) {
    dst = dst || new MatType(16);
    dst[ 0] = 1; dst[ 1] = 0; dst[ 2] = 0; dst[ 3] = 0;
    dst[ 4] = 0; dst[ 5] = 1; dst[ 6] = 0; dst[ 7] = 0;
    dst[ 8] = 0; dst[ 9] = 0; dst[10] = 1; dst[11] = 0;
    dst[12] = 0; dst[13] = 0; dst[14] = 0; dst[15] = 1;
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

  return {
    identity: identity,
    translation: translation,
    xRotation: xRotation,
    yRotation: yRotation,
    multiply: multiply,
  };
}));