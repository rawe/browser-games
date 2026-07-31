// Dünne Hülle um WebGL2 – nur das, was Lumenweber wirklich braucht.
//
// Der Renderer soll sich um Licht kümmern, nicht um Boilerplate. Deshalb liegen
// hier Programmbau, Uniform-Cache, Renderziele und die beiden Zeichen-Primitive
// (Vollbild-Dreieck, Instanz-Stapel). Alles ist so gebaut, dass im laufenden
// Bild nichts mehr allokiert wird: Puffer werden einmal reserviert und danach
// nur noch beschrieben.

/** Ein Shader übersetzen und im Fehlerfall verständlich meckern. */
function compile(gl, type, source, label) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Lumenweber-Shader „${label}“: ${log}`);
  }
  return shader;
}

/**
 * Programm aus Vertex- und Fragmentquelle.
 *
 * Uniform-Orte werden einmal aufgelöst und gemerkt – `gl.getUniformLocation`
 * pro Bild wäre auf Mobilgeräten spürbar.
 */
export function createProgram(gl, vertSrc, fragSrc, label) {
  const vs = compile(gl, gl.VERTEX_SHADER, vertSrc, `${label}:vert`);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc, `${label}:frag`);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Lumenweber-Programm „${label}“: ${log}`);
  }

  const cache = new Map();
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i += 1) {
    const info = gl.getActiveUniform(program, i);
    const name = info.name.replace(/\[0\]$/, '');
    cache.set(name, gl.getUniformLocation(program, name));
  }

  return {
    program,
    use: () => gl.useProgram(program),
    loc: (name) => cache.get(name) ?? null,
    u1f(name, v) { const l = cache.get(name); if (l) gl.uniform1f(l, v); },
    u1i(name, v) { const l = cache.get(name); if (l) gl.uniform1i(l, v); },
    u2f(name, a, b) { const l = cache.get(name); if (l) gl.uniform2f(l, a, b); },
    u3f(name, a, b, c) { const l = cache.get(name); if (l) gl.uniform3f(l, a, b, c); },
    u4f(name, a, b, c, d) { const l = cache.get(name); if (l) gl.uniform4f(l, a, b, c, d); },
    destroy: () => gl.deleteProgram(program),
  };
}

/**
 * Renderziel mit Farbtextur.
 *
 * `texStorage2D` legt die Textur unveränderlich an – das ist auf Mobil-GPUs
 * der schnellere Weg, kostet aber, dass bei jeder Größenänderung ein neues
 * Ziel gebaut werden muss. Das passiert nur beim Drehen des Geräts.
 */
export function createTarget(gl, width, height, internalFormat) {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return {
    texture, fbo, width: w, height: h, ok,
    bind() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, w, h);
    },
    destroy() {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(texture);
    },
  };
}

/**
 * Vollbild-Dreieck ohne Attributpuffer.
 *
 * Ein einziges übergroßes Dreieck statt zweier Quad-Dreiecke: keine Naht in der
 * Mitte, ein Vertex weniger, und der Vertex-Shader kann die Eckpunkte aus
 * `gl_VertexID` rechnen – deshalb braucht es hier nur ein leeres VAO.
 */
export function createFullscreen(gl) {
  const vao = gl.createVertexArray();
  return {
    draw() {
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy: () => gl.deleteVertexArray(vao),
  };
}

/** Attribute je Instanz: 4 × vec4, siehe `shaders.js`. */
export const INSTANCE_FLOATS = 16;

/**
 * Stapel gleichartiger Sprites, in einem Zug gezeichnet.
 *
 * Alle Bildelemente – Wand, Ziel, Spiegel, Quelle, Ring, Funke – sind derselbe
 * gedrehte Einheitsquad; erst der Fragment-Shader entscheidet anhand von `kind`,
 * was daraus wird. So bleibt es bei zwei Zeichenaufrufen pro Bild (einer für
 * deckende, einer für additive Elemente) statt hunderten.
 */
export function createSpriteBatch(gl, program, capacity) {
  const data = new Float32Array(capacity * INSTANCE_FLOATS);
  let count = 0;

  // Einheitsquad als Triangle-Strip: (-1,-1) (1,-1) (-1,1) (1,1)
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const instances = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instances);
  gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, instances);
  const stride = INSTANCE_FLOATS * 4;
  for (let i = 0; i < 4; i += 1) {
    const slot = 1 + i;
    gl.enableVertexAttribArray(slot);
    gl.vertexAttribPointer(slot, 4, gl.FLOAT, false, stride, i * 16);
    gl.vertexAttribDivisor(slot, 1);
  }
  gl.bindVertexArray(null);

  return {
    get count() { return count; },
    reset() { count = 0; },
    /**
     * Eine Instanz anhängen. Die Reihenfolge entspricht den vier vec4 im
     * Shader: (Mitte, Größe, Drehung) · (Art, Stärke, Glut, Zusatz) · Farbe ·
     * vier freie Parameter je Art.
     */
    add(cx, cy, size, rot, kind, power, glow, aux, r, g, b, a, p0, p1, p2, p3) {
      if (count >= capacity) return;
      const o = count * INSTANCE_FLOATS;
      data[o] = cx; data[o + 1] = cy; data[o + 2] = size; data[o + 3] = rot;
      data[o + 4] = kind; data[o + 5] = power; data[o + 6] = glow; data[o + 7] = aux;
      data[o + 8] = r; data[o + 9] = g; data[o + 10] = b; data[o + 11] = a;
      data[o + 12] = p0; data[o + 13] = p1; data[o + 14] = p2; data[o + 15] = p3;
      count += 1;
    },
    draw() {
      if (count === 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, instances);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * INSTANCE_FLOATS);
      program.use();
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.bindVertexArray(null);
    },
    destroy() {
      gl.deleteBuffer(quad);
      gl.deleteBuffer(instances);
      gl.deleteVertexArray(vao);
    },
  };
}

