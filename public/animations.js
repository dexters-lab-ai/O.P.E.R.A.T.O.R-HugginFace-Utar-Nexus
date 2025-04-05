// animations.js - Optimized for performance and context handling

// Global variables
let bgCanvas, bgFallback, bgRenderer, bgScene, bgCamera, wormhole, particles;
let sentinelCanvas, sentinelFallback, sentinelRenderer, sentinelScene, sentinelCamera, sentinelGroup;
let isTaskRunning = false;
let sentinelState = 'idle'; // 'idle', 'tasking', 'normal'
let animationFrameId = null; // For tracking and canceling animation frames
let contextRestoreAttempts = 0;
const MAX_RESTORE_ATTEMPTS = 5;

// Create a single clock for all animations
const clock = new THREE.Clock();

// Check WebGL Support with more detailed diagnostics
function checkWebGLSupport() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    
    if (!gl) {
      console.warn('WebGL not supported');
      return { supported: false, reason: 'WebGL context could not be created' };
    }
    
    // Check for key WebGL capabilities
    const extensions = {
      floatTextures: gl.getExtension('OES_texture_float'),
      standardDerivatives: gl.getExtension('OES_standard_derivatives'),
      vertexArrayObjects: gl.getExtension('OES_vertex_array_object'),
      anisotropicFiltering: gl.getExtension('EXT_texture_filter_anisotropic')
    };
    
    // Check if sufficient extensions are available
    const extensionsSupported = Object.values(extensions).filter(Boolean).length >= 2;
    if (!extensionsSupported) {
      console.warn('Limited WebGL extension support');
    }
    
    return { 
      supported: true, 
      capabilities: extensions,
      renderer: {
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER)
      }
    };
  } catch (e) {
    console.error('WebGL detection error:', e);
    return { supported: false, reason: e.message };
  }
}

// Initialize all scenes and elements
function initBackgroundScene() {
  bgCanvas = document.getElementById('bg-canvas');
  bgFallback = document.getElementById('bg-fallback');
  
  // Create renderer with better defaults for performance
  bgRenderer = new THREE.WebGLRenderer({ 
    canvas: bgCanvas, 
    alpha: true,
    antialias: false, // Turn off antialiasing for better performance
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false
  });
  
  // Handle context loss and restoration
  bgCanvas.addEventListener('webglcontextlost', handleBgContextLost, false);
  bgCanvas.addEventListener('webglcontextrestored', handleBgContextRestored, false);
  
  bgRenderer.setPixelRatio(window.devicePixelRatio > 1 ? 1.5 : 1); // Limit pixel ratio
  bgRenderer.setSize(window.innerWidth, window.innerHeight);
  bgRenderer.setClearColor(0x000000, 0); // Transparent background
  
  bgScene = new THREE.Scene();
  
  // Use perspective camera with better defaults
  bgCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
  bgCamera.position.set(0, 5, 30);
  bgCamera.lookAt(0, 0, 0);
  
  // Create wormhole with optimized geometry
  createWormhole();
  
  // Create particle system with optimized settings
  createParticles();
}

