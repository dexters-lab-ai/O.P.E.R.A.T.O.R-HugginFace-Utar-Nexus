/**
 * 3D Room Experience
 * Based on Bruno Simon's "My Room in 3D" project
 * https://github.com/brunosimon/my-room-in-3d
 * 
 * Creates an immersive 3D room entry experience for OPERATOR
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { TextureLoader } from './loaders/TextureLoader.js';
import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';

/**
 * Create a 3D room experience
 * @param {Object} props - Component properties
 * @returns {Object} Room experience instance with methods to control the experience
 */
export function RoomExperience(props = {}) {
  console.group('[Room] Constructor Verification');
  try {
    console.log('Container:', props.container);
    console.log('Options:', JSON.stringify(props));
    
    if (!props.container) {
      console.error('No container element provided');
      throw new Error('Container element required');
    }
    
    if (typeof props.container === 'string') {
      props.container = document.querySelector(props.container);
      if (!props.container) {
        console.error(`Container selector "${props.container}" not found`);
        throw new Error('Container selector not found');
      }
    } else if (!props.container.appendChild) {
      console.error('Invalid container element - missing appendChild method');
      throw new Error('Invalid container element');
    }
    
    console.log('Constructor validation passed');
  } finally {
    console.groupEnd();
  }
  
  console.group('[Room] Constructor');
  console.log('Initial props:', props);
  console.log('Container element:', props.container);
  console.log('Model path:', props.modelPath);
  console.groupEnd();

  const {
    container = document.body,
    modelPath = '/models/room.glb',
    transitionDuration = 2000,
    enableOrbitControls = true,
    initialState = null
  } = props;

  console.log('[Room] Initializing with props:', props);
  
  let modelPathValue = modelPath || '/models/room.glb';
  console.log('[Room] Model path:', modelPathValue);

  // Scene elements
  let scene;
  let camera;
  let renderer;
  let controls;
  let mixer;
  let clock;
  let roomModel;
  let computerScreen;
  let launchButton;
  
  // State
  let state = initialState || {
    cameraPosition: [0, 1.6, 3],
    cameraRotation: [0, 0, 0],
    computerViewed: false,
    objectsInteracted: []
  };
  let isInitialized = false;
  let isTransitioning = false;
  let isAppLaunched = false;
  let currentCameraTarget = new THREE.Vector3(0, 1, 0);
  let animations = [];
  
  // Animation targets
  const cameraPositions = {
    initial: new THREE.Vector3(2, 1.5, 2),
    computer: new THREE.Vector3(0.5, 1.2, 0.5),
    screen: new THREE.Vector3(0.2, 1.1, 0.3)
  };
  
  // Setup loaders
  const loadingManager = new THREE.LoadingManager(
    // Loaded
    () => {},
    
    // Progress
    (itemUrl, itemsLoaded, itemsTotal) => {
      const progressRatio = itemsLoaded / itemsTotal;
      eventBus.emit('room-loading-progress', { 
        progress: Math.round(progressRatio * 100) 
      });
    }
  );
  
  // Add these progress milestones
  const PROGRESS_STEPS = {
    INIT: 5,
    DRACO_LOADED: 15,
    MODEL_FETCHED: 30,
    TEXTURES_LOADED: 70,
    ANIMATIONS_READY: 90,
    COMPLETE: 100
  };
  
  // Update progress emitter
  function updateProgress(step) {
    eventBus.emit('room-loading-progress', { 
      progress: PROGRESS_STEPS[step],
      step
    });
  }
  
  // Loaders
  const gltfLoader = new GLTFLoader(loadingManager);
  const dracoLoader = new DRACOLoader();
  // Use local DRACO decoder
  const isDevelopmentDraco = window.location.hostname === 'localhost' ||
                             window.location.hostname === '127.0.0.1';
  const decoderPath = isDevelopmentDraco
    ? '/draco/'
    : 'https://www.gstatic.com/draco/v1/decoders/';
  dracoLoader.setDecoderPath(decoderPath);
  console.log(`[MODEL] Using ${isDevelopmentDraco ? 'local' : 'CDN'} DRACO decoder`);
  dracoLoader.setDecoderConfig({ type: 'wasm' });
  if (dracoLoader.preload) dracoLoader.preload();
  gltfLoader.setDRACOLoader(dracoLoader);
  console.log('[MODEL] DRACO loader configured');

  const textureLoader = new TextureLoader(loadingManager);

  /**
   * Load external textures for materials lacking embedded images.
   * @param {THREE.Scene} scene
   */
  async function loadTextures(scene) {
    console.group('[TEXTURES] Loading');
    const promises = [];
    scene.traverse(child => {
      if (child.material) {
        const mat = child.material;
        ['map','normalMap','roughnessMap','metalnessMap','emissiveMap'].forEach(type => {
          const map = mat[type];
          if (map && (!map.image || map.image.width === undefined)) {
            const url = map.sourceFile || `${modelPathValue.replace(/\.glb$/, '')}/${type}.jpg`;
            promises.push(new Promise(resolve => {
              textureLoader.load(url,
                texture => {
                  mat[type] = texture;
                  mat.needsUpdate = true;
                  console.log(`[TEXTURES] Loaded ${type} for ${child.name}`);
                  resolve();
                },
                undefined,
                error => {
                  console.warn(`[TEXTURES] Failed ${type}:`, error);
                  resolve();
                }
              );
            }));
          }
        });
      }
    });
    await Promise.all(promises);
    console.log('[TEXTURES] Completed');
    console.groupEnd();
  }

  async function verifyModelFile() {
    try {
      const response = await fetch(modelPathValue);
      if (!response.ok) throw new Error('Model file missing');
      
      const size = response.headers.get('content-length');
      if (size < 1000000) throw new Error('Model file too small');
      
      return true;
    } catch (error) {
      console.error('[MODEL] Pre-check failed:', error);
      throw error;
    }
  }

  // Animation setup helper
  /**
   * Set up animation mixer and actions.
   * @param {import('three/examples/jsm/loaders/GLTFLoader').GLTF} gltf
   */
  function setupAnimations(gltf) {
    mixer = new THREE.AnimationMixer(gltf.scene);
    animations = gltf.animations.map(clip => mixer.clipAction(clip));
    animations.forEach(action => action.play());
    console.log(`[ANIMATIONS] ${animations.length} actions playing`);
  }

  async function init() {
    try {
      updateProgress('INIT');
      
      // 1. Verify model file exists
      await verifyModelFile();
      updateProgress('DRACO_LOADED');
      
      // 2. Initialize scene and load GLTF model
      scene = new THREE.Scene();
      scene.name = 'MainRoomScene';
      const isDev = window.location.hostname === 'localhost' ||
                    window.location.hostname === '127.0.0.1';
      const modelUrl = isDev
        ? `${modelPathValue}?v=${Date.now()}`
        : modelPathValue;
      console.log(`[MODEL] Loading from: ${modelUrl}`);
      const gltf = await gltfLoader.loadAsync(modelUrl);
      if (!gltf.scene) throw new Error('No scene in loaded model');
      scene.add(gltf.scene);
      console.log('[MODEL] Successfully loaded and added to scene');
      updateProgress('MODEL_FETCHED');
      
      // 3. Load textures
      if (!gltf.scene) throw new Error('No scene in loaded model');
      await loadTextures(gltf.scene);
      updateProgress('TEXTURES_LOADED');
      
      // 4. Setup animations
      if (gltf.animations?.length > 0) {
        mixer = new THREE.AnimationMixer(gltf.scene);
        animations = gltf.animations.map(clip => mixer.clipAction(clip));
        animations.forEach(action => action.play());
        console.log(`[ANIMATIONS] ${animations.length} actions playing`);
      }
      updateProgress('ANIMATIONS_READY');
      
      // 5. Complete
      updateProgress('COMPLETE');
      
    } catch (error) {
      console.error('[ROOM] Initialization failed:', error);
      
      // Attempt recovery
      if (!scene) {
        console.warn('[RECOVERY] Reinitializing scene');
        scene = new THREE.Scene();
      }
      
      throw error; // Re-throw after recovery attempt
    }
    
    console.log('[Room] Initializing with container:', container);
    console.log('[Room] WebGL support check:', hasWebGLSupport());
    
    if (!container) {
      console.error('[RoomExperience] No container element provided');
      throw new Error('Container element is required');
    }
    
    // Notify loading start
    eventBus.emit('room-loading-start');
    
    // Create a visible HTML container if provided as a selector
    let canvasContainer = container;
    if (typeof container === 'string') {
      canvasContainer = document.querySelector(container);
    }
    
    if (!canvasContainer) {
      console.error('Container not found');
      return;
    }
    
    // Setup clock
    clock = new THREE.Clock();
    
    // Setup camera
    console.log('Setting up camera');
    const aspectRatio = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(75, aspectRatio, 0.1, 100);
    camera.position.copy(cameraPositions.initial);
    scene.add(camera);
    
    // Setup renderer
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);
    
    console.log('[DEBUG] Renderer context:', renderer.getContext());
    console.log('[DEBUG] Canvas dimensions:', 
      renderer.domElement.width, 
      renderer.domElement.height
    );
    
    // Add debug panel
    const debugPanel = document.createElement('div');
    debugPanel.style.position = 'fixed';
    debugPanel.style.bottom = '20px';
    debugPanel.style.left = '20px';
    debugPanel.style.backgroundColor = 'rgba(0,0,0,0.7)';
    debugPanel.style.color = 'white';
    debugPanel.style.padding = '10px';
    debugPanel.style.zIndex = '1000';
    document.body.appendChild(debugPanel);
    
    // WebGL capability check
    updateDebugInfo(debugPanel);
    
    // Setup controls
    if (enableOrbitControls) {
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.screenSpacePanning = false;
      controls.minDistance = 1;
      controls.maxDistance = 5;
      controls.maxPolarAngle = Math.PI / 2;
      controls.target.set(0, 1, 0);
    }
    
    // Add lights
    setupLights();
    
    // Setup resize handler
    window.addEventListener('resize', () => {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    });
    
    // Start animation loop
    let frameCount = 0;
    function update() {
      const delta = clock.getDelta();
      if (mixer) {
        mixer.update(delta);
        animations.forEach(action => {
          if (!action.isRunning()) action.play();
        });
      }
      controls?.update();
      frameCount++;
      if (frameCount % 60 === 0) {
        console.log('[DEBUG] Animation frame:', frameCount);
      }
      renderer.render(scene, camera);
      console.log('[DEBUG] Scene rendered - objects visible:', scene.children.length);
      requestAnimationFrame(update);
    }
    update();
    
    console.log('[RoomExperience] Three.js scene initialized');
    
    isInitialized = true;
  }
  
  function updateDebugInfo(debugPanel) {
    if (!renderer) return;
    
    const gl = renderer.getContext();
    const info = {
      'WebGL Version': gl.getParameter(gl.VERSION),
      'Renderer': renderer.info.render,
      'Draw Calls': renderer.info.render.calls,
      'Geometries': renderer.info.memory.geometries,
      'Textures': renderer.info.memory.textures
    };
    
    debugPanel.innerHTML = Object.entries(info)
      .map(([key, val]) => `${key}: ${val}`)
      .join('<br>');
  }
  
  function setupLights() {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    
    // Main directional light
    const mainLight = new THREE.DirectionalLight(0xffffff, 1);
    mainLight.position.set(5, 5, 5);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    scene.add(mainLight);
    
    // Add point lights
    const pointLight1 = new THREE.PointLight(0x3498db, 0.8, 5);
    pointLight1.position.set(-1, 2, 1);
    scene.add(pointLight1);
    
    const pointLight2 = new THREE.PointLight(0xe74c3c, 0.8, 5);
    pointLight2.position.set(2, 1, -1);
    scene.add(pointLight2);
  }
  
  /**
   * Create a launch button on the computer screen
   */
  function createLaunchButton() {
    if (!computerScreen) return;
    
    // Create a canvas texture for the button
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    
    // Draw button background
    context.fillStyle = '#2a2a2a';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    // Create gradient for screen
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#1a1a2e');
    gradient.addColorStop(1, '#16213e');
    context.fillStyle = gradient;
    context.fillRect(20, 20, canvas.width - 40, canvas.height - 40);
    
    // Draw OPERATOR text
    context.font = 'bold 56px Arial';
    context.textAlign = 'center';
    context.fillStyle = '#4361ee';
    context.fillText('OPERATOR', canvas.width / 2, canvas.height / 2 - 40);
    
    // Draw launch button
    context.fillStyle = '#4361ee';
    context.fillRect(canvas.width / 2 - 100, canvas.height / 2 + 20, 200, 60);
    
    context.font = 'bold 24px Arial';
    context.fillStyle = '#ffffff';
    context.fillText('LAUNCH', canvas.width / 2, canvas.height / 2 + 60);
    
    // Create texture and material
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({ 
      map: texture,
      transparent: true
    });
    
    // Replace screen material
    if (computerScreen.material) {
      computerScreen.material = material;
    } else if (computerScreen.children && computerScreen.children.length) {
      computerScreen.children.forEach(child => {
        if (child.isMesh) {
          child.material = material;
        }
      });
    }
    
    // Add click handler for the screen
    addScreenInteraction();
  }
  
  /**
   * Add click interaction to the computer screen
   */
  function addScreenInteraction() {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    
    // Add click event listener
    renderer.domElement.addEventListener('click', (event) => {
      // Calculate mouse position in normalized device coordinates
      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
      
      // Update the picking ray with the camera and mouse position
      raycaster.setFromCamera(mouse, camera);
      
      // Calculate objects intersecting the picking ray
      const intersects = raycaster.intersectObject(computerScreen, true);
      
      if (intersects.length > 0) {
        if (!isAppLaunched) {
          // First move closer to the screen
          moveToScreen();
        } else {
          // Go back to room view
          exitApplication();
        }
      }
    });
  }
  
  /**
   * Move camera to view the computer
   */
  function moveToComputer() {
    if (isTransitioning) return;
    
    disableControls();
    isTransitioning = true;
    
    // Animate camera to computer position
    animateCamera(
      cameraPositions.computer,
      new THREE.Vector3(0, 1.1, 0),
      transitionDuration,
      () => {
        isTransitioning = false;
        eventBus.emit('camera-at-computer');
      }
    );
  }
  
  /**
   * Move camera to view the computer screen closely
   */
  function moveToScreen() {
    if (isTransitioning) return;
    
    disableControls();
    isTransitioning = true;
    
    // Animate camera to screen position
    animateCamera(
      cameraPositions.screen,
      new THREE.Vector3(0, 1.1, 0),
      transitionDuration,
      () => {
        isTransitioning = false;
        launchApplication();
      }
    );
  }
  
  /**
   * Launch the OPERATOR application
   */
  function launchApplication() {
    isAppLaunched = true;
    
    // Show loading animation
    showLoadingAnimation();
    
    // Emit event for application to handle
    eventBus.emit('launch-application');
    
    // Fade out the 3D view
    fadeOut(() => {
      // Pause rendering to save resources
      // renderer.setAnimationLoop(null);
    });
  }
  
  /**
   * Exit the application and return to room view
   */
  function exitApplication() {
    isAppLaunched = false;
    
    // Resume rendering
    // renderer.setAnimationLoop(animate);
    
    // Fade in the 3D view
    fadeIn();
    
    // Return to initial camera position
    moveToInitialPosition();
    
    // Emit event for application to handle
    eventBus.emit('exit-application');
  }
  
  /**
   * Move camera to the initial position
   */
  function moveToInitialPosition() {
    if (isTransitioning) return;
    
    isTransitioning = true;
    
    // Animate camera to initial position
    animateCamera(
      cameraPositions.initial,
      new THREE.Vector3(0, 1, 0),
      transitionDuration,
      () => {
        isTransitioning = false;
        enableControls();
        eventBus.emit('camera-at-initial-position');
      }
    );
  }
  
  /**
   * Animate camera movement
   * @param {THREE.Vector3} targetPosition - Target camera position
   * @param {THREE.Vector3} targetLookAt - Target look at point
   * @param {number} duration - Animation duration in ms
   * @param {Function} callback - Callback function when animation completes
   */
  function animateCamera(targetPosition, targetLookAt, duration, callback) {
    console.group('[Room] Camera Animation');
    try {
      const startPosition = camera.position.clone();
      const startLookAt = currentCameraTarget.clone();
      
      const startTime = Date.now();
      
      function updateCamera() {
        const elapsedTime = Date.now() - startTime;
        const progress = Math.min(elapsedTime / duration, 1);
        
        // Use an easing function for smoother animation
        const easedProgress = easeInOutCubic(progress);
        
        // Interpolate camera position
        camera.position.lerpVectors(startPosition, targetPosition, easedProgress);
        
        // Interpolate look at point
        currentCameraTarget.lerpVectors(startLookAt, targetLookAt, easedProgress);
        camera.lookAt(currentCameraTarget);
        
        if (controls) {
          controls.target.copy(currentCameraTarget);
          controls.update();
        }
        
        // Continue animation if not complete
        if (progress < 1) {
          requestAnimationFrame(updateCamera);
        } else {
          if (callback) callback();
        }
      }
      
      updateCamera();
    } finally {
      console.groupEnd();
    }
  }
  
  /**
   * Easing function for smoother animations
   * @param {number} t - Progress from 0 to 1
   * @returns {number} Eased value
   */
  function easeInOutCubic(t) {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  
  /**
   * Show loading animation on the screen
   */
  function showLoadingAnimation() {
    if (!computerScreen) return;
    
    // Create a canvas texture for the loading animation
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    
    let frameCount = 0;
    
    function drawLoadingFrame() {
      // Clear canvas
      context.fillStyle = '#16213e';
      context.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw loading text
      context.font = 'bold 56px Arial';
      context.textAlign = 'center';
      context.fillStyle = '#4361ee';
      context.fillText('OPERATOR', canvas.width / 2, canvas.height / 2 - 40);
      
      // Draw loading spinner
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2 + 50;
      const radius = 30;
      
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.strokeStyle = '#1e3a8a';
      context.lineWidth = 5;
      context.stroke();
      
      // Draw spinner arc
      const startAngle = (frameCount * 0.1) % (Math.PI * 2);
      context.beginPath();
      context.arc(centerX, centerY, radius, startAngle, startAngle + Math.PI);
      context.strokeStyle = '#4361ee';
      context.lineWidth = 5;
      context.stroke();
      
      // Update texture
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.MeshBasicMaterial({ 
        map: texture,
        transparent: true
      });
      
      // Replace screen material
      if (computerScreen.material) {
        computerScreen.material = material;
      } else if (computerScreen.children && computerScreen.children.length) {
        computerScreen.children.forEach(child => {
          if (child.isMesh) {
            child.material = material;
          }
        });
      }
      
      frameCount++;
      
      if (!isAppLaunched) {
        requestAnimationFrame(drawLoadingFrame);
      }
    }
    
    drawLoadingFrame();
  }
  
  /**
   * Fade out the 3D scene
   * @param {Function} callback - Callback function when fade completes
   */
  function fadeOut(callback) {
    console.group('[Room] Fade Out');
    try {
      const fadeOverlay = document.createElement('div');
      fadeOverlay.className = 'fade-overlay';
      fadeOverlay.style.position = 'absolute';
      fadeOverlay.style.top = '0';
      fadeOverlay.style.left = '0';
      fadeOverlay.style.width = '100%';
      fadeOverlay.style.height = '100%';
      fadeOverlay.style.backgroundColor = '#000';
      fadeOverlay.style.opacity = '0';
      fadeOverlay.style.transition = `opacity ${transitionDuration / 1000}s ease`;
      fadeOverlay.style.zIndex = '1000';
      
      document.body.appendChild(fadeOverlay);
      
      // Trigger reflow
      void fadeOverlay.offsetWidth;
      
      // Fade in the overlay
      fadeOverlay.style.opacity = '1';
      
      // Call callback after animation completes
      setTimeout(() => {
        if (callback) callback();
      }, transitionDuration);
    } finally {
      console.groupEnd();
    }
  }
  
  /**
   * Fade in the 3D scene
   * @param {Function} callback - Callback function when fade completes
   */
  function fadeIn(callback) {
    console.group('[Room] Fade In');
    try {
      const fadeOverlay = document.querySelector('.fade-overlay');
      
      if (fadeOverlay) {
        // Fade out the overlay
        fadeOverlay.style.opacity = '0';
        
        // Remove the overlay after animation completes
        setTimeout(() => {
          fadeOverlay.remove();
          if (callback) callback();
        }, transitionDuration);
      } else if (callback) {
        callback();
      }
    } finally {
      console.groupEnd();
    }
  }
  
  /**
   * Handle window resize
   */
  function handleResize() {
    console.group('[Room] Resize');
    try {
      const width = window.innerWidth;
      const height = window.innerHeight;
      
      // Update camera
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      
      // Update renderer
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    } finally {
      console.groupEnd();
    }
  }
  
  /**
   * Disable orbit controls
   */
  function disableControls() {
    if (controls) {
      controls.enabled = false;
    }
  }
  
  /**
   * Enable orbit controls
   */
  function enableControls() {
    if (controls) {
        window.WebGLRenderingContext && 
        (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
      );
    } catch (e) {
      return false;
    }
  }
  
  // Return public API
  return {
    init,
    moveToComputer,
    moveToScreen,
    moveToInitialPosition,
    launchApplication,
    exitApplication,
    dispose
  };
}

/**
 * Create and mount a room experience to a container
 * @param {Object} props - Room experience properties
 * @returns {Object} Room experience instance
 */
RoomExperience.create = (props = {}) => {
  const roomExperience = RoomExperience(props);
  roomExperience.init();
  return roomExperience;
};

export default RoomExperience;
