// sentinel-animation.js - Advanced Sentinel Robot Animation with Particle Effects
// Inspired by Gort from "The Day the Earth Stood Still"

import * as THREE from 'three';
const { sRGBEncoding } = THREE; // extract the constant
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FilmPass } from 'three/examples/jsm/postprocessing/FilmPass.js';

// Global variables and configuration
let canvas, renderer, scene, camera;
let sentinel, sentinelEye, particleSystem, glowEffect;
let clock, mixer, actions = {};
let state = 'intro'; // 'intro', 'idle', 'alert', 'firing'
let animationFrameId = null;

// Constants
const PARTICLE_COUNT = 2000;
const GLOW_INTENSITY = 1.8;
const LASER_COLOR = 0xff3333;
const BODY_COLOR = 0xaaddff;
const ACCENT_COLOR = 0x33ffdd;

// Initialize the animation system
function init(containerId) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error("Container element not found");
    return false;
  }
  
  // Create clock for animations
  clock = new THREE.Clock();
  
  // Setup renderer
  canvas = document.createElement('canvas');
  container.appendChild(canvas);
  
  renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    alpha: true
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputEncoding = sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  
  // Setup scene
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000020, 0.035);
  
  // Setup camera
  camera = new THREE.PerspectiveCamera(
    50,
    container.clientWidth / container.clientHeight,
    0.1,
    1000
  );
  camera.position.set(0, 0, 12);
  
  // Add lights
  setupLighting();
  
  // Create the sentinel robot
  createSentinelRobot();
  
  // Create particle system
  createParticleSystem();
  
  // Add post-processing effects
  setupPostProcessing();
  
  // Add event listeners
  window.addEventListener('resize', onWindowResize);
  
  // Start animation loop
  animate();
  
  // Begin with intro sequence
  playIntroSequence();
  
  return true;
}

// Setup scene lighting
function setupLighting() {
  // Ambient light
  const ambientLight = new THREE.AmbientLight(0x111122, 0.4);
  scene.add(ambientLight);
  
  // Main directional light
  const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
  mainLight.position.set(5, 10, 7);
  mainLight.castShadow = true;
  mainLight.shadow.bias = -0.0005;
  mainLight.shadow.mapSize.width = 2048;
  mainLight.shadow.mapSize.height = 2048;
  scene.add(mainLight);
  
  // Rim light to highlight edges
  const rimLight = new THREE.DirectionalLight(ACCENT_COLOR, 0.6);
  rimLight.position.set(-2, -1, -2);
  scene.add(rimLight);
  
  // Add point lights for dramatic effect
  const frontLight = new THREE.PointLight(BODY_COLOR, 0.8, 15);
  frontLight.position.set(0, 3, 5);
  scene.add(frontLight);
  
  // Floor spot for dramatic lighting from below
  const floorSpot = new THREE.SpotLight(ACCENT_COLOR, 1.5, 20, Math.PI/4, 0.5, 1);
  floorSpot.position.set(0, -5, 2);
  floorSpot.target.position.set(0, 0, 0);
  scene.add(floorSpot);
  scene.add(floorSpot.target);
}

