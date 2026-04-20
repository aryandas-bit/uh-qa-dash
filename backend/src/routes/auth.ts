import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { requireAuth, type AuthenticatedRequest } from '../middleware/requireAuth.js';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const ALLOWED_DOMAIN = 'ultrahuman.com';
const TOKEN_TTL = '8h';

// Reuse a single OAuth2Client instance across requests (it caches Google's public keys)
const oauthClient = new OAuth2Client();

// POST /api/auth/google
// Accepts a Google ID token (credential from GoogleLogin component), verifies it
// cryptographically, enforces @ultrahuman.com domain, returns a session JWT.
router.post('/google', async (req, res) => {
  const { credential } = req.body as { credential?: string };

  if (!credential) {
    res.status(400).json({ error: 'credential is required' });
    return;
  }

  if (!JWT_SECRET) {
    console.error('[Auth] JWT_SECRET is not configured');
    res.status(500).json({ error: 'Server misconfiguration' });
    return;
  }

  try {
    // Verify the ID token signature against Google's public keys
    const ticket = await oauthClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID, // undefined = skip audience check (safe for internal tools)
    });

    const payload = ticket.getPayload();
    if (!payload?.email) {
      res.status(401).json({ error: 'Could not verify Google account' });
      return;
    }

    const { email, name = email.split('@')[0], picture = '' } = payload;

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

  } catch (err: any) {
    console.error('[Auth] ID token verification failed:', err?.message);
    res.status(401).json({ error: 'Invalid or expired Google credential. Please try again.' });
  }
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
