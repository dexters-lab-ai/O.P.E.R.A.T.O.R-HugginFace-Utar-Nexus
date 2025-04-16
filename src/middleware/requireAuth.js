// src/middleware/requireAuth.js
export function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ success: false, error: 'Not logged in' });
    }
    next();
}
