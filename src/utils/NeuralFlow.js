/**
 * NeuralFlow.js - Lightweight, beautiful canvas-based neural flow visualization
 * A modern, lightweight alternative to 3D visualization for thought logs
 */

export default class NeuralFlow {
  constructor(container) {
    this.container = container;
    this.nodes = [];
    this.branches = []; // Store branch connections between main and sub-steps
    this.animationFrameId = null;
    this.hoveredNodeIdx = -1;
    this.lastFrameTime = 0;
    this.particleTime = 0;
    this.planNodeCreated = false; // Flag to identify if we have a plan node already
    this.autoScrollEnabled = true; // Enable auto-scrolling by default
    this.cameraY = 0; // Track camera vertical position
    this.targetCameraY = 0; // Target camera position for smooth panning
    
    // Create high-res canvas for crisp rendering
    this.initCanvas();
    
    // Start animation loop
    this.animate = this.animate.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleClick = this.handleClick.bind(this);
    
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('click', this.handleClick);
    
    requestAnimationFrame(this.animate);
  }
  
  initCanvas() {
    // Create high-DPI canvas for sharp rendering
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.container.appendChild(this.canvas);
    
    // Set actual canvas dimensions for high resolution
    this.resize();
    
    // Handle resize events
    window.addEventListener('resize', () => {
      this.resize();
    });
  }
  
  resize() {
    // Get actual container dimensions
    const rect = this.container.getBoundingClientRect();
    const width = rect.width;
    
    // Dynamically adjust the height based on content
    // Make it taller as more nodes are added to accommodate the visualization
    const minHeight = 300; // Minimum height
    
    // Calculate required height based on node positions - ensure all nodes are visible
    let maxNodeY = 0;
    if (this.nodes.length > 0) {
      // Find the lowest node's y-position plus some padding
      maxNodeY = Math.max(...this.nodes.map(node => node.y + 100));
    }
    
    // Ensure enough space for all nodes plus buffer space at bottom
    const nodeHeight = Math.max(this.nodes.length * 70, minHeight); 
    const calculatedHeight = Math.max(maxNodeY + 200, nodeHeight);
    const height = Math.max(rect.height || calculatedHeight, calculatedHeight);
    
    // Set canvas dimensions to match content - use higher resolution for crisp rendering
    const pixelRatio = window.devicePixelRatio || 2; // For HD quality
    this.canvas.width = width * pixelRatio;
    this.canvas.height = height * pixelRatio;
    this.ctx.scale(pixelRatio, pixelRatio); // Scale context to match high DPI
    
    this.width = width;
    this.height = height;
    
    // Skip layout recalculation if no nodes exist yet
    if (this.nodes.length > 0) {
      // Recalculate node layout when resized
      this.updateNodePositions();
    }
    
    // Ensure the container has a minimum height to display all nodes
    this.container.style.minHeight = `${height}px`;
    
    // Auto-scroll to the latest content
    if (this.nodes.length > 0 && this.autoScrollEnabled) {
      this.container.scrollTop = this.container.scrollHeight;
    }
  }
  
  updateNodePositions() {
    if (!this.nodes.length) return;
    
    // Find main (non-sub) nodes
    const mainNodes = this.nodes.filter(node => !node.isSubStep);
    
    // Calculate layout dimensions
    const mainNodesPerRow = Math.max(3, Math.min(5, Math.floor(this.width / 200)));
    const verticalSpacing = Math.min(70, this.height / 5);
    const subNodeOffset = { x: 40, y: 36 }; // Offset for sub-steps
    
    // Position main nodes first
    mainNodes.forEach((node, mainIdx) => {
      const idx = this.nodes.indexOf(node);
      const row = Math.floor(mainIdx / mainNodesPerRow);
      const col = mainIdx % mainNodesPerRow;

      // For alternating rows, reverse direction for organic brain feel
      const x = row % 2 === 0 
        ? 90 + col * ((this.width - 180) / (mainNodesPerRow - 1 || 1))
        : this.width - 90 - col * ((this.width - 180) / (mainNodesPerRow - 1 || 1));
      
      const y = 80 + row * verticalSpacing;
      
      // Set target position with slight random variation (less for plan node)
      const randomJitter = node.isPlanNode ? 5 : 15;
      node.tx = x + (Math.random() - 0.5) * randomJitter;
      node.ty = y + (Math.random() - 0.5) * randomJitter;
      
      if (!node.x) {
        // Initial position for animation
        node.x = node.isPlanNode ? node.tx : node.tx;
        node.y = node.isPlanNode ? node.ty - 80 : -50; // Plan node comes from top
      }
      
      // Now position any sub-steps related to this main node
      const subSteps = this.nodes.filter(n => n.parentStepId === idx);
      
      subSteps.forEach((subNode, subIdx) => {
        // Position in a semi-circle around the parent
        const angle = -Math.PI/2 + (Math.PI * (subIdx / Math.max(subSteps.length, 1)));
        const distance = node.radius * 5.5;
        
        subNode.tx = node.tx + Math.cos(angle) * distance;
        subNode.ty = node.ty + Math.sin(angle) * distance + 10;
        
        // Add slight random variation
        subNode.tx += (Math.random() - 0.5) * 10;
        subNode.ty += (Math.random() - 0.5) * 10;
        
        if (!subNode.x) {
          subNode.x = node.tx; // Start from parent
          subNode.y = node.ty;
        }
      });
    });
    
    // Special positioning for plan node if it exists
    const planNode = this.nodes.find(node => node.isPlanNode);
    if (planNode) {
      // Always position plan node prominently
      planNode.tx = 90;
      planNode.ty = 90;
      if (!planNode.x) {
        planNode.x = planNode.tx;
        planNode.y = -50; // Start from above
      }
    }
  }
  
