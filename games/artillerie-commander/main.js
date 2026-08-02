import {
  WORLD, WEAPONS, clamp, terrainFor, surfaceAt, crater, makePlayers, placePlayers,
  shotVelocity, stepProjectile, damageAt, chooseAiShot, living, tankAt,
  boundaryHit, previewPath,
} from './game.js';

const $ = (id) => document.getElementById(id);
const canvas = $('battle');
const ctx = canvas.getContext('2d');
const ids = ['hud','controls','title','menu','shop','turn-name','round-label','wind','angle','power','weapon','weapon-icon','weapon-name','weapon-stock','fire','credits','shop-list','shop-title','shop-round','angle-slider','power-slider','angle-value','power-value'];
const el = Object.fromEntries(ids.map((id) => [id, $(id)]));

let players = [], terrain = terrainFor(Date.now()), particles = [], trails = [];
let projectile = null, current = 0, round = 0, wind = 0, playing = false, waiting = false, nextTimer = 0;
let wallMode = 'solid', aimAssist = false, showLastTrail = true;
const camera = { x: WORLD.width / 2, y: WORLD.height / 2, zoom: 1.6, manual: false };
const pointers = new Map();
let gesture = null;

const weaponBy = (id) => WEAPONS.find((w) => w.id === id);
const active = () => players[current];

function baseScale() { return Math.min(innerWidth / WORLD.width, innerHeight / WORLD.height); }
function viewScale() { return baseScale() * camera.zoom; }
function clampCamera() {
  const scale = viewScale(), halfW = innerWidth / scale / 2, halfH = innerHeight / scale / 2;
  camera.x = halfW * 2 >= WORLD.width ? WORLD.width / 2 : clamp(camera.x, halfW, WORLD.width - halfW);
  camera.y = halfH * 2 >= WORLD.height ? WORLD.height / 2 : clamp(camera.y, WORLD.hud + halfH, WORLD.height - halfH);
}
function focusOn(x, y, manual = false) { camera.x = x; camera.y = y; camera.manual = manual; clampCamera(); }
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
  clampCamera();
}

