import { Router, Request, Response } from 'express';
import { SavedResume } from '../models/resume.model';
import { requireAuth } from '../middleware/auth.middleware';

export const resumeRouter = Router();

resumeRouter.use(requireAuth);

resumeRouter.get('/', async (req: Request, res: Response) => {
  try {
    const resumes = await SavedResume.find({ userId: req.user!.userId })
      .select('name lastScore updatedAt createdAt')
      .sort({ updatedAt: -1 });
    res.json(resumes);
  } catch (err) {
    console.error('List resumes error:', err);
    res.status(500).json({ error: 'Failed to list resumes' });
  }
});

resumeRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { name, latexCode, lastJobDescription, lastOptimizedLatex, lastScore } = req.body;
    if (!name || !latexCode) {
      res.status(400).json({ error: 'name and latexCode are required' });
      return;
    }

    const count = await SavedResume.countDocuments({ userId: req.user!.userId });
    if (count >= 20) {
      res.status(400).json({ error: 'Maximum 20 saved resumes reached. Delete one to save a new one.' });
      return;
    }

    const resume = await SavedResume.create({
      userId: req.user!.userId,
      name,
      latexCode,
      lastJobDescription: lastJobDescription || '',
      lastOptimizedLatex: lastOptimizedLatex || '',
      lastScore: lastScore ?? null,
    });

    res.status(201).json(resume);
  } catch (err) {
    console.error('Save resume error:', err);
    res.status(500).json({ error: 'Failed to save resume' });
  }
});

resumeRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const resume = await SavedResume.findOne({
      _id: req.params.id,
      userId: req.user!.userId,
    });
    if (!resume) {
      res.status(404).json({ error: 'Resume not found' });
      return;
    }
    res.json(resume);
  } catch (err) {
    console.error('Get resume error:', err);
    res.status(500).json({ error: 'Failed to get resume' });
  }
});

resumeRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, latexCode, lastJobDescription, lastOptimizedLatex, lastScore } = req.body;
    const update: Record<string, unknown> = {};
    if (name !== undefined) update.name = name;
    if (latexCode !== undefined) update.latexCode = latexCode;
    if (lastJobDescription !== undefined) update.lastJobDescription = lastJobDescription;
    if (lastOptimizedLatex !== undefined) update.lastOptimizedLatex = lastOptimizedLatex;
    if (lastScore !== undefined) update.lastScore = lastScore;

    const resume = await SavedResume.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.userId },
      update,
      { new: true }
    );

    if (!resume) {
      res.status(404).json({ error: 'Resume not found' });
      return;
    }
    res.json(resume);
  } catch (err) {
    console.error('Update resume error:', err);
    res.status(500).json({ error: 'Failed to update resume' });
  }
});

resumeRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await SavedResume.findOneAndDelete({
      _id: req.params.id,
      userId: req.user!.userId,
    });
    if (!result) {
      res.status(404).json({ error: 'Resume not found' });
      return;
    }
    res.json({ message: 'Resume deleted' });
  } catch (err) {
    console.error('Delete resume error:', err);
    res.status(500).json({ error: 'Failed to delete resume' });
  }
});