function createWormhole() {
  // Optimize geometry with fewer segments where possible
  const wormholeGeometry = new THREE.TorusGeometry(10, 3, 12, 48);
  
  // Use a more efficient shader without unnecessary calculations
  const wormholeMaterial = new THREE.ShaderMaterial({
    uniforms: { 
      time: { value: 0.0 }, 
      glowColor: { value: new THREE.Color(0x00ddeb) }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform vec3 glowColor;
      varying vec2 vUv;
      void main() {
        float dist = length(vUv - vec2(0.5));
        float pulse = 0.1 + 0.5 * sin(time + dist * 10.0);
        vec3 color = mix(vec3(0.0), glowColor, pulse);
        gl_FragColor = vec4(color, max(0.0, 0.8 - dist));
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false // Improves transparency rendering
  });
  
  wormhole = new THREE.Mesh(wormholeGeometry, wormholeMaterial);
  wormhole.rotation.x = Math.PI / 2;
  bgScene.add(wormhole);
}

function createParticles() {
  // Use fewer particles for better performance
  const particleCount = window.innerWidth < 768 ? 1000 : 1500;
  
  // Create geometry
  const particlesGeometry = new THREE.BufferGeometry();
  
  // Create position array
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const velocities = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  
  // Initialize particle attributes
  for (let i = 0; i < particleCount * 3; i += 3) {
    const theta = Math.random() * Math.PI * 2;
    const radius = 10 + Math.random() * 5;
    
    // Positions in a torus shape
    positions[i] = Math.cos(theta) * radius;
    positions[i + 1] = (Math.random() - 0.5) * 2;
    positions[i + 2] = Math.sin(theta) * radius;
    
    // Alternate between two colors
    const hue = Math.random() > 0.5 ? 0.5 : 0.85; // Cyan or magenta in HSL
    const col = new THREE.Color().setHSL(hue, 1, 0.5);
    colors[i] = col.r;
    colors[i + 1] = col.g;
    colors[i + 2] = col.b;
    
    // Random velocities
    velocities[i] = (Math.random() - 0.5) * 0.03;
    velocities[i + 1] = (Math.random() - 0.5) * 0.03;
    velocities[i + 2] = (Math.random() - 0.5) * 0.03;
    
    // Random sizes for depth perception
    sizes[i/3] = Math.random() * 0.1 + 0.05;
  }
  
  // Set attributes
  particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particlesGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  particlesGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  
  // Store references for animation
  particlesGeometry.userData.velocities = velocities;
  
  // Create shader material for better particle rendering
  const particlesMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0.0 },
      pixelRatio: { value: window.devicePixelRatio }
    },
    vertexShader: `
      attribute float size;
      attribute vec3 color;
      varying vec3 vColor;
      uniform float time;
      uniform float pixelRatio;
      
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
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;
        float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
        gl_FragColor = vec4(vColor, alpha * 0.9);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  
  particles = new THREE.Points(particlesGeometry, particlesMaterial);
  bgScene.add(particles);
}

function initSentinelScene() {
  sentinelCanvas = document.getElementById('sentinel-canvas');
  sentinelFallback = document.getElementById('sentinel-fallback');
  
  // Create renderer with better defaults
  sentinelRenderer = new THREE.WebGLRenderer({ 
    canvas: sentinelCanvas, 
    alpha: true,
    antialias: true, // Enable antialiasing for the sentinel for smoother edges
    powerPreference: 'high-performance'
  });
  
  // Handle context loss
  sentinelCanvas.addEventListener('webglcontextlost', handleSentinelContextLost, false);
  sentinelCanvas.addEventListener('webglcontextrestored', handleSentinelContextRestored, false);
  
  sentinelRenderer.setPixelRatio(window.devicePixelRatio > 1 ? 1.5 : 1);
  sentinelRenderer.setSize(sentinelCanvas.clientWidth, sentinelCanvas.clientHeight);
  sentinelRenderer.setClearColor(0x000000, 0);
  console.log(sentinelCanvas.clientWidth, sentinelCanvas.clientHeight);
  
  sentinelScene = new THREE.Scene();
  
  // Camera with better positioning
  sentinelCamera = new THREE.PerspectiveCamera(
    60, 
    sentinelCanvas.clientWidth / sentinelCanvas.clientHeight, 
    0.1, 
    1000
  );
  sentinelCamera.position.set(0, 1.5, 5);
  sentinelCamera.lookAt(0, 1, 0);
  
  // Add efficient lighting
  setupSentinelLighting();
  
  // Create sentinel robot
  createSentinelRobot();
}

function setupSentinelLighting() {
  // Ambient light for basic illumination
  const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
  sentinelScene.add(ambientLight);
  
  // Main directional light with optimized shadow settings
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(5, 5, 5);
  directionalLight.castShadow = true;
  
  // Optimize shadow map
  directionalLight.shadow.mapSize.width = 512;
  directionalLight.shadow.mapSize.height = 512;
  directionalLight.shadow.camera.near = 0.5;
  directionalLight.shadow.camera.far = 20;
  directionalLight.shadow.bias = -0.001;
  
  sentinelScene.add(directionalLight);
  
  // Add subtle rim light for better edge definition
  const rimLight = new THREE.DirectionalLight(0x00ddeb, 0.3);
  rimLight.position.set(-5, 3, -5);
  sentinelScene.add(rimLight);
}

function createSentinelRobot() {
  sentinelGroup = new THREE.Group();
  
  // Materials - using darker blue like in the image
  const bodyMaterial = new THREE.MeshPhongMaterial({
    color: 0x1a237e, // Dark blue color
    shininess: 30,
    specular: 0x222222
  });
  
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ddeb, // Cyan glow for eyes
    transparent: true,
    opacity: 0.9
  });
  
  // Main Body - slimmer and more cylindrical
  const bodyGeometry = new THREE.CylinderGeometry(0.5, 0.45, 1.0, 24);
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.scale.set(0.6, 0.5, 0.5); // Make body smaller and slimmer
  body.castShadow = true;
  body.receiveShadow = true;
  sentinelGroup.add(body);
  
  // Head - more round but smaller
  const headGeometry = new THREE.SphereGeometry(0.45, 24, 24);
  const head = new THREE.Mesh(headGeometry, bodyMaterial);
  head.position.set(0, 0.35, 0);
  head.scale.set(0.6, 0.5, 0.5); // Make head smaller and slimmer
  head.castShadow = true;
  head.receiveShadow = true;
  sentinelGroup.add(head);
  
  // Eyes - keep proportional size but position closer together
  const eyeGeometry = new THREE.CircleGeometry(0.15, 20);
  const leftEye = new THREE.Mesh(eyeGeometry, glowMaterial.clone());
  leftEye.position.set(-0.15, 0.4, 0.3);
  leftEye.userData.isEye = true;
  
  const rightEye = new THREE.Mesh(eyeGeometry, glowMaterial.clone());
  rightEye.position.set(0.15, 0.4, 0.3);
  rightEye.userData.isEye = true;
  
  sentinelGroup.add(leftEye, rightEye);
  
  // Arms - thinner and shorter
  const armGeometry = new THREE.CylinderGeometry(0.08, 0.08, 0.3, 16);
  
  const leftArm = new THREE.Mesh(armGeometry, bodyMaterial);
  leftArm.position.set(-0.5, 0.05, 0);
  leftArm.rotation.z = Math.PI / 2.2;
  leftArm.castShadow = true;
  leftArm.receiveShadow = true;
  leftArm.userData.isLeftArm = true;
  
  const rightArm = new THREE.Mesh(armGeometry, bodyMaterial);
  rightArm.position.set(0.5, 0.05, 0);
  rightArm.rotation.z = -Math.PI / 2.2;
  rightArm.castShadow = true;
  rightArm.receiveShadow = true;
  rightArm.userData.isRightArm = true;
  
  sentinelGroup.add(leftArm, rightArm);
  
  // Hands - smaller round hands
  const handGeometry = new THREE.SphereGeometry(0.1, 16, 16);
  
  const leftHand = new THREE.Mesh(handGeometry, bodyMaterial);
  leftHand.position.set(-0.65, 0.05, 0);
  leftHand.castShadow = true;
  leftHand.receiveShadow = true;
  
  const rightHand = new THREE.Mesh(handGeometry, bodyMaterial);
  rightHand.position.set(0.65, 0.05, 0);
  rightHand.castShadow = true;
  rightHand.receiveShadow = true;
  
  sentinelGroup.add(leftHand, rightHand);
  
  // Legs - thinner
  const legGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.25, 16);
  
  const leftLeg = new THREE.Mesh(legGeometry, bodyMaterial);
  leftLeg.position.set(-0.2, -0.4, 0);
  leftLeg.castShadow = true;
  leftLeg.receiveShadow = true;
  leftLeg.userData.isLeftLeg = true;
  
  const rightLeg = new THREE.Mesh(legGeometry, bodyMaterial);
  rightLeg.position.set(0.2, -0.4, 0);
  rightLeg.castShadow = true;
  rightLeg.receiveShadow = true;
  rightLeg.userData.isRightLeg = true;
  
  sentinelGroup.add(leftLeg, rightLeg);
  
  // Feet - smaller
  const footGeometry = new THREE.SphereGeometry(0.12, 16, 16);
  
  const leftFoot = new THREE.Mesh(footGeometry, bodyMaterial);
  leftFoot.position.set(-0.2, -0.55, 0);
  leftFoot.scale.set(1.2, 0.5, 1.2);
  leftFoot.castShadow = true;
  leftFoot.receiveShadow = true;
  
  const rightFoot = new THREE.Mesh(footGeometry, bodyMaterial);
  rightFoot.position.set(0.2, -0.55, 0);
  rightFoot.scale.set(1.2, 0.5, 1.2);
  rightFoot.castShadow = true;
  rightFoot.receiveShadow = true;
  
  sentinelGroup.add(leftFoot, rightFoot);
  
  // Ear-like protrusions - smaller and more subtle
  const earGeometry = new THREE.SphereGeometry(0.08, 16, 16);
  
  // Left ear
  const leftEar = new THREE.Mesh(earGeometry, bodyMaterial);
  leftEar.position.set(-0.4, 0.45, 0);
  leftEar.castShadow = true;
  leftEar.receiveShadow = true;
  
  // Right ear
  const rightEar = new THREE.Mesh(earGeometry, bodyMaterial);
  rightEar.position.set(0.4, 0.45, 0);
  rightEar.castShadow = true;
  rightEar.receiveShadow = true;
  
  sentinelGroup.add(leftEar, rightEar);
  
  // Create subtle jet flames (less visible)
  createJetFumes();
  
  // Scale down the entire sentinel by 50% as requested
  sentinelGroup.scale.set(0.5, 0.5, 0.5);
  
  sentinelScene.add(sentinelGroup);
}

// Update jet fumes for cyberpunk aesthetic
function createJetFumes() {
  const fumeCount = 80; // Fewer particles
  const fumeGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(fumeCount * 3);
  const colors = new Float32Array(fumeCount * 3);
  const sizes = new Float32Array(fumeCount);
  const lifetimes = new Float32Array(fumeCount);
  const velocities = new Float32Array(fumeCount * 3);

  for (let i = 0; i < fumeCount; i++) {
    const i3 = i * 3;
    positions[i3] = (Math.random() - 0.5) * 0.15;
    positions[i3 + 1] = -0.7;
    positions[i3 + 2] = -0.4 + (Math.random() - 0.5) * 0.15;
    
    velocities[i3] = (Math.random() - 0.5) * 0.02;
    velocities[i3 + 1] = -0.08 - Math.random() * 0.05; // Slower downward movement
    velocities[i3 + 2] = (Math.random() - 0.5) * 0.02;
    
    lifetimes[i] = Math.random() * 1.0;
    sizes[i] = Math.random() * 0.05 + 0.02; // Smaller particles
    
    // Blue color range to match the robot theme
    const col = new THREE.Color().setHSL(0.6 + Math.random() * 0.1, 0.8, 0.7); 
    colors[i3] = col.r;
    colors[i3 + 1] = col.g;
    colors[i3 + 2] = col.b;
  }

  fumeGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  fumeGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  fumeGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  fumeGeometry.userData.velocities = velocities;
  fumeGeometry.userData.lifetimes = lifetimes;

  const fumeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0.0 },
      pixelRatio: { value: window.devicePixelRatio }
    },
    vertexShader: `
      attribute float size;
      attribute vec3 color;
      varying vec3 vColor;
      uniform float pixelRatio;
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
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;
        float alpha = 1.0 - smoothstep(0.2, 0.5, dist);
        gl_FragColor = vec4(vColor, alpha * 0.5); // More subtle opacity
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const fumes = new THREE.Points(fumeGeometry, fumeMaterial);
  fumes.userData.isFumes = true;
  sentinelGroup.add(fumes);
}

