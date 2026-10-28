// Flotte aufstellen: Ziehen aus dem Dock, Verschieben, Drehen per Antippen.
//
// Fingerbedienung ist der Normalfall. Tippen und Ziehen werden an der
// Wegstrecke unterschieden, nicht an der Eingabeart; wer nicht ziehen mag,
// tippt ein Schiff im Dock an und dann das Zielfeld.

import { SIZE, fleetPieces, surrounding } from './logic/rules.js';
import { canPlace, randomFleet, rotated, shipCells, occupancy } from './logic/fleet.js';
import { shipSprite } from './gfx/ships.js';

const DRAG_THRESHOLD = 8;

/**
 * @param {{view: object, dock: HTMLElement, onChange: () => void,
 *          sound: (name: string) => void}} options
 */
export function createPlacement({ view, dock, onChange, sound }) {
  let pieces = [];
  let ships = [];
  let spacing = true;
  let fleetId = 'klassisch';
  let selectedId = null;
  /** Ausrichtung, mit der Schiffe aus dem Dock aufs Meer kommen. */
  let dockDir = 'h';
  let drag = null;
  let active = false;

  const avatar = document.createElement('canvas');
  avatar.className = 'drag-avatar';
  avatar.hidden = true;
  document.body.append(avatar);

  const placedIds = () => new Set(ships.map((s) => s.id));
  const pieceById = (id) => pieces.find((p) => p.id === id);
  const shipById = (id) => ships.find((s) => s.id === id);

  function sync() {
    view.set({
      ships,
      shots: null,
      ghost: drag?.ghost ?? null,
      selectedId: shipById(selectedId) ? selectedId : null,
      blocked: drag ? blockedCells(drag.piece.id) : null,
      aim: -1,
      dim: false,
    });
    renderDock();
    onChange();
  }

  /** Felder, auf die das gezogene Schiff nicht darf – als Orientierung. */
  function blockedCells(ignoreId) {
    const taken = occupancy(ships, ignoreId);
    const out = new Set(taken.keys());
    if (spacing) for (const idx of taken.keys()) for (const n of surrounding(idx)) out.add(n);
    return out;
  }

  function renderDock() {
    const placed = placedIds();
    const cell = dockCell();
    // Aufgestellte Schiffe bleiben im Dock stehen (abgehakt) – so springt
    // die Anordnung nicht, und man sieht, was noch fehlt.
    dock.replaceChildren(...pieces.map((piece) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `dock-ship${placed.has(piece.id) ? ' is-placed' : ''}`;
      button.dataset.id = piece.id;
      button.setAttribute('aria-pressed', String(selectedId === piece.id));
      button.title = `${piece.name} (${piece.length} Felder)`;
      const canvas = document.createElement('canvas');
      drawPiece(canvas, piece, cell, 'h');
      const label = document.createElement('span');
      label.textContent = placed.has(piece.id) ? `✓ ${piece.name}` : piece.name;
      button.append(canvas, label);
      button.addEventListener('pointerdown', (e) => {
        if (placed.has(piece.id)) {
          selectedId = piece.id;
          sound('click');
          sync();
        } else startDockDrag(e, piece);
      });
      return button;
    }));
  }

  /** Feldgröße der Schiffe im Dock – passend zur Dockbreite. */
  function dockCell() {
    const width = dock.clientWidth || 300;
    // Auf niedrigen Schirmen kleiner, damit das Meer nicht zusammenschrumpft.
    const cap = window.innerHeight < 720 ? 17 : 26;
    return Math.max(13, Math.min(cap, width / 15));
  }

  function drawPiece(canvas, piece, cell, dir) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const sprite = shipSprite(piece.type, piece.length, cell, dpr);
    const w = piece.length * cell + sprite.margin * 2;
    const h = cell + sprite.margin * 2;
    const [cw, ch] = dir === 'h' ? [w, h] : [h, w];
    canvas.width = Math.ceil(cw * dpr);
    canvas.height = Math.ceil(ch * dpr);
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (dir === 'v') {
      ctx.translate(h, 0);
      ctx.rotate(Math.PI / 2);
    }
    ctx.drawImage(sprite.image, 0, 0, w, h);
    return sprite.margin;
  }

  // ── Ziehen ──────────────────────────────────────────────────────────────

  function startDockDrag(event, piece) {
    if (!active || event.button > 0) return;
    event.preventDefault();
    drag = {
      piece,
      fromBoard: null,
      dir: dockDir,
      grab: (piece.length - 1) / 2,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      ghost: null,
      pointerId: event.pointerId,
    };
    listen();
  }

  function startBoardDrag(event) {
    if (!active || event.button > 0) return;
    const idx = view.cellAt(event.clientX, event.clientY);
    if (idx < 0) return;
    const hit = ships.find((s) => shipCells(s).includes(idx));
    if (!hit) {
      // Tippen aufs Wasser: ausgewähltes Dock-Schiff dort absetzen.
      const piece = pieceById(selectedId);
      if (piece && !shipById(piece.id)) {
        const x = idx % SIZE;
        const y = Math.floor(idx / SIZE);
        const ship = clampToBoard({ ...piece, x, y, dir: dockDir });
        if (canPlace(ships, ship, spacing)) {
          ships.push(ship);
          sound('place');
          selectedId = nextWaiting();
        } else sound('deny');
        sync();
      } else if (selectedId) {
        selectedId = null;
        sync();
      }
      return;
    }
    event.preventDefault();
    const exact = view.cellAt(event.clientX, event.clientY, true);
    drag = {
      piece: pieceById(hit.id),
      fromBoard: hit,
      dir: hit.dir,
      grab: hit.dir === 'h' ? exact.x - hit.x - 0.5 : exact.y - hit.y - 0.5,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      ghost: null,
      pointerId: event.pointerId,
    };
    listen();
  }

  function listen() {
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  function unlisten() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  }

  function onMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) return;
    drag.moved = true;
    event.preventDefault();

    if (view.contains(event.clientX, event.clientY)) {
      avatar.hidden = true;
      const exact = view.cellAt(event.clientX, event.clientY, true);
      const ship = ghostAt(exact);
      drag.ghost = { ship, valid: canPlace(ships, ship, spacing, drag.piece.id) };
    } else {
      drag.ghost = null;
      showAvatar(event.clientX, event.clientY);
    }
    sync();
  }

  /** Schiffslage unter dem Finger, aufs Raster eingerastet und ins Brett geklemmt. */
  function ghostAt(exact) {
    const { piece, dir, grab } = drag;
    let x = Math.round(exact.x - 0.5 - (dir === 'h' ? grab : 0));
    let y = Math.round(exact.y - 0.5 - (dir === 'v' ? grab : 0));
    return clampToBoard({ ...piece, x, y, dir });
  }

  function clampToBoard(ship) {
    const maxX = SIZE - (ship.dir === 'h' ? ship.length : 1);
    const maxY = SIZE - (ship.dir === 'v' ? ship.length : 1);
    return { ...ship, x: Math.max(0, Math.min(maxX, ship.x)), y: Math.max(0, Math.min(maxY, ship.y)) };
  }

  function showAvatar(clientX, clientY) {
    const cell = view.geo.cell || 30;
    if (avatar.dataset.key !== `${drag.piece.id}:${drag.dir}:${cell}`) {
      const margin = drawPiece(avatar, drag.piece, cell, drag.dir);
      avatar.dataset.key = `${drag.piece.id}:${drag.dir}:${cell}`;
      avatar.dataset.margin = String(margin);
    }
    const margin = Number(avatar.dataset.margin);
    const along = (drag.grab + 0.5) * cell + margin;
    const across = cell / 2 + margin;
    const [dx, dy] = drag.dir === 'h' ? [along, across] : [across, along];
    avatar.style.transform = `translate(${clientX - dx}px, ${clientY - dy}px)`;
    avatar.hidden = false;
  }

  function onUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    unlisten();
    avatar.hidden = true;

    if (!d.moved) {
      if (d.fromBoard) {
        // Antippen dreht – um das Feld, das angetippt wurde.
        const pivot = Math.max(0, Math.min(d.piece.length - 1, Math.round(d.grab)));
        const turned = rotated(ships, d.fromBoard, spacing, pivot);
        selectedId = d.fromBoard.id;
        if (turned) {
          replace(turned);
          sound('place');
        } else {
          sound('deny');
          view.pulse(shipCells(d.fromBoard));
        }
      } else {
        selectedId = selectedId === d.piece.id ? null : d.piece.id;
        sound('click');
      }
      sync();
      return;
    }

    if (d.ghost?.valid) {
      replace(d.ghost.ship);
      selectedId = d.piece.id;
      sound('place');
    } else if (d.fromBoard && !view.contains(event.clientX, event.clientY)) {
      // Vom Brett gezogen und daneben losgelassen: zurück ins Dock.
      ships = ships.filter((s) => s.id !== d.piece.id);
      selectedId = null;
      sound('click');
    } else if (d.ghost) {
      sound('deny');
    }
    sync();
  }

  function onCancel(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    unlisten();
    avatar.hidden = true;
    sync();
  }

  function replace(ship) {
    ships = ships.filter((s) => s.id !== ship.id);
    ships.push(ship);
  }

  function nextWaiting() {
    const placed = placedIds();
    return pieces.find((p) => !placed.has(p.id))?.id ?? null;
  }

  view.canvas.addEventListener('pointerdown', startBoardDrag);

  return {
    start(nextFleetId, nextSpacing) {
      fleetId = nextFleetId;
      spacing = nextSpacing;
      pieces = fleetPieces(fleetId);
      ships = [];
      selectedId = pieces[0].id;
      dockDir = 'h';
      active = true;
      // Das Dock kennt seine Breite erst, wenn es sichtbar ist.
      requestAnimationFrame(sync);
      sync();
    },
    stop() {
      active = false;
      drag = null;
      unlisten();
      avatar.hidden = true;
      view.set({ ghost: null, blocked: null, selectedId: null });
    },
    get active() { return active; },
    get ships() { return ships; },
    get complete() { return ships.length === pieces.length; },
    get remaining() { return pieces.length - ships.length; },

    randomize() {
      ships = randomFleet(fleetId, spacing);
      selectedId = null;
      sound('place');
      sync();
    },
    clear() {
      ships = [];
      selectedId = pieces[0]?.id ?? null;
      sound('click');
      sync();
    },
    /** Knopf „Drehen“: das gewählte Schiff, sonst die Lage für das Dock. */
    rotate() {
      const ship = shipById(selectedId);
      if (ship) {
        const turned = rotated(ships, ship, spacing, Math.floor((ship.length - 1) / 2));
        if (turned) { replace(turned); sound('place'); } else sound('deny');
      } else {
        dockDir = dockDir === 'h' ? 'v' : 'h';
        sound('click');
      }
      sync();
    },
    get dockDir() { return dockDir; },
    refreshDock: renderDock,
  };
}
