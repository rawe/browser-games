import {
  WORLD, WEAPONS, clamp, terrainFor, surfaceAt, crater, makePlayers, placePlayers,
  shotVelocity, stepProjectile, damageAt, chooseAiShot, living, tankAt,
  boundaryHit, previewPath, muzzlePoint,
} from './game.js';

const $ = (id) => document.getElementById(id);
const canvas = $('battle');
const ctx = canvas.getContext('2d');
const ids = ['hud','controls','title','menu','shop','turn-name','round-label','wind','angle','power','weapon','weapon-icon','weapon-name','weapon-stock','fire','credits','shop-list','shop-title','shop-round','angle-dial','power-dial','angle-value','power-value','shop-buyer','shop-kicker','next-round'];
const el = Object.fromEntries(ids.map((id) => [id, $(id)]));

let players = [], terrain = terrainFor(Date.now()), particles = [], trails = [], effects = [];
let projectile = null, laserState = null, current = 0, round = 0, wind = 0, playing = false, waiting = false, nextTimer = 0;
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
  ctx.save();ctx.translate(p.x,p.y);
  ctx.strokeStyle='#263546';ctx.lineWidth=4;ctx.fillStyle=p.color;ctx.beginPath();ctx.roundRect(-16,-7,32,13,4);ctx.fill();ctx.stroke();
  ctx.beginPath();ctx.arc(0,-9,8,Math.PI,0);ctx.fill();ctx.stroke();const end=barrelEnd(p);ctx.strokeStyle='#263546';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(0,-10);ctx.lineTo(end.x,-10+end.y);ctx.stroke();ctx.strokeStyle=p.color;ctx.lineWidth=4;ctx.stroke();
  ctx.fillStyle='#263546';for(let x=-12;x<=12;x+=8){ctx.beginPath();ctx.arc(x,7,3,0,Math.PI*2);ctx.fill();}ctx.restore();
  ctx.fillStyle='#233344bb';ctx.fillRect(p.x-19,p.y+15,38,5);ctx.fillStyle=p.hp>35?'#67e777':'#ff665b';ctx.fillRect(p.x-19,p.y+15,38*p.hp/100,5);
  ctx.fillStyle='#fff';ctx.strokeStyle='#234';ctx.lineWidth=3;ctx.font='bold 10px system-ui';ctx.textAlign='center';ctx.strokeText(p.name,p.x,p.y+33);ctx.fillText(p.name,p.x,p.y+33);
  if(playing&&p===active()){ctx.strokeStyle='#fff';ctx.setLineDash([4,4]);ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,25,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
}
function drawPath(points,color,dash=[]){if(points.length<2)return;ctx.strokeStyle=color;ctx.lineWidth=2;ctx.setLineDash(dash);ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();ctx.setLineDash([]);}
function addEffect(kind,x,y,radius,delay=0){effects.push({kind,x,y,radius,age:-delay,duration:kind==='acid'?1.1:kind==='nuke'?0.72:0.58});}
function drawEffects(){for(const e of effects){if(e.age<0)continue;const t=clamp(e.age/e.duration,0,1),r=e.radius*(e.kind==='dirt'?t:.25+t*.75);ctx.save();if(e.kind==='nuke'&&t<.45){ctx.globalCompositeOperation='difference';ctx.fillStyle=t%0.14<.07?'#fff':'#8ff';ctx.beginPath();ctx.arc(e.x,e.y,r,0,Math.PI*2);ctx.fill();}else if(e.kind==='dirt'){ctx.globalAlpha=1-t*.25;ctx.fillStyle='#9b6a3c';ctx.strokeStyle='#d4ef72';ctx.lineWidth=3;ctx.beginPath();ctx.arc(e.x,e.y,r,0,Math.PI*2);ctx.fill();ctx.stroke();}else if(e.kind==='acid'){ctx.globalAlpha=1-t;ctx.strokeStyle='#b9ff4c';ctx.lineWidth=3+6*(1-t);for(let i=-2;i<=2;i+=1){ctx.beginPath();ctx.moveTo(e.x+i*e.radius*.18,e.y-e.radius*.45);ctx.lineTo(e.x+i*e.radius*.13,e.y+e.radius*(.2+t*1.7));ctx.stroke();}}else if(e.kind==='drill'){ctx.globalAlpha=1-t;ctx.strokeStyle='#fff4b0';ctx.lineWidth=4;ctx.beginPath();for(let i=0;i<8;i+=1)ctx.lineTo(e.x+Math.sin(i*2.4+t*12)*e.radius*.45,e.y+i*e.radius*.34);ctx.stroke();}else{ctx.globalAlpha=1-t;ctx.strokeStyle=e.kind==='heavy'?'#fff1a0':'#ffb13b';ctx.lineWidth=e.kind==='heavy'?8:5;ctx.beginPath();ctx.arc(e.x,e.y,r,0,Math.PI*2);ctx.stroke();if(e.kind==='heavy'||e.kind==='mirv'){ctx.lineWidth=2;ctx.beginPath();ctx.arc(e.x,e.y,r*.58,0,Math.PI*2);ctx.stroke();}}ctx.restore();}}
function render(){screenBackdrop();worldTransform();drawBackdrop();drawTerrain();
  if(playing&&active()?.human){if(showLastTrail)drawPath(active().lastTrail||[],'#ffffff66',[5,5]);if(aimAssist)drawPath(previewPath(active(),terrain,wind,wallMode),'#ffe36fbb',[3,5]);}
  players.forEach(drawTank);if(projectile){ctx.fillStyle='#fff7c7';ctx.strokeStyle='#ff8e32';ctx.lineWidth=3;ctx.beginPath();ctx.arc(projectile.x,projectile.y,4,0,Math.PI*2);ctx.fill();ctx.stroke();}if(laserState){drawPath(laserState.points,'#ffefff');ctx.shadowColor='#ff43ff';ctx.shadowBlur=12;drawPath(laserState.points,'#ff65ff');ctx.shadowBlur=0;}
  drawEffects();ctx.fillStyle='#ffffff55';for(const t of trails)ctx.fillRect(t.x-1,t.y-1,2,2);for(const p of particles){ctx.globalAlpha=p.life;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.size*p.life,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;requestAnimationFrame(render);}

function updateHud(){if(!players.length)return;const p=active(),w=weaponBy(p.weapon),power=Math.round(p.power/5);el['turn-name'].textContent=p.name;el.hud.style.setProperty('--player',p.color);el['round-label'].textContent=`Runde ${round} · ${p.hp} Panzerung`;el.wind.textContent=`${wind>0?'→':wind<0?'←':'·'} ${Math.abs(wind)}`;el.angle.textContent=`${p.angle}° ${p.facing>0?'→':'←'}`;el.power.textContent=power;el['angle-value'].textContent=`${p.angle}°`;el['power-value'].textContent=power;el['angle-dial'].setAttribute('aria-valuenow',p.angle);el['power-dial'].setAttribute('aria-valuenow',power);el['angle-dial'].style.setProperty('--roll',p.angle*2);el['power-dial'].style.setProperty('--roll',power*2);el['weapon-icon'].textContent=w.icon;el['weapon-name'].textContent=w.name;el['weapon-stock'].textContent=Number.isFinite(p.inventory[w.id])?p.inventory[w.id]:'∞';el.controls.classList.toggle('is-waiting',!p.human||waiting);}
function beginRound(){round+=1;terrain=terrainFor(Date.now()+round*911);placePlayers(players,terrain);trails=[];particles=[];effects=[];projectile=null;laserState=null;wind=Math.round((Math.random()-.5)*95);current=Math.floor(Math.random()*players.length);playing=true;waiting=false;el.shop.hidden=true;el.hud.hidden=false;el.controls.hidden=false;camera.zoom=innerWidth<700?2.15:1.6;focusOn(active().x,active().y);updateHud();maybeAi();}
function cycleWeapon(){if(!playing||waiting||!active().human)return;const p=active(),available=WEAPONS.filter((w)=>p.inventory[w.id]>0);p.weapon=available[(available.findIndex((w)=>w.id===p.weapon)+1)%available.length].id;updateHud();}
function fire(){const p=active();if(!playing||waiting||p.hp<=0)return;const w=weaponBy(p.weapon),cost=w.laser?Math.min(p.power,p.inventory[w.id]):1;if(p.inventory[w.id]<cost||cost<=0){p.weapon='granate';updateHud();return;}if(Number.isFinite(p.inventory[w.id]))p.inventory[w.id]-=cost;waiting=true;trails=[];camera.manual=false;if(w.laser){startLaser(p,w,cost);updateHud();return;}const v=shotVelocity(p),muzzle=muzzlePoint(p);projectile={...muzzle,...v,age:0,weapon:w,shooter:p};updateHud();}
function startLaser(p,w,energy){const a=p.angle*Math.PI/180,muzzle=muzzlePoint(p);laserState={shooter:p,weapon:w,energy,x:muzzle.x,y:muzzle.y,dx:Math.cos(a)*p.facing,dy:-Math.sin(a),points:[muzzle],distance:0,killed:[]};trails=[];}
function applyImpact(x,y,weapon,shooter,directTarget=null){const aliveBefore=new Set(living(players));if(directTarget&&directTarget.hp>0){const bonus=Math.round(weapon.damage*.55),wasAlive=directTarget.hp>0;directTarget.hp=Math.max(0,directTarget.hp-bonus);if(directTarget!==shooter){shooter.score+=bonus*2;if(wasAlive&&directTarget.hp===0)shooter.score+=100;}}const count=weapon.cluster||1,bursts=Array.from({length:count},(_,i)=>(i-(count-1)/2)*24);for(const offset of bursts){const bx=clamp(x+offset,0,WORLD.width-1);crater(terrain,bx,y,weapon.radius,weapon.dirt);damageAt(players,bx,y,weapon,shooter);for(let i=0;i<Math.min(90,weapon.radius*1.2);i+=1)particles.push({x:bx,y,vx:(Math.random()-.5)*240,vy:-Math.random()*210,life:1,size:3+Math.random()*7,color:weapon.dirt?'#a88a55':weapon.acid?'#b8ff4b':i%3?'#ff9f36':'#fff2a8'});}if(weapon.burrow)for(let i=1;i<5;i+=1)crater(terrain,x,y+i*17,weapon.radius*.72);if(weapon.acid)for(let i=0;i<7;i+=1)crater(terrain,x,y+i*28,weapon.radius*(1-i*.07));settleTanks();return players.filter((p)=>aliveBefore.has(p)&&p.hp<=0&&!p.deathTriggered);}
function explode(x,y,weapon,shooter,directTarget=null){projectile=null;focusOn(x,y);if(weapon.cluster){for(let i=0;i<weapon.cluster;i+=1)addEffect(weapon.effect,x+(i-(weapon.cluster-1)/2)*24,y,weapon.radius,i*.07);}else addEffect(weapon.effect,x,y,weapon.radius);const delay=weapon.acid?720:weapon.dirt?380:weapon.effect==='nuke'?300:140;setTimeout(()=>{const deaths=applyImpact(x,y,weapon,shooter,directTarget);if(deathSalvo&&deaths.length){deaths.forEach((p,i)=>setTimeout(()=>triggerDeathSalvo(p),i*520));setTimeout(finishTurn,deaths.length*520+900);}else setTimeout(finishTurn,650);},delay);}
function triggerDeathSalvo(p){p.deathTriggered=true;const pool=WEAPONS.filter((w)=>w.id!=='granate'&&!w.laser),weapon=pool[Math.floor(Math.random()*pool.length)];addEffect(weapon.effect,p.x,p.y,weapon.radius);setTimeout(()=>applyImpact(p.x,p.y,weapon,p),weapon.acid?700:weapon.dirt?380:160);}
function settleTanks(){for(const p of players){if(p.hp<=0)continue;const old=p.y,surface=surfaceAt(terrain,p.x),landing=surface-8;if(surface>=WORLD.height-2){if(wallMode==='open'){p.hp=0;continue;}p.y=WORLD.height-10;}else if(landing>p.y)p.y=landing;const fall=p.y-old;if(fall>45)p.hp=Math.max(0,p.hp-Math.round((fall-35)*.6));}}
function finishTurn(){const alive=living(players);if(alive.length<=1){if(alive[0]){alive[0].wins+=1;alive[0].score+=300;}openShop(alive[0]);return;}do{current=(current+1)%players.length;}while(players[current].hp<=0);waiting=false;focusOn(active().x,active().y);updateHud();maybeAi();}
function maybeAi(){clearTimeout(nextTimer);const p=active();if(!playing||p.human)return;waiting=true;updateHud();nextTimer=setTimeout(()=>{chooseAiShot(p,players,terrain,wind);const specials=WEAPONS.filter((w)=>w.id!=='granate'&&p.inventory[w.id]>=(w.laser?p.power:1));p.weapon=specials.length&&Math.random()<.72?specials[Math.floor(Math.random()*specials.length)].id:'granate';updateHud();waiting=false;fire();},650);}
function autoBuyBots(){for(const bot of players.filter((p)=>!p.human)){let guard=0;while(guard++<5){const choices=WEAPONS.slice(1).filter((w)=>w.cost<=bot.score);if(!choices.length)break;const w=choices[Math.floor(Math.random()*choices.length)];bot.score-=w.cost;bot.inventory[w.id]+=w.stock;}}}
function openShop(winner,first=false){playing=false;waiting=false;el.hud.hidden=true;el.controls.hidden=true;el.shop.hidden=false;autoBuyBots();shopBuyers=players.filter((p)=>p.human);shopCursor=0;el['shop-round'].textContent=round;el['shop-kicker'].firstChild.textContent=first?'Erstausstattung vor dem Gefecht ':'Versorgung nach Runde ';el['shop-title'].textContent=first?'Arsenal öffnen':winner?`${winner.name} hält das Feld`:'Keine Überlebenden';renderShop();}
function renderShop(){const buyer=shopBuyers[shopCursor];el['shop-buyer'].textContent=buyer.name;el.credits.textContent=buyer.score;el['shop-list'].replaceChildren();let category='';for(const w of WEAPONS.slice(1)){if(w.category!==category){category=w.category;const heading=document.createElement('h3');heading.className='shop-category';heading.textContent=category;el['shop-list'].append(heading);}const b=document.createElement('button');b.className='shop-item';b.disabled=buyer.score<w.cost;b.innerHTML=`<span class="weapon-preview" data-kind="${w.kind}"></span><span><b>${w.name}</b><small>Vorrat ${buyer.inventory[w.id]} · +${w.stock}</small><small class="description">${w.description}</small></span><span class="price">${w.cost}</span>`;b.onclick=()=>{if(buyer.score<w.cost)return;buyer.score-=w.cost;buyer.inventory[w.id]+=w.stock;renderShop();};el['shop-list'].append(b);}el['next-round'].textContent=shopCursor<shopBuyers.length-1?'Nächster Commander':'Nächste Runde';}
function advanceShop(){if(shopCursor<shopBuyers.length-1){shopCursor+=1;renderShop();}else beginRound();}

function finishLaser(){if(!laserState)return;const {shooter,killed}=laserState;shooter.lastTrail=[...laserState.points];laserState=null;settleTanks();if(deathSalvo&&killed.length){killed.forEach((p,i)=>setTimeout(()=>triggerDeathSalvo(p),i*520));setTimeout(finishTurn,killed.length*520+900);}else setTimeout(finishTurn,500);}
function stepLaser(dt){const laser=laserState;if(!laser)return;let travel=Math.min(1000*dt,laser.energy*2),blocked=false;while(travel>0&&!blocked){const step=Math.min(4,travel),nx=laser.x+laser.dx*step,ny=laser.y+laser.dy*step,hit=tankAt(players,nx,ny,laser.shooter,laser.distance/1000);if(hit){const damage=Math.min(hit.hp,72*dt);hit.hp=Math.max(0,hit.hp-damage);if(hit!==laser.shooter){laser.shooter.score+=Math.round(damage*2);if(hit.hp===0&&!laser.killed.includes(hit)){laser.shooter.score+=100;laser.killed.push(hit);}}laser.energy-=500*dt;blocked=hit.hp>0;if(!blocked)continue;break;}const probe={x:nx,y:ny,vx:laser.dx,vy:laser.dy};const edge=boundaryHit(probe,wallMode);if(edge&&edge.action!=='bounce'){laser.energy=0;break;}if(edge?.action==='bounce'){laser.dx=probe.vx;laser.dy=probe.vy;}laser.x=probe.x;laser.y=probe.y;laser.distance+=step;laser.energy-=step/2;travel-=step;laser.points.push({x:laser.x,y:laser.y});const tx=Math.round(laser.x);if(laser.y>=surfaceAt(terrain,tx))for(let ix=tx-5;ix<=tx+5;ix+=1)if(ix>=0&&ix<terrain.length)terrain[ix]=Math.max(terrain[ix],Math.round(laser.y+7));}if(!camera.manual)focusOn(laser.x,laser.y);if(laser.energy<=0)finishLaser();}
function tick(now){const dt=Math.min(.025,(now-(tick.last||now))/1000);tick.last=now;if(projectile){stepProjectile(projectile,dt,wind);trails.push({x:projectile.x,y:projectile.y});if(trails.length>400)trails.shift();projectile.shooter.lastTrail=[...trails];if(!camera.manual)focusOn(projectile.x,projectile.y);
    const hit=tankAt(players,projectile.x,projectile.y,projectile.shooter,projectile.age);if(hit){explode(projectile.x,projectile.y,projectile.weapon,projectile.shooter,hit);}else{const edge=boundaryHit(projectile,wallMode);if(edge?.action==='leave'){projectile=null;setTimeout(finishTurn,350);}else if(edge?.action==='explode')explode(projectile.x,projectile.y,projectile.weapon,projectile.shooter);else if(projectile&&projectile.y>=surfaceAt(terrain,projectile.x))explode(projectile.x,projectile.y,projectile.weapon,projectile.shooter);}}
  if(laserState)stepLaser(dt);for(const e of effects)e.age+=dt;effects=effects.filter((e)=>e.age<e.duration);for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=260*dt;p.life-=dt*1.25;}particles=particles.filter((p)=>p.life>0);requestAnimationFrame(tick);}
