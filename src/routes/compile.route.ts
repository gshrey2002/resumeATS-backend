import { Router, Request, Response } from 'express';
import { compileLatexToPdf } from '../services/latex-compiler.service';

export const compileRouter = Router();

compileRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { latexCode } = req.body;

    if (!latexCode) {
      res.status(400).json({ error: 'latexCode is required' });
      return;
    }

    const pdfBuffer = await compileLatexToPdf(latexCode);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="optimized-resume.pdf"');
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Compilation error:', error);
    const message = error instanceof Error ? error.message : 'Failed to compile LaTeX';
    res.status(500).json({ error: message });
  }
});
