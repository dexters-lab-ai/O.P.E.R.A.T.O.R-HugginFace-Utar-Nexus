/**
 * 3D Room Experience
 * Based on Bruno Simon's "My Room in 3D" project
 * https://github.com/brunosimon/my-room-in-3d
 * 
 * Creates an immersive 3D room entry experience for OPERATOR
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.module.js';
import { OrbitControls } from '/lib/OrbitControls.js';
import { GLTFLoader } from '/lib/GLTFLoader.js';
import { DRACOLoader } from 'https://cdn.jsdelivr.net/npm/three@0.132.2/examples/jsm/loaders/DRACOLoader.js';
import { TextureLoader } from './loaders/TextureLoader.js';
import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';

/**
 * Create a 3D room experience
 * @param {Object} props - Component properties
 * @returns {Object} Room experience instance with methods to control the experience
 */
export function RoomExperience(props = {}) {
  const {
    container = document.body,
    modelPath = '/models/room.glb',
    transitionDuration = 2000,
    enableOrbitControls = true,
    initialState = null
  } = props;

  console.log('[Room] Initializing with props:', props);
  
  modelPath = modelPath || '/models/room.glb';
  console.log('[Room] Model path:', modelPath);

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
  
  // Loaders
  const gltfLoader = new GLTFLoader(loadingManager);
  const dracoLoader = new THREE.DRACOLoader();
  dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.132.2/examples/jsm/loaders/draco/');
  gltfLoader.setDRACOLoader(dracoLoader);
  
  const textureLoader = new THREE.TextureLoader(loadingManager);

  async function loadRoomModel() {
    console.log('Loading 3D model from:', modelPath);
    
    try {
      const gltf = await loadModel();
      console.log('Model loaded successfully');
      roomModel = gltf.scene;
      
      // Scale and position the model
      roomModel.scale.set(1, 1, 1);
      roomModel.position.set(0, 0, 0);
      
      // Apply shadows
      roomModel.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          
          // Find computer screen
          if (child.name.includes('Screen') || child.name.includes('Monitor')) {
            computerScreen = child;
          }
        }
      });
      
      scene.add(roomModel);
      
      // Process animations
      if (gltf.animations && gltf.animations.length) {
        mixer = new THREE.AnimationMixer(roomModel);
        gltf.animations.forEach((clip) => {
          animations.push(mixer.clipAction(clip));
        });
      }
      
      // Add launch button to computer screen
      if (computerScreen) {
        createLaunchButton();
      }
      
      // Emit loaded event
      eventBus.emit('room-loading-complete');
    } catch (error) {
      console.error('Error loading model:', error);
    }
  }

  async function loadModel() {
    console.log('Attempting to load model from:', modelPath);
    
    try {
      const gltf = await new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.load(
          modelPath,
          resolve,
          (xhr) => console.log(`Loading ${(xhr.loaded/xhr.total*100).toFixed(0)}%`),
          reject
        );
      });
      
      console.log('Model successfully loaded:', gltf);
      return gltf;
    } catch (error) {
      console.error('Model loading failed:', error);
      throw error;
    }
  }
  
  function saveState() {
    eventBus.emit('room-state-change', state);
  }

  /**
   * Initialize the 3D experience
   */
  function init() {
    if (isInitialized) return;
    
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
    
    // Setup scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111122);
    
    // Setup clock
    clock = new THREE.Clock();
    
    // Setup camera
    const aspectRatio = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(75, aspectRatio, 0.1, 100);
    camera.position.copy(cameraPositions.initial);
    scene.add(camera);
    
    // Setup renderer
    setupRenderer();
    
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
    
    // Load room model
    loadRoomModel();
    
    // Setup resize handler
    window.addEventListener('resize', handleResize);
    
    // Start animation loop
    renderer.setAnimationLoop(animate);
    
    isInitialized = true;
  }
  
  function setupRenderer() {
    console.log('Setting up renderer');
    
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    
    console.log('Renderer dimensions:', 
      renderer.domElement.width, renderer.domElement.height);
    
    container.appendChild(renderer.domElement);
  }
  
  /**
   * Set up scene lighting
   */
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
      renderer.setAnimationLoop(null);
    });
  }
  
  /**
   * Exit the application and return to room view
   */
  function exitApplication() {
    isAppLaunched = false;
    
    // Resume rendering
    renderer.setAnimationLoop(animate);
    
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
  }
  
  /**
   * Fade in the 3D scene
   * @param {Function} callback - Callback function when fade completes
   */
  function fadeIn(callback) {
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
  }
  
  /**
   * Handle window resize
   */
  function handleResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    // Update camera
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    
    // Update renderer
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
      controls.enabled = true;
    }
  }
  
  /**
   * Animation loop
   */
  function animate() {
    requestAnimationFrame(() => {
      console.log('[Render Loop] Frame requested');
      this.animate();
    });
    
    try {
      console.log('[Render Loop] Rendering frame');
      this.renderer.render(this.scene, this.camera);
    } catch (error) {
      console.error('[Render Loop] Error:', error);
    }
  }
  
  /**
   * Dispose of all resources
   */
  function dispose() {
    // Stop animation loop
    renderer.setAnimationLoop(null);
    
    // Remove event listeners
    window.removeEventListener('resize', handleResize);
    
    // Dispose of Three.js resources
    if (scene) {
      scene.traverse((object) => {
        if (object.isMesh) {
          object.geometry.dispose();
          
          if (object.material.map) {
            object.material.map.dispose();
          }
          object.material.dispose();
        }
      });
    }
    
    // Remove canvas from DOM
    if (renderer && renderer.domElement && renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
    
    // Dispose of renderer
    if (renderer) {
      renderer.dispose();
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
