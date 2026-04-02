import { Router, Request, Response } from 'express';
import { parseLatexResume, extractSkillsFromLatex, extractBulletPoints } from '../services/latex-parser.service';
import { parseJobDescriptionWithLLM } from '../services/jd-parser.service';
import { calculateATSScore } from '../services/ats-scorer.service';

export const analyzeRouter = Router();

analyzeRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { latexCode, jobDescription } = req.body;

    if (!latexCode || !jobDescription) {
      res.status(400).json({ error: 'Both latexCode and jobDescription are required' });
      return;
    }

    const parsedResume = parseLatexResume(latexCode);
    const resumeSkills = extractSkillsFromLatex(parsedResume.sections);
    const resumeBullets = extractBulletPoints(parsedResume.sections);

    const parsedJD = await parseJobDescriptionWithLLM(jobDescription);

    const atsScore = calculateATSScore(
      parsedResume.sections,
      resumeSkills,
      resumeBullets,
      parsedJD,
    );

    res.json({
      score: atsScore,
      parsedJD: {
        jobTitle: parsedJD.jobTitle,
        requiredSkills: parsedJD.requiredSkills,
        preferredSkills: parsedJD.preferredSkills,
        experienceYears: parsedJD.experienceYears,
      },
      resumeInfo: {
        sectionsFound: parsedResume.sections.map((s) => s.type),
        skillsExtracted: resumeSkills,
        bulletPointCount: resumeBullets.length,
      },
    });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze resume' });
  }
});