  addNode(text) {
    // Determine node type based on text content
    const isPlanNode = !this.planNodeCreated && 
                        (text.toLowerCase().includes('plan created') || 
                         text.toLowerCase().includes('planning') || 
                         text.toLowerCase().includes('creating plan'));
    const isStepNode = text.match(/step\s+\d+/i) || 
                        text.match(/executing step/i) || 
                        text.toLowerCase().includes('executing');
    let parentStepId = -1;
    
    // Check if this is a sub-step by looking for parent indicators
    // Extract step number if this is a main step
    let stepNumber = null;
    const stepMatch = text.match(/step\s+(\d+)/i);
    if (stepMatch) {
      stepNumber = parseInt(stepMatch[1]);
    }
    
    // Look for completion pattern to determine if this is a completion node
    const isCompletionNode = text.toLowerCase().includes('complete') || 
                             text.toLowerCase().includes('finished') || 
                             text.toLowerCase().includes('completed');
                             
    // Check if this is related to an existing step
    this.nodes.forEach((existingNode, idx) => {
      if (existingNode.stepNumber && text.includes(`step ${existingNode.stepNumber}`)) {
        parentStepId = idx;
      }
    });
    
    // Determine if it's the final node
    const isFinal = this.nodes.length === 0 ? false : false; // Updated later
    
    // Mark the special node types
    if (isPlanNode) this.planNodeCreated = true;
    
    // Create the node with appropriate properties
    const node = {
      text,
      isPlanNode,
      isStepNode,
      stepNumber,
      isCompletionNode,
      isFinal,
      parentStepId,
      isSubStep: parentStepId >= 0,
      x: 0, 
      y: 0,
      tx: 0, // target x
      ty: 0, // target y
      radius: isPlanNode ? 18 : 11, // Plan node is larger
      dendrites: [], // Brain cell dendrites (randomly generated)
      dendriteCount: isPlanNode ? 9 : (Math.floor(Math.random() * 4) + 4), // More for plan node
      alpha: 0, // for fade-in
      hovered: false,
      pulsePhase: Math.random() * Math.PI * 2, // randomize pulse
      energyParticles: [], 
      timeCreated: Date.now()
    };
    
    // Generate brain cell-like dendrites
    for (let i = 0; i < node.dendriteCount; i++) {
      const angle = (i / node.dendriteCount) * Math.PI * 2;
      const length = node.radius * (0.7 + Math.random() * 0.6);
      const curve = 0.3 + Math.random() * 0.5;
      
      node.dendrites.push({
        angle,
        length, 
        curve,
        pulseOffset: Math.random() * Math.PI * 2
      });
    }
    
    const nodeIdx = this.nodes.length;
    this.nodes.push(node);
    
    // Create branch connection if this is a sub-step
    if (parentStepId >= 0) {
      this.branches.push({
        fromIdx: parentStepId,
        toIdx: nodeIdx,
        type: 'sub-step'
      });
    } 
    // Otherwise, connect to previous node if not a plan node
    else if (nodeIdx > 0 && !isPlanNode) {
      // Find the most recent non-sub-step to connect to, or connect to plan node
      let connectToIdx = nodeIdx - 1;
      while (connectToIdx > 0 && this.nodes[connectToIdx].isSubStep) {
        connectToIdx--;
      }
      
      this.branches.push({
        fromIdx: connectToIdx,
        toIdx: nodeIdx,
        type: 'main-flow'
      });
    }
    
    // Update the "isFinal" flag to be true only for the last node
    this.nodes.forEach((n, i) => {
      n.isFinal = (i === this.nodes.length - 1);
    });
    
    this.updateNodePositions();
    this.panCameraToLatestNode();
    return node;
  }
  
  panCameraToLatestNode() {
    const latestNode = this.nodes[this.nodes.length - 1];
    const nodeY = latestNode.y + latestNode.radius;
    const viewportHeight = window.innerHeight;
    const containerHeight = this.container.offsetHeight;
    
    // Calculate target camera position
    const targetY = Math.max(0, Math.min(nodeY - viewportHeight / 2, containerHeight - viewportHeight));
    
    // Smoothly animate camera to target position
    this.targetCameraY = targetY;
  }
  
  handleMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Check for node hover
    this.hoveredNodeIdx = -1;
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      const dx = mouseX - node.x;
      const dy = mouseY - node.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      // Update hovered state
      const wasHovered = node.hovered;
      node.hovered = dist < node.radius * 1.8;
      
      // If found a hovered node, store its index
      if (node.hovered) {
        this.hoveredNodeIdx = i;
        
        // If just started hovering, create "ripple" effect
        if (!wasHovered) {
          this.createRipple(node);
        }
      }
    }
    
    // Update cursor
    this.canvas.style.cursor = this.hoveredNodeIdx >= 0 ? 'pointer' : 'default';
  }
  
  handleClick(e) {
    if (this.hoveredNodeIdx >= 0) {
      const node = this.nodes[this.hoveredNodeIdx];
      
      // Create tooltip with expanded details
      this.showTooltip(node);
    }
  }
  
  createRipple(node) {
    if (!node.ripples) node.ripples = [];
    
    node.ripples.push({
      radius: node.radius * 1.2,
      alpha: 0.8,
      maxRadius: node.radius * 4
    });
  }
  
  showTooltip(node) {
    // Clear any existing tooltip
    if (this.tooltip) {
      this.container.removeChild(this.tooltip);
    }
    
    // Format the detailed tooltip content with enhanced information
    const formattedTime = new Date(node.timeCreated).toLocaleTimeString();
    const formattedDate = new Date(node.timeCreated).toLocaleDateString();
    let nodeType = "Processing Step";
    let nodeIcon = '🔄';
    
    // Determine node type with specific icons
    if (node.isPlanNode) {
      nodeType = "Plan Creation";
      nodeIcon = '🧠';
    } else if (node.isCompletionNode) {
      nodeType = "Task Completion";
      nodeIcon = '✅';
    } else if (node.isSubStep) {
      nodeType = "Sub-step";
      nodeIcon = '📎';
    } else if (node.isFinal) {
      nodeType = "Final Step";
      nodeIcon = '🏁';
    }
    
    // Find connections for contextual information
    const connectedNodes = [];
    if (node.parentStepId !== undefined && node.parentStepId >= 0) {
      const parentNode = this.nodes[node.parentStepId];
      if (parentNode) {
        connectedNodes.push({ type: 'Parent', text: parentNode.text.substring(0, 40) + '...' });
      }
    }
    
    // Find child nodes (sub-steps)
    const childNodes = this.nodes.filter(n => n.parentStepId === this.nodes.indexOf(node));
    if (childNodes.length > 0) {
      connectedNodes.push({ type: 'Sub-steps', count: childNodes.length });
    }
    
    // Get progression information
    const nodeIndex = this.nodes.indexOf(node);
    const totalNodes = this.nodes.length;
    const progress = Math.round((nodeIndex / Math.max(1, totalNodes - 1)) * 100);
    
    // Build rich tooltip HTML
    let tooltipContent = `
      <div class="neural-tooltip-header">
        <div class="neural-tooltip-type">${nodeIcon} ${nodeType}</div>
        <div class="neural-tooltip-time">${formattedTime}</div>
      </div>
      <div class="neural-tooltip-content">${node.text}</div>
      <div class="neural-tooltip-details">
        <div class="neural-tooltip-detail"><span>Created:</span> ${formattedDate} ${formattedTime}</div>
        ${node.stepNumber ? `<div class="neural-tooltip-detail"><span>Step:</span> ${node.stepNumber} of ${totalNodes}</div>` : ''}
        <div class="neural-tooltip-detail"><span>Progress:</span> <div class="tooltip-progress-bar"><div style="width: ${progress}%"></div></div> ${progress}%</div>
      </div>
    `;
    
    // Add connection information if available
    if (connectedNodes.length > 0) {
      tooltipContent += `<div class="neural-tooltip-connections">`;
      connectedNodes.forEach(conn => {
        if (conn.type === 'Parent') {
          tooltipContent += `<div class="neural-tooltip-connection"><span>Parent:</span> ${conn.text}</div>`;
        } else if (conn.type === 'Sub-steps') {
          tooltipContent += `<div class="neural-tooltip-connection"><span>Sub-steps:</span> ${conn.count}</div>`;
        }
      });
      tooltipContent += `</div>`;
    }
    
    if (node.isPlanNode) {
      tooltipContent += `<div class="neural-tooltip-help">Start of processing sequence</div>`;
    }
    
    if (node.isFinal) {
      tooltipContent += `<div class="neural-tooltip-help">Final processing step</div>`;
    }
    
    // Create tooltip element with enhanced styling
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'neural-flow-tooltip';
    this.tooltip.innerHTML = tooltipContent;
    this.tooltip.style.position = 'absolute';
    this.tooltip.style.left = `${node.x}px`;
    this.tooltip.style.top = `${node.y - 15}px`;
    this.tooltip.style.transform = 'translate(-50%, -100%)';
    this.tooltip.style.backgroundColor = 'rgba(20, 20, 40, 0.92)';
    this.tooltip.style.color = '#fff';
    this.tooltip.style.padding = '12px 16px';
    this.tooltip.style.borderRadius = '12px';
    this.tooltip.style.width = '320px';
    this.tooltip.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.5), 0 0 15px rgba(0, 150, 255, 0.3)';
    this.tooltip.style.backdropFilter = 'blur(10px)';
    this.tooltip.style.zIndex = '10000';
    this.tooltip.style.overflow = 'hidden';
    this.tooltip.style.opacity = '0';
    this.tooltip.style.transition = 'opacity 0.3s, transform 0.3s';
    this.tooltip.style.transform = 'translate(-50%, -90%)'; // Start slightly lower
    
    // Add internal styling
    const style = document.createElement('style');
    style.textContent = `
      .neural-tooltip-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        border-bottom: 1px solid rgba(255,255,255,0.2);
        padding-bottom: 8px;
      }
      .neural-tooltip-type {
        font-weight: bold;
        color: ${node.isPlanNode ? '#b388ff' : (node.isFinal ? '#00ffb3' : '#00e5ff')};
        font-size: 14px;
      }
      .neural-tooltip-time {
        font-size: 12px;
        opacity: 0.7;
      }
      .neural-tooltip-content {
        font-size: 14px;
        line-height: 1.4;
        margin-bottom: 8px;
        font-family: 'Segoe UI', Arial, sans-serif;
        max-height: 120px;
        overflow-y: auto;
        white-space: normal;
        word-break: break-word;
      }
      .neural-tooltip-detail {
        font-size: 13px;
        margin-top: 6px;
        padding: 4px 8px;
        background: rgba(255,255,255,0.1);
        border-radius: 4px;
        display: inline-block;
      }
      .neural-tooltip-help {
        font-size: 12px;
        opacity: 0.7;
        font-style: italic;
        margin-top: 6px;
      }
    `;
    this.tooltip.appendChild(style);
    
    // Add to container
    this.container.appendChild(this.tooltip);
    
    // Animate in with smooth transition
    setTimeout(() => {
      this.tooltip.style.opacity = '1';
      this.tooltip.style.transform = 'translate(-50%, -100%)';
    }, 10);
    
    // Auto-remove after delay, but longer for more reading time
    setTimeout(() => {
      if (this.tooltip) {
        this.tooltip.style.opacity = '0';
        this.tooltip.style.transform = 'translate(-50%, -90%)';
        setTimeout(() => {
          if (this.tooltip && this.tooltip.parentNode) {
            this.container.removeChild(this.tooltip);
            this.tooltip = null;
          }
        }, 300);
      }
    }, 5000); // Longer display time - 5 seconds
  }
  
  // Main animation loop
  animate(timestamp) {
    // Calculate delta time for smooth animations
    const deltaTime = (timestamp - this.lastFrameTime) / 1000;
    this.lastFrameTime = timestamp;
    this.particleTime += deltaTime;
    
    // Clear canvas with transparent background
    this.ctx.clearRect(0, 0, this.width, this.height);
    
    // Draw connections between nodes first (under nodes)
    this.drawConnections();
    
    // Draw ambient particles
    this.drawAmbientParticles();
    
    // Draw nodes
    this.nodes.forEach((node, i) => this.drawNode(node, i, timestamp));
    
    // Animate out tooltip if present and we're not hovering relevant node
    if (this.tooltip && this.hoveredNodeIdx === -1) {
      this.tooltip.style.opacity = '0';
      setTimeout(() => {
        if (this.tooltip && this.tooltip.parentNode) {
          this.container.removeChild(this.tooltip);
          this.tooltip = null;
        }
      }, 200);
    }
    
    // Smoothly pan camera to target position
    this.cameraY += (this.targetCameraY - this.cameraY) * 0.1;
    this.container.scrollTop = this.cameraY;
    
    // Continue animation loop
    this.animationFrameId = requestAnimationFrame(this.animate);
  }
  
  drawConnections() {
    const now = Date.now();
    
    // Draw all branch connections from the branch list instead of sequential
    this.branches.forEach(branch => {
      const fromNode = this.nodes[branch.fromIdx];
      const toNode = this.nodes[branch.toIdx];
      
      // Only draw if both nodes have faded in
      if (fromNode.alpha < 0.1 || toNode.alpha < 0.1) return;
      
      // Determine connection style based on branch type
      const isMainFlow = branch.type === 'main-flow';
      const isSubStep = branch.type === 'sub-step';
      const isPlanConnection = fromNode.isPlanNode || toNode.isPlanNode;
      const isFinalConnection = toNode.isFinal;
      const isCompletionConnection = toNode.isCompletionNode;
      
      // Calculate control points for curved path - more curve for sub-steps
      const midX = (fromNode.x + toNode.x) / 2;
      const midY = (fromNode.y + toNode.y) / 2;
      
      // Add appropriate curve based on connection type and distance
      const dx = toNode.x - fromNode.x;
      const dy = toNode.y - fromNode.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      
      // Different curve styles for different connection types
      let curveFactor;
      if (isSubStep) {
        // Sub-steps have more pronounced curves
        curveFactor = Math.min(0.45, 80 / dist);
      } else if (isPlanConnection) {
        // Plan connections have slight, elegant curves
        curveFactor = Math.min(0.15, 30 / dist);
      } else {
        // Regular flow has natural neural curves
        curveFactor = Math.min(0.2, 40 / dist);
      }
      
      // Add slight randomization for organic feel
      const randomShift = isSubStep ? 0.1 : 0.05;
      const controlX = midX + dy * curveFactor * (1 + (Math.random() - 0.5) * randomShift);
      const controlY = midY - dx * curveFactor * (1 + (Math.random() - 0.5) * randomShift);
      
      // Create path for drawing
      const path = [];
      const steps = 30; // More steps for smoother curve
      
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = Math.pow(1-t, 2) * fromNode.x + 2 * (1-t) * t * controlX + Math.pow(t, 2) * toNode.x;
        const y = Math.pow(1-t, 2) * fromNode.y + 2 * (1-t) * t * controlY + Math.pow(t, 2) * toNode.y;
        path.push({x, y});
      }
      
      // Draw brain-like axon connection (slightly thicker near nodes, thinner in middle)
      this.ctx.save();
      
      // Determine connection color based on type
      let connectionColors;
      
      if (isPlanConnection) {
        // Plan node connections: purple
        connectionColors = {
          start: 'rgba(170, 100, 255, 0.8)',
          end: 'rgba(100, 160, 255, 0.7)',
          pulse: 'rgba(200, 150, 255, 0.9)',
          glow: 'rgba(170, 100, 255, 0.6)'
        };
      } else if (isFinalConnection) {
        // Final node: teal green
        connectionColors = {
          start: 'rgba(0, 210, 255, 0.8)',
          end: 'rgba(0, 255, 180, 0.8)',
          pulse: 'rgba(120, 255, 210, 0.9)',
          glow: 'rgba(0, 255, 180, 0.6)'
        };
      } else if (isCompletionConnection) {
        // Completion connections: aqua
        connectionColors = {
          start: 'rgba(0, 180, 220, 0.7)',
          end: 'rgba(0, 220, 200, 0.7)',
          pulse: 'rgba(100, 240, 230, 0.8)',
          glow: 'rgba(0, 200, 210, 0.5)'
        };
      } else if (isSubStep) {
        // Substep connections: lighter blue
        connectionColors = {
          start: 'rgba(70, 150, 240, 0.6)',
          end: 'rgba(90, 170, 255, 0.6)',
          pulse: 'rgba(130, 190, 255, 0.8)',
          glow: 'rgba(80, 160, 245, 0.4)'
        };
      } else {
        // Regular connections: blue
        connectionColors = {
          start: 'rgba(30, 160, 255, 0.7)',
          end: 'rgba(50, 180, 255, 0.7)',
          pulse: 'rgba(100, 200, 255, 0.8)', 
          glow: 'rgba(40, 170, 255, 0.5)'
        };
      }
      
      // Check if this connection involves a hovered node
      const isHighlighted = (branch.fromIdx === this.hoveredNodeIdx || branch.toIdx === this.hoveredNodeIdx);
      
      // Draw the main connection with gradient
      const gradient = this.ctx.createLinearGradient(fromNode.x, fromNode.y, toNode.x, toNode.y);
      gradient.addColorStop(0, connectionColors.start);
      gradient.addColorStop(1, connectionColors.end);
      
      // Draw the path with varying thickness
      for (let i = 1; i < path.length; i++) {
        const prev = path[i-1];
        const curr = path[i];
        
        // Calculate progress along the path for thickness variation
        const progress = i / path.length;
        const thickness = isHighlighted ? 2.5 : 1.8;
        
        // Axon is thicker near the nodes, thinner in middle - gives organic feel
        const axonThickness = thickness * (1 - 0.4 * Math.sin(progress * Math.PI));
        
        this.ctx.beginPath();
        this.ctx.moveTo(prev.x, prev.y);
        this.ctx.lineTo(curr.x, curr.y);
        this.ctx.strokeStyle = gradient;
        this.ctx.lineWidth = axonThickness;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.stroke();
      }
      
      // Add subtle glow effect around connection
      this.ctx.shadowColor = connectionColors.glow;
      this.ctx.shadowBlur = isHighlighted ? 12 : 8;
      this.ctx.beginPath();
      this.ctx.moveTo(path[0].x, path[0].y);
      
      for (let i = 1; i < path.length; i++) {
        this.ctx.lineTo(path[i].x, path[i].y);
      }
      
      this.ctx.strokeStyle = gradient;
      this.ctx.lineWidth = isHighlighted ? 1.8 : 1.5;
      this.ctx.stroke();
      this.ctx.restore();
      
      // Draw energy pulses along the path
      this.drawNeuralPulses(fromNode, toNode, path, connectionColors, isHighlighted);
    });
  }
  
  // Draw neural pulse animations traveling along connections
  drawNeuralPulses(fromNode, toNode, path, colors, isHighlighted) {
    const now = Date.now();
    
    // Create pulses at intervals
    if (!fromNode.pulses) fromNode.pulses = [];
    
    // Add new pulse occasionally
    if (Math.random() < 0.03) {
      fromNode.pulses.push({
        progress: 0,
        speed: 0.002 + Math.random() * 0.002,
        size: isHighlighted ? 3.5 : 2.8,
        createdAt: now
      });
    }
    
    // Move and draw existing pulses
    fromNode.pulses = fromNode.pulses.filter(pulse => {
      // Update progress
      pulse.progress += pulse.speed;
      
      // Remove if completed
      if (pulse.progress >= 1) return false;
      
      // Calculate position along path
      const pathIdx = Math.min(Math.floor(pulse.progress * path.length), path.length - 1);
      const pulseX = path[pathIdx].x;
      const pulseY = path[pathIdx].y;
      
      // Calculate glow effect
      const age = (now - pulse.createdAt) / 1000;
      const pulseIntensity = Math.min(1, age * 2) * (1 - pulse.progress * 0.5);
      
      // Draw pulse
      this.ctx.save();
      
      // Create circular glow
      const glowSize = pulse.size * (1.5 + Math.sin(now/200) * 0.3);
      const gradient = this.ctx.createRadialGradient(
        pulseX, pulseY, 0,
        pulseX, pulseY, glowSize
      );
      
      gradient.addColorStop(0, colors.pulse);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      
      this.ctx.beginPath();
      this.ctx.arc(pulseX, pulseY, glowSize, 0, Math.PI * 2);
      this.ctx.fillStyle = gradient;
      this.ctx.fill();
      
      // Draw core of pulse
      this.ctx.beginPath();
      this.ctx.arc(pulseX, pulseY, pulse.size * 0.7, 0, Math.PI * 2);
      this.ctx.fillStyle = colors.pulse;
      this.ctx.fill();
      
      this.ctx.restore();
      
      return true;
    });
  }
  
  drawEnergyParticles(from, to, controlX, controlY, isFinal) {
    const now = Date.now();
    const pathSegments = 30;
    
    // Create particle every so often
    if (Math.random() < 0.3) {
      const particle = {
        progress: 0,
        speed: 0.6 + Math.random() * 0.7,
        size: isFinal ? 4 : 3,
        color: isFinal ? 'rgba(0, 255, 180, 0.9)' : 'rgba(0, 210, 255, 0.9)',
        born: now
      };
      
      if (!from.energyParticles) from.energyParticles = [];
      from.energyParticles.push(particle);
    }
    
    // Animate existing particles
    if (from.energyParticles) {
      from.energyParticles.forEach((p, i) => {
        // Update progress
        p.progress += (p.speed / 50);
        
        // If completed, remove
        if (p.progress >= 1) {
          from.energyParticles.splice(i, 1);
          return;
        }
        
        // Calculate position on quadratic curve
        const t = p.progress;
        const x = (1-t)*(1-t)*from.x + 2*(1-t)*t*controlX + t*t*to.x;
        const y = (1-t)*(1-t)*from.y + 2*(1-t)*t*controlY + t*t*to.y;
        
        // Draw particle
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(x, y, p.size, 0, Math.PI * 2);
        this.ctx.fillStyle = p.color;
        this.ctx.shadowColor = p.color;
        this.ctx.shadowBlur = 10;
        this.ctx.fill();
        this.ctx.restore();
      });
    }
  }
  
  drawAmbientParticles() {
    if (!this.particles) {
      // Initialize particles
      this.particles = [];
      for (let i = 0; i < 25; i++) {
        this.particles.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          size: 0.5 + Math.random() * 1.5,
          speed: 0.2 + Math.random() * 0.7,
          angle: Math.random() * Math.PI * 2,
          angleSpeed: (Math.random() - 0.5) * 0.02,
          alpha: 0.1 + Math.random() * 0.4
        });
      }
    }
    
    // Update and draw particles
    this.particles.forEach(p => {
      // Update position
      p.angle += p.angleSpeed;
      p.x += Math.cos(p.angle) * p.speed;
      p.y += Math.sin(p.angle) * p.speed;
      
      // Wrap around screen
      if (p.x < 0) p.x = this.width;
      if (p.x > this.width) p.x = 0;
      if (p.y < 0) p.y = this.height;
      if (p.y > this.height) p.y = 0;
      
      // Draw particle
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(100, 210, 255, ${p.alpha})`;
      this.ctx.fill();
    });
  }
  
  drawNode(node, idx, timestamp) {
    // Smooth animation to target position
    node.alpha = Math.min(1, node.alpha + 0.02);
    node.x = node.x + (node.tx - node.x) * 0.1;
    node.y = node.y + (node.ty - node.y) * 0.1;
    
    const timeSinceCreation = Date.now() - node.timeCreated;
    const isRecent = timeSinceCreation < 1000;
    
    // Determine node appearance
    const isHovered = node.hovered;
    const isPlanNode = node.isPlanNode;
    const isFinal = node.isFinal;
    const isSubStep = node.isSubStep;
    const isCompletionNode = node.isCompletionNode;
    
    // Different pulse rates for different node types
    const pulseFreq = isPlanNode ? 0.0015 : (isFinal ? 0.002 : 0.001);
    const pulseAmp = isPlanNode ? 0.5 : (isFinal ? 0.4 : 0.2);
    const pulse = Math.sin(timestamp * pulseFreq + node.pulsePhase) * pulseAmp + 1;
    
    // Different color schemes for different node types
    let nodeColors = {};
    
    if (isPlanNode) {
      // Plan node: purple/blue brain cell
      nodeColors = {
        main: `rgba(170, 100, 255, ${node.alpha})`,
        glow: `rgba(170, 100, 255, ${0.5 * pulse * node.alpha})`,
        ring: `rgba(170, 100, 255, ${0.8 * node.alpha})`,
        text: `rgba(200, 180, 255, ${node.alpha})`,
        nucleus: `rgba(120, 80, 220, ${0.9 * node.alpha})`,
        dendrite: `rgba(170, 100, 255, ${0.7 * node.alpha})`
      };
    } else if (isFinal) {
      // Final node: green/teal
      nodeColors = {
        main: `rgba(0, 255, 180, ${node.alpha})`,
        glow: `rgba(0, 255, 180, ${0.4 * pulse * node.alpha})`,
        ring: `rgba(0, 255, 180, ${0.8 * node.alpha})`,
        text: `rgba(140, 255, 210, ${node.alpha})`,
        nucleus: `rgba(0, 180, 120, ${0.9 * node.alpha})`,
        dendrite: `rgba(0, 255, 180, ${0.6 * node.alpha})`
      };
    } else if (isCompletionNode) {
      // Completion node: aqua blue
      nodeColors = {
        main: `rgba(0, 210, 220, ${node.alpha})`,
        glow: `rgba(0, 210, 220, ${0.4 * pulse * node.alpha})`,
        ring: `rgba(0, 210, 220, ${0.7 * node.alpha})`,
        text: `rgba(150, 240, 240, ${node.alpha})`,
        nucleus: `rgba(0, 160, 170, ${0.9 * node.alpha})`,
        dendrite: `rgba(0, 210, 220, ${0.6 * node.alpha})`
      };
    } else {
      // Regular node: cyan/blue
      nodeColors = {
        main: `rgba(30, 160, 255, ${node.alpha})`,
        glow: `rgba(30, 160, 255, ${0.3 * pulse * node.alpha})`,
        ring: `rgba(50, 180, 255, ${0.6 * node.alpha})`,
        text: `rgba(180, 230, 255, ${node.alpha})`,
        nucleus: `rgba(20, 130, 220, ${0.9 * node.alpha})`,
        dendrite: `rgba(50, 180, 255, ${0.55 * node.alpha})`
      };
    }
    
    // Draw subtle outer glow (brain cell aura)
    this.ctx.save();
    const glowRadius = node.radius * (1.4 + pulse * 0.3);
    const glowGradient = this.ctx.createRadialGradient(
      node.x, node.y, node.radius,
      node.x, node.y, glowRadius
    );
    glowGradient.addColorStop(0, nodeColors.glow);
    glowGradient.addColorStop(1, `rgba(0, 0, 0, 0)`);
    
    this.ctx.beginPath();
    this.ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
    this.ctx.fillStyle = glowGradient;
    this.ctx.fill();
    
    // Draw brain cell dendrites (connections to nearby areas)
    if (node.dendrites && node.dendrites.length > 0) {
      node.dendrites.forEach(dendrite => {
        const baseAngle = dendrite.angle;
        const dendriteLength = dendrite.length * (1 + pulse * 0.1);
        
        const startX = node.x + Math.cos(baseAngle) * node.radius * 0.7;
        const startY = node.y + Math.sin(baseAngle) * node.radius * 0.7;
        
        // Main dendrite
        this.ctx.beginPath();
        this.ctx.moveTo(startX, startY);
        
        // Create a curved dendrite with branches
        const endX = node.x + Math.cos(baseAngle) * dendriteLength;
        const endY = node.y + Math.sin(baseAngle) * dendriteLength;
        
        // Control point for curve
        const ctrlX = startX + Math.cos(baseAngle + dendrite.curve) * dendriteLength * 0.6;
        const ctrlY = startY + Math.sin(baseAngle + dendrite.curve) * dendriteLength * 0.6;
        
        this.ctx.quadraticCurveTo(ctrlX, ctrlY, endX, endY);
        
        // Draw with glow for hover
        this.ctx.lineWidth = 1.5;
        this.ctx.strokeStyle = nodeColors.dendrite;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.stroke();
        
        // Add small branches at the end for some dendrites
        if (Math.random() > 0.5) {
          const branchAngle1 = baseAngle + (Math.random() - 0.5) * 1.2;
          const branchAngle2 = baseAngle + (Math.random() - 0.5) * 1.2;
          const branchLength = dendriteLength * 0.3;
          
          const branch1X = endX + Math.cos(branchAngle1) * branchLength * 0.5;
          const branch1Y = endY + Math.sin(branchAngle1) * branchLength * 0.5;
          
          this.ctx.beginPath();
          this.ctx.moveTo(endX, endY);
          this.ctx.lineTo(branch1X, branch1Y);
          this.ctx.lineWidth = 1;
          this.ctx.strokeStyle = nodeColors.dendrite;
          this.ctx.stroke();
          
          const branch2X = endX + Math.cos(branchAngle2) * branchLength * 0.4;
          const branch2Y = endY + Math.sin(branchAngle2) * branchLength * 0.4;
          
          this.ctx.beginPath();
          this.ctx.moveTo(endX, endY);
          this.ctx.lineTo(branch2X, branch2Y);
          this.ctx.stroke();
        }
        
        // Add pulse animation along dendrite
        const pulseFactor = Math.sin(timestamp * 0.005 + dendrite.pulseOffset);
        if (pulseFactor > 0.7) {
          const pulseProgress = (pulseFactor - 0.7) / 0.3; // 0 to 1
          const pulsePos = pulseProgress * 0.8; // Position along dendrite
          
          const pulseX = startX + (endX - startX) * pulsePos;
          const pulseY = startY + (endY - startY) * pulsePos;
          
          this.ctx.beginPath();
          this.ctx.arc(pulseX, pulseY, 2, 0, Math.PI * 2);
          this.ctx.fillStyle = nodeColors.ring;
          this.ctx.fill();
        }
      });
    }
    
    // Enhance glow effect when hovered or final/special node
    if (isHovered || isFinal || isPlanNode) {
      this.ctx.beginPath();
      this.ctx.arc(node.x, node.y, node.radius * (1.2 + pulse * 0.3), 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(255, 255, 255, ${0.1 * pulse * node.alpha})`;
      this.ctx.fill();
      
      // Add ripple effect on hover
      if (isHovered && node.ripples) {
        node.ripples.forEach((ripple, i) => {
          ripple.radius += 1.5;
          ripple.alpha -= 0.03;
          
          if (ripple.alpha <= 0 || ripple.radius >= ripple.maxRadius) {
            node.ripples.splice(i, 1);
            return;
          }
          
          this.ctx.beginPath();
          this.ctx.arc(node.x, node.y, ripple.radius, 0, Math.PI * 2);
          this.ctx.strokeStyle = `rgba(255, 255, 255, ${ripple.alpha})`;
          this.ctx.lineWidth = 1.5;
          this.ctx.stroke();
        });
      }
    }
    
    // Draw cell nucleus (inner circle)
    this.ctx.beginPath();
    this.ctx.arc(node.x, node.y, node.radius * 0.8, 0, Math.PI * 2);
    
    // Create organic-looking gradient for nucleus
    const nucleusGradient = this.ctx.createRadialGradient(
      node.x - node.radius * 0.3, node.y - node.radius * 0.3, 0,
      node.x, node.y, node.radius * 0.8
    );
    nucleusGradient.addColorStop(0, `rgba(255, 255, 255, ${0.7 * node.alpha})`);
    nucleusGradient.addColorStop(0.7, nodeColors.nucleus);
    nucleusGradient.addColorStop(1, `rgba(10, 20, 40, ${0.6 * node.alpha})`);
    
    this.ctx.fillStyle = nucleusGradient;
    this.ctx.fill();
    
    // Add faint outer membrane (ring)
    this.ctx.beginPath();
    this.ctx.arc(node.x, node.y, node.radius * 0.9, 0, Math.PI * 2);
    this.ctx.strokeStyle = nodeColors.ring;
    this.ctx.lineWidth = 1.2;
    this.ctx.stroke();
    
    // Add special indicator for plan node
    if (isPlanNode) {
      // Brain pattern inside node
      this.ctx.beginPath();
      this.ctx.moveTo(node.x - node.radius * 0.4, node.y);
      this.ctx.bezierCurveTo(
        node.x - node.radius * 0.2, node.y - node.radius * 0.3,
        node.x + node.radius * 0.2, node.y - node.radius * 0.3,
        node.x + node.radius * 0.4, node.y
      );
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      this.ctx.lineWidth = 1.5;
      this.ctx.stroke();
    }
    
    // Add check mark for completion nodes
    if (isCompletionNode) {
      const checkSize = node.radius * 0.6;
      this.ctx.beginPath();
      this.ctx.moveTo(node.x - checkSize * 0.3, node.y);
      this.ctx.lineTo(node.x, node.y + checkSize * 0.3);
      this.ctx.lineTo(node.x + checkSize * 0.5, node.y - checkSize * 0.3);
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      this.ctx.lineWidth = 1.8;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.stroke();
    }
    
    this.drawNodeText(node, node.x, node.y);
    
    // Draw "activation" animation for recent nodes
    if (isRecent) {
      const popProgress = Math.min(1, timeSinceCreation / 500);
      const popRadius = node.radius * (2 - popProgress);
      const popAlpha = 0.5 * (1 - popProgress);
      
      this.ctx.beginPath();
      this.ctx.arc(node.x, node.y, popRadius, 0, Math.PI * 2);
      this.ctx.strokeStyle = `rgba(255, 255, 255, ${popAlpha})`;
      this.ctx.lineWidth = 1.5;
      this.ctx.stroke();
    }
    
    this.ctx.restore();
  }
  
  drawNodeText(node, x, y) {
    const { text, radius, isHovered } = node;
    if (!text) return; // Skip if no text
    
    // Set up text styling
    this.ctx.font = `15px 'Courier New', 'Lucida Console', monospace`; // Computer-style font
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    
    // Text wrapping
    const words = text.split(' ');
    const lines = [];
    let currentLine = words[0];
    const maxWidth = radius * 1.8; // Max width for text wrapping
    
    // Create text wrapping
    for (let i = 1; i < words.length; i++) {
      const testLine = currentLine + ' ' + words[i];
      const metrics = this.ctx.measureText(testLine);
      
      if (metrics.width > maxWidth) {
        lines.push(currentLine);
        currentLine = words[i];
      } else {
        currentLine = testLine;
      }
    }
    lines.push(currentLine);
    
    // Calculate text positioning
    const lineHeight = 16;
    const totalHeight = lines.length * lineHeight;
    let startY = y - totalHeight / 2 + lineHeight / 2;
    
    // Draw text with computer terminal effect
    this.ctx.save();
    
    // First draw text shadow for glow effect
    this.ctx.shadowColor = 'rgba(100, 255, 255, 0.8)';
    this.ctx.shadowBlur = 4;
    this.ctx.fillStyle = 'rgba(230, 255, 255, 0.95)'; // Bright white with slight blue tint
    
    // Draw text
    lines.forEach((line, index) => {
      const yPos = startY + (index * lineHeight);
      this.ctx.fillText(line, x, yPos);
    });
    
    this.ctx.restore();
  }
  
  cleanup() {
    // Remove event listeners
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('click', this.handleClick);
    window.removeEventListener('resize', this.resize);
    
    // Cancel animation frame
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    
    // Remove canvas
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    
    // Remove tooltip if present
    if (this.tooltip && this.tooltip.parentNode) {
      this.tooltip.parentNode.removeChild(this.tooltip);
    }
  }
}
