import {
  WORLD, WEAPONS, clamp, terrainFor, surfaceAt, crater, makePlayers, placePlayers,
  shotVelocity, stepProjectile, damageAt, chooseAiShot, living, tankAt,
  boundaryHit, previewPath,
} from './game.js';

const $ = (id) => document.getElementById(id);
const canvas = $('battle');
const ctx = canvas.getContext('2d');
const ids = ['hud','controls','title','menu','shop','turn-name','round-label','wind','angle','power','weapon','weapon-icon','weapon-name','weapon-stock','fire','credits','shop-list','shop-title','shop-round','angle-dial','power-dial','angle-value','power-value','shop-buyer','shop-kicker','next-round'];
const el = Object.fromEntries(ids.map((id) => [id, $(id)]));

let players = [], terrain = terrainFor(Date.now()), particles = [], trails = [];
let projectile = null, current = 0, round = 0, wind = 0, playing = false, waiting = false, nextTimer = 0;
let wallMode = 'solid', aimAssist = false, showLastTrail = true, deathSalvo = false;
let shopBuyers = [], shopCursor = 0;
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

function updateHud(){if(!players.length)return;const p=active(),w=weaponBy(p.weapon),power=Math.round(p.power/5);el['turn-name'].textContent=p.name;el.hud.style.setProperty('--player',p.color);el['round-label'].textContent=`Runde ${round} · ${p.hp} Panzerung`;el.wind.textContent=`${wind>0?'→':wind<0?'←':'·'} ${Math.abs(wind)}`;el.angle.textContent=`${p.angle}° ${p.facing>0?'→':'←'}`;el.power.textContent=power;el['angle-value'].textContent=`${p.angle}°`;el['power-value'].textContent=power;el['angle-dial'].setAttribute('aria-valuenow',p.angle);el['power-dial'].setAttribute('aria-valuenow',power);el['angle-dial'].style.setProperty('--turn',`${p.angle-90}deg`);el['power-dial'].style.setProperty('--turn',`${(power-20)/160*270-135}deg`);el['weapon-icon'].textContent=w.icon;el['weapon-name'].textContent=w.name;el['weapon-stock'].textContent=Number.isFinite(p.inventory[w.id])?p.inventory[w.id]:'∞';el.controls.classList.toggle('is-waiting',!p.human||waiting);}
function beginRound(){round+=1;terrain=terrainFor(Date.now()+round*911);placePlayers(players,terrain);trails=[];particles=[];projectile=null;wind=Math.round((Math.random()-.5)*95);current=Math.floor(Math.random()*players.length);playing=true;waiting=false;el.shop.hidden=true;el.hud.hidden=false;el.controls.hidden=false;camera.zoom=innerWidth<700?2.15:1.6;focusOn(active().x,active().y);updateHud();maybeAi();}
function cycleWeapon(){if(!playing||waiting||!active().human)return;const p=active(),available=WEAPONS.filter((w)=>p.inventory[w.id]>0);p.weapon=available[(available.findIndex((w)=>w.id===p.weapon)+1)%available.length].id;updateHud();}
function fire(){const p=active();if(!playing||waiting||p.hp<=0)return;const w=weaponBy(p.weapon),cost=w.laser?p.power:1;if(p.inventory[w.id]<cost){p.weapon='granate';updateHud();return;}if(Number.isFinite(p.inventory[w.id]))p.inventory[w.id]-=cost;waiting=true;trails=[];camera.manual=false;if(w.laser){fireLaser(p,w);return;}const v=shotVelocity(p);projectile={x:p.x+p.facing*19,y:p.y-12,...v,age:0,weapon:w,shooter:p};updateHud();}
function fireLaser(p,w){const a=p.angle*Math.PI/180,dx=Math.cos(a)*p.facing,dy=-Math.sin(a),range=p.power*.92;let x=p.x+dx*20,y=p.y-12,hit=null;for(let d=0;d<range;d+=3){x+=dx*3;y+=dy*3;trails.push({x,y});hit=tankAt(players,x,y,p,d/900);if(hit||x<=0||x>=WORLD.width||y<=WORLD.hud||y>=WORLD.height||y>=surfaceAt(terrain,x))break;}p.lastTrail=[...trails];setTimeout(()=>explode(x,y,w,p,hit),180);updateHud();}
function explode(x,y,weapon,shooter,directTarget=null){const aliveBefore=new Set(living(players));if(directTarget&&directTarget.hp>0){const bonus=Math.round(weapon.damage*.55),wasAlive=directTarget.hp>0;directTarget.hp=Math.max(0,directTarget.hp-bonus);if(directTarget!==shooter){shooter.score+=bonus*2;if(wasAlive&&directTarget.hp===0)shooter.score+=100;}}const bursts=weapon.mirv?[-48,-24,0,24,48]:[0];for(const offset of bursts){const bx=clamp(x+offset,0,WORLD.width-1);crater(terrain,bx,y,weapon.radius,weapon.dirt);damageAt(players,bx,y,weapon,shooter);for(let i=0;i<Math.min(90,weapon.radius*1.2);i+=1)particles.push({x:bx,y,vx:(Math.random()-.5)*240,vy:-Math.random()*210,life:1,size:3+Math.random()*7,color:weapon.dirt?'#a88a55':weapon.acid?'#b8ff4b':i%3?'#ff9f36':'#fff2a8'});}if(weapon.burrow)for(let i=1;i<5;i+=1)crater(terrain,x,y+i*17,weapon.radius*.72);if(weapon.acid)for(let i=0;i<6;i+=1)crater(terrain,x,y+i*28,weapon.radius*(1-i*.08));if(deathSalvo){for(const p of players)if(aliveBefore.has(p)&&p.hp<=0&&!p.deathTriggered){p.deathTriggered=true;const retaliation=WEAPONS[1+Math.floor(Math.random()*(WEAPONS.length-2))];crater(terrain,p.x,p.y,retaliation.radius,retaliation.dirt);damageAt(players,p.x,p.y,retaliation,p);}}settleTanks();projectile=null;focusOn(x,y);setTimeout(finishTurn,900);}
function settleTanks(){for(const p of players){if(p.hp<=0)continue;const old=p.y,surface=surfaceAt(terrain,p.x);if(surface>=WORLD.height-2){if(wallMode==='open'){p.hp=0;continue;}p.y=WORLD.height-10;}else p.y=surface-8;const fall=p.y-old;if(fall>45)p.hp=Math.max(0,p.hp-Math.round((fall-35)*.6));}}
function finishTurn(){const alive=living(players);if(alive.length<=1){if(alive[0]){alive[0].wins+=1;alive[0].score+=300;}openShop(alive[0]);return;}do{current=(current+1)%players.length;}while(players[current].hp<=0);waiting=false;focusOn(active().x,active().y);updateHud();maybeAi();}
function maybeAi(){clearTimeout(nextTimer);const p=active();if(!playing||p.human)return;waiting=true;updateHud();nextTimer=setTimeout(()=>{chooseAiShot(p,players,terrain,wind);const specials=WEAPONS.filter((w)=>w.id!=='granate'&&p.inventory[w.id]>=(w.laser?p.power:1));p.weapon=specials.length&&Math.random()<.72?specials[Math.floor(Math.random()*specials.length)].id:'granate';updateHud();waiting=false;fire();},650);}
function autoBuyBots(){for(const bot of players.filter((p)=>!p.human)){let guard=0;while(guard++<5){const choices=WEAPONS.slice(1).filter((w)=>w.cost<=bot.score);if(!choices.length)break;const w=choices[Math.floor(Math.random()*choices.length)];bot.score-=w.cost;bot.inventory[w.id]+=w.stock;}}}
function openShop(winner,first=false){playing=false;waiting=false;el.hud.hidden=true;el.controls.hidden=true;el.shop.hidden=false;autoBuyBots();shopBuyers=players.filter((p)=>p.human);shopCursor=0;el['shop-round'].textContent=round;el['shop-kicker'].firstChild.textContent=first?'Erstausstattung vor dem Gefecht ':'Versorgung nach Runde ';el['shop-title'].textContent=first?'Arsenal öffnen':winner?`${winner.name} hält das Feld`:'Keine Überlebenden';renderShop();}
function renderShop(){const buyer=shopBuyers[shopCursor];el['shop-buyer'].textContent=buyer.name;el.credits.textContent=buyer.score;el['shop-list'].replaceChildren();for(const w of WEAPONS.slice(1)){const b=document.createElement('button');b.className='shop-item';b.disabled=buyer.score<w.cost;b.innerHTML=`<span class="weapon-preview" data-kind="${w.kind}"></span><span><b>${w.name}</b><small>Vorrat ${buyer.inventory[w.id]} · +${w.stock}</small><small class="description">${w.description}</small></span><span class="price">${w.cost}</span>`;b.onclick=()=>{if(buyer.score<w.cost)return;buyer.score-=w.cost;buyer.inventory[w.id]+=w.stock;renderShop();};el['shop-list'].append(b);}el['next-round'].textContent=shopCursor<shopBuyers.length-1?'Nächster Commander':'Nächste Runde';}
function advanceShop(){if(shopCursor<shopBuyers.length-1){shopCursor+=1;renderShop();}else beginRound();}

function tick(now){const dt=Math.min(.025,(now-(tick.last||now))/1000);tick.last=now;if(projectile){stepProjectile(projectile,dt,wind);trails.push({x:projectile.x,y:projectile.y});if(trails.length>400)trails.shift();projectile.shooter.lastTrail=[...trails];if(!camera.manual)focusOn(projectile.x,projectile.y);
    const hit=tankAt(players,projectile.x,projectile.y,projectile.shooter,projectile.age);if(hit){explode(projectile.x,projectile.y,projectile.weapon,projectile.shooter,hit);}else{const edge=boundaryHit(projectile,wallMode);if(edge?.action==='leave'){projectile=null;setTimeout(finishTurn,350);}else if(edge?.action==='explode')explode(projectile.x,projectile.y,projectile.weapon,projectile.shooter);else if(projectile&&projectile.y>=surfaceAt(terrain,projectile.x))explode(projectile.x,projectile.y,projectile.weapon,projectile.shooter);}}
  for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=260*dt;p.life-=dt*1.25;}particles=particles.filter((p)=>p.life>0);requestAnimationFrame(tick);}
function startGame(){const humans=+$('humans').value,cpus=+$('opponents').value;players=makePlayers(Math.min(6,humans+cpus),humans);wallMode=$('wall-mode').value;aimAssist=$('aim-assist').checked;showLastTrail=$('last-trail').checked;deathSalvo=$('death-salvo').checked;round=0;el.title.hidden=true;openShop(null,true);}
function adjust(action){if(!playing||waiting||!active().human)return;const p=active();if(action==='angle-down')p.angle=clamp(p.angle-1,0,180);if(action==='angle-up')p.angle=clamp(p.angle+1,0,180);if(action==='power-down')p.power=clamp(p.power-5,100,900);if(action==='power-up')p.power=clamp(p.power+5,100,900);updateHud();}

function pointerDistance(){const a=[...pointers.values()];return a.length<2?0:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);}
canvas.addEventListener('pointerdown',(e)=>{canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});gesture={distance:pointerDistance(),zoom:camera.zoom};});
canvas.addEventListener('pointermove',(e)=>{const old=pointers.get(e.pointerId);if(!old)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===1){camera.x-=(e.clientX-old.x)/viewScale();camera.y-=(e.clientY-old.y)/viewScale();camera.manual=true;clampCamera();}else if(pointers.size===2&&gesture?.distance){camera.zoom=clamp(gesture.zoom*pointerDistance()/gesture.distance,1,3.5);camera.manual=true;clampCamera();}});
const pointerUp=(e)=>{pointers.delete(e.pointerId);gesture=pointers.size?{distance:pointerDistance(),zoom:camera.zoom}:null;};canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerUp);
canvas.addEventListener('wheel',(e)=>{e.preventDefault();camera.zoom=clamp(camera.zoom*Math.exp(-e.deltaY*.001),1,3.5);camera.manual=true;clampCamera();},{passive:false});

$('start').onclick=startGame;$('rules').onclick=()=>{$('rules-panel').hidden=false};$('rules-close').onclick=()=>{$('rules-panel').hidden=true};$('pause').onclick=()=>{el.menu.hidden=false};$('resume').onclick=()=>{el.menu.hidden=true};$('restart').onclick=()=>location.reload();$('next-round').onclick=advanceShop;el.weapon.onclick=cycleWeapon;el.fire.onclick=fire;$('focus').onclick=()=>focusOn(active().x,active().y);
function bindDial(node,getValue,setValue,min,max){let drag=null;const apply=(value)=>{if(!active()?.human||waiting)return;setValue(clamp(Math.round(value),min,max));updateHud();};node.addEventListener('pointerdown',(e)=>{node.setPointerCapture(e.pointerId);drag={y:e.clientY,value:getValue(),carry:0};node.classList.add('is-turning');});node.addEventListener('pointermove',(e)=>{if(!drag)return;const dy=drag.y-e.clientY;if(Math.abs(dy)<1)return;const speed=1+Math.min(4,Math.floor(Math.abs(dy)/14));drag.carry+=dy/7*speed;const steps=Math.trunc(drag.carry);if(steps){drag.value=clamp(drag.value+steps,min,max);drag.carry-=steps;apply(drag.value);}drag.y=e.clientY;});const stop=()=>{drag=null;node.classList.remove('is-turning');};node.addEventListener('pointerup',stop);node.addEventListener('pointercancel',stop);node.addEventListener('wheel',(e)=>{e.preventDefault();apply(getValue()+(e.deltaY<0?1:-1));},{passive:false});node.addEventListener('keydown',(e)=>{if(e.key==='ArrowUp'||e.key==='ArrowRight'){e.preventDefault();apply(getValue()+1);}if(e.key==='ArrowDown'||e.key==='ArrowLeft'){e.preventDefault();apply(getValue()-1);}});}
bindDial(el['angle-dial'],()=>active()?.angle??45,(v)=>{active().angle=v;},0,180);bindDial(el['power-dial'],()=>Math.round((active()?.power??480)/5),(v)=>{active().power=v*5;},20,180);
addEventListener('keydown',(e)=>{if(e.key==='ArrowLeft')adjust('angle-down');if(e.key==='ArrowRight')adjust('angle-up');if(e.key==='ArrowDown')adjust('power-down');if(e.key==='ArrowUp')adjust('power-up');if(e.key==='Tab'){e.preventDefault();cycleWeapon();}if(e.code==='Space'){e.preventDefault();fire();}});addEventListener('resize',resize);resize();requestAnimationFrame(render);requestAnimationFrame(tick);
