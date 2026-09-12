// Subtle HDR light bloom, used by both the game and the single-view inspector.
// Only radiance above 1.5 blooms; ordinary paint and rival lamps stay crisp.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
export function createCarPresentation(renderer){
 renderer.info.autoReset=false;
 const composer=new EffectComposer(renderer);
 const pass=new RenderPass(new THREE.Scene(),new THREE.PerspectiveCamera());
 composer.addPass(pass);
 composer.addPass(new UnrealBloomPass(new THREE.Vector2(512,512),.20,.25,1.5));
 composer.addPass(new OutputPass());
 let width=0,height=0;
 return {
  render(scene,camera){
   const size=renderer.getSize(new THREE.Vector2());
   if(size.x!==width||size.y!==height){width=size.x;height=size.y;composer.setSize(width,height);}
   renderer.info.reset();
   pass.scene=scene;pass.camera=camera;composer.render();
  },
  dispose(){for(const pass of composer.passes)pass.dispose?.();composer.dispose();},
 };
}