function screenBackdrop() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, '#5cc8ff'); g.addColorStop(.62, '#9be7ff'); g.addColorStop(1, '#ffe49a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
}
function worldTransform() {
  const dpr = canvas.width / innerWidth, scale = viewScale();
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale,
    dpr * (innerWidth / 2 - camera.x * scale), dpr * (innerHeight / 2 - camera.y * scale));
}
function drawBackdrop() {
  ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.arc(805, 122, 42, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffffdc';
  for (const [x,y,s] of [[95,115,1],[350,155,.8],[670,87,1.2]]) {
    ctx.beginPath(); ctx.arc(x,y,18*s,0,Math.PI*2);ctx.arc(x+22*s,y-9*s,25*s,0,Math.PI*2);ctx.arc(x+48*s,y,18*s,0,Math.PI*2);ctx.fill();
  }
  const hills = (base, color, offset, amp) => { ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(0,WORLD.height);ctx.lineTo(0,base);for(let x=0;x<=WORLD.width;x+=24)ctx.lineTo(x,base+Math.sin((x+camera.x*offset)*.013)*amp);ctx.lineTo(WORLD.width,WORLD.height);ctx.fill(); };
  hills(300,'#63bb76',-.08,32); hills(355,'#36895d',-.16,43);
  ctx.fillStyle='#ffffff35';for(let x=35;x<WORLD.width;x+=95){ctx.beginPath();ctx.arc(x,285+Math.sin(x)*8,4,0,Math.PI*2);ctx.fill();}
}
function drawTerrain() {
  const g=ctx.createLinearGradient(0,250,0,WORLD.height);g.addColorStop(0,'#8bd34d');g.addColorStop(.035,'#4d9d3d');g.addColorStop(.12,'#a8673d');g.addColorStop(1,'#5a382c');
  ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(0,WORLD.height);for(let x=0;x<terrain.length;x+=2)ctx.lineTo(x,terrain[x]);ctx.lineTo(WORLD.width,WORLD.height);ctx.fill();
  ctx.strokeStyle='#d4ef72';ctx.lineWidth=3;ctx.beginPath();for(let x=0;x<terrain.length;x+=2)x?ctx.lineTo(x,terrain[x]):ctx.moveTo(x,terrain[x]);ctx.stroke();
  ctx.fillStyle='#633b2b55';for(let x=20;x<WORLD.width;x+=37){const y=surfaceAt(terrain,x)+20+(x%4)*9;ctx.fillRect(x,y,5,4);}
  if(wallMode!=='open'){ctx.fillStyle=wallMode==='mirror'?'#dff9ff88':'#3b6688aa';ctx.fillRect(0,WORLD.hud,5,WORLD.height-WORLD.hud);ctx.fillRect(WORLD.width-5,WORLD.hud,5,WORLD.height-WORLD.hud);ctx.fillRect(0,WORLD.hud,WORLD.width,5);ctx.fillRect(0,WORLD.height-5,WORLD.width,5);}
}
function barrelEnd(p) {
  const a=p.angle*Math.PI/180;return {x:Math.cos(a)*20*p.facing,y:-Math.sin(a)*20};
}
function drawTank(p) {
  if(p.hp<=0)return;
  p.y=Math.min(p.y,surfaceAt(terrain,p.x)-8);ctx.save();ctx.translate(p.x,p.y);
  ctx.strokeStyle='#263546';ctx.lineWidth=4;ctx.fillStyle=p.color;ctx.beginPath();ctx.roundRect(-16,-7,32,13,4);ctx.fill();ctx.stroke();
  ctx.beginPath();ctx.arc(0,-9,8,Math.PI,0);ctx.fill();ctx.stroke();const end=barrelEnd(p);ctx.strokeStyle='#263546';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(0,-10);ctx.lineTo(end.x,-10+end.y);ctx.stroke();ctx.strokeStyle=p.color;ctx.lineWidth=4;ctx.stroke();
  ctx.fillStyle='#263546';for(let x=-12;x<=12;x+=8){ctx.beginPath();ctx.arc(x,7,3,0,Math.PI*2);ctx.fill();}ctx.restore();
  ctx.fillStyle='#233344bb';ctx.fillRect(p.x-19,p.y+15,38,5);ctx.fillStyle=p.hp>35?'#67e777':'#ff665b';ctx.fillRect(p.x-19,p.y+15,38*p.hp/100,5);
  ctx.fillStyle='#fff';ctx.strokeStyle='#234';ctx.lineWidth=3;ctx.font='bold 10px system-ui';ctx.textAlign='center';ctx.strokeText(p.name,p.x,p.y+33);ctx.fillText(p.name,p.x,p.y+33);
  if(playing&&p===active()){ctx.strokeStyle='#fff';ctx.setLineDash([4,4]);ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,25,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
}
function drawPath(points,color,dash=[]){if(points.length<2)return;ctx.strokeStyle=color;ctx.lineWidth=2;ctx.setLineDash(dash);ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();ctx.setLineDash([]);}
function render(){screenBackdrop();worldTransform();drawBackdrop();drawTerrain();
  if(playing&&active()?.human){if(showLastTrail)drawPath(active().lastTrail||[],'#ffffff66',[5,5]);if(aimAssist)drawPath(previewPath(active(),terrain,wind,wallMode),'#ffe36fbb',[3,5]);}
  players.forEach(drawTank);if(projectile){ctx.fillStyle='#fff7c7';ctx.strokeStyle='#ff8e32';ctx.lineWidth=3;ctx.beginPath();ctx.arc(projectile.x,projectile.y,4,0,Math.PI*2);ctx.fill();ctx.stroke();}
  ctx.fillStyle='#ffffff55';for(const t of trails)ctx.fillRect(t.x-1,t.y-1,2,2);for(const p of particles){ctx.globalAlpha=p.life;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.size*p.life,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;requestAnimationFrame(render);}

function updateHud(){if(!players.length)return;const p=active(),w=weaponBy(p.weapon);el['turn-name'].textContent=p.name;el.hud.style.setProperty('--player',p.color);el['round-label'].textContent=`Runde ${round} · ${p.hp} Panzerung`;el.wind.textContent=`${wind>0?'→':wind<0?'←':'·'} ${Math.abs(wind)}`;el.angle.textContent=`${p.angle}° ${p.facing>0?'→':'←'}`;el.power.textContent=p.power;el['angle-value'].textContent=`${p.angle}°`;el['power-value'].textContent=p.power;el['angle-slider'].value=p.angle;el['power-slider'].value=p.power;el['weapon-icon'].textContent=w.icon;el['weapon-name'].textContent=w.name;el['weapon-stock'].textContent=Number.isFinite(p.inventory[w.id])?p.inventory[w.id]:'∞';el.controls.classList.toggle('is-waiting',!p.human||waiting);}
function beginRound(){round+=1;terrain=terrainFor(Date.now()+round*911);placePlayers(players,terrain);trails=[];particles=[];projectile=null;wind=Math.round((Math.random()-.5)*95);current=Math.floor(Math.random()*players.length);playing=true;waiting=false;el.shop.hidden=true;el.hud.hidden=false;el.controls.hidden=false;camera.zoom=innerWidth<700?2.15:1.6;focusOn(active().x,active().y);updateHud();maybeAi();}
function cycleWeapon(){if(!playing||waiting||!active().human)return;const p=active(),available=WEAPONS.filter((w)=>p.inventory[w.id]>0);p.weapon=available[(available.findIndex((w)=>w.id===p.weapon)+1)%available.length].id;updateHud();}
function fire(){const p=active();if(!playing||waiting||p.hp<=0)return;const w=weaponBy(p.weapon);if(p.inventory[w.id]<=0){p.weapon='granate';updateHud();return;}if(Number.isFinite(p.inventory[w.id]))p.inventory[w.id]-=1;const v=shotVelocity(p);projectile={x:p.x+p.facing*19,y:p.y-12,...v,age:0,weapon:w,shooter:p};waiting=true;trails=[];camera.manual=false;updateHud();}
function explode(x,y,weapon,shooter){const bursts=weapon.mirv?[-48,-24,0,24,48]:[0];for(const offset of bursts){const bx=clamp(x+offset,0,WORLD.width-1);crater(terrain,bx,y,weapon.radius,weapon.dirt);damageAt(players,bx,y,weapon,shooter);for(let i=0;i<Math.min(90,weapon.radius*1.2);i+=1)particles.push({x:bx,y,vx:(Math.random()-.5)*240,vy:-Math.random()*210,life:1,size:3+Math.random()*7,color:weapon.dirt?'#a88a55':i%3?'#ff9f36':'#fff2a8'});}if(weapon.burrow)for(let i=1;i<5;i+=1)crater(terrain,x,y+i*17,weapon.radius*.72);settleTanks();projectile=null;focusOn(x,y);setTimeout(finishTurn,900);}
function settleTanks(){for(const p of players){if(p.hp<=0)continue;const old=p.y,surface=surfaceAt(terrain,p.x);if(surface>=WORLD.height-2){if(wallMode==='open'){p.hp=0;continue;}p.y=WORLD.height-10;}else p.y=surface-8;const fall=p.y-old;if(fall>45)p.hp=Math.max(0,p.hp-Math.round((fall-35)*.6));}}
function finishTurn(){const alive=living(players);if(alive.length<=1){if(alive[0]){alive[0].wins+=1;alive[0].score+=300;}openShop(alive[0]);return;}do{current=(current+1)%players.length;}while(players[current].hp<=0);waiting=false;focusOn(active().x,active().y);updateHud();maybeAi();}
function maybeAi(){clearTimeout(nextTimer);const p=active();if(!playing||p.human)return;waiting=true;updateHud();nextTimer=setTimeout(()=>{chooseAiShot(p,players,terrain,wind);updateHud();waiting=false;fire();},650);}
function openShop(winner){playing=false;waiting=false;el.hud.hidden=true;el.controls.hidden=true;el.shop.hidden=false;el['shop-round'].textContent=round;el['shop-title'].textContent=winner?`${winner.name} hält das Feld`:'Keine Überlebenden';renderShop();}
function renderShop(){const buyer=players.find((p)=>p.human)||players[0];el.credits.textContent=buyer.score;el['shop-list'].replaceChildren();for(const w of WEAPONS.slice(1)){const b=document.createElement('button');b.className='shop-item';b.disabled=buyer.score<w.cost;b.innerHTML=`<span>${w.icon}</span><span><b>${w.name}</b><small>Vorrat ${buyer.inventory[w.id]} · +${w.stock}</small></span><span class="price">${w.cost}</span>`;b.onclick=()=>{if(buyer.score<w.cost)return;buyer.score-=w.cost;buyer.inventory[w.id]+=w.stock;renderShop();};el['shop-list'].append(b);}}

function tick(now){const dt=Math.min(.025,(now-(tick.last||now))/1000);tick.last=now;if(projectile){stepProjectile(projectile,dt,wind);trails.push({x:projectile.x,y:projectile.y});if(trails.length>400)trails.shift();projectile.shooter.lastTrail=[...trails];if(!camera.manual)focusOn(projectile.x,projectile.y);
    const hit=tankAt(players,projectile.x,projectile.y,projectile.shooter,projectile.age);if(hit){explode(projectile.x,projectile.y,projectile.weapon,projectile.shooter);}else{const edge=boundaryHit(projectile,wallMode);if(edge?.action==='leave'){projectile=null;setTimeout(finishTurn,350);}else if(edge?.action==='explode')explode(projectile.x,projectile.y,projectile.weapon,projectile.shooter);else if(projectile&&projectile.y>=surfaceAt(terrain,projectile.x))explode(projectile.x,projectile.y,projectile.weapon,projectile.shooter);}}
  for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=260*dt;p.life-=dt*1.25;}particles=particles.filter((p)=>p.life>0);requestAnimationFrame(tick);}
function startGame(){const humans=+$('humans').value,cpus=+$('opponents').value;players=makePlayers(Math.min(6,humans+cpus),humans);wallMode=$('wall-mode').value;aimAssist=$('aim-assist').checked;showLastTrail=$('last-trail').checked;round=0;el.title.hidden=true;beginRound();}
function adjust(action){if(!playing||waiting||!active().human)return;const p=active();if(action==='angle-down')p.angle=clamp(p.angle-1,5,85);if(action==='angle-up')p.angle=clamp(p.angle+1,5,85);if(action==='power-down')p.power=clamp(p.power-15,100,900);if(action==='power-up')p.power=clamp(p.power+15,100,900);updateHud();}

function pointerDistance(){const a=[...pointers.values()];return a.length<2?0:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);}
canvas.addEventListener('pointerdown',(e)=>{canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});gesture={distance:pointerDistance(),zoom:camera.zoom};});
canvas.addEventListener('pointermove',(e)=>{const old=pointers.get(e.pointerId);if(!old)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===1){camera.x-=(e.clientX-old.x)/viewScale();camera.y-=(e.clientY-old.y)/viewScale();camera.manual=true;clampCamera();}else if(pointers.size===2&&gesture?.distance){camera.zoom=clamp(gesture.zoom*pointerDistance()/gesture.distance,1,3.5);camera.manual=true;clampCamera();}});
const pointerUp=(e)=>{pointers.delete(e.pointerId);gesture=pointers.size?{distance:pointerDistance(),zoom:camera.zoom}:null;};canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerUp);
canvas.addEventListener('wheel',(e)=>{e.preventDefault();camera.zoom=clamp(camera.zoom*Math.exp(-e.deltaY*.001),1,3.5);camera.manual=true;clampCamera();},{passive:false});