function startGame(){const humans=+$('humans').value,cpus=+$('opponents').value;players=makePlayers(Math.min(6,humans+cpus),humans);wallMode=$('wall-mode').value;aimAssist=$('aim-assist').checked;showLastTrail=$('last-trail').checked;deathSalvo=$('death-salvo').checked;round=0;el.title.hidden=true;openShop(null,true);}
function adjust(action){if(!playing||waiting||!active().human)return;const p=active();if(action==='angle-down')p.angle=clamp(p.angle-1,0,180);if(action==='angle-up')p.angle=clamp(p.angle+1,0,180);if(action==='power-down')p.power=clamp(p.power-5,100,1000);if(action==='power-up')p.power=clamp(p.power+5,100,1000);updateHud();}

function pointerDistance(){const a=[...pointers.values()];return a.length<2?0:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);}
canvas.addEventListener('pointerdown',(e)=>{canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});gesture={distance:pointerDistance(),zoom:camera.zoom};});
canvas.addEventListener('pointermove',(e)=>{const old=pointers.get(e.pointerId);if(!old)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===1){camera.x-=(e.clientX-old.x)/viewScale();camera.y-=(e.clientY-old.y)/viewScale();camera.manual=true;clampCamera();}else if(pointers.size===2&&gesture?.distance){camera.zoom=clamp(gesture.zoom*pointerDistance()/gesture.distance,1,3.5);camera.manual=true;clampCamera();}});
const pointerUp=(e)=>{pointers.delete(e.pointerId);gesture=pointers.size?{distance:pointerDistance(),zoom:camera.zoom}:null;};canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerUp);
canvas.addEventListener('wheel',(e)=>{e.preventDefault();camera.zoom=clamp(camera.zoom*Math.exp(-e.deltaY*.001),1,3.5);camera.manual=true;clampCamera();},{passive:false});

