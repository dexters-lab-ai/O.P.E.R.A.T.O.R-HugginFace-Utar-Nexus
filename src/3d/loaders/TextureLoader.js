import { TextureLoader as ThreeTextureLoader } from 'https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.module.js';

export class TextureLoader extends ThreeTextureLoader {
  constructor(manager) {
    super(manager);
  }
}