$('start').onclick=startGame;$('rules').onclick=()=>{$('rules-panel').hidden=false};$('rules-close').onclick=()=>{$('rules-panel').hidden=true};$('pause').onclick=()=>{el.menu.hidden=false};$('resume').onclick=()=>{el.menu.hidden=true};$('restart').onclick=()=>location.reload();$('next-round').onclick=beginRound;el.weapon.onclick=cycleWeapon;el.fire.onclick=fire;$('focus').onclick=()=>focusOn(active().x,active().y);
el['angle-slider'].oninput=()=>{if(active()?.human&&!waiting){active().angle=+el['angle-slider'].value;updateHud();}};el['power-slider'].oninput=()=>{if(active()?.human&&!waiting){active().power=+el['power-slider'].value;updateHud();}};
addEventListener('keydown',(e)=>{if(e.key==='ArrowLeft')adjust('angle-down');if(e.key==='ArrowRight')adjust('angle-up');if(e.key==='ArrowDown')adjust('power-down');if(e.key==='ArrowUp')adjust('power-up');if(e.key==='Tab'){e.preventDefault();cycleWeapon();}if(e.code==='Space'){e.preventDefault();fire();}});addEventListener('resize',resize);resize();requestAnimationFrame(render);requestAnimationFrame(tick);
