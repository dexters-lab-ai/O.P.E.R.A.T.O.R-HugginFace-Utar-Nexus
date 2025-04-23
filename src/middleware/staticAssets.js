// src/middleware/staticAssets.js
import express from 'express';
import path from 'path';
import configureMime from './mimeConfig.js';

export default function serveStaticAssets(app) {
  // Configure MIME types
  configureMime();

  // CSS
  app.use(
    '/css',
    express.static(path.join(process.cwd(), 'public/css'), {
      setHeaders: (res) => res.set('Content-Type', 'text/css')
    })
  );

  // JS
  app.use('/js', express.static(path.join(process.cwd(), 'public/js')));
  app.use(
    '/js/components',
    express.static(path.join(process.cwd(), 'public/js/components'))
  );

  // Vendors, Models, Libs
  app.use(
    '/vendors',
    express.static(path.join(process.cwd(), 'public/vendors'))
  );
  app.use(
    '/models',
    express.static(path.join(process.cwd(), 'public/models'))
  );
  app.use(
    '/lib',
    express.static(path.join(process.cwd(), 'public/lib'))
  );

  // Bruno Simon assets
  app.use(
    '/bruno_demo_temp/static',
    express.static(path.join(process.cwd(), 'bruno_demo_temp/static'))
  );

  // Styles alias
  express.static.mime.define({'text/css': ['css']});
  app.use(
    '/styles',
    express.static(path.join(process.cwd(), 'src/styles'))
  );

  // GLTF
  app.use(
    '/js/3d',
    express.static(path.join(process.cwd(), 'src/3d'), {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.glb')) res.set('Content-Type', 'model/gltf-binary');
      }
    })
  );
}