// Create the sentinel robot
function createSentinelRobot() {
  // Create group to hold all sentinel parts
  sentinel = new THREE.Group();
  scene.add(sentinel);
  
  // Materials
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: BODY_COLOR,
    metalness: 0.9,
    roughness: 0.3,
    clearcoat: 1.0,
    clearcoatRoughness: 0.2,
    emissive: new THREE.Color(BODY_COLOR).multiplyScalar(0.2),
    transparent: true,
    opacity: 0.8
  });
  
  const eyeMaterial = new THREE.MeshLambertMaterial({
    color: LASER_COLOR,
    emissive: new THREE.Color(LASER_COLOR),  // Emissive color for glow
    transparent: true,
    opacity: 0.9
  });  
  
  // Create the main body parts
  
  // Torso
  const torsoGeometry = new THREE.CylinderGeometry(1.2, 1.5, 4, 32);
  const torso = new THREE.Mesh(torsoGeometry, bodyMaterial);
  torso.position.y = 0;
  sentinel.add(torso);
  
  // Head
  const headGeometry = new THREE.CylinderGeometry(0.8, 1.2, 1.2, 32);
  const head = new THREE.Mesh(headGeometry, bodyMaterial);
  head.position.y = 2.6;
  sentinel.add(head);
  
  // Helmet dome
  const domeGeometry = new THREE.SphereGeometry(0.8, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2);
  const dome = new THREE.Mesh(domeGeometry, bodyMaterial);
  dome.position.y = 3.2;
  sentinel.add(dome);
  
  // Eye visor (Gort's iconic single eye)
  const visorGeometry = new THREE.BoxGeometry(1.6, 0.3, 0.05);
  sentinelEye = new THREE.Mesh(visorGeometry, eyeMaterial);
  sentinelEye.position.set(0, 2.8, 0.7);
  sentinel.add(sentinelEye);
  
  // Shoulders
  const shoulderGeometry = new THREE.BoxGeometry(3, 0.5, 0.8);
  const shoulders = new THREE.Mesh(shoulderGeometry, bodyMaterial);
  shoulders.position.y = 1.5;
  sentinel.add(shoulders);
  
  // Arms
  const armGeometry = new THREE.CylinderGeometry(0.3, 0.2, 3, 16);
  
  const leftArm = new THREE.Mesh(armGeometry, bodyMaterial);
  leftArm.position.set(-1.5, 0, 0);
  leftArm.rotation.z = 0.1;
  sentinel.add(leftArm);
  
  const rightArm = new THREE.Mesh(armGeometry, bodyMaterial);
  rightArm.position.set(1.5, 0, 0);
  rightArm.rotation.z = -0.1;
  sentinel.add(rightArm);
  
  // Create laser beam (initially invisible)
  const laserGeometry = new THREE.CylinderGeometry(0.05, 0.05, 50, 8);
  const laserMaterial = new THREE.MeshBasicMaterial({
    color: LASER_COLOR,
    transparent: true,
    opacity: 0,
    emissive: LASER_COLOR
  });
  
  const laser = new THREE.Mesh(laserGeometry, laserMaterial);
  laser.position.z = 25;
  laser.rotation.x = Math.PI / 2;
  sentinelEye.add(laser);
  sentinelEye.userData.laser = laser;
  
  // Add floating rings around the sentinel
  for (let i = 0; i < 3; i++) {
    const ringGeometry = new THREE.TorusGeometry(1.8 + i * 0.4, 0.05, 16, 100);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: ACCENT_COLOR,
      transparent: true,
      opacity: 0.6,
      emissive: ACCENT_COLOR
    });
    
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.userData.initialY = i * 0.6 - 0.6;
    ring.position.y = ring.userData.initialY;
    ring.userData.rotationSpeed = (i + 1) * 0.2;
    sentinel.add(ring);
  }
  
  // Initially hide sentinel until particles form it
  sentinel.visible = false;
}

// Create particle system
function createParticleSystem() {
  const particleGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const colors = new Float32Array(PARTICLE_COUNT * 3);
  const sizes = new Float32Array(PARTICLE_COUNT);
  const targetPositions = new Float32Array(PARTICLE_COUNT * 3);
  
  // Generate random initial positions (dispersed)
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const i3 = i * 3;
    
    // Random position in sphere
    const radius = 10 + Math.random() * 15;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    
    positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i3 + 2] = radius * Math.cos(phi);
    
    // Store target positions (on sentinel surface)
    // We'll distribute particles to form the robot shape
    const section = Math.random();
    
    if (section < 0.6) {
      // Torso
      const angle = Math.random() * Math.PI * 2;
      const height = (Math.random() * 4) - 2;
      const radius = 1.2 + Math.random() * 0.3;
      
      targetPositions[i3] = Math.cos(angle) * radius;
      targetPositions[i3 + 1] = height;
      targetPositions[i3 + 2] = Math.sin(angle) * radius;
    } 
    else if (section < 0.8) {
      // Head
      const angle = Math.random() * Math.PI * 2;
      const height = 2.6 + Math.random() * 1.2;
      const radius = 0.8 + Math.random() * 0.2;
      
      targetPositions[i3] = Math.cos(angle) * radius;
      targetPositions[i3 + 1] = height;
      targetPositions[i3 + 2] = Math.sin(angle) * radius;
    }
    else {
      // Arms and other parts
      const side = Math.random() > 0.5 ? 1 : -1;
      targetPositions[i3] = side * (1.3 + Math.random() * 0.4);
      targetPositions[i3 + 1] = Math.random() * 3 - 1.5;
      targetPositions[i3 + 2] = Math.random() * 0.8 - 0.4;
    }
    
    // Colors - blueish to cyan gradient
    colors[i3] = 0.4 + Math.random() * 0.2; // R
    colors[i3 + 1] = 0.7 + Math.random() * 0.3; // G
    colors[i3 + 2] = 0.9 + Math.random() * 0.1; // B
    
    // Random sizes
    sizes[i] = 0.1 + Math.random() * 0.15;
  }
  
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  particleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  
  // Custom shader material for particles
  const particleMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      pixelRatio: { value: window.devicePixelRatio }
    },
    vertexShader: `
      uniform float time;
      uniform float pixelRatio;
      attribute float size;
      varying vec3 vColor;
      
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * pixelRatio * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      
      void main() {
        // Creating a soft, circular particle
        vec2 xy = gl_PointCoord.xy - vec2(0.5);
        float radius = length(xy);
        if (radius > 0.5) discard;
        
        // Glow effect with soft edges
        float intensity = 1.0 - radius * 2.0;
        intensity = pow(intensity, 1.5);
        
        gl_FragColor = vec4(vColor, intensity);
      }
    `,
    transparent: true,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  
  particleSystem = new THREE.Points(particleGeometry, particleMaterial);
  particleSystem.userData.targetPositions = targetPositions;
  particleSystem.userData.initialPositions = positions.slice();
  scene.add(particleSystem);
}

