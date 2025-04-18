import { RoomEntryPoint } from '../src/3d/RoomEntryPoint.js';

export function init3DScene() {
  return new RoomEntryPoint({
    container: document.getElementById('scene-container'),
    modelPath: '/models/room.glb',
    dracoPath: '/draco/'
  });
}
