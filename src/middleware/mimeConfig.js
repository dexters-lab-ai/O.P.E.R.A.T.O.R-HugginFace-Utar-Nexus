// src/middleware/mimeConfig.js
import mime from 'mime';

// Configure MIME types for static assets
export default function configureMime() {
  mime.define({'application/javascript': ['js']}, true);
  mime.define({'text/css': ['css']}, true);
  mime.define({'model/gltf-binary': ['glb']}, true);
}