// Animation loop - restructured with proper time handling
function animate() {
  // Use requestAnimationFrame with proper cancellation
  animationFrameId = requestAnimationFrame(animate);
  
  // Get delta time for smooth animations regardless of frame rate
  const delta = Math.min(clock.getDelta(), 0.1); // Cap delta to avoid large jumps
  const elapsedTime = clock.getElapsedTime();
  
  try {
    // Background animation
    animateBackground(delta, elapsedTime);
    
    // Sentinel animation
    animateSentinel(delta, elapsedTime);
  } catch (err) {
    console.error('Animation error:', err);
    // If we have an error, try to recover by stopping and restarting animation
    stopAnimations();
    
    // Only attempt to restart if we haven't tried too many times
    if (contextRestoreAttempts < MAX_RESTORE_ATTEMPTS) {
      contextRestoreAttempts++;
      console.log(`Attempting to recover animation (${contextRestoreAttempts}/${MAX_RESTORE_ATTEMPTS})`);
      setTimeout(startAnimations, 1000);
    }
  }
}

function animateBackground(delta, elapsedTime) {
  if (!bgRenderer || !bgScene || !bgCamera) return;
  
  // Update wormhole
  if (wormhole && wormhole.material.uniforms) {
    wormhole.material.uniforms.time.value = elapsedTime;
    wormhole.rotation.z += 0.005 * (isTaskRunning ? 3 : 1);
  }
  
  // Update particles
  if (particles && particles.geometry) {
    const geometry = particles.geometry;
    const positions = geometry.attributes.position.array;
    const velocities = geometry.userData.velocities;
    
    if (positions && velocities) {
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i], z = positions[i + 2];
        const dist = Math.sqrt(x * x + z * z);
        
        if (dist > 0) {
          // Particles move toward center faster when task is running
          const speed = isTaskRunning ? 0.12 / dist : 0.04 / dist;
          positions[i] -= (x / dist) * speed;
          positions[i + 2] -= (z / dist) * speed;
          
          // Reset particle if it gets too close to center
          if (dist < 3) {
            const theta = Math.random() * Math.PI * 2;
            const radius = 10 + Math.random() * 5;
            positions[i] = Math.cos(theta) * radius;
            positions[i + 2] = Math.sin(theta) * radius;
          }
        }
        
        // Apply velocity
        positions[i] += velocities[i] * delta * 60;
        positions[i + 1] += velocities[i + 1] * delta * 60;
        positions[i + 2] += velocities[i + 2] * delta * 60;
      }
      
      geometry.attributes.position.needsUpdate = true;
    }
  }
  
  // Render scene
  bgRenderer.render(bgScene, bgCamera);
}

