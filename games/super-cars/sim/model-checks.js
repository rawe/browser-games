// Rendering-contract checks; run without a browser or WebGL context.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSupercarMesh } from '../carModel.js';

for (const type of ['roter-keil', 'magenta-fluegel', 'cyan-puls']) {
  const model = createSupercarMesh({ color: 0xff4b3a, type });
  const bounds = new THREE.Box3();
  let triangles = 0;
  for (const part of model.children.slice(1)) {
    bounds.union(new THREE.Box3().setFromObject(part));
    for (const attribute of Object.values(part.geometry.attributes)) {
      assert.ok(Array.from(attribute.array).every(Number.isFinite), `${type}: non-finite geometry`);
    }
    triangles += (part.geometry.index?.count ?? part.geometry.attributes.position.count) / 3 * (part.count ?? 1);
  }
  const size = bounds.getSize(new THREE.Vector3());
  assert.ok(size.x <= 4.601 && size.y <= 1.481 && size.z <= 2.201, `${type}: vehicle exceeds camera/physics envelope`);
  assert.ok(Math.abs(bounds.min.y) < 1e-5, `${type}: tires must touch ground`);
  assert.ok(Math.abs(bounds.min.z + bounds.max.z) < 1e-5, `${type}: asymmetric body envelope`);
  assert.ok(triangles < 8000, `${type}: triangle budget exceeded`);
  assert.equal(new Set(model.children.slice(1).map(p => p.material)).size, 6);
  const tires = model.children[5], rims = model.children[6];
  for(let i=0;i<4;i++) {
    const matrix=new THREE.Matrix4(); rims.getMatrixAt(i,matrix);
    const center=new THREE.Vector3().setFromMatrixPosition(matrix);
    const outward=new THREE.Vector3(0,0,1).transformDirection(matrix);
    assert.ok(outward.z * center.z > 0, `${type}: rim faces into tire`);
    const tireMatrix=new THREE.Matrix4(); tires.getMatrixAt(i,tireMatrix);
    assert.deepEqual(matrix.elements,tireMatrix.elements);
  }
  console.log(`${type}: ${triangles} triangles; ${size.toArray().map(n=>n.toFixed(3)).join(' × ')}; passed`);
}
// The seven rival colors must select all intended vehicle families.
const wing = createSupercarMesh({color:0xff5ca8});
assert.equal(wing.children[1].geometry,createSupercarMesh({color:0x3d7bff}).children[1].geometry);
assert.notEqual(wing.children[1].geometry,createSupercarMesh({color:0x2ad4c8}).children[1].geometry);
assert.notEqual(wing.children[1].geometry,createSupercarMesh({color:0xff5ca8,isPlayer:true}).children[1].geometry);
console.log('Vehicle assignment and shared geometry cache: passed');
