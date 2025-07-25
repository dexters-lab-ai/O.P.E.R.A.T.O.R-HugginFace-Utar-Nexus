import {
  FullScreenQuad,
  Pass
} from "./chunk-XFRWWYNP.js";
import {
  ShaderMaterial,
  UniformsUtils
} from "./chunk-FV24Y4CC.js";

// node_modules/three/examples/jsm/postprocessing/ShaderPass.js
var ShaderPass = class extends Pass {
  /**
   * Constructs a new shader pass.
   *
   * @param {Object|ShaderMaterial} [shader] - A shader object holding vertex and fragment shader as well as
   * defines and uniforms. It's also valid to pass a custom shader material.
   * @param {string} [textureID='tDiffuse'] - The name of the texture uniform that should sample
   * the read buffer.
   */
  constructor(shader, textureID = "tDiffuse") {
    super();
    this.textureID = textureID;
    this.uniforms = null;
    this.material = null;
    if (shader instanceof ShaderMaterial) {
      this.uniforms = shader.uniforms;
      this.material = shader;
    } else if (shader) {
      this.uniforms = UniformsUtils.clone(shader.uniforms);
      this.material = new ShaderMaterial({
        name: shader.name !== void 0 ? shader.name : "unspecified",
        defines: Object.assign({}, shader.defines),
        uniforms: this.uniforms,
        vertexShader: shader.vertexShader,
        fragmentShader: shader.fragmentShader
      });
    }
    this._fsQuad = new FullScreenQuad(this.material);
  }
  /**
   * Performs the shader pass.
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
    if (this.uniforms[this.textureID]) {
      this.uniforms[this.textureID].value = readBuffer.texture;
    }
    this._fsQuad.material = this.material;
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this._fsQuad.render(renderer);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
      this._fsQuad.render(renderer);
    }
  }
  /**
   * Frees the GPU-related resources allocated by this instance. Call this
   * method whenever the pass is no longer used in your app.
   */
  dispose() {
    this.material.dispose();
    this._fsQuad.dispose();
  }
};

export {
  ShaderPass
};
//# sourceMappingURL=chunk-QAIA5QJX.js.map