// Setup post-processing effects
function setupPostProcessing() {
  // Use the imported EffectComposer instead of THREE.EffectComposer
  const composer = new EffectComposer(renderer);
  
  // Use the imported RenderPass
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  
  // Bloom effect for the glow using the imported UnrealBloomPass;
  // we still use THREE.Vector2 since that's in core
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.5,  // strength
    0.4,  // radius
    0.85  // threshold
  );
  composer.addPass(bloomPass);
  
  // Use the imported FilmPass
  const filmPass = new FilmPass(0.35, 0.025, 648, false);
  composer.addPass(filmPass);
  
  renderer.userData.composer = composer;
}

// Animate the sentinel
function animate() {
  animationFrameId = requestAnimationFrame(animate);
  
  const delta = clock.getDelta();
  const elapsedTime = clock.getElapsedTime();
  
  // Update particles based on state
  updateParticles(delta, elapsedTime);
  
  // Update sentinel animations
  updateSentinel(delta, elapsedTime);
  
  // Render scene with post-processing
  if (renderer.userData.composer) {
    renderer.userData.composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

// Update particle positions and behavior
function updateParticles(delta, elapsedTime) {
  if (!particleSystem) return;
  
  const positions = particleSystem.geometry.attributes.position.array;
  const targetPositions = particleSystem.userData.targetPositions;
  const initialPositions = particleSystem.userData.initialPositions;
  
  let formingFactor = 0;
  let disperseFactor = 0;
  
  switch (state) {
    case 'intro':
      // Particles gradually form the sentinel
      formingFactor = Math.min(elapsedTime / 3, 1.0);
      sentinel.visible = formingFactor > 0.85;
      break;
    
    case 'idle':
      // Particles have formed the sentinel with gentle movement
      formingFactor = 1.0;
      sentinel.visible = true;
      break;
      
    case 'alert':
      // Particles start to disperse slightly
      formingFactor = 0.85;
      disperseFactor = 0.15;
      sentinel.visible = true;
      break;
      
    case 'firing':
      // Particles pulse and disperse more while firing
      formingFactor = 0.7 + Math.sin(elapsedTime * 8) * 0.1;
      disperseFactor = 0.3;
      sentinel.visible = true;
      break;
      
    case 'disperse':
      // Particles fly away
      formingFactor = Math.max(1.0 - (elapsedTime - particleSystem.userData.disperseStartTime) / 2, 0);
      disperseFactor = 1.0 - formingFactor;
      sentinel.visible = formingFactor > 0.3;
      break;
  }
  
  // Update each particle position
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const i3 = i * 3;
    
    // Current position
    let x = positions[i3];
    let y = positions[i3 + 1];
    let z = positions[i3 + 2];
    
    // Target position (on sentinel body)
    const tx = targetPositions[i3];
    const ty = targetPositions[i3 + 1];
    const tz = targetPositions[i3 + 2];
    
    // Initial dispersed position
    const ix = initialPositions[i3];
    const iy = initialPositions[i3 + 1];
    const iz = initialPositions[i3 + 2];
    
    // Calculate new position based on forming/disperse factors
    if (state === 'idle' || state === 'alert' || state === 'firing') {
      // Add subtle movement in formed state
      const noise = Math.sin(i * 0.1 + elapsedTime * 2) * 0.05;
      
      x = tx + noise;
      y = ty + noise;
      z = tz + noise;
      
      // Add pulsing effect when firing
      if (state === 'firing') {
        const pulse = Math.sin(elapsedTime * 12 + i * 0.2) * 0.15;
        x += pulse;
        y += pulse * 0.5;
        z += pulse;
      }
    } else {
      // Interpolate between formed and dispersed positions
      x = tx * formingFactor + ix * disperseFactor;
      y = ty * formingFactor + iy * disperseFactor;
      z = tz * formingFactor + iz * disperseFactor;
      
      // Add some movement to the particles during transition
      const waveFactor = 0.1;
      x += Math.sin(elapsedTime * 2 + i * 0.1) * waveFactor;
      y += Math.cos(elapsedTime * 1.5 + i * 0.05) * waveFactor;
      z += Math.sin(elapsedTime * 1.2 + i * 0.15) * waveFactor;
    }
    
    // Update particle position
    positions[i3] = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z;
  }
  
  // Update material
  particleSystem.geometry.attributes.position.needsUpdate = true;
  particleSystem.material.uniforms.time.value = elapsedTime;
}

// Update sentinel robot animations
function updateSentinel(delta, elapsedTime) {
  if (!sentinel) return;
  
  // Base hover animation
  sentinel.position.y = Math.sin(elapsedTime * 0.8) * 0.2;
  
  // Rotate rings
  sentinel.children.forEach(child => {
    if (child.geometry && child.geometry.type === 'TorusGeometry') {
      child.rotation.z += delta * child.userData.rotationSpeed;
      child.position.y = child.userData.initialY + Math.sin(elapsedTime * 1.2) * 0.1;
    }
  });
  
  // Animate the eye based on state
  if (sentinelEye) {
    if (state === 'idle') {
      // Gentle scanning motion
      sentinelEye.position.x = Math.sin(elapsedTime * 0.5) * 0.2;
      sentinelEye.material.opacity = 0.8 + Math.sin(elapsedTime * 2) * 0.2;
      
      // Make sure laser is hidden
      if (sentinelEye.userData.laser) {
        sentinelEye.userData.laser.material.opacity = 0;
      }
    }
    else if (state === 'alert') {
      // More rapid scanning
      sentinelEye.position.x = Math.sin(elapsedTime * 2) * 0.4;
      sentinelEye.material.opacity = 0.9 + Math.sin(elapsedTime * 8) * 0.1;
      
      // Brief laser pulses
      if (sentinelEye.userData.laser) {
        sentinelEye.userData.laser.material.opacity = (Math.sin(elapsedTime * 4) > 0.9) ? 0.3 : 0;
      }
    }
    else if (state === 'firing') {
      // Fire laser
      sentinelEye.material.opacity = 1.0;
      
      // Full laser beam
      if (sentinelEye.userData.laser) {
        sentinelEye.userData.laser.material.opacity = 0.8 + Math.sin(elapsedTime * 20) * 0.2;
        
        // Add subtle position vibration when firing
        sentinel.position.x = (Math.random() - 0.5) * 0.05;
        sentinel.position.z = (Math.random() - 0.5) * 0.05;
      }
    }
  }
}

// Play the intro sequence
function playIntroSequence() {
  state = 'intro';
  
  // After 3 seconds, transition to idle
  setTimeout(() => {
    state = 'idle';
  }, 3000);
}

// Handle window resize
function onWindowResize() {
  const container = canvas.parentElement;
  if (!container) return;
  
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  
  renderer.setSize(container.clientWidth, container.clientHeight);
  
  if (renderer.userData.composer) {
    renderer.userData.composer.setSize(container.clientWidth, container.clientHeight);
  }
}

// Public API functions
function setAlertMode() {
  state = 'alert';
}

function setIdleMode() {
  state = 'idle';
}

function fireLaser(duration = 3000) {
  state = 'firing';
  
  // Return to alert mode after duration
  setTimeout(() => {
    state = 'alert';
  }, duration);
}

function disperseAndReset() {
  state = 'disperse';
  particleSystem.userData.disperseStartTime = clock.getElapsedTime();
  
  // After dispersion, play intro sequence again
  setTimeout(() => {
    playIntroSequence();
  }, 2000);
}

// Clean up resources
function dispose() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  
  window.removeEventListener('resize', onWindowResize);
  
  if (renderer) {
    renderer.dispose();
    if (renderer.userData.composer) {
      renderer.userData.composer.dispose();
    }
  }
  
  // Dispose geometries and materials
  scene.traverse(object => {
    if (object.geometry) object.geometry.dispose();
    
    if (object.material) {
      if (Array.isArray(object.material)) {
        object.material.forEach(material => material.dispose());
      } else {
        object.material.dispose();
      }
    }
  });
  
  // Remove canvas
  if (canvas && canvas.parentElement) {
    canvas.parentElement.removeChild(canvas);
  }
}

// Export public API
export {
  init,
  setAlertMode,
  setIdleMode,
  fireLaser,
  disperseAndReset,
  dispose
};