function animateSentinel(delta, elapsedTime) {
  if (!sentinelRenderer || !sentinelScene || !sentinelCamera) return;
  
  // Find sentinel components by userData tags
  const components = findSentinelComponents();
  
  // Animate eyes
  animateEyes(components.eyes, elapsedTime);
  
  // Animate jet fumes
  animateJetFumes(components.fumes, delta);
  
  // State-specific animations
  switch (sentinelState) {
    case 'idle':
      animateIdleState(components, elapsedTime);
      break;
    case 'tasking':
      animateTaskingState(components, elapsedTime);
      break;
    case 'normal':
      animateNormalState(components);
      break;
  }
  
  // Render scene
  sentinelRenderer.render(sentinelScene, sentinelCamera);
}

function findSentinelComponents() {
  const components = {
    eyes: [],
    leftArm: null,
    rightArm: null,
    leftLeg: null,
    rightLeg: null,
    fumes: null
  };
  
  // Skip if sentinel group isn't available
  if (!sentinelGroup) return components;
  
  // Find components by traversing the group
  sentinelGroup.traverse(obj => {
    if (obj.userData.isEye) {
      components.eyes.push(obj);
    } else if (obj.userData.isLeftArm) {
      components.leftArm = obj;
    } else if (obj.userData.isRightArm) {
      components.rightArm = obj;
    } else if (obj.userData.isLeftLeg) {
      components.leftLeg = obj;
    } else if (obj.userData.isRightLeg) {
      components.rightLeg = obj;
    } else if (obj.userData.isFumes) {
      components.fumes = obj;
    }
  });
  
  return components;
}

