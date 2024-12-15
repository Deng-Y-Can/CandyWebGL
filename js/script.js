// 获取HTML元素
const functionInput = document.getElementById('functionInput');
const plotButton = document.getElementById('plotButton');
const canvas = document.getElementById('glcanvas');

// 获取WebGL上下文
const gl = canvas.getContext('webgl');

// 设置WebGL视图端口
gl.viewport(0, 0, canvas.width, canvas.height);

// 顶点着色器代码
const vertexShaderSource = `
attribute vec2 a_position;
uniform vec2 u_translation;
uniform float u_scale;
void main() {
  vec2 scaledPosition = a_position * u_scale;
  vec2 translatedPosition = scaledPosition + u_translation;
  gl_Position = vec4(translatedPosition, 0.0, 1.0);
}`;

// 片段着色器代码
const fragmentShaderSource = `
precision mediump float;
void main() {
  gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
}`;

// 创建顶点着色器
const vertexShader = gl.createShader(gl.VERTEX_SHADER);
gl.shaderSource(vertexShader, vertexShaderSource);
gl.compileShader(vertexShader);

// 创建片段着色器
const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
gl.shaderSource(fragmentShader, fragmentShaderSource);
gl.compileShader(fragmentShader);

// 创建程序并链接着色器
const program = gl.createProgram();
gl.attachShader(program, vertexShader);
gl.attachShader(program, fragmentShader);
gl.linkProgram(program);
gl.useProgram(program);

// 设置顶点位置属性
const positionAttributeLocation = gl.getAttribLocation(program, 'a_position');
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

// 定义函数图像的范围
const xMin = -5;
const xMax = 5;
const numPoints = 100;
const dx = (xMax - xMin) / (numPoints - 1);

// 存储顶点位置数据
const positions = [];

// 根据输入函数生成顶点位置数据
function generatePositions() {
  const functionExpression = functionInput.value;
  positions.length = 0;
  for (let i = 0; i < numPoints; i++) {
    const x = xMin + i * dx;
    const y = eval(functionExpression.replace('x', x.toString()));
    positions.push(x, y);
  }
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
}

// 设置平移变量
const translationUniformLocation = gl.getUniformLocation(program, 'u_translation');
// 设置缩放变量
const scaleUniformLocation = gl.getUniformLocation(program, 'u_scale');

// 绘制函数图像的函数
function drawFunction() {
  generatePositions();

  gl.enableVertexAttribArray(positionAttributeLocation);
  gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

  gl.uniform2f(translationUniformLocation, 0, 0);
  gl.uniform1f(scaleUniformLocation, 1.0);

  gl.drawArrays(gl.LINE_STRIP, 0, numPoints);
}

// 鼠标状态变量
let isDragging = false;
let startX = 0;
let startY = 0;
let scaleFactor = 1.0;

// 鼠标按下事件处理函数
function handleMouseDown(event) {
  isDragging = true;
  startX = event.clientX;
  startY = event.clientY;
}

// 鼠标移动事件处理函数
function handleMouseMove(event) {
  if (isDragging) {
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    startX = event.clientX;
    startY = event.clientY;

    // 计算平移量并应用到平移变量
    gl.uniform2f(translationUniformLocation, dx / 100, -dy / 100);

    drawFunction();
  }
}

// 鼠标滚轮事件处理函数
function handleMouseWheel(event) {
  // 根据滚轮滚动方向调整缩放因子
  scaleFactor += event.deltaY * 0.01;
  scaleFactor = Math.max(0.1, Math.min(10, scaleFactor));

  // 设置缩放变量
  gl.uniform1f(scaleUniformLocation, scaleFactor);

  drawFunction();
}

// 鼠标松开事件处理函数
function handleMouseUp(event) {
  isDragging = false;
}

// 绑定事件监听器
plotButton.addEventListener('click', drawFunction);
canvas.addEventListener('mousedown', handleMouseDown);
canvas.addEventListener('mousemove', handleMouseMove);
canvas.addEventListener('mousewheel', handleMouseWheel);
canvas.addEventListener('mouseout', handleMouseUp);