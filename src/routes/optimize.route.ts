import { Router, Request, Response } from 'express';
import { parseLatexResume, extractSkillsFromLatex, extractBulletPoints } from '../services/latex-parser.service';
import { parseJobDescriptionWithLLM } from '../services/jd-parser.service';
import { calculateATSScore } from '../services/ats-scorer.service';
import { optimizeResumeLatex } from '../services/llm.service';

export const optimizeRouter = Router();

optimizeRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { latexCode, jobDescription } = req.body;

    if (!latexCode || !jobDescription) {
      res.status(400).json({ error: 'Both latexCode and jobDescription are required' });
      return;
    }

    // Analyze original resume
    const parsedResume = parseLatexResume(latexCode);
    const resumeSkills = extractSkillsFromLatex(parsedResume.sections);
    const resumeBullets = extractBulletPoints(parsedResume.sections);
    const parsedJD = await parseJobDescriptionWithLLM(jobDescription);

    const originalScore = calculateATSScore(
      parsedResume.sections,
      resumeSkills,
      resumeBullets,
      parsedJD,
    );

    // Optimize with LLM
    const optimizedLatex = await optimizeResumeLatex(latexCode, parsedJD, originalScore);

    // Score the optimized version
    const optimizedParsed = parseLatexResume(optimizedLatex);
    const optimizedSkills = extractSkillsFromLatex(optimizedParsed.sections);
    const optimizedBullets = extractBulletPoints(optimizedParsed.sections);

    const optimizedScore = calculateATSScore(
      optimizedParsed.sections,
      optimizedSkills,
      optimizedBullets,
      parsedJD,
    );

    res.json({
      optimizedLatex,
      originalScore: originalScore.overall,
      optimizedScore: optimizedScore.overall,
      improvement: optimizedScore.overall - originalScore.overall,
      details: {
        before: {
          matchedKeywords: originalScore.matchedKeywords,
          missingKeywords: originalScore.missingKeywords,
        },
        after: {
          matchedKeywords: optimizedScore.matchedKeywords,
          missingKeywords: optimizedScore.missingKeywords,
        },
      },
    });
  } catch (error) {
    console.error('Optimization error:', error);
    const message = error instanceof Error ? error.message : 'Failed to optimize resume';
    res.status(500).json({ error: message });
  }
});
