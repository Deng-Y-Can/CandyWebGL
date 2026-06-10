/*
 * Copyright 2021 GFXFundamentals.
 * All rights reserved.
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.primitives = factory();
  }
}(this, function() {
  'use strict';

  function createPlane(width, height, subdivisions) {
    const positions = [];
    const texCoords = [];
    const indices = [];
    
    const w2 = width / 2;
    const h2 = height / 2;
    const stepX = width / subdivisions;
    const stepY = height / subdivisions;
    
    for (let y = 0; y <= subdivisions; y++) {
      for (let x = 0; x <= subdivisions; x++) {
        positions.push(-w2 + x * stepX, -h2 + y * stepY, 0);
        texCoords.push(x / subdivisions, y / subdivisions);
      }
    }
    
    for (let y = 0; y < subdivisions; y++) {
      for (let x = 0; x < subdivisions; x++) {
        const i = y * (subdivisions + 1) + x;
        indices.push(i, i + 1, i + subdivisions + 1);
        indices.push(i + 1, i + subdivisions + 2, i + subdivisions + 1);
      }
    }
    
    return {
      positions: new Float32Array(positions),
      texCoords: new Float32Array(texCoords),
      indices: new Uint16Array(indices)
    };
  }

  return {
    createPlane: createPlane,
  };
}));