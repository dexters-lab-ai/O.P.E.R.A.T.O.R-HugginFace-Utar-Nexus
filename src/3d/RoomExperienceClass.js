import * as THREE from 'three';
import { GLTFLoader } from '/vendors/three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from '/vendors/three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from '/vendors/three/examples/jsm/controls/OrbitControls.js';
import { RGBELoader } from '/vendors/three/examples/jsm/loaders/RGBELoader.js';
import { EffectComposer } from '/vendors/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '/vendors/three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '/vendors/three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GammaCorrectionShader } from '/vendors/three/examples/jsm/shaders/GammaCorrectionShader.js';
import { ShaderPass } from '/vendors/three/examples/jsm/postprocessing/ShaderPass.js';
import { gsap } from 'gsap';
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
  googleLeds: { primary: '/models/googleHomeLedsModel.glb', fallback: '/models/googleHomeLeds-low.glb' },
  loupedeck: { primary: '/models/loupedeckButtonsModel.glb', fallback: '/models/loupedeckButtons-low.glb' },
  topChair: { primary: '/models/topChairModel.glb', fallback: '/models/topChair-low.glb' },
  elgatoLight: { primary: '/models/elgatoLightModel.glb', fallback: '/models/elgatoLight-low.glb' },
  pcScreen: { primary: '/models/pcScreenModel.glb', fallback: '/models/pcScreen-low.glb' },
  macScreen: { primary: '/models/macScreenModel.glb', fallback: '/models/macScreen-low.glb' }
};

export default class RoomExperience {
  constructor(props = {}) {
    this.props = {
      assetPaths: {
        room: '/models/roomModel.glb',  // Note: removed 'public/' since it's served from root
        googleLeds: '/models/googleHomeLedsModel.glb',
        loupedeck: '/models/loupedeckButtonsModel.glb',
        topChair: '/models/topChairModel.glb',
        elgatoLight: '/models/elgatoLightModel.glb',
        pcScreen: '/models/pcScreenModel.glb',
        macScreen: '/models/macScreenModel.glb',
        bakedDay: '/models/textures/bakedDay.jpg',
        bakedNight: '/models/textures/bakedNight.jpg',
        bakedNeutral: '/models/textures/bakedNeutral.jpg',
        lightMap: '/models/textures/lightMap.jpg',
        googleLedMask: '/bruno_demo_temp/static/assets/googleHomeLedMask.png'
      },
      ...props
    };
    
    // Initialize loadingManager, textureLoader, dracoLoader, gltfLoader
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
      this.controls.minPolarAngle = 0.2;
      this.controls.maxPolarAngle = Math.PI / 2.2;
      this.controls.screenSpacePanning = true;
      this.controls.enableKeys = false;
      this.controls.zoomSpeed = 0.25;
    }
    window.addEventListener('resize', this.handleResize);
    this.handleResize();
    
    // Create container that will always exist
    this.roomContainer = new THREE.Group();
    this.roomContainer.name = 'RoomContainer';
    this.scene.add(this.roomContainer);
    
    // Initialize empty arrays for dynamic elements
    this.accentLights = [];
    this.interactiveElements = [];
    
    // Basic lighting from baked maps; disable additional base lights
    // this.setupBaseLighting();
    
    // Then load models and setup model-dependent lighting
    this.loadMainModel().then(() => {
      this.setupAccentLights();
      this.finishLoadingUI();
      this.startAnimationLoop();
    }).catch(error => {
      console.error('Model loading failed:', error);
      this.finishLoadingUI();
    });
    
