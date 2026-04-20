import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { requireAuth, type AuthenticatedRequest } from '../middleware/requireAuth.js';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET;
const ALLOWED_DOMAIN = 'ultrahuman.com';
const TOKEN_TTL = '8h';

// POST /api/auth/google
// Accepts a Google access token, verifies it, enforces domain, returns a session JWT.
router.post('/google', async (req, res) => {
  const { accessToken } = req.body as { accessToken?: string };

  if (!accessToken) {
    res.status(400).json({ error: 'accessToken is required' });
    return;
  }

  if (!JWT_SECRET) {
    console.error('[Auth] JWT_SECRET is not configured');
    res.status(500).json({ error: 'Server misconfiguration' });
    return;
  }

  let email: string, name: string, picture: string;

  try {
    const response = await fetch(
      `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${accessToken}`,
    );

    if (!response.ok) {
      res.status(401).json({ error: 'Invalid Google token' });
      return;
    }

    const info = await response.json() as {
      email?: string;
      name?: string;
      picture?: string;
      email_verified?: boolean;
    };

    if (!info.email || !info.email_verified) {
      res.status(401).json({ error: 'Could not verify Google account' });
      return;
    }

    email   = info.email;
    name    = info.name    ?? email.split('@')[0];
    picture = info.picture ?? '';
  } catch (err) {
    console.error('[Auth] Google userinfo fetch failed:', err);
    res.status(502).json({ error: 'Failed to reach Google. Please try again.' });
    return;
  }

  // Domain restriction — server-side enforcement
  if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    console.warn(`[Auth] Blocked sign-in attempt from: ${email}`);
    res.status(403).json({
      error: 'Access restricted to Ultrahuman accounts only.',
      code: 'DOMAIN_RESTRICTED',
    });
    return;
  }

  const token = jwt.sign({ email, name, picture }, JWT_SECRET, { expiresIn: TOKEN_TTL });

  console.log(`[Auth] Signed in: ${email}`);
  res.json({ token, user: { email, name, picture } });
});

// POST /api/auth/logout  (stateless — client drops the JWT)
router.post('/logout', (_req, res) => {
  res.json({ success: true });
});

// GET /api/auth/me — validate current session and return user info
router.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});

export { router as authRouter };
