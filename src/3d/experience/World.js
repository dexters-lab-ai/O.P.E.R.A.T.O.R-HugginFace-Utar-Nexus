import * as THREE from 'three'
import Experience from './Experience.js'
import Baked from './Baked.js'
import GoogleLeds from './GoogleLeds.js'
import LoupedeckButtons from './LoupedeckButtons.js'
import CoffeeSteam from './CoffeeSteam.js'
import TopChair from './TopChair.js'
import ElgatoLight from './ElgatoLight.js'
import BouncingLogo from './BouncingLogo.js'
import Screen from './Screen.js'

export default class World
{
    constructor(_options)
    {
        this.experience = new Experience()
        this.config = this.experience.config
        this.scene = this.experience.scene
        this.resources = this.experience.resources
        
        this.resources.on('groupEnd', (_group) =>
        {
            if(_group.name === 'base')
            {
                this.setBaked()
                this.setGoogleLeds()
                this.setLoupedeckButtons()
                this.setCoffeeSteam()
                this.setTopChair()
                this.setElgatoLight()
                this.setBouncingLogo()
                this.setScreens()
            }
        })
    }

    setBaked()
    {
        this.baked = new Baked()
    }

    setGoogleLeds()
    {
        this.googleLeds = new GoogleLeds()
    }

    setLoupedeckButtons()
    {
        this.loupedeckButtons = new LoupedeckButtons()
    }

    setCoffeeSteam()
    {
        this.coffeeSteam = new CoffeeSteam()
    }

    setTopChair()
    {
        this.topChair = new TopChair()
    }

    setElgatoLight()
    {
        this.elgatoLight = new ElgatoLight()
    }

    setBouncingLogo()
    {
        this.bouncingLogo = new BouncingLogo()
    }

    setScreens()
    {
        if (this.pcScreen && typeof this.pcScreen.dispose === 'function') {
            this.pcScreen.dispose();
        }
        if (this.macScreen && typeof this.macScreen.dispose === 'function') {
            this.macScreen.dispose();
        }
        this.pcScreen = new Screen(
            this.resources.items.pcScreenModel.scene.children[0],
            '/assets/videoPortfolio.mp4',
            this.scene
        );
        this.macScreen = new Screen(
            this.resources.items.macScreenModel.scene.children[0],
            '/assets/videoStream.mp4',
            this.scene
        );
    }

    resize()
    {
    }

    update()
    {
        if(this.googleLeds && typeof this.googleLeds.update === 'function')
            this.googleLeds.update();

        if(this.loupedeckButtons && typeof this.loupedeckButtons.update === 'function')
            this.loupedeckButtons.update();

        if(this.coffeeSteam && typeof this.coffeeSteam.update === 'function')
            this.coffeeSteam.update();

        if(this.topChair && typeof this.topChair.update === 'function')
            this.topChair.update();

        if(this.bouncingLogo && typeof this.bouncingLogo.update === 'function')
            this.bouncingLogo.update();
    }

    destroy()
    {
        if (this.pcScreen && typeof this.pcScreen.dispose === 'function') {
            this.pcScreen.dispose();
            this.pcScreen = null;
        }
        if (this.macScreen && typeof this.macScreen.dispose === 'function') {
            this.macScreen.dispose();
            this.macScreen = null;
        }
    }
}