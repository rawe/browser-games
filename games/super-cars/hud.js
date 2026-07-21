// HUD: Positionsanzeige, Runden, Zustand, Waffe, Countdown und Minimap.

export function createHud() {
  const el = {
    pos: document.getElementById('hud-pos'),
    lap: document.getElementById('hud-lap'),
    speed: document.getElementById('hud-speed'),
    health: document.getElementById('hud-health-fill'),
    weaponLabel: document.getElementById('hud-weapon-label'),
    ammo: document.getElementById('hud-ammo'),
    countdown: document.getElementById('countdown'),
    minimap: document.getElementById('minimap'),
    fireBtn: document.getElementById('btn-fire'),
    weaponBtn: document.getElementById('btn-weapon'),
  };
  const mapCtx = el.minimap.getContext('2d');
  let mapScale = 1;
  let mapCx = 0;
  let mapCz = 0;

  return {
    prepareTrack(track) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const s of track.samples) {
        minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
        minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
      }
      const w = el.minimap.width;
      const h = el.minimap.height;
      mapScale = Math.min((w - 16) / (maxX - minX), (h - 16) / (maxZ - minZ));
      mapCx = (minX + maxX) / 2;
      mapCz = (minZ + maxZ) / 2;
    },

    update(race) {
      const player = race.cars[0];
      const total = race.cars.length;
      el.pos.textContent = `${player.position ?? total}.`;
      const lapNow = Math.min(race.track.laps, Math.max(1, Math.floor(player.totalS / race.track.length) + 1));
      el.lap.textContent = `${lapNow}/${race.track.laps}`;
      el.speed.textContent = `${Math.round(player.state.v * 3.6)}`;
      const pct = Math.max(0, player.health);
      el.health.style.width = `${pct}%`;
      el.health.style.background = pct > 50 ? 'var(--tacho)' : pct > 25 ? 'var(--turbo)' : 'var(--signal)';

      const front = player.weapon === 'front';
      el.weaponLabel.textContent = front ? '▲ VORNE' : '▼ HINTEN';
      el.ammo.textContent = front ? player.ammoF : player.ammoR;
      const ammoLeft = front ? player.ammoF : player.ammoR;
      el.fireBtn.classList.toggle('empty', ammoLeft <= 0);

      // Countdown: 3·2·1, dann kurz „LOS!"
      if (race.state === 'countdown') {
        const n = Math.ceil(race.countdown - 0.6);
        el.countdown.textContent = n > 0 ? String(n) : 'LOS!';
        el.countdown.classList.add('visible');
      } else if (race.countdown > -1.2) {
        el.countdown.textContent = 'LOS!';
        el.countdown.classList.add('visible');
      } else {
        el.countdown.classList.remove('visible');
      }

      this.drawMinimap(race);
    },

    drawMinimap(race) {
      const w = el.minimap.width;
      const h = el.minimap.height;
      mapCtx.clearRect(0, 0, w, h);
      const tx = (x) => w / 2 + (x - mapCx) * mapScale;
      const tz = (z) => h / 2 + (z - mapCz) * mapScale;

      mapCtx.strokeStyle = 'rgba(240,242,246,0.55)';
      mapCtx.lineWidth = 3;
      mapCtx.beginPath();
      race.track.samples.forEach((s, i) => {
        if (i === 0) mapCtx.moveTo(tx(s.x), tz(s.z));
        else mapCtx.lineTo(tx(s.x), tz(s.z));
      });
      mapCtx.closePath();
      mapCtx.stroke();

      for (let i = race.cars.length - 1; i >= 0; i--) {
        const c = race.cars[i];
        if (c.destroyed) continue;
        mapCtx.fillStyle = c.isPlayer ? '#ff4b3a' : `#${c.color.toString(16).padStart(6, '0')}`;
        mapCtx.beginPath();
        mapCtx.arc(tx(c.state.x), tz(c.state.z), c.isPlayer ? 4 : 3, 0, Math.PI * 2);
        mapCtx.fill();
      }
    },
  };
}
