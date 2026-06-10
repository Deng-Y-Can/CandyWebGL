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

  function createCube() {
    const positions = new Float32Array([
      -1, -1, -1,   1, -1, -1,   1,  1, -1,  -1,  1, -1,
      -1, -1,  1,   1, -1,  1,   1,  1,  1,  -1,  1,  1,
      -1, -1, -1,  -1,  1, -1,  -1,  1,  1,  -1, -1,  1,
       1, -1, -1,   1,  1, -1,   1,  1,  1,   1, -1,  1,
      -1, -1, -1,  -1, -1,  1,   1, -1,  1,   1, -1, -1,
      -1,  1, -1,  -1,  1,  1,   1,  1,  1,   1,  1, -1,
    ]);
    const colors = new Float32Array([
      1, 0, 0,   1, 0, 0,   1, 0, 0,   1, 0, 0,
      0, 1, 0,   0, 1, 0,   0, 1, 0,   0, 1, 0,
      0, 0, 1,   0, 0, 1,   0, 0, 1,   0, 0, 1,
      1, 1, 0,   1, 1, 0,   1, 1, 0,   1, 1, 0,
      1, 0, 1,   1, 0, 1,   1, 0, 1,   1, 0, 1,
      0, 1, 1,   0, 1, 1,   0, 1, 1,   0, 1, 1,
    ]);
    const indices = new Uint16Array([
      0,  1,  2,    0,  2,  3,
      4,  5,  6,    4,  6,  7,
      8,  9, 10,    8, 10, 11,
      12, 13, 14,   12, 14, 15,
      16, 17, 18,   16, 18, 19,
      20, 21, 22,   20, 22, 23,
    ]);
    return { positions, colors, indices };
  }

  function createSphere(radius, subdivisions) {
    const positions = [];
    const colors = [];
    const indices = [];
    
    for (let lat = 0; lat <= subdivisions; lat++) {
      const theta = lat * Math.PI / subdivisions;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);
      
      for (let lon = 0; lon <= subdivisions; lon++) {
        const phi = lon * 2 * Math.PI / subdivisions;
        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);
        
        const x = radius * sinTheta * cosPhi;
        const y = radius * cosTheta;
        const z = radius * sinTheta * sinPhi;
        
        positions.push(x, y, z);
        colors.push((x + radius) / (2 * radius), (y + radius) / (2 * radius), (z + radius) / (2 * radius));
      }
    }
    
    for (let lat = 0; lat < subdivisions; lat++) {
      for (let lon = 0; lon < subdivisions; lon++) {
        const first = lat * (subdivisions + 1) + lon;
        const second = first + subdivisions + 1;
        indices.push(first, second, first + 1);
        indices.push(second, second + 1, first + 1);
      }
    }
    
    return {
      positions: new Float32Array(positions),
      colors: new Float32Array(colors),
      indices: new Uint16Array(indices)
    };
  }

  function createCylinder(radius, height, subdivisions) {
    const positions = [];
    const colors = [];
    const indices = [];
    
    for (let i = 0; i <= subdivisions; i++) {
      const angle = i * 2 * Math.PI / subdivisions;
      const x = radius * Math.cos(angle);
      const z = radius * Math.sin(angle);
      positions.push(x, -height / 2, z);
      positions.push(x, height / 2, z);
      colors.push(0.5 + x / (2 * radius), 0.5, 0.5 + z / (2 * radius));
      colors.push(0.5 + x / (2 * radius), 0.5, 0.5 + z / (2 * radius));
    }
    
    for (let i = 0; i < subdivisions; i++) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
    
    return {
      positions: new Float32Array(positions),
      colors: new Float32Array(colors),
      indices: new Uint16Array(indices)
    };
  }

  return {
    createCube: createCube,
    createSphere: createSphere,
    createCylinder: createCylinder,
  };
}));