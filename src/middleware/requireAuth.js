// src/middleware/requireAuth.js

export function requireAuth(req, res, next) {
    if (!req.session.user) {
      // detect XHR/fetch
      if (req.headers['x-requested-with'] === 'XMLHttpRequest' ||
          req.headers.accept?.includes('application/json')) {
        return res.status(401).json({ success: false, error: 'Not logged in' });
      }
      return res.redirect('/login.html');
    }
    next();
  }
  