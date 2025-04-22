import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export default class Screen {
  constructor(mesh, videoPath, scene) {
    this.mesh = mesh;
    this.videoPath = videoPath;
    this.scene = scene; // Store scene reference
    this.video = null;
    this.material = null;
    this.texture = null;
    this.initialized = false;
    this.init();
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;
    // Ensure video texture renders behind other objects
    this.mesh.renderOrder = 0;
    this.mesh.material.depthWrite = true;
    this.mesh.material.depthTest = true;

    // Video setup (Bruno's exact parameters)
    this.video = document.createElement('video');
    this.video.src = this.videoPath;
    this.video.muted = true;
    this.video.loop = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
    this.video.crossOrigin = 'anonymous';
    this.video.style.display = 'none';
    document.body.appendChild(this.video);
    this.video.play();

    // Material setup
    this.texture = new THREE.VideoTexture(this.video);
    this.texture.encoding = THREE.sRGBEncoding;
    this.mesh.material.map = this.texture;

    // Force depth buffer update
    this.mesh.material.needsUpdate = true;
    this.scene.add(this.mesh);
  }

  dispose() {
    if (this.video) {
      this.video.pause();
      this.video.src = '';
      if (this.video.parentNode) {
        this.video.parentNode.removeChild(this.video);
      }
      this.video = null;
    }
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
    if (this.mesh && this.mesh.material && this.mesh.material.map) {
      this.mesh.material.map = null;
      this.mesh.material.needsUpdate = true;
    }
    if (this.scene && this.mesh) {
      this.scene.remove(this.mesh);
    }
    this.initialized = false;
  }
}