function animateIdleState(components, elapsedTime) {
  if (!sentinelGroup) return;
  
  // Gentle hover motion - higher up like in the image
  sentinelGroup.position.y = 0.7 + Math.sin(elapsedTime * 0.6) * 0.2;
  
  // Subtle body rotation
  sentinelGroup.rotation.z = Math.sin(elapsedTime * 0.4) * 0.05;
  
  // Arm motion - gentle swaying
  if (components.leftArm) {
    components.leftArm.rotation.z = Math.PI / 2.2 + Math.sin(elapsedTime * 0.8) * 0.1;
  }
  if (components.rightArm) {
    components.rightArm.rotation.z = -Math.PI / 2.2 - Math.sin(elapsedTime * 0.8) * 0.1;
  }
  
  // Leg motion - subtle kicking
  if (components.leftLeg) {
    components.leftLeg.rotation.x = Math.sin(elapsedTime) * 0.1;
  }
  if (components.rightLeg) {
    components.rightLeg.rotation.x = -Math.sin(elapsedTime) * 0.1;
  }
}

function animateTaskingState(components, elapsedTime) {
  if (!sentinelGroup) return;
  
  // More energetic hovering at higher position
  sentinelGroup.position.y = 1.5 + Math.sin(elapsedTime * 2) * 0.3;
  
  // Gentle spinning when working
  sentinelGroup.rotation.y += 0.02;
  sentinelGroup.rotation.z = Math.sin(elapsedTime * 1.2) * 0.1;
  
  // Energetic but cute arm motion
  if (components.leftArm) {
    components.leftArm.rotation.z = Math.PI / 2.2 + Math.sin(elapsedTime * 3) * 0.2;
    components.leftArm.rotation.x = Math.sin(elapsedTime * 4) * 0.15;
  }
  if (components.rightArm) {
    components.rightArm.rotation.z = -Math.PI / 2.2 - Math.sin(elapsedTime * 3 + 1) * 0.2;
    components.rightArm.rotation.x = Math.sin(elapsedTime * 4 + 1) * 0.15;
  }
  
  // Excited leg kicking
  if (components.leftLeg) {
    components.leftLeg.rotation.x = Math.sin(elapsedTime * 2) * 0.25;
  }
  if (components.rightLeg) {
    components.rightLeg.rotation.x = -Math.sin(elapsedTime * 2 + 1) * 0.25;
  }
}

