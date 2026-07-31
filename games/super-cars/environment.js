// Mobile-friendly low-poly scenery. Repeated objects are instanced so the richer
// horizon costs only a handful of draw calls even with dozens of trees.
import * as THREE from 'three';

const tmp = new THREE.Object3D();

function skyDome(env) {
  const radius = 280;
  const geo = new THREE.SphereGeometry(radius, 24, 12);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const zenith = new THREE.Color(env.sky);
  const horizon = new THREE.Color(env.horizon);
  const haze = new THREE.Color(env.fog);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / radius;
    if (y < -0.05) c.copy(haze);
    else if (y < 0.28) c.copy(horizon).lerp(zenith, Math.max(0, y / 0.28));
    else c.copy(zenith);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  }));
  dome.renderOrder = -100;
  return dome;
}

function addMountains(group, env, rand) {
  const layers = [
    { count: 20, radius: 178, height: 23, color: new THREE.Color(env.fog).lerp(new THREE.Color(env.horizon), 0.16) },
    { count: 15, radius: 222, height: 32, color: new THREE.Color(env.sky).lerp(new THREE.Color(0x111827), 0.34) },
  ];

  for (const [layerIndex, layer] of layers.entries()) {
    const geo = new THREE.ConeGeometry(16, layer.height, 5);
    const material = new THREE.MeshLambertMaterial({ color: layer.color, flatShading: true });
    const mountains = new THREE.InstancedMesh(geo, material, layer.count);
    for (let i = 0; i < layer.count; i++) {
      const angle = (i / layer.count) * Math.PI * 2 + layerIndex * 0.11;
      const radial = layer.radius + (rand() - 0.5) * 28;
      const width = 0.75 + rand() * 1.45;
      const height = 0.65 + rand() * 0.72;
      tmp.position.set(Math.cos(angle) * radial, layer.height * height * 0.5 - 5, Math.sin(angle) * radial);
      tmp.rotation.set(0, rand() * Math.PI, 0);
      tmp.scale.set(width, height, width * (0.85 + rand() * 0.3));
      tmp.updateMatrix();
      mountains.setMatrixAt(i, tmp.matrix);
    }
    mountains.instanceMatrix.needsUpdate = true;
    mountains.computeBoundingSphere();
    group.add(mountains);
  }
}

function addTreesAndRocks(group, track, rand) {
  const count = 64;
  const foliage = new THREE.InstancedMesh(
    new THREE.ConeGeometry(1.7, 4.8, 6),
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    count,
  );
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.24, 0.32, 1.5, 5),
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    count,
  );
  const treeColor = new THREE.Color();
  const trunkColor = new THREE.Color();
  const isNearTrack = (x, z, margin) => track.samples.some(
    (s) => (s.x - x) ** 2 + (s.z - z) ** 2 < margin * margin,
  );

  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts++ < 750) {
    const x = (rand() - 0.5) * 310;
    const z = (rand() - 0.5) * 310;
    if (isNearTrack(x, z, track.halfWidth + track.shoulder + 5)) continue;
    const scale = 0.72 + rand() * 0.95;

    tmp.position.set(x, 3.25 * scale, z);
    tmp.rotation.set(0, rand() * Math.PI, 0);
    tmp.scale.set(scale, scale, scale);
    tmp.updateMatrix();
    foliage.setMatrixAt(placed, tmp.matrix);
    treeColor.setHSL(0.34 + (rand() - 0.5) * 0.025, 0.38, 0.16 + rand() * 0.08);
    foliage.setColorAt(placed, treeColor);

    tmp.position.set(x, 0.72 * scale, z);
    tmp.updateMatrix();
    trunks.setMatrixAt(placed, tmp.matrix);
    trunkColor.setHSL(0.08, 0.34, 0.18 + rand() * 0.06);
    trunks.setColorAt(placed, trunkColor);
    placed++;
  }
  foliage.instanceMatrix.needsUpdate = true;
  trunks.instanceMatrix.needsUpdate = true;
  if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
  if (trunks.instanceColor) trunks.instanceColor.needsUpdate = true;
  foliage.computeBoundingSphere();
  trunks.computeBoundingSphere();
  group.add(foliage, trunks);

  const rockCount = 22;
  const rocks = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(1.25, 0),
    new THREE.MeshLambertMaterial({ color: 0x6b6873, flatShading: true }),
    rockCount,
  );
  for (let i = 0; i < rockCount; i++) {
    const angle = rand() * Math.PI * 2;
    const radial = 76 + rand() * 75;
    const scale = 0.65 + rand() * 1.8;
    tmp.position.set(Math.cos(angle) * radial, scale * 0.55, Math.sin(angle) * radial);
    tmp.rotation.set(rand(), rand() * Math.PI, rand() * 0.35);
    tmp.scale.set(scale * 1.3, scale * 0.75, scale);
    tmp.updateMatrix();
    rocks.setMatrixAt(i, tmp.matrix);
  }
  rocks.instanceMatrix.needsUpdate = true;
  rocks.computeBoundingSphere();
  group.add(rocks);
}

export function addEnvironmentScenery(scene, track, env, rand) {
  const group = new THREE.Group();
  group.name = 'low-poly-scenery';
  group.add(skyDome(env));
  addMountains(group, env, rand);
  addTreesAndRocks(group, track, rand);
  scene.add(group);
  return group;
}
