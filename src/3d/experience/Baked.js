import * as THREE from 'three'

import Experience from './Experience.js'

// Embedded vertex shader
const vertexShader = `
varying vec2 vUv;

void main() {
    vec4 modelPosition = modelMatrix * vec4(position, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 projectionPosition = projectionMatrix * viewPosition;
    gl_Position = projectionPosition;

    vUv = uv;
}
`;

// Embedded fragment shader
const fragmentShader = `
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
    vec3 bakedDayColor = texture2D(uBakedDayTexture, vUv).rgb;
    vec3 bakedNightColor = texture2D(uBakedNightTexture, vUv).rgb;
    vec3 bakedNeutralColor = texture2D(uBakedNeutralTexture, vUv).rgb;
    vec3 bakedColor = mix(mix(bakedDayColor, bakedNightColor, uNightMix), bakedNeutralColor, uNeutralMix);
    vec3 lightMapColor = texture2D(uLightMapTexture, vUv).rgb;

    bakedColor = max(bakedColor, uLightTvColor * (lightMapColor.r * uLightTvStrength));
    bakedColor = max(bakedColor, uLightPcColor * (lightMapColor.b * uLightPcStrength));
    bakedColor = max(bakedColor, uLightDeskColor * (lightMapColor.g * uLightDeskStrength));

    gl_FragColor = vec4(bakedColor, 1.0);
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
                title: 'baked',
                expanded: true
            })
        }

        this.setModel()
    }

    setModel()
    {
        this.model = {}
        
        this.model.mesh = this.resources.items.roomModel.scene.children[0]

        this.model.bakedDayTexture = this.resources.items.bakedDayTexture
        this.model.bakedDayTexture.encoding = THREE.sRGBEncoding
        this.model.bakedDayTexture.flipY = false

        this.model.bakedNightTexture = this.resources.items.bakedNightTexture
        this.model.bakedNightTexture.encoding = THREE.sRGBEncoding
        this.model.bakedNightTexture.flipY = false

        this.model.bakedNeutralTexture = this.resources.items.bakedNeutralTexture
        this.model.bakedNeutralTexture.encoding = THREE.sRGBEncoding
        this.model.bakedNeutralTexture.flipY = false

        this.model.lightMapTexture = this.resources.items.lightMapTexture
        this.model.lightMapTexture.flipY = false

        this.colors = {}
        this.colors.tv = '#ff115e'
        this.colors.desk = '#ff6700'
        this.colors.pc = '#0082ff'

        this.model.material = new THREE.ShaderMaterial({
            uniforms:
            {
                uBakedDayTexture: { value: this.model.bakedDayTexture },
                uBakedNightTexture: { value: this.model.bakedNightTexture },
                uBakedNeutralTexture: { value: this.model.bakedNeutralTexture },
                uLightMapTexture: { value: this.model.lightMapTexture },

                uNightMix: { value: 1 },
                uNeutralMix: { value: 0 },

                uLightTvColor: { value: new THREE.Color(this.colors.tv) },
                uLightTvStrength: { value: 1.47 },

                uLightDeskColor: { value: new THREE.Color(this.colors.desk) },
                uLightDeskStrength: { value: 1.9 },

                uLightPcColor: { value: new THREE.Color(this.colors.pc) },
                uLightPcStrength: { value: 1.4 }
            },
            vertexShader: vertexShader,
            fragmentShader: fragmentShader
        })

        this.model.mesh.traverse((_child) =>
        {
            if(_child instanceof THREE.Mesh)
            {
                _child.material = this.model.material
            }
        })

        this.scene.add(this.model.mesh)
        
        // Debug
        if(this.debug)
        {
            this.debugFolder
                .addInput(
                    this.model.material.uniforms.uNightMix,
                    'value',
                    { label: 'uNightMix', min: 0, max: 1 }
                )

            this.debugFolder
                .addInput(
                    this.model.material.uniforms.uNeutralMix,
                    'value',
                    { label: 'uNeutralMix', min: 0, max: 1 }
                )

            this.debugFolder
                .addInput(
                    this.colors,
                    'tv',
                    { view: 'color' }
                )
                .on('change', () =>
                {
                    this.model.material.uniforms.uLightTvColor.value.set(this.colors.tv)
                })

            this.debugFolder
                .addInput(
                    this.model.material.uniforms.uLightTvStrength,
                    'value',
                    { label: 'uLightTvStrength', min: 0, max: 3 }
                )

            this.debugFolder
                .addInput(
                    this.colors,
                    'desk',
                    { view: 'color' }
                )
                .on('change', () =>
                {
                    this.model.material.uniforms.uLightDeskColor.value.set(this.colors.desk)
                })

            this.debugFolder
                .addInput(
                    this.model.material.uniforms.uLightDeskStrength,
                    'value',
                    { label: 'uLightDeskStrength', min: 0, max: 3 }
                )

            this.debugFolder
                .addInput(
                    this.colors,
                    'pc',
                    { view: 'color' }
                )
                .on('change', () =>
                {
                    this.model.material.uniforms.uLightPcColor.value.set(this.colors.pc)
                })

            this.debugFolder
                .addInput(
                    this.model.material.uniforms.uLightPcStrength,
                    'value',
                    { label: 'uLightPcStrength', min: 0, max: 3 }
                )
        }
    }
}