function animateNormalState(components) {
  if (!sentinelGroup) return;
  
  // Hover at medium height
  sentinelGroup.position.y = 1.2;
  
  // Slowly return to neutral rotation
  sentinelGroup.rotation.y *= 0.95;
  sentinelGroup.rotation.z *= 0.95;
  
  // Reset arm and leg rotations
  if (components.leftArm) {
    components.leftArm.rotation.z = Math.PI / 2.2;
    components.leftArm.rotation.x *= 0.9;
  }
  if (components.rightArm) {
    components.rightArm.rotation.z = -Math.PI / 2.2;
    components.rightArm.rotation.x *= 0.9;
  }
  
  // Reset leg rotations
  if (components.leftLeg) {
    components.leftLeg.rotation.x *= 0.9;
  }
  if (components.rightLeg) {
    components.rightLeg.rotation.x *= 0.9;
  }
}

function animateJetFumes(fumes, delta) {
  if (!fumes || !fumes.geometry) return;
  
  const geometry = fumes.geometry;
  const positions = geometry.attributes.position.array;
  const velocities = geometry.userData.velocities;
  const lifetimes = geometry.userData.lifetimes;
  
  if (!positions || !velocities || !lifetimes) return;
  
  // Intensity based on state
  const intensity = sentinelState === 'tasking' ? 3 : 
                   sentinelState === 'idle' ? 1 : 0.5;
  
  for (let i = 0; i < lifetimes.length; i++) {
    const i3 = i * 3;
    
    // Update position
    positions[i3] += velocities[i3] * delta * 60;
    positions[i3 + 1] += velocities[i3 + 1] * delta * 60 * intensity;
    positions[i3 + 2] += velocities[i3 + 2] * delta * 60;
    
    // Update lifetime
    lifetimes[i] -= delta * intensity;
    
    // Reset particle if lifetime expired or too far away
    if (lifetimes[i] <= 0 || positions[i3 + 1] < -3) {
      positions[i3] = (Math.random() - 0.5) * 0.2;
      positions[i3 + 1] = -1.0;
      positions[i3 + 2] = -0.8 + (Math.random() - 0.5) * 0.2;
      
      velocities[i3] = (Math.random() - 0.5) * 0.05;
      velocities[i3 + 1] = -0.1 - Math.random() * 0.05 * intensity;
      velocities[i3 + 2] = (Math.random() - 0.5) * 0.05;
      
      lifetimes[i] = Math.random() * 2;
    }
  }
  
  // Update geometry
  geometry.attributes.position.needsUpdate = true;
}