$('start').onclick=startGame;$('rules').onclick=()=>{$('rules-panel').hidden=false};$('rules-close').onclick=()=>{$('rules-panel').hidden=true};$('pause').onclick=()=>{el.menu.hidden=false};$('resume').onclick=()=>{el.menu.hidden=true};$('restart').onclick=()=>location.reload();$('next-round').onclick=advanceShop;el.weapon.onclick=cycleWeapon;el.fire.onclick=fire;$('focus').onclick=()=>focusOn(active().x,active().y);
function bindRoller(node,getValue,setValue,min,max){let drag=null,velocity=0,carry=0,frame=0;const applyDelta=(delta)=>{if(!active()?.human||waiting)return;carry+=delta;const steps=Math.trunc(carry);if(!steps)return;carry-=steps;const before=getValue(),next=clamp(before+steps,min,max);setValue(next);if(next===min||next===max){velocity=0;carry=0;}updateHud();};const coast=()=>{velocity*=.925;if(Math.abs(velocity)<.015){frame=0;return;}applyDelta(velocity*16/5);frame=requestAnimationFrame(coast);};node.addEventListener('pointerdown',(e)=>{if(frame)cancelAnimationFrame(frame);frame=0;velocity=0;carry=0;node.setPointerCapture(e.pointerId);drag={x:e.clientX,time:e.timeStamp};node.classList.add('is-turning');});node.addEventListener('pointermove',(e)=>{if(!drag)return;const dx=e.clientX-drag.x,dt=Math.max(1,e.timeStamp-drag.time);if(Math.abs(dx)<.4)return;velocity=dx/dt;applyDelta(dx/5);drag={x:e.clientX,time:e.timeStamp};});const stop=()=>{if(!drag)return;drag=null;node.classList.remove('is-turning');if(Math.abs(velocity)>.08)frame=requestAnimationFrame(coast);};node.addEventListener('pointerup',stop);node.addEventListener('pointercancel',()=>{velocity=0;stop();});node.addEventListener('wheel',(e)=>{e.preventDefault();applyDelta(e.deltaY<0?1:-1);},{passive:false});node.addEventListener('keydown',(e)=>{if(e.key==='ArrowUp'||e.key==='ArrowRight'){e.preventDefault();applyDelta(1);}if(e.key==='ArrowDown'||e.key==='ArrowLeft'){e.preventDefault();applyDelta(-1);}});}
bindRoller(el['angle-dial'],()=>active()?.angle??45,(v)=>{active().angle=v;},0,180);bindRoller(el['power-dial'],()=>Math.round((active()?.power??480)/5),(v)=>{active().power=v*5;},20,200);
addEventListener('keydown',(e)=>{if(e.key==='ArrowLeft')adjust('angle-down');if(e.key==='ArrowRight')adjust('angle-up');if(e.key==='ArrowDown')adjust('power-down');if(e.key==='ArrowUp')adjust('power-up');if(e.key==='Tab'){e.preventDefault();cycleWeapon();}if(e.code==='Space'){e.preventDefault();fire();}});addEventListener('resize',resize);resize();requestAnimationFrame(render);requestAnimationFrame(tick);
