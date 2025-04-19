import { TextureLoader as ThreeTextureLoader } from 'https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.module.js';

export class TextureLoader extends ThreeTextureLoader {
  constructor(manager) {
    super(manager);
    this.setPath('/models/textures/');
  }
  
  load(url, onLoad, onProgress, onError) {
    // Add cache busting for development
    const finalUrl = process.env.NODE_ENV === 'development' 
      ? `${url}?v=${Date.now()}` 
      : url;
    
    return super.load(finalUrl, onLoad, onProgress, onError);
  }
}