function animateEyes(eyes, elapsedTime) {
  if (!eyes || eyes.length === 0) return;
  
  // More frequent blinking for cute effect
  const blinkCycle = Math.floor(elapsedTime * 2) % 4; // More frequent blinking
  const shouldBlink = blinkCycle >= 3.8;
  
  eyes.forEach(eye => {
    if (sentinelState === 'tasking') {
      // Brighter blue when tasking (not green like before)
      eye.material.color.set(0x00ffff);
      eye.material.opacity = 1.0;
    } else {
      // Normal blue eyes
      eye.material.color.set(0x00ddeb);
      eye.material.opacity = shouldBlink ? 0.2 : 0.9;
    }
  });
}

// WebGL context recovery handlers
function handleBgContextLost(event) {
  event.preventDefault();
  console.warn('Background WebGL context lost');
  stopAnimations();
  showFallback(bgFallback);
}

function handleBgContextRestored() {
  console.log('Background WebGL context restored');
  hideFallback(bgFallback);
  
  // Reinitialize scene objects
  createWormhole();
  createParticles();
  
  startAnimations();
}

function handleSentinelContextLost(event) {
  event.preventDefault();
  console.warn('Sentinel WebGL context lost');
  showFallback(sentinelFallback);
}

function handleSentinelContextRestored() {
  console.log('Sentinel WebGL context restored');
  hideFallback(sentinelFallback);
  
  // Reinitialize sentinel objects
  setupSentinelLighting();
  createSentinelRobot();
  
  startAnimations();
}

function showFallback(fallbackEl) {
  if (fallbackEl) {
    fallbackEl.style.display = 'block';
  }
}

function hideFallback(fallbackEl) {
  if (fallbackEl) {
    fallbackEl.style.display = 'none';
  }
}

// Memory management
function disposeScene(scene) {
  if (!scene) return;
  
  scene.traverse(object => {
    if (object.geometry) {
      object.geometry.dispose();
    }
    
    if (object.material) {
      if (Array.isArray(object.material)) {
        object.material.forEach(material => disposeMaterial(material));
      } else {
        disposeMaterial(object.material);
      }
    }
  });
}

function disposeMaterial(material) {
  if (!material) return;
  
  // Dispose textures
  Object.keys(material).forEach(prop => {
    if (!material[prop]) return;
    if (material[prop].isTexture) {
      material[prop].dispose();
    }
  });
  
  // Dispose material
  material.dispose();
}

