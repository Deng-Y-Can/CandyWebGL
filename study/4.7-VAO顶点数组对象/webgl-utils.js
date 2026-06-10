/*
 * Copyright 2021 GFXFundamentals.
 * All rights reserved.
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], function() { return factory.call(root); });
  } else {
    root.webglUtils = factory.call(root);
  }
}(this, function() {
  'use strict';

  function error(msg) {
    if (topWindow.console) {
      if (topWindow.console.error) topWindow.console.error(msg);
      else if (topWindow.console.log) topWindow.console.log(msg);
    }
  }

  function loadShader(gl, shaderSource, shaderType, opt_errorCallback) {
    const errFn = opt_errorCallback || error;
    const shader = gl.createShader(shaderType);
    gl.shaderSource(shader, shaderSource);
    gl.compileShader(shader);
    const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (!compiled) {
      const lastError = gl.getShaderInfoLog(shader);
      errFn('*** Error compiling shader: ' + lastError);
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function createProgram(gl, shaders, opt_attribs, opt_locations, opt_errorCallback) {
    const errFn = opt_errorCallback || error;
    const program = gl.createProgram();
    shaders.forEach(function(shader) { gl.attachShader(program, shader); });
    if (opt_attribs) {
      opt_attribs.forEach(function(attrib, ndx) {
        gl.bindAttribLocation(program, opt_locations ? opt_locations[ndx] : ndx, attrib);
      });
    }
    gl.linkProgram(program);
    const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (!linked) {
      errFn('Error in program linking: ' + gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  function createProgramFromSources(gl, shaderSources, opt_attribs, opt_locations, opt_errorCallback) {
    const shaders = [];
    for (let ii = 0; ii < shaderSources.length; ++ii) {
      shaders.push(loadShader(gl, shaderSources[ii], gl[['VERTEX_SHADER', 'FRAGMENT_SHADER'][ii]], opt_errorCallback));
    }
    return createProgram(gl, shaders, opt_attribs, opt_locations, opt_errorCallback);
  }

  function resizeCanvasToDisplaySize(canvas, multiplier) {
    multiplier = multiplier || 1;
    const width = canvas.clientWidth * multiplier | 0;
    const height = canvas.clientHeight * multiplier | 0;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      return true;
    }
    return false;
  }

  return {
    createProgramFromSources: createProgramFromSources,
    resizeCanvasToDisplaySize: resizeCanvasToDisplaySize,
  };
}));