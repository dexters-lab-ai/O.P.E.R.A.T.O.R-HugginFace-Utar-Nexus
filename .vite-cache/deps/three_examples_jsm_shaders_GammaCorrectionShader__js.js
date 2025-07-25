import "./chunk-BUSYA2B4.js";

// node_modules/three/examples/jsm/shaders/GammaCorrectionShader.js
var GammaCorrectionShader = {
  name: "GammaCorrectionShader",
  uniforms: {
    "tDiffuse": { value: null }
  },
  vertexShader: (
    /* glsl */
    `

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`
  ),
  fragmentShader: (
    /* glsl */
    `

		uniform sampler2D tDiffuse;

		varying vec2 vUv;

		void main() {

			vec4 tex = texture2D( tDiffuse, vUv );

			gl_FragColor = sRGBTransferOETF( tex );

		}`
  )
};
export {
  GammaCorrectionShader
};
//# sourceMappingURL=three_examples_jsm_shaders_GammaCorrectionShader__js.js.map
