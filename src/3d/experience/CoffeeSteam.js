import * as THREE from 'three'

import Experience from './Experience.js'

// Embedded vertex shader
const vertexShader = `
uniform float uTime;

varying vec2 vUv;

void main() {
    vec3 newPosition = position;
    vec2 displacementUv = uv;
    displacementUv *= 5.0;
    displacementUv.y -= uTime * 0.0002;

    float displacementStrength = pow(uv.y * 3.0, 2.0);
    float perlin = perlin2d(displacementUv) * displacementStrength;

    newPosition.y += perlin * 0.1;

    vec4 modelPosition = modelMatrix * vec4(newPosition, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 projectionPosition = projectionMatrix * viewPosition;
    gl_Position = projectionPosition;

    vUv = uv;
}
`;

// Embedded fragment shader
const fragmentShader = `
uniform float uTime;
uniform float uTimeFrequency;
uniform vec2 uUvFrequency;
uniform vec3 uColor;

varying vec2 vUv;

void main() {
    vec2 uv = vUv * uUvFrequency;
    uv.y -= uTime * uTimeFrequency;

    float borderAlpha = min(vUv.x * 4.0, (1.0 - vUv.x) * 4.0);
    borderAlpha = borderAlpha * (1.0 - vUv.y);

    float perlin = perlin2d(uv);
    perlin *= borderAlpha;
    perlin *= 0.6;
    perlin = min(perlin, 1.0);

    gl_FragColor = vec4(uColor, perlin);
}
`;

export default class CoffeeSteam
{
    constructor()
    {
        this.experience = new Experience()
        this.resources = this.experience.resources
        this.debug = this.experience.debug
        this.scene = this.experience.scene
        this.time = this.experience.time

        // Debug
        if(this.debug)
        {
            this.debugFolder = this.debug.addFolder({
                title: 'coffeeSteam',
                expanded: false
            })
        }

        this.setModel()
    }

    setModel()
    {
        this.model = {}
        
        this.model.color = '#d2958a'

        // Material
        this.model.material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            vertexShader,
            fragmentShader,
            uniforms:
            {
                uTime: { value: 0 },
                uTimeFrequency: { value: 0.0004 },
                uUvFrequency: { value: new THREE.Vector2(4, 5) },
                uColor: { value: new THREE.Color(this.model.color) }
            }
        })

        // Mesh
        this.model.mesh = this.resources.items.coffeeSteamModel.scene.children[0]
        this.model.mesh.material = this.model.material
        this.scene.add(this.model.mesh)

        if(this.debug)
        {
            this.debugFolder.addInput(
                this.model,
                'color',
                {
                    view: 'color'
                }
            )
            .on('change', () =>
            {
                this.model.material.uniforms.uColor.value.set(this.model.color)
            })
            
            
            this.debugFolder.addInput(
                this.model.material.uniforms.uTimeFrequency,
                'value',
                {
                    label: 'uTimeFrequency', min: 0.0001, max: 0.001, step: 0.0001
                }
            )
            
            this.debugFolder.addInput(
                this.model.material.uniforms.uUvFrequency.value,
                'x',
                {
                    min: 0.001, max: 20, step: 0.001
                }
            )
            
            this.debugFolder.addInput(
                this.model.material.uniforms.uUvFrequency.value,
                'y',
                {
                    min: 0.001, max: 20, step: 0.001
                }
            )
        }
    }

    update()
    {
        this.model.material.uniforms.uTime.value = this.time.elapsed
    }
}