// Initialize and start animations
function init() {
  const webGLSupport = checkWebGLSupport();
  
  if (!webGLSupport.supported) {
    console.error('WebGL not supported:', webGLSupport.reason);
    
    // Show fallbacks
    if (bgFallback) bgFallback.style.display = 'block';
    if (sentinelFallback) sentinelFallback.style.display = 'block';
    
    // Hide canvases
    if (bgCanvas) bgCanvas.style.display = 'none';
    if (sentinelCanvas) sentinelCanvas.style.display = 'none';
    
    return;
  }
  
  // Log WebGL capabilities for debugging
  console.log('WebGL supported with capabilities:', webGLSupport.capabilities);
  
  // Initialize scenes
  try {
    initBackgroundScene();
    initSentinelScene();
    startAnimations();
    
    // Log success
    console.log('Animation system initialized successfully');
  } catch (e) {
    console.error('Error initializing animations:', e);
    
    // Show fallbacks on error
    if (bgFallback) bgFallback.style.display = 'block';
    if (sentinelFallback) sentinelFallback.style.display = 'block';
  }
}

// Window resize handler with debounce
let resizeTimeout;
function handleResize() {
  clearTimeout(resizeTimeout);
  
  resizeTimeout = setTimeout(() => {
    // Update background
    if (bgRenderer && bgCamera) {
      bgCamera.aspect = window.innerWidth / window.innerHeight;
      bgCamera.updateProjectionMatrix();
      bgRenderer.setSize(window.innerWidth, window.innerHeight);
    }
    
    // Update sentinel
    if (sentinelRenderer && sentinelCamera) {
      sentinelCamera.aspect = sentinelCanvas.clientWidth / sentinelCanvas.clientHeight;
      sentinelCamera.updateProjectionMatrix();
      sentinelRenderer.setSize(sentinelCanvas.clientWidth, sentinelCanvas.clientHeight);
    }
  }, 250); // Debounce resize events
}

// Public API functions
function startAnimations() {
  // Reset clock to avoid large time jumps
  clock.start();
  
  // Reset context restore attempts counter
  contextRestoreAttempts = 0;
  
  // Cancel any existing animation frame first
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
  }
  
  // Start animation loop
  animate();
}

function stopAnimations() {
  // Cancel animation frame
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  
  // Stop the clock
  clock.stop();
}

function updateTaskState(running) {
  isTaskRunning = running;
  
  // Update sentinel state based on task state
  if (running) {
    updateSentinelState('tasking');
  } else {
    updateSentinelState('normal');
    
    // Set timeout to return to idle state after task completion
    setTimeout(() => {
      if (!isTaskRunning) {
        updateSentinelState('idle');
      }
    }, 10000);
  }
}

function updateSentinelState(state) {
  sentinelState = state;
  
  // Reset sentinel rotation on state change
  if (state === 'idle' && sentinelGroup) {
    sentinelGroup.rotation.y = 0;
  }
}

function cleanup() {
  // Stop animations
  stopAnimations();
  
  // Remove event listeners
  window.removeEventListener('resize', handleResize);
  
  if (bgCanvas) {
    bgCanvas.removeEventListener('webglcontextlost', handleBgContextLost);
    bgCanvas.removeEventListener('webglcontextrestored', handleBgContextRestored);
  }
  
  if (sentinelCanvas) {
    sentinelCanvas.removeEventListener('webglcontextlost', handleSentinelContextLost);
    sentinelCanvas.removeEventListener('webglcontextrestored', handleSentinelContextRestored);
  }
  
  // Dispose resources
  if (bgRenderer) {
    disposeScene(bgScene);
    bgRenderer.dispose();
  }
  
  if (sentinelRenderer) {
    disposeScene(sentinelScene);
    sentinelRenderer.dispose();
  }
}

// Setup event listeners
window.addEventListener('resize', handleResize);

// Export public API
export {
  init,
  startAnimations,
  stopAnimations,
  updateTaskState,
  updateSentinelState,
  handleResize,
  cleanup
};