/** Attribute je Strahl-Eckpunkt: Position, Segmentkoordinate, Metadaten. */
export const BEAM_FLOATS = 8;

/**
 * Streifen aus Dreiecken für den Lichtfaden.
 *
 * Jedes gerade Stück wird als eigenes Rechteck abgelegt, das an den Enden um
 * die halbe Leuchtbreite übersteht. Unter additiver Mischung überlagern sich
 * die Überstände genau in den Spiegelmitten – dort, wo der Faden knickt, soll
 * es ohnehin heller sein.
 */
export function createBeamBuffer(gl, program, maxSegments) {
  const perSegment = 6 * BEAM_FLOATS;
  const data = new Float32Array(maxSegments * perSegment);
  let vertices = 0;

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const stride = BEAM_FLOATS * 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);   // Position (CSS-Pixel)
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);   // u längs, v quer
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);  // Länge, Bogenmaß, Radius, Kraft
  gl.bindVertexArray(null);

  const put = (i, x, y, u, v, len, arc, half, energy) => {
    const o = i * BEAM_FLOATS;
    data[o] = x; data[o + 1] = y; data[o + 2] = u; data[o + 3] = v;
    data[o + 4] = len; data[o + 5] = arc; data[o + 6] = half; data[o + 7] = energy;
  };

  return {
    get vertexCount() { return vertices; },
    reset() { vertices = 0; },
    /**
     * Ein Segment von (ax,ay) nach (bx,by) in CSS-Pixeln. `arc` ist die bis
     * hierher zurückgelegte Bogenlänge – daraus entsteht der Energiefluss.
     */
    addSegment(ax, ay, bx, by, half, arc, energy) {
      if (vertices + 6 > maxSegments * 6) return 0;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 1e-4) return 0;
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;
      // Überstand an beiden Enden, damit der Halo nicht abgeschnitten wirkt.
      const pad = half;
      const x0 = ax - ux * pad;
      const y0 = ay - uy * pad;
      const u0 = -pad;
      const u1 = len + pad;

      const i = vertices;
      put(i + 0, x0 + nx * half, y0 + ny * half, u0, half, len, arc, half, energy);
      put(i + 1, x0 - nx * half, y0 - ny * half, u0, -half, len, arc, half, energy);
      put(i + 2, x0 + ux * (u1 - u0) + nx * half, y0 + uy * (u1 - u0) + ny * half, u1, half, len, arc, half, energy);
      put(i + 3, data[(i + 1) * BEAM_FLOATS], data[(i + 1) * BEAM_FLOATS + 1], u0, -half, len, arc, half, energy);
      put(i + 4, data[(i + 2) * BEAM_FLOATS], data[(i + 2) * BEAM_FLOATS + 1], u1, half, len, arc, half, energy);
      put(i + 5, x0 + ux * (u1 - u0) - nx * half, y0 + uy * (u1 - u0) - ny * half, u1, -half, len, arc, half, energy);
      vertices += 6;
      return len;
    },
    draw() {
      if (vertices === 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, vertices * BEAM_FLOATS);
      program.use();
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, vertices);
      gl.bindVertexArray(null);
    },
    destroy() {
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
    },
  };
}
