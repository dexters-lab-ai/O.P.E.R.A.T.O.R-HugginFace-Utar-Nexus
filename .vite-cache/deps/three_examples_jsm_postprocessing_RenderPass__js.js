import {
  Pass
} from "./chunk-E5FRHPIL.js";
import {
  Color
} from "./chunk-MYETRLG2.js";
import "./chunk-BUSYA2B4.js";

// node_modules/three/examples/jsm/postprocessing/RenderPass.js
var RenderPass = class extends Pass {
  /**
   * Constructs a new render pass.
   *
   * @param {Scene} scene - The scene to render.
   * @param {Camera} camera - The camera.
   * @param {?Material} [overrideMaterial=null] - The override material. If set, this material is used
   * for all objects in the scene.
   * @param {?(number|Color|string)} [clearColor=null] - The clear color of the render pass.
   * @param {?number} [clearAlpha=null] - The clear alpha of the render pass.
   */
  constructor(scene, camera, overrideMaterial = null, clearColor = null, clearAlpha = null) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.overrideMaterial = overrideMaterial;
    this.clearColor = clearColor;
    this.clearAlpha = clearAlpha;
    this.clear = true;
    this.clearDepth = false;
    this.needsSwap = false;
    this._oldClearColor = new Color();
  }
  /**
   * Performs a beauty pass with the configured scene and camera.
   *
   * @param {WebGLRenderer} renderer - The renderer.
   * @param {WebGLRenderTarget} writeBuffer - The write buffer. This buffer is intended as the rendering
   * destination for the pass.
   * @param {WebGLRenderTarget} readBuffer - The read buffer. The pass can access the result from the
   * previous pass from this buffer.
   * @param {number} deltaTime - The delta time in seconds.
   * @param {boolean} maskActive - Whether masking is active or not.
   */
  render(renderer, writeBuffer, readBuffer) {
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    let oldClearAlpha, oldOverrideMaterial;
    if (this.overrideMaterial !== null) {
      oldOverrideMaterial = this.scene.overrideMaterial;
      this.scene.overrideMaterial = this.overrideMaterial;
    }
    if (this.clearColor !== null) {
      renderer.getClearColor(this._oldClearColor);
      renderer.setClearColor(this.clearColor, renderer.getClearAlpha());
    }
    if (this.clearAlpha !== null) {
      oldClearAlpha = renderer.getClearAlpha();
      renderer.setClearAlpha(this.clearAlpha);
    }
    if (this.clearDepth == true) {
      renderer.clearDepth();
    }
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    if (this.clear === true) {
      renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
    }
    renderer.render(this.scene, this.camera);
    if (this.clearColor !== null) {
      renderer.setClearColor(this._oldClearColor);
    }
    if (this.clearAlpha !== null) {
      renderer.setClearAlpha(oldClearAlpha);
    }
    if (this.overrideMaterial !== null) {
      this.scene.overrideMaterial = oldOverrideMaterial;
    }
    renderer.autoClear = oldAutoClear;
  }
};
export {
  RenderPass
};
//# sourceMappingURL=three_examples_jsm_postprocessing_RenderPass__js.js.map
