// WebGL2-Renderer für Lumenweber.
//
// Aufbau eines Bildes:
//
//   1. Hintergrund   Nebel, Sternenstaub, Brettmulde, Raster (Vollbild-Shader)
//   2. Materie       Wände, Knoten, Spiegel, Quellen  – Alpha-Mischung
//   3. Faden         der Lichtstrahl                  – additiv
//   4. Licht         Glut, Reflexe, Ringe, Funken     – additiv
//   5. Bloom         Helligkeitsauszug + Unschärfe in ¼ und ⅛ Auflösung
//   6. Abschluss     Belichtung, Vignette, Rauschkorn → Bildschirm
//
// Die Schritte 1–4 laufen in ein Zwischenziel mit möglichst hoher Farbtiefe
// (RGBA16F, wenn die Erweiterung da ist). Erst damit kann der Kern des Fadens
// heller als Weiß werden – und genau das ist es, was den Bloom auslöst und den
// Strahl glühen statt bloß hell aussehen lässt.
//
// Alles ist auf Telefone hin gebaut: Pixelverhältnis gedeckelt, Bloom nur in
// Viertel- und Achtelauflösung, zwei Zeichenaufrufe für sämtliche Spielsteine,
// keine Allokationen im laufenden Bild.

import { computeLayout } from '../layout.js';
import {
  createProgram, createTarget, createFullscreen, createSpriteBatch, createBeamBuffer,
} from './glcore.js';
import { createScene } from './scene.js';
import { BACKGROUND_VERT, BACKGROUND_FRAG } from './shaders/background.js';
import { SPRITE_VERT, SPRITE_FRAG } from './shaders/sprite.js';
import { BEAM_VERT, BEAM_FRAG } from './shaders/beam.js';
import { FULLSCREEN_VERT } from './shaders/common.js';
import { BRIGHT_FRAG, BLUR_FRAG, COMPOSITE_FRAG } from './shaders/post.js';

const CONTEXT_ATTRS = {
  alpha: false,
  depth: false,
  stencil: false,
  antialias: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
};

/**
 * Obergrenze für Gerätepixel.
 *
 * Alles auf dem Brett ist weiches Licht – oberhalb von rund 2,8 Millionen
 * Pixeln gewinnt die Darstellung nichts mehr an Schärfe, kostet aber überall
 * volle Füllrate. Große Retina-Tablets und -Desktops rechnen darum leicht
 * unterhalb ihres Pixelverhältnisses.
 */
const MAX_DEVICE_PIXELS = 2_800_000;
const MAX_DPR = 2;

// Ein Prisma vervielfacht Fäden und damit Segmente: Aus einem Strahl können
// bis zu `Breite · Höhe · 4` Zustände werden. Die Grenzen liegen deshalb
// großzügig – `addSegment` verwirft bei Überlauf stillschweigend, und ein
// halb gezeichneter Lichtweg wäre schlimmer als ein paar Kilobyte mehr.
const MAX_SPRITES = 2048;
const MAX_BEAM_SEGMENTS = 2048;

/**
 * @returns {object|null} Renderer oder `null`, wenn kein WebGL2 zustande kommt.
 *          Der Aufrufer weicht dann auf die 2D-Canvas aus.
 */
export function createWebglRenderer(canvas) {
  const gl = canvas.getContext('webgl2', CONTEXT_ATTRS);
  if (!gl) return null;

  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let calm = motion?.matches ?? false;
  const onMotion = (event) => { calm = event.matches; };

  const scene = createScene();
  let level = null;
  let session = null;
  let layout = computeLayout(1, 1, { width: 1, height: 1 });
  let cssW = 1;
  let cssH = 1;
  let insets = {};
  let dpr = 1;
  let hover = null;
  let cursor = null;
  let lastNow = 0;
  let lost = false;

  /* ---------- Ressourcen ---------- */

  let gpu = null;

  function buildPrograms() {
    return {
      background: createProgram(gl, BACKGROUND_VERT, BACKGROUND_FRAG, 'hintergrund'),
      sprite: createProgram(gl, SPRITE_VERT, SPRITE_FRAG, 'sprites'),
      beam: createProgram(gl, BEAM_VERT, BEAM_FRAG, 'strahl'),
      bright: createProgram(gl, FULLSCREEN_VERT, BRIGHT_FRAG, 'auszug'),
      blur: createProgram(gl, FULLSCREEN_VERT, BLUR_FRAG, 'unschaerfe'),
      composite: createProgram(gl, FULLSCREEN_VERT, COMPOSITE_FRAG, 'abschluss'),
    };
  }

  function build() {
    const programs = buildPrograms();

    // RGBA16F ist der eigentliche Zweck der Übung: Werte über 1.0 überleben,
    // der Bloom greift dort und nur dort. Fehlt die Erweiterung, geht es auch
    // mit 8 Bit – dann muss die Schwelle nur tiefer liegen.
    const floatOk = !!(gl.getExtension('EXT_color_buffer_float')
      || gl.getExtension('EXT_color_buffer_half_float'));
    const format = floatOk ? gl.RGBA16F : gl.RGBA8;

    gpu = {
      programs,
      floatOk,
      format,
      fullscreen: createFullscreen(gl),
      solid: createSpriteBatch(gl, programs.sprite, MAX_SPRITES),
      glow: createSpriteBatch(gl, programs.sprite, MAX_SPRITES),
      beam: createBeamBuffer(gl, programs.beam, MAX_BEAM_SEGMENTS),
      targets: null,
    };
    allocTargets();
  }

  function freeTargets() {
    if (!gpu?.targets) return;
    for (const t of Object.values(gpu.targets)) t.destroy();
    gpu.targets = null;
  }

  function allocTargets() {
    if (!gpu) return;
    freeTargets();
    const w = Math.max(1, canvas.width);
    const h = Math.max(1, canvas.height);
    const q = (n) => Math.max(1, Math.ceil(n / 4));
    const o = (n) => Math.max(1, Math.ceil(n / 8));
    gpu.targets = {
      scene: createTarget(gl, w, h, gpu.format),
      nearA: createTarget(gl, q(w), q(h), gpu.format),
      nearB: createTarget(gl, q(w), q(h), gpu.format),
      farA: createTarget(gl, o(w), o(h), gpu.format),
      farB: createTarget(gl, o(w), o(h), gpu.format),
    };
    // Sollte ein Ziel nicht vollständig sein, ist Gleitkomma schuld – zurück
    // auf 8 Bit statt schwarzes Bild.
    if (!Object.values(gpu.targets).every((t) => t.ok) && gpu.format !== gl.RGBA8) {
      gpu.format = gl.RGBA8;
      gpu.floatOk = false;
      allocTargets();
    }
  }

  function teardown() {
    if (!gpu) return;
    freeTargets();
    gpu.fullscreen.destroy();
    gpu.solid.destroy();
    gpu.glow.destroy();
    gpu.beam.destroy();
    for (const p of Object.values(gpu.programs)) p.destroy();
    gpu = null;
  }

  // Erst wenn alle Programme stehen, hängen wir uns an die Umgebung – sonst
  // bliebe bei einem Shader-Fehler ein Listener zurück.
  build();
  motion?.addEventListener?.('change', onMotion);

  /* ---------- Kontextverlust ---------- */

  const onContextLost = (event) => {
    event.preventDefault();
    lost = true;
    gpu = null;   // alle Objekte sind bereits ungültig, nichts mehr freigeben
  };

  const onContextRestored = () => {
    build();
    lost = false;
  };

  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  /* ---------- Vertrag ---------- */

  function resize(width, height, nextInsets = {}) {
    cssW = Math.max(1, width);
    cssH = Math.max(1, height);
    insets = nextInsets;

    const raw = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    // Sehr große Flächen (Retina-Desktop) sonst unnötig teuer.
    const scale = Math.sqrt(MAX_DEVICE_PIXELS / Math.max(1, cssW * cssH * raw * raw));
    dpr = Math.max(1, raw * Math.min(1, scale));

    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      allocTargets();
    }
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    if (level) layout = computeLayout(cssW, cssH, level, insets);
  }

  function setLevel(next, options) {
    level = next;
    scene.setLevel(next, options);
    if (level) layout = computeLayout(cssW, cssH, level, insets);
  }

  /* ---------- Durchgänge ---------- */

  function blur(source, into, horizontal) {
    const p = gpu.programs.blur;
    into.bind();
    p.use();
    p.u2f('uDir', horizontal ? 1 / source.width : 0, horizontal ? 0 : 1 / source.height);
    p.u1i('uTex', 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source.texture);
    gpu.fullscreen.draw();
  }

  function downsample(source, into, threshold, knee) {
    const p = gpu.programs.bright;
    into.bind();
    p.use();
    p.u2f('uTexel', 1 / source.width, 1 / source.height);
    p.u1f('uThreshold', threshold);
    p.u1f('uKnee', knee);
    p.u1i('uTex', 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source.texture);
    gpu.fullscreen.draw();
  }

  function drawScene(time) {
    const t = gpu.targets;
    const { cell } = layout;
    t.scene.bind();
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const bg = gpu.programs.background;
    bg.use();
    bg.u2f('uPxRes', canvas.width, canvas.height);
    bg.u1f('uDpr', dpr);
    bg.u1f('uTime', time);
    bg.u1f('uCalm', calm ? 1 : 0);
    bg.u1f('uWin', scene.state.winGlow);
    bg.u4f('uBoard', layout.originX, layout.originY, layout.boardW, layout.boardH);
    bg.u1f('uCell', Math.max(1, cell));
    bg.u2f('uGridDim', level ? level.width : 1, level ? level.height : 1);
    gpu.fullscreen.draw();

    if (!level || !session) return;

    const sprite = gpu.programs.sprite;
    sprite.use();
    sprite.u2f('uCssRes', cssW, cssH);
    sprite.u1f('uTime', time);
    sprite.u1f('uCalm', calm ? 1 : 0);

    gpu.solid.reset();
    scene.emitSolid(gpu.solid, session, layout, hover, cursor);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gpu.solid.draw();

    // Ab hier addiert sich Licht: Überlagerungen werden heller, nie dunkler.
    gl.blendFunc(gl.ONE, gl.ONE);

    gpu.beam.reset();
    scene.emitBeam(gpu.beam, session, layout);
    const beamProgram = gpu.programs.beam;
    beamProgram.use();
    beamProgram.u2f('uCssRes', cssW, cssH);
    beamProgram.u1f('uTime', time);
    beamProgram.u1f('uCalm', calm ? 1 : 0);
    beamProgram.u1f('uCell', Math.max(1, cell));
    beamProgram.u1f('uCore', Math.max(1.1, cell * 0.036));
    beamProgram.u1f('uHalo', Math.max(5, cell * 0.24));
    beamProgram.u1f('uReveal', scene.state.reveal);
    beamProgram.u1f('uWave', scene.state.wave);
    beamProgram.u1f('uGain', gpu.floatOk ? 1.20 : 0.9);
    gpu.beam.draw();

    gpu.glow.reset();
    scene.emitGlow(gpu.glow, session, layout, hover);
    sprite.use();
    gpu.glow.draw();
  }

  function drawBloom() {
    const t = gpu.targets;
    gl.disable(gl.BLEND);
    // Ohne Gleitkomma sättigt die Szene bei 1.0 – dann muss die Schwelle tiefer.
    const threshold = gpu.floatOk ? 1.05 : 0.60;
    downsample(t.scene, t.nearA, threshold, 0.55);
    blur(t.nearA, t.nearB, true);
    blur(t.nearB, t.nearA, false);
    downsample(t.nearA, t.farA, -1, 0.001);
    blur(t.farA, t.farB, true);
    blur(t.farB, t.farA, false);
  }

  function present(time) {
    const t = gpu.targets;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);

    const p = gpu.programs.composite;
    p.use();
    p.u1i('uScene', 0);
    p.u1i('uBloomNear', 1);
    p.u1i('uBloomFar', 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.scene.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, t.nearA.texture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, t.farA.texture);
    p.u2f('uPxRes', canvas.width, canvas.height);
    p.u1f('uNear', 0.55);
    p.u1f('uFar', 0.45);
    p.u1f('uExposure', gpu.floatOk ? 1.10 : 1.35);
    p.u1f('uFlash', scene.state.flash);
    p.u1f('uTime', time);
    gpu.fullscreen.draw();
  }

  function frame(now) {
    if (lost || !gpu || gl.isContextLost()) return;
    const dt = Math.min(0.05, (now - lastNow) / 1000 || 0.016);
    lastNow = now;
    // Bei sehr langen Sitzungen liefe die Zeit sonst aus der Genauigkeit von
    // `float` heraus und alle Schwingungen würden ruckeln.
    const time = (now / 1000) % 3600;

    scene.update(dt, now, session, layout, calm);
    drawScene(time);
    drawBloom();
    present(time);
  }

  return {
    backend: 'webgl2',
    setLevel,
    setSession(next) { session = next; },
    resize,
    setHover(cell) { hover = cell; },
    setCursor(cell) { cursor = cell; },
    tapAt(x, y) { scene.tap(x, y, layout.cell); },
    celebrate() { scene.celebrate(performance.now(), layout); },
    frame,
    get layout() { return layout; },
    dispose() {
      motion?.removeEventListener?.('change', onMotion);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      teardown();
    },
  };
}