    // Load environment and setup post-processing
    this.loadEnvironment();
    this.setupPostProcessing();
  }

  setupRenderer(container) {
    // Core renderer, scene, and camera setup
    this.scene = new THREE.Scene();
    const containerEl = container || document.body;
    this.camera = new THREE.PerspectiveCamera(60, containerEl.clientWidth / containerEl.clientHeight, 0.1, 100);
    this.camera.position.copy(this.props.initialCameraPosition || new THREE.Vector3(30, 20, 30));
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    this.renderer.physicallyCorrectLights = false;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.setClearColor(0x010101, 1);
    this.renderer.setSize(containerEl.clientWidth, containerEl.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    containerEl.appendChild(this.renderer.domElement);
    this.initializeCamera();
  }

  initializeCamera() {
    // Start higher (1.8m ~ eye level) and further back (5m)
    this.camera.position.set(0, 1.8, 5);
    this.camera.lookAt(0, 1.5, 0); // Look slightly downward
    this.camera.fov = 45;
    this.camera.updateProjectionMatrix();
    
    // Lighting adjustments
    if (this.ambientLight) this.ambientLight.intensity = 0.8;
    if (this.directionalLight) this.directionalLight.intensity = 1.5;
  }

  async loadEnvironment() {
    const paths = [
      '/bruno_demo_temp/static/environment.hdr',
      '/models/environment.hdr'
    ];
    
    for (const path of paths) {
      try {
        const hdrEquirect = await new RGBELoader().loadAsync(path);
        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        pmremGenerator.compileEquirectangularShader();
        const envMap = pmremGenerator.fromEquirectangular(hdrEquirect).texture;
        
        // Apply to scene
        this.scene.environment = envMap;
        this.scene.background = envMap;
        
        // Cleanup
        hdrEquirect.dispose();
        pmremGenerator.dispose();
        console.log(`✅ Loaded HDR from ${path}`);
        return;
      } catch (err) {
        console.log(`❌ Failed HDR from ${path}`);
      }
    }
    
    // Fallback: background image
    try {
      const bgTex = await this.textureLoader.loadAsync('/bruno_demo_temp/static/assets/background.jpg');
      this.scene.background = bgTex;
      console.log('✅ Loaded background image from /bruno_demo_temp/static/assets/background.jpg');
      return;
    } catch (err) {
      console.log('❌ Failed to load background fallback');
    }
    
    // Neutral fallback
    this.scene.environment = new THREE.Color(0xeeeeee);
    this.scene.background = new THREE.Color(0xeeeeee);
    console.log('⚠️ Using fallback color environment');
  }

  async loadMainModel() {
    console.group('[Model] Loading Main Room');
    
    try {
      // Load main room
      const roomGLTF = await this.loadGLB('room');
      if (roomGLTF?.scene) {
        this.room = roomGLTF.scene;
        this.roomContainer.add(this.room);
        
        // Load textures
        const textures = await Promise.all([
          this.textureLoader.loadAsync('models/textures/bakedDay.jpg'),
          this.textureLoader.loadAsync('models/textures/bakedNight.jpg'),
          this.textureLoader.loadAsync('models/textures/bakedNeutral.jpg'),
          this.textureLoader.loadAsync('models/textures/lightMap.jpg')
        ]);
        
        this.applyBakedMaterials(...textures);
      }
      
      // Load interactive elements via dedicated loaders
      await Promise.all([
        this.loadGoogleLeds(),
        this.loadLoupedeck(),
        this.loadTopChair(),
        this.loadElgatoLight(),
        this.loadCoffeeSteam(),
        this.loadScreens()
      ]);
      
      this.setupAccentLights();
    } catch (error) {
      console.error('[Model] Failed to load:', error);
    } finally {
      console.groupEnd();
    }
  }

  async loadGLB(name) {
    // Exact filenames from our assets folder
    const modelMap = {
      room: 'roomModel',
      googleLeds: 'googleHomeLedsModel',
      loupedeck: 'loupedeckButtonsModel',
      topChair: 'topChairModel',
      elgatoLight: 'elgatoLightModel',
      pcScreen: 'pcScreenModel',
      macScreen: 'macScreenModel'
    };
    
    const paths = [
      // First try Bruno's exact assets
      `/bruno_demo_temp/static/assets/${modelMap[name]}.glb`,
      // Then try our models with same names
      `/assets/${modelMap[name]}.glb`,
      `/models/${modelMap[name]}.glb`
    ];
    
    for (const path of paths) {
      try {
        const gltf = await this.gltfLoader.loadAsync(path);
        console.log(`✅ Loaded ${name} from ${path}`);
        return gltf;
      } catch (err) {
        console.log(`❌ Failed ${name} from ${path}`);
      }
    }
    
    console.error(`💥 Could not load ${name}`);
    return null;
  }

  async loadGoogleLeds() {
    const gltf = await this.loadGLB('googleLeds');
    if (!gltf) return;
    
    this.googleLeds = gltf.scene;
    this.scene.add(this.googleLeds);
    
    const maskTexture = await this.textureLoader.loadAsync('/bruno_demo_temp/static/assets/googleHomeLedMask.png');
    this.googleLeds.traverse(child => {
      if (child.isMesh) {
        child.material = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          alphaMap: maskTexture,
          transparent: true
        });
      }
    });
  }

  async loadLoupedeck() {
    const gltf = await this.loadGLB('loupedeck');
    if (!gltf) return;
    
    this.loupedeck = gltf.scene;
    this.scene.add(this.loupedeck);
    
    // Find and store button meshes for animation
    this.loupedeckButtons = [];
    gltf.scene.traverse(child => {
      if (child.isMesh && child.name.includes('Button')) {
        this.loupedeckButtons.push(child);
      }
    });
  }

  async loadCoffeeSteam() {
    this.coffeeSteam = {
      particles: new THREE.Group(),
      count: 30,
      speed: 0.2
    };
    
    // Create particle system
    for (let i = 0; i < this.coffeeSteam.count; i++) {
      const particle = new THREE.Mesh(
        new THREE.SphereGeometry(0.02, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })
      );
      
      // Randomize initial position
      particle.position.set(
        Math.random() * 0.1 - 0.05,
        Math.random() * 0.1,
        Math.random() * 0.1 - 0.05
      );
      
      particle.userData = {
        speed: Math.random() * 0.1 + 0.05,
        offset: Math.random() * Math.PI * 2
      };
      
      this.coffeeSteam.particles.add(particle);
    }
    
    this.coffeeSteam.particles.position.set(0.5, 0.8, 0.3); // Above coffee cup
    this.scene.add(this.coffeeSteam.particles);
  }

  async loadElgatoLight() {
    const gltf = await this.loadGLB('elgatoLight');
    if (!gltf) return;
    
    this.elgatoLight = {
      group: gltf.scene,
      light: new THREE.SpotLight(0xffffff, 2, 5),
      target: new THREE.Object3D()
    };
    
    // Position light and target
    this.elgatoLight.light.position.set(0.5, 1.2, 0.3);
    this.elgatoLight.target.position.set(0.5, 0.8, 0.3);
    this.elgatoLight.light.target = this.elgatoLight.target;
    
    this.scene.add(this.elgatoLight.group);
    this.scene.add(this.elgatoLight.light);
    this.scene.add(this.elgatoLight.target);
    
    // Debug controls
    if (this.debug) {
      const folder = this.debug.addFolder('Elgato Light');
      folder.add(this.elgatoLight.light, 'intensity', 0, 5);
      folder.addColor(this.elgatoLight.light, 'color');
    }
  }

  async loadTopChair() {
    const gltf = await this.loadGLB('topChair');
    if (!gltf) return;
    
    this.topChair = {
      group: gltf.scene,
      swingSpeed: 0.5,
      swingAmount: 0.3
    };
    
    this.topChair.group.position.set(0.7, 0, 0.5);
    this.scene.add(this.topChair.group);
    
    // Setup physics pivot point
    this.topChair.pivot = new THREE.Group();
    this.topChair.pivot.position.copy(this.topChair.group.position);
    this.scene.add(this.topChair.pivot);
    this.topChair.group.position.set(0, -0.5, 0);
    this.topChair.pivot.add(this.topChair.group);
  }

  async loadBouncingLogo() {
    this.bouncingLogo = {
      mesh: new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 32, 32),
        new THREE.MeshStandardMaterial({ 
          color: 0x196aff,
          metalness: 0.3,
          roughness: 0.1
        })
      ),
      velocity: new THREE.Vector3(0, 0, 0),
      position: new THREE.Vector3(0.5, 2, 0.5)
    };
    
    this.bouncingLogo.mesh.position.copy(this.bouncingLogo.position);
    this.bouncingLogo.mesh.castShadow = true;
    this.scene.add(this.bouncingLogo.mesh);
  }

  async loadScreens() {
    try {
      // PC Screen
      const pcScreen = await this.loadGLB('pcScreen');
      
      // Mac Screen
      const macScreen = await this.loadGLB('macScreen');
      
      if (pcScreen) {
        this.pcScreen = pcScreen.scene;
        this.scene.add(this.pcScreen);
      }
      
      if (macScreen) {
        this.macScreen = macScreen.scene;
        this.scene.add(this.macScreen);
      }
      this.setupScreens();
    } catch (error) {
      console.error('[Model] Failed to load screens:', error);
    }
  }

  setupBaseLighting() {
    // Bruno's exact ambient light settings
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    this.scene.add(this.ambientLight);
    
    // Bruno's window light configuration
    const windowLight = new THREE.PointLight(0xffffff, 1.5, 6);
    windowLight.position.set(1.8, 1.8, -3.2);
    this.scene.add(windowLight);
    
    // Bruno's directional light setup
    this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.directionalLight.position.set(0.8, 1.5, 0.8);
    this.scene.add(this.directionalLight);
    
    // Configure renderer to match Bruno's settings
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
  }

  setupAccentLights() {
    if (!this.roomContainer) return;
    
    // Clear existing lights
    this.accentLights.forEach(light => {
      this.scene.remove(light);
      if (light.target) this.scene.remove(light.target);
    });
    this.accentLights = [];
    
    // More vibrant accent lights
    this.roomContainer.traverse(obj => {
      if (obj.isMesh && obj.name.includes('LightTarget')) {
        const light = new THREE.SpotLight(0xfff0c2, 1.0, 6, Math.PI * 0.15, 0.4);
        light.position.copy(obj.position);
        light.target = obj;
        
        if (obj.name.includes('Strong')) {
          light.intensity = 1.8; 
          light.color.setHex(0xffe699); 
          light.penumbra = 0.15;
        }
        
        this.scene.add(light);
        this.scene.add(light.target);
        this.accentLights.push(light);
      }
    });
  }

  applyBakedMaterials(bakedDayTex, bakedNightTex, bakedNeutralTex, lightMapTex) {
    bakedDayTex.flipY = false;
    bakedNightTex.flipY = false;
    bakedNeutralTex.flipY = false;
    lightMapTex.flipY = false;
    
    // More vibrant material settings
    this.room.traverse(child => {
      if (child.isMesh) {
        child.material = new THREE.MeshBasicMaterial({
          map: bakedDayTex,
          lightMap: lightMapTex,
          lightMapIntensity: 2.0, 
          toneMapped: false 
        });
      }
    });
  }

  setupPostProcessing() {
    // Create composer
    this.composer = new EffectComposer(this.renderer);
    
    // Add render pass
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    
    // Add bloom pass
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      1.5, // strength
      0.4, // radius
      0.85 // threshold
    );
    this.composer.addPass(bloomPass);
    
    // Add gamma correction
    this.composer.addPass(new ShaderPass(GammaCorrectionShader));
  }

  setupScreens() {
    // No screen emissive override; screens retain original materials
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

  startAnimationLoop() {
    const animate = () => {
      this._animationFrameId = requestAnimationFrame(animate);
      
      // Use composer instead of direct render
      this.composer.render();
      
      // Update controls if they exist
      if (this.controls) this.controls.update();
      
      // Google LEDs animation (TV 'DAIL' bouncing)
      if (this.googleLeds?.items) {
        const time = Date.now() * 0.002;
        this.googleLeds.items.forEach(item => {
          item.material.opacity = Math.sin(time - item.index * 0.5) * 0.5 + 0.5;
        });
      }
      
      // Coffee steam animation
      if (this.coffeeSteam?.particles) {
        const time = Date.now() * 0.001;
        this.coffeeSteam.particles.children.forEach(particle => {
          particle.position.y += particle.userData.speed * 0.02;
          particle.position.x += Math.sin(time + particle.userData.offset) * 0.01;
          
          // Reset particles that go too high
          if (particle.position.y > 0.3) {
            particle.position.set(
              Math.random() * 0.1 - 0.05,
              Math.random() * 0.05,
              Math.random() * 0.1 - 0.05
            );
          }
        });
      }
      
      // Top Chair physics
      if (this.topChair) {
        this.topChair.pivot.rotation.z = Math.sin(Date.now() * 0.001 * this.topChair.swingSpeed) * this.topChair.swingAmount;
      }
      
      // Bouncing Logo physics
      if (this.bouncingLogo) {
        // Apply gravity
        this.bouncingLogo.velocity.y -= 0.01;
        this.bouncingLogo.position.add(this.bouncingLogo.velocity);
        
        // Floor collision
        if (this.bouncingLogo.position.y < 0.1) {
          this.bouncingLogo.position.y = 0.1;
          this.bouncingLogo.velocity.y *= -0.8; // Bounce with energy loss
          this.bouncingLogo.velocity.x += (Math.random() - 0.5) * 0.02; // Random horizontal push
        }
        
        this.bouncingLogo.mesh.position.copy(this.bouncingLogo.position);
      }
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
    this.dispose();
    const root = document.querySelector('#react-root');
    if (root) root.style.display = 'block';
    window.mountApp('#react-root');
  }

  /**
   * Exit the OPERATOR application and return to room view
   */
  exitApplication() {
    this.isAppLaunched = false;
    this.fadeIn && this.fadeIn();
    this.moveToInitialPosition();
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

  playIntro() {
    this.controls.enabled = false;
    const tl = gsap.timeline({
      onComplete: () => {
        this.controls.enabled = true;
        this.showLaunchButton();
      }
    });
    const compMesh = this.scene.getObjectByName('pcScreenMesh');
    const compPos = compMesh ? compMesh.position.clone() : new THREE.Vector3();
    tl.to(this.camera.position, { x: compPos.x+2, y: compPos.y+2, z: compPos.z+5, duration: 2 });
    tl.to(this.controls.target, { x: compPos.x, y: compPos.y, z: compPos.z, duration: 2 }, '<');
  }

  showLaunchButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'launch-btn';
    btn.innerText = 'Launch O.P.E.R.A.T.O.R';
    Object.assign(btn.style, {
      position: 'absolute', bottom: '2rem', left: '50%', transform: 'translateX(-50%)',
      padding: '1rem 2rem', background: 'rgba(0,0,0,0.8)', color: '#0ff', border: '1px solid #0ff',
      borderRadius: '4px', cursor: 'pointer', zIndex: '10'
    });
    document.body.appendChild(btn);
    btn.addEventListener('click', () => this.launchApplication());
  }

  launchApplication() {
    this.controls.dispose();
    this.renderer.domElement.style.display = 'none';
    const root = document.querySelector('#react-root');
    if (root) root.style.display = 'block';
    window.mountApp('#react-root');
  }

  createVideoTexture(videoPath) {
    const video = document.createElement('video');
    video.src = videoPath;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.autoplay = true;
    video.play().catch(e => console.error('Video play failed:', e));
    
    const texture = new THREE.VideoTexture(video);
    texture.encoding = THREE.sRGBEncoding;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    
    return texture;
  }
}

// Helper to create and initialize
export async function createRoomExperience(props = {}) {
  const exp = new RoomExperience(props);
  await exp.initialize();
  return exp;
}
