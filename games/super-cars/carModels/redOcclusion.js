import { redOcclusion } from './redOcclusionData.js';

// Bind the offline bake to the exact mesh so edits cannot silently use old shading.
export function redGeometrySignature(geometry) {
  let hash=2166136261;
  for(const value of geometry.attributes.position.array)hash=Math.imul(hash^Math.round(value*1e6),16777619)>>>0;
  return hash.toString(16);
}
export function applyRedOcclusion(geometry) {
  const colors=geometry.attributes.color;
  if(redOcclusion.signature!==redGeometrySignature(geometry)||redOcclusion.factors.length!==colors.count) {
    throw new Error('Red car occlusion is stale. Run node games/super-cars/dev/bake-red-occlusion.mjs');
  }
  for(let i=0;i<colors.count;i++){
    const factor=redOcclusion.factors[i];
    colors.setXYZ(i,colors.getX(i)*factor,colors.getY(i)*factor,colors.getZ(i)*factor);
  }
  colors.needsUpdate=true;
}
