import * as THREE from 'three';
import { GLTFLoader } from './loaders/GLTFLoader.js';
import { DRACOLoader } from './loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GammaCorrectionShader } from 'three/examples/jsm/shaders/GammaCorrectionShader.js';
import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';

// Baked room shaders
const BAKED_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BAKED_FRAGMENT_SHADER = `
uniform sampler2D uBakedDayTexture;
uniform sampler2D uBakedNightTexture;
uniform sampler2D uBakedNeutralTexture;
uniform sampler2D uLightMapTexture;
uniform float uNightMix;
uniform float uNeutralMix;
uniform vec3 uLightTvColor;
uniform float uLightTvStrength;
uniform vec3 uLightDeskColor;
uniform float uLightDeskStrength;
uniform vec3 uLightPcColor;
uniform float uLightPcStrength;
varying vec2 vUv;
void main() {
    vec3 day = texture2D(uBakedDayTexture, vUv).rgb;
    vec3 night = texture2D(uBakedNightTexture, vUv).rgb;
    vec3 neutral = texture2D(uBakedNeutralTexture, vUv).rgb;
    vec3 color = mix(mix(day, night, uNightMix), neutral, uNeutralMix);
    vec3 lm = texture2D(uLightMapTexture, vUv).rgb;

    // TV lighten blend
    float tvStr = lm.r * uLightTvStrength;
    vec3 ltTv = max(color, uLightTvColor);
    color = mix(color, ltTv, tvStr);

    // PC lighten blend
    float pcStr = lm.b * uLightPcStrength;
    vec3 ltPc = max(color, uLightPcColor);
    color = mix(color, ltPc, pcStr);

    // Desk lighten blend
    float deskStr = lm.g * uLightDeskStrength;
    vec3 ltDesk = max(color, uLightDeskColor);
    color = mix(color, ltDesk, deskStr);

    gl_FragColor = vec4(color, 1.0);
}
`;

const MODEL_PATHS = {
  room: { primary: '/models/roomModel.glb', fallback: '/models/room-low.glb' },
  // ... other paths
};

export default class RoomExperience {
  constructor(props = {}) {
    // Initialize loadingManager, textureLoader, dracoLoader, gltfLoader
    this.props = props;
    this.loadingManager = new THREE.LoadingManager();
    this.textureLoader = new THREE.TextureLoader(this.loadingManager);
    this.textureLoader.crossOrigin = 'anonymous';
    this.dracoLoader = new DRACOLoader(this.loadingManager);
    this.dracoLoader.setDecoderPath('/draco/');
    this.dracoLoader.setDecoderConfig({ type: 'wasm' });
    this.gltfLoader = new GLTFLoader(this.loadingManager);
    this.gltfLoader.setDRACOLoader(this.dracoLoader);

    // Prepare core members
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.composer = null;
    this.controls = null;

    // Bind methods
    this.initialize = this.initialize.bind(this);
    this.loadGLB = this.loadGLB.bind(this);
    this.handleResize = this.handleResize.bind(this);
    // bind interaction methods and state
    this.isTransitioning = false;
    this.isAppLaunched = false;
    this.transitionDuration = this.props.transitionDuration || 2000;
    this.addScreenInteraction = this.addScreenInteraction.bind(this);
    this.disableControls = this.disableControls.bind(this);
    this.enableControls = this.enableControls.bind(this);
    this.moveToComputer = this.moveToComputer.bind(this);
    this.moveToScreen = this.moveToScreen.bind(this);
    this.launchApplication = this.launchApplication.bind(this);
    this.exitApplication = this.exitApplication.bind(this);
    this.moveToInitialPosition = this.moveToInitialPosition.bind(this);
  }

  async initialize() {
    const { container = document.body, transitionDuration = 2000, enableOrbitControls = true, initialState = null } = this.props;
    console.log('[Room] Initializing with props:', this.props);
    let canvasContainer = container;
    if (typeof canvasContainer === 'string') canvasContainer = document.querySelector(canvasContainer);
    if (!canvasContainer) throw new Error('Container element is required');
    eventBus.emit('room-loading-start');
    this.setupRenderer(canvasContainer);
    if (enableOrbitControls) {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
    }
    window.addEventListener('resize', this.handleResize);
    this.handleResize();
    await Promise.all([this.loadEnvironment(), this.loadMainModel()]);
    this.setupLighting();
    this.setupPostProcessing();
    this.finishLoadingUI();
    if (this.computerScreen) this.addScreenInteraction();
    this.startAnimationLoop();
  }

  setupRenderer(container) {
    // Core renderer, scene, and camera setup
    this.scene = new THREE.Scene();
    const containerEl = container || document.body;
    this.camera = new THREE.PerspectiveCamera(60, containerEl.clientWidth / containerEl.clientHeight, 0.1, 100);
    this.camera.position.copy(this.props.initialCameraPosition || new THREE.Vector3(0, 1.6, 3));
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    this.renderer.physicallyCorrectLights = true;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.props.toneMappingExposure || 1.3;
    this.renderer.setSize(containerEl.clientWidth, containerEl.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    containerEl.appendChild(this.renderer.domElement);
  }

  async loadEnvironment() {
    // If custom background image is provided, use it
    if (this.props.backgroundImage) {
      try {
        const bgTexture = await this.textureLoader.loadAsync(this.props.backgroundImage);
        this.scene.background = bgTexture;
        console.log('[ENV] Background image loaded:', this.props.backgroundImage);
      } catch (err) {
        console.error('[ENV] Failed to load background image:', err);
      }
      return;
    }
    try {
      const rgbeLoader = new RGBELoader(this.loadingManager);
      const hdrPath = this.props.hdrPath || 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/venice_sunset_1k.hdr';
      const hdrTexture = await rgbeLoader.loadAsync(hdrPath);
      hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
      const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
      pmremGenerator.compileEquirectangularShader();
      this.scene.environment = pmremGenerator.fromEquirectangular(hdrTexture).texture;
      this.scene.background = this.scene.environment;
      hdrTexture.dispose();
      console.log('[ENV] Environment map loaded successfully');
    } catch (error) {
      console.error('[ENV] Failed to load environment map:', error);
      this.scene.environment = new THREE.Color(0x111111);
    }
  }

  async loadMainModel() {
    console.group('[Model] Loading Main Room');
    try {
      this.room = await this.loadGLB(MODEL_PATHS.room.primary, 'Room');
      if (this.room) {
        this.scene.add(this.room);
        console.log('[Model] Room added to scene');
        console.log('[Model] Child mesh names:');
        this.room.traverse(child => console.log(`  ${child.name} (${child.type})`));
        // Load Bruno’s baked textures
        const bakedDayTex = await this.textureLoader.loadAsync('/models/textures/bakedDay.jpg');
        bakedDayTex.encoding = THREE.sRGBEncoding;
        bakedDayTex.flipY = false;
        const lightMapTex = await this.textureLoader.loadAsync('/models/textures/lightMap.jpg');
        lightMapTex.encoding = THREE.sRGBEncoding;
        lightMapTex.flipY = false;
        // Apply PBR or baked lighting based on metalness
        this.room.traverse(child => {
          if (!child.isMesh) return;
          const origMat = child.material;
          // Metal: restore original PBR with environment reflections
          if (origMat.metalness > 0.1) {
            const pbrMat = origMat.clone ? origMat.clone() : new THREE.MeshStandardMaterial();
            pbrMat.envMap = this.scene.environment;
            pbrMat.envMapIntensity = 1;
            pbrMat.needsUpdate = true;
            child.material = pbrMat;
          } else {
            // Non-metal: apply baked Day and lightMap on PBR
            const mat = origMat.clone ? origMat.clone() : new THREE.MeshStandardMaterial();
            mat.map = bakedDayTex;
            mat.lightMap = lightMapTex;
            mat.lightMapIntensity = 1;
            mat.envMap = this.scene.environment;
            mat.envMapIntensity = 1;
            mat.metalness = origMat.metalness !== undefined ? origMat.metalness : 0;
            mat.roughness = origMat.roughness !== undefined ? origMat.roughness : 1;
            mat.needsUpdate = true;
            child.material = mat;
          }
        });
        console.log('[Model] PBR materials restored with baked maps');
        // detect computer screen mesh
        this.room.traverse(child => {
          if (child.isMesh && /screen/i.test(child.name)) {
            this.computerScreen = child;
          }
        });
        if (!this.computerScreen) console.warn('[Model] No computerScreen mesh found');
      }
    } catch (error) {
      console.error('[Model] Failed to load room:', error);
      throw error;
    } finally {
      console.groupEnd();
    }
  }

  setupLighting() {
    // Remove old lights
    this.scene.traverse(obj => { if (obj.isLight) this.scene.remove(obj); });
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);
    // Main directional light
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(5, 5, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    this.scene.add(dirLight);
    // Point lights
    const p1 = new THREE.PointLight(0x3498db, 0.8, 5);
    p1.position.set(-1, 2, 1);
    this.scene.add(p1);
    const p2 = new THREE.PointLight(0xe74c3c, 0.8, 5);
    p2.position.set(2, 1, -1);
    this.scene.add(p2);
    console.log('[Lighting] Setup complete');
  }

  setupPostProcessing() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(
      this.props.container.clientWidth,
      this.props.container.clientHeight
    ), 0.3, 0.4, 0.85);
    this.composer.addPass(this.bloomPass);
    this.gammaPass = new ShaderPass(GammaCorrectionShader);
    this.composer.addPass(this.gammaPass);
    console.log('[Post] EffectComposer with Bloom and GammaCorrection ready');
  }

  finishLoadingUI() {
    const splash = document.getElementById('splash-screen');
    const loader = document.getElementById('app-loader');
    const webgl = this.props.container instanceof HTMLElement
      ? this.props.container
      : document.getElementById('webgl-container');
    if (splash) {
      splash.style.opacity = '0';
      splash.style.pointerEvents = 'none';
      setTimeout(() => { splash.style.display = 'none'; }, 600);
      console.log('[UI] Splash screen hidden');
    }
    if (loader) {
      loader.style.opacity = '0';
      loader.style.pointerEvents = 'none';
      setTimeout(() => { loader.style.display = 'none'; }, 600);
      console.log('[UI] Loader hidden');
    }
    if (webgl) {
      webgl.style.opacity = '1';
      webgl.style.pointerEvents = 'auto';
      webgl.style.display = 'block';
      console.log('[UI] 3D room container shown');
    }
  }

  async loadGLB(path, name) {
    console.group(`[Model] loadGLB: ${name}`);
    try {
      const res = await fetch(path, { method: 'HEAD' });
      if (res.ok) {
        console.log(`[Model] Loading ${name} from: ${path}`);
        const gltf = await this.gltfLoader.loadAsync(path);
        return gltf.scene;
      }
      const fallback = MODEL_PATHS[name]?.fallback;
      console.warn(`[Model] Primary ${name} not found, trying fallback: ${fallback}`);
      const res2 = await fetch(fallback, { method: 'HEAD' });
      if (res2.ok) {
        console.log(`[Model] Loaded ${name} from fallback: ${fallback}`);
        const gltf2 = await this.gltfLoader.loadAsync(fallback);
        return gltf2.scene;
      }
      throw new Error(`Both sources failed for ${name}`);
    } catch (error) {
      console.error(`[Model] Failed to load ${name}:`, error);
      return null;
    } finally {
      console.groupEnd();
    }
  }

  async loadModels() {
    console.groupCollapsed('[Models] Loading accessories');
    for (const model of MODEL_PATHS.accessories) {
      const mesh = await this.loadGLB(model.primary, 'Accessory');
      if (mesh) this.scene.add(mesh);
    }
    console.groupEnd();
  }

  async verifyModel(gltf) {
    console.group('[Verify] Model');
    try {
      // Basic checks: ensure scene and children exist
      const valid = gltf && gltf.scene && gltf.scene.children;
      console.log('[Verify] Model valid structure:', Boolean(valid));
      return Boolean(valid);
    } catch (err) {
      console.error('[Verify] Error during verification:', err);
      return false;
    } finally {
      console.groupEnd();
    }
  }

  dispose() {
    window.removeEventListener('resize', this.handleResize);
    this.scene.traverse(obj => {
      if (obj.isMesh) {
        obj.geometry.dispose();
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    });
    if (this.renderer && this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
    if (this.renderer) this.renderer.dispose();
  }

  startAnimationLoop() {
    const clock = new THREE.Clock();
    let frameCount = 0;
    const animate = () => {
      requestAnimationFrame(animate);
      if (this.mixer) this.mixer.update(clock.getDelta());
      if (this.controls && this.controls.update) this.controls.update();
      try {
        if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
      } catch (err) {
        console.error('[RENDER] Error:', err);
      }
      frameCount++;
    };
    animate();
  }

  handleResize() {
    const container = this.props.container || document.body;
    const width = container.clientWidth;
    const height = container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    if (this.composer) this.composer.setSize(width, height);
  }

  /**
   * Add click interaction to the computer screen
   */
  addScreenInteraction() {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    this.renderer.domElement.addEventListener('click', (event) => {
      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, this.camera);
      const intersects = raycaster.intersectObject(this.computerScreen, true);
      if (intersects.length > 0) {
        if (!this.isAppLaunched) {
          this.moveToScreen();
        } else {
          this.exitApplication();
        }
      }
    });
  }

  /**
   * Disable orbit controls
   */
  disableControls() {
    if (this.controls) this.controls.enabled = false;
  }

  /**
   * Enable orbit controls
   */
  enableControls() {
    if (this.controls) this.controls.enabled = true;
  }

  /**
   * Move camera to view the computer
   */
  moveToComputer() {
    if (this.isTransitioning) return;
    this.disableControls();
    this.isTransitioning = true;
    this.animateCamera(
      this.props.cameraPositions.computer,
      new THREE.Vector3(0, 1.1, 0),
      this.transitionDuration,
      () => {
        this.isTransitioning = false;
        eventBus.emit('camera-at-computer');
      }
    );
  }

  /**
   * Move camera closer to the screen
   */
  moveToScreen() {
    if (this.isTransitioning) return;
    this.disableControls();
    this.isTransitioning = true;
    this.animateCamera(
      this.props.cameraPositions.screen,
      new THREE.Vector3(0, 1.1, 0),
      this.transitionDuration,
      () => {
        this.isTransitioning = false;
        this.launchApplication();
      }
    );
  }

  /**
   * Launch the OPERATOR application
   */
  launchApplication() {
    this.isAppLaunched = true;
    this.showLoadingAnimation && this.showLoadingAnimation();
    eventBus.emit('launch-application');
    this.fadeOut && this.fadeOut();
  }

  /**
   * Exit the OPERATOR application and return to room view
   */
  exitApplication() {
    this.isAppLaunched = false;
    this.fadeIn && this.fadeIn();
    this.moveToInitialPosition();
    eventBus.emit('exit-application');
  }

  /**
   * Move camera back to its initial position
   */
  moveToInitialPosition() {
    if (this.isTransitioning) return;
    this.isTransitioning = true;
    this.animateCamera(
      this.props.cameraPositions.initial,
      new THREE.Vector3(0, 1, 0),
      this.transitionDuration,
      () => {
        this.isTransitioning = false;
        this.enableControls();
        eventBus.emit('camera-at-initial-position');
      }
    );
  }

  /**
   * Animate camera movement
   */
  animateCamera(targetPosition, targetLookAt, duration, callback) {
    const startPosition = this.camera.position.clone();
    const startLookAt = this.controls?.target.clone() || new THREE.Vector3();
    const clockStart = Date.now();
    const easeInOutCubic = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
    const currentTarget = startLookAt.clone();
    const update = () => {
      const elapsed = Date.now() - clockStart;
      const t = Math.min(elapsed / duration, 1);
      const ease = easeInOutCubic(t);
      this.camera.position.lerpVectors(startPosition, targetPosition, ease);
      currentTarget.lerpVectors(startLookAt, targetLookAt, ease);
      this.camera.lookAt(currentTarget);
      if (this.controls) {
        this.controls.target.copy(currentTarget);
        this.controls.update();
      }
      if (t < 1) requestAnimationFrame(update);
      else if (callback) callback();
    };
    update();
  }

  /**
   * Fade out the 3D view
   */
  fadeOut(callback) {
    const el = this.renderer.domElement;
    el.style.transition = 'opacity 0.5s';
    el.style.opacity = '0';
    el.addEventListener('transitionend', () => callback && callback(), { once: true });
  }

  /**
   * Fade in the 3D view
   */
  fadeIn(callback) {
    const el = this.renderer.domElement;
    el.style.transition = 'opacity 0.5s';
    el.style.opacity = '1';
    el.addEventListener('transitionend', () => callback && callback(), { once: true });
  }
}

// Helper to create and initialize
export async function createRoomExperience(props = {}) {
  const exp = new RoomExperience(props);
  await exp.initialize();
  return exp;
}
