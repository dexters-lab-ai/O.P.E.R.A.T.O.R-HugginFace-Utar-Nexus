import * as THREE from 'three';

export default class LogTimeline {
  constructor(container) {
    this.container = container;
    this.spheres = [];
    this.lines = [];
    this.splats = [];  // splatter effect meshes

    // --- Fixed high-res canvas for sharp visuals ---
    const CANVAS_WIDTH = 800;
    const CANVAS_HEIGHT = 400;
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setSize(CANVAS_WIDTH, CANVAS_HEIGHT, false);
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.top = '0';
    this.renderer.domElement.style.left = '0';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.maxWidth = '100%';
    this.renderer.domElement.style.maxHeight = '100%';
    this.renderer.domElement.width = CANVAS_WIDTH;
    this.renderer.domElement.height = CANVAS_HEIGHT;
    container.appendChild(this.renderer.domElement);

    // --- Proportional scene/camera setup ---
    this.scene = new THREE.Scene();
    // Orthographic camera: left, right, top, bottom, near, far
    const aspect = CANVAS_WIDTH / CANVAS_HEIGHT;
    this.camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 10);
    this.camera.position.z = 2;

    // Light
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(0, 0, 1);
    this.scene.add(light);

    // Group for timeline objects
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Start animation loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  animate() {
    const dt = 0.016;
    const now = Date.now();
    // Animate node entry (scale/glow)
    this.spheres.forEach(obj => {
      if (obj.mesh.entryAnim > 0) {
        obj.mesh.entryAnim -= dt * 1.6;
        if (obj.mesh.entryAnim < 0) obj.mesh.entryAnim = 0;
        obj.mesh.position.lerp(obj.mesh.targetPos, 1 - obj.mesh.entryAnim * 0.5);
        const s = 1.4 - 0.4 * obj.mesh.entryAnim;
        obj.mesh.scale.set(s, s, s);
        obj.mesh.material.emissiveIntensity = 1.2 - obj.mesh.entryAnim;
      } else {
        obj.mesh.position.lerp(obj.mesh.targetPos, 0.15);
        obj.mesh.scale.set(1, 1, 1);
        obj.mesh.material.emissiveIntensity = 0.6;
      }
      // Animate label sprite to follow node
      if (obj.mesh.labelSprite) {
        obj.mesh.labelSprite.position.copy(obj.mesh.position).add(new THREE.Vector3(0.24, 0.10, 0.15));
      }
    });

    // --- Animate neural arcs/branches with special final arc effect ---
    if (this.spheres.length > 1) {
      // Remove previous arcs
      this.lines.forEach(line => this.group.remove(line.mesh));
      this.lines = [];
      for (let i = 1; i < this.spheres.length; ++i) {
        const a = this.spheres[i-1].mesh.position;
        const b = this.spheres[i].mesh.position;
        // Neural curve: curve upward then down, or random slight bend
        const branchDir = (Math.random() - 0.5) * 0.16;
        const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, branchDir, 0));
        const curve = new THREE.CatmullRomCurve3([a, mid, b]);
        const points = curve.getPoints(36);
        const isFinalArc = this.spheres[i].isFinal;
        // Animate arc color/pulse for final
        const baseColor = isFinalArc ? 0x00ffb3 : 0x00ffe7;
        const glowColor = isFinalArc ? 0xffffff : 0x5f2fff;
        const arcMat = new THREE.LineBasicMaterial({
          color: i === this.hoveredIdx || i-1 === this.hoveredIdx ? glowColor : baseColor,
          linewidth: isFinalArc ? 6 : 3,
          transparent: true,
          opacity: isFinalArc ? (0.82 + 0.18 * Math.abs(Math.sin(now/200))) : (0.7 + 0.3 * Math.sin(now/320 + i)),
        });
        const arcGeo = new THREE.BufferGeometry().setFromPoints(points);
        const arc = new THREE.Line(arcGeo, arcMat);
        this.group.add(arc);
        // Animate a pulse traveling along the arc
        const pulseIdx = Math.floor(((now/2 + i*100) % 1000) / 1000 * points.length);
        const pulseGeo = new THREE.SphereGeometry(isFinalArc ? 0.045 : 0.022, 10, 10);
        const pulseMat = new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: isFinalArc ? 1 : 0.85 });
        const pulse = new THREE.Mesh(pulseGeo, pulseMat);
        pulse.position.copy(points[pulseIdx]);
        if (isFinalArc) {
          // Add celebratory pulse animation for final arc
          pulse.scale.setScalar(1.2 + 0.4 * Math.abs(Math.sin(now/160)));
        }
        this.group.add(pulse);
        this.lines.push({ mesh: arc });
        this.lines.push({ mesh: pulse });
      }
    }

    // --- Subtle node background glow, special for final node ---
    // Fix: nodeRadius must be defined here as in addLog
    const CANVAS_WIDTH = 800, CANVAS_HEIGHT = 400;
    const nodeRadius = 0.10 * (CANVAS_HEIGHT / CANVAS_WIDTH);
    this.spheres.forEach((obj, i) => {
      if (!obj.glowMesh) {
        const glowGeo = new THREE.SphereGeometry(obj.isFinal ? nodeRadius*2.2 : nodeRadius*1.5, 16, 16);
        const glowMat = new THREE.MeshBasicMaterial({
          color: obj.isFinal ? 0x00ffb3 : 0x00ffe7,
          transparent: true,
          opacity: obj.isFinal ? (0.24 + 0.16 * Math.abs(Math.sin(now/160))) : 0.13,
          depthWrite: false
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.position.copy(obj.mesh.position);
        this.group.add(glow);
        obj.glowMesh = glow;
      } else {
        obj.glowMesh.position.copy(obj.mesh.position);
        obj.glowMesh.material.opacity = obj.isFinal ? (0.24 + 0.16 * Math.abs(Math.sin(now/160))) : 0.13;
      }
    });

    // Animate ambient particles
    if (!this.particles) {
      this.particles = [];
      for (let i = 0; i < 36; ++i) {
        const pGeo = new THREE.SphereGeometry(0.012, 6, 6);
        const pMat = new THREE.MeshBasicMaterial({ color: 0x5f2fff, transparent: true, opacity: 0.22 });
        const p = new THREE.Mesh(pGeo, pMat);
        p.position.set(
          (Math.random()-0.5)*1.5,
          (Math.random()-0.5)*1.1,
          (Math.random()-0.5)*1.5
        );
        this.group.add(p);
        this.particles.push(p);
      }
    }
    this.particles.forEach((p, i) => {
      p.position.x += Math.sin(now/900 + i) * 0.0012;
      p.position.y += Math.cos(now/1000 + i*2) * 0.0013;
      p.position.z += Math.sin(now/1100 + i*3) * 0.0014;
    });

    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.animate);
  }

  addLog(text) {
    // --- Responsive, non-overlapping, snaking neural layout ---
    const CANVAS_WIDTH = 800, CANVAS_HEIGHT = 400;
    const idx = this.spheres.length;
    const nodeRadius = 0.10 * (CANVAS_HEIGHT / CANVAS_WIDTH);
    // Adaptive step count and snaking logic
    const maxStepsPerCol = Math.max(5, Math.floor((CANVAS_HEIGHT/nodeRadius/2.5) - 1));
    const col = Math.floor(idx / maxStepsPerCol);
    const row = idx % maxStepsPerCol;
    const totalCols = Math.ceil((this.spheres.length+1) / maxStepsPerCol);
    const xStart = -0.95 * (CANVAS_WIDTH / CANVAS_HEIGHT);
    const xEnd = 0.95 * (CANVAS_WIDTH / CANVAS_HEIGHT);
    const yTop = 0.8, yBot = -0.8;
    const xStep = (xEnd-xStart)/(Math.max(totalCols-1,1));
    let x = xStart + col*xStep;
    let y = yTop - row*((yTop-yBot)/(maxStepsPerCol-1));
    // Snake: odd columns go downward, even columns go upward
    if (col%2===1) y = yBot + row*((yTop-yBot)/(maxStepsPerCol-1));
    // Add slight jitter for neural look
    x += (Math.random()-0.5)*nodeRadius*0.3;
    y += (Math.random()-0.5)*nodeRadius*0.3;
    const z = (Math.random()-0.5)*0.1 + Math.sin(idx*1.2)*0.03;

    // --- Proportional node size, final step is visually distinct ---
    const isFinal = idx === (this.spheres.length+1)-1;
    const geo = new THREE.SphereGeometry(isFinal ? nodeRadius*1.3 : nodeRadius, 32, 32);
    const mat = new THREE.MeshPhysicalMaterial({
      color: isFinal ? 0x00ffb3 : 0x00f0ff,
      emissive: isFinal ? 0x00ffb3 : 0x0099bb,
      roughness: isFinal ? 0.13 : 0.23,
      metalness: 0.85,
      transparent: true,
      opacity: isFinal ? 1 : 0.97,
      transmission: 0.72,
      clearcoat: 0.8,
      clearcoatRoughness: isFinal ? 0.09 : 0.12
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + 1.1, z); // Start above, animates down
    mesh.targetPos = new THREE.Vector3(x, y, z);
    mesh.entryAnim = 1.0; // 1 = just appeared, animates to 0
    this.group.add(mesh);
    this.spheres.push({ mesh, label: text, isFinal });

    // --- 3D glowing text label (sprite, proportional, improved clarity, dark outline) ---
    const labelCanvasW = 420, labelCanvasH = 90;
    const labelFontSize = Math.round(labelCanvasH * 0.55);
    const labelPad = Math.round(labelCanvasH * 0.24);
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = labelCanvasW;
    labelCanvas.height = labelCanvasH;
    const ctx = labelCanvas.getContext('2d');
    ctx.font = `bold ${labelFontSize}px 'Orbitron', 'Segoe UI', Arial, sans-serif`;
    ctx.shadowColor = isFinal ? '#00ffb3' : '#00ffe7';
    ctx.shadowBlur = 22;
    ctx.fillStyle = isFinal ? '#00ffb3' : '#00f0ff';
    ctx.textBaseline = 'middle';
    // --- Add dark outline for max readability ---
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#111';
    // Truncate/wrap text if too long
    let labelText = text;
    if (ctx.measureText(labelText).width > labelCanvasW-labelPad*2) {
      while (ctx.measureText(labelText+"…").width > labelCanvasW-labelPad*2 && labelText.length>2) labelText = labelText.slice(0,-1);
      labelText += "…";
    }
    ctx.strokeText(labelText, labelPad, labelCanvasH/2);
    ctx.fillText(labelText, labelPad, labelCanvasH / 2);
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    const spriteMat = new THREE.SpriteMaterial({ map: labelTexture, transparent: true, opacity: isFinal ? 1 : 0.97, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    // Proportional label position/scale
    sprite.position.set(x + nodeRadius * 1.4, y + nodeRadius * 0.7, z + nodeRadius * 0.5);
    sprite.scale.set(nodeRadius * 8.2, nodeRadius * 1.9, 1);
    this.group.add(sprite);
    mesh.labelSprite = sprite;

    // --- Animated checkmark for final node ---
    if (isFinal) {
      const checkCanvas = document.createElement('canvas');
      checkCanvas.width = 90; checkCanvas.height = 90;
      const cctx = checkCanvas.getContext('2d');
      cctx.strokeStyle = '#00ffb3';
      cctx.lineWidth = 8;
      cctx.shadowColor = '#fff';
      cctx.shadowBlur = 14;
      cctx.lineCap = 'round';
      // Animate checkmark drawing
      let progress = 0;
      const drawCheck = () => {
        cctx.clearRect(0,0,90,90);
        cctx.beginPath();
        cctx.moveTo(18, 50);
        cctx.lineTo(38, 70);
        cctx.lineTo(72, 22);
        cctx.stroke();
      };
      drawCheck();
      const tex = new THREE.CanvasTexture(checkCanvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 1 });
      const checkSprite = new THREE.Sprite(mat);
      checkSprite.position.copy(mesh.targetPos).add(new THREE.Vector3(0, nodeRadius*0.18, 0));
      checkSprite.scale.set(nodeRadius*1.4, nodeRadius*1.4, 1);
      this.group.add(checkSprite);
      mesh.checkSprite = checkSprite;
    }

    // Interactive: register raycast targets for hover/click
    if (!this.raycastTargets) this.raycastTargets = [];
    this.raycastTargets.push(mesh);
  }

  // --- Interactive Hover/Click ---
  _setupRaycaster() {
    if (this._raycasterSetup) return;
    this._raycasterSetup = true;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hoveredIdx = -1;
    this.tooltipSprite = null;
    this.renderer.domElement.addEventListener('mousemove', (event) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    });
    this.renderer.domElement.addEventListener('click', () => {
      if (this.hoveredIdx >= 0) this._showTooltip(this.hoveredIdx);
    });
  }

  _showTooltip(idx) {
    if (this.tooltipSprite) this.group.remove(this.tooltipSprite);
    const log = this.spheres[idx]?.label || '';
    const canvas = document.createElement('canvas');
    canvas.width = 420; canvas.height = 120;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 24px "Orbitron", "Segoe UI", Arial, sans-serif';
    ctx.shadowColor = '#5f2fff';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'top';
    ctx.fillText(log, 18, 40);
    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.98 });
    const sprite = new THREE.Sprite(mat);
    const mesh = this.spheres[idx].mesh;
    sprite.position.copy(mesh.position).add(new THREE.Vector3(0.1, 0.24, 0.1));
    sprite.scale.set(2.6, 0.8, 1);
    this.group.add(sprite);
    this.tooltipSprite = sprite;
    setTimeout(() => { if (this.tooltipSprite) this.group.remove(this.tooltipSprite); }, 2400);
  }
}
