import { Router, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { User } from '../models/user.model';
import { requireAuth } from '../middleware/auth.middleware';

export const authRouter = Router();

authRouter.post('/google', async (req: Request, res: Response) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      res.status(400).json({ error: 'Google credential token is required' });
      return;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      res.status(500).json({ error: 'Google OAuth not configured on server' });
      return;
    }

    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: clientId,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      res.status(400).json({ error: 'Invalid Google token' });
      return;
    }

    const user = await User.findOneAndUpdate(
      { googleId: payload.sub },
      {
        googleId: payload.sub,
        email: payload.email,
        name: payload.name || payload.email,
        picture: payload.picture || '',
      },
      { upsert: true, new: true }
    );

    const jwtSecret = process.env.JWT_SECRET!;
    const token = jwt.sign(
      { userId: user._id.toString(), email: user.email },
      jwtSecret,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        picture: user.picture,
      },
    });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(401).json({ error: 'Authentication failed' });
  }
});

authRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.user!.userId).select('-__v');
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      picture: user.picture,
      draftLatex: user.draftLatex || '',
      draftJobDescription: user.draftJobDescription || '',
    });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

authRouter.put('/draft', requireAuth, async (req: Request, res: Response) => {
  try {
    const { draftLatex, draftJobDescription } = req.body;
    const update: Record<string, string> = {};
    if (draftLatex !== undefined) update.draftLatex = draftLatex;
    if (draftJobDescription !== undefined) update.draftJobDescription = draftJobDescription;

    await User.findByIdAndUpdate(req.user!.userId, update);
    res.json({ message: 'Draft saved' });
  } catch (err) {
    console.error('Save draft error:', err);
    res.status(500).json({ error: 'Failed to save draft' });
  }
});
