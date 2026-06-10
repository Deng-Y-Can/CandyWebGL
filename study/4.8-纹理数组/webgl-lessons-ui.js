/*
 * Copyright 2021 GFXFundamentals.
 * All rights reserved.
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.webglLessonsUI = factory();
  }
}(this, function() {
  'use strict';

  function setupSlider(selector, options) {
    const slider = document.querySelector(selector);
    if (!slider) return null;
    
    const valueDisplay = document.querySelector(options.valueDisplay);
    const min = parseFloat(options.min) || 0;
    const max = parseFloat(options.max) || 1;
    const step = parseFloat(options.step) || 0.01;
    
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = options.value || (min + max) / 2;
    
    function updateValue() {
      if (valueDisplay) {
        valueDisplay.textContent = parseFloat(slider.value).toFixed(2);
      }
      if (options.onChange) {
        options.onChange(parseFloat(slider.value));
      }
    }
    
    slider.addEventListener('input', updateValue);
    updateValue();
    
    return slider;
  }

  function setupCheckbox(selector, options) {
    const checkbox = document.querySelector(selector);
    if (!checkbox) return null;
    
    checkbox.checked = options.value || false;
    
    checkbox.addEventListener('change', function(e) {
      if (options.onChange) {
        options.onChange(e.target.checked);
      }
    });
    
    return checkbox;
  }

  return {
    setupSlider: setupSlider,
    setupCheckbox: setupCheckbox,
  };
}));