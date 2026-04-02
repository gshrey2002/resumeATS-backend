import { ParsedJobDescription } from './jd-parser.service';
import { ResumeSection } from './latex-parser.service';

export interface ATSScore {
  overall: number;
  keywordMatch: number;
  skillsCoverage: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  suggestions: string[];
}

export function calculateATSScore(
  resumeSections: ResumeSection[],
  resumeSkills: string[],
  resumeBullets: string[],
  jd: ParsedJobDescription,
): ATSScore {
  const resumeText = resumeSections.map((s) => s.content).join(' ').toLowerCase();
  const allResumeWords = new Set(
    resumeText.split(/[\s,;|•·{}\\]+/).map((w) => w.trim().toLowerCase()).filter(Boolean)
  );

  const allJdKeywords = [...new Set([...jd.requiredSkills, ...jd.preferredSkills])];

  const matchedKeywords: string[] = [];
  const missingKeywords: string[] = [];

  for (const keyword of allJdKeywords) {
    if (resumeText.includes(keyword.toLowerCase())) {
      matchedKeywords.push(keyword);
    } else {
      missingKeywords.push(keyword);
    }
  }

  const keywordMatch = allJdKeywords.length > 0
    ? Math.round((matchedKeywords.length / allJdKeywords.length) * 100)
    : 0;

  const resumeSkillsLower = resumeSkills.map((s) => s.toLowerCase());
  const jdRequiredLower = jd.requiredSkills.map((s) => s.toLowerCase());
  const matchedSkills = jdRequiredLower.filter((s) =>
    resumeSkillsLower.some((rs) => rs.includes(s) || s.includes(rs))
  );
  const skillsCoverage = jdRequiredLower.length > 0
    ? Math.round((matchedSkills.length / jdRequiredLower.length) * 100)
    : 0;

  const overall = Math.round(keywordMatch * 0.6 + skillsCoverage * 0.4);

  const suggestions = generateSuggestions(missingKeywords, jd, resumeSections);

  return {
    overall,
    keywordMatch,
    skillsCoverage,
    matchedKeywords,
    missingKeywords,
    suggestions,
  };
}

function generateSuggestions(
  missingKeywords: string[],
  jd: ParsedJobDescription,
  sections: ResumeSection[],
): string[] {
  const suggestions: string[] = [];

  if (missingKeywords.length > 0) {
    const top5 = missingKeywords.slice(0, 5);
    suggestions.push(`Add these missing keywords to your resume: ${top5.join(', ')}`);
  }

  const hasSkillsSection = sections.some((s) => s.type === 'skills');
  if (!hasSkillsSection) {
    suggestions.push('Add a dedicated "Skills" section to improve ATS parsing');
  }

  const hasSummary = sections.some((s) => s.type === 'summary');
  if (!hasSummary) {
    suggestions.push('Add a professional summary tailored to this role');
  }

  if (jd.experienceYears && jd.experienceYears > 0) {
    suggestions.push(`JD requires ${jd.experienceYears}+ years — ensure your experience section reflects this`);
  }

  if (missingKeywords.length > allKeywordsThreshold(jd)) {
    suggestions.push('Consider reorganizing your experience bullets to naturally include more JD keywords');
  }

  return suggestions;
}

function allKeywordsThreshold(jd: ParsedJobDescription): number {
  const total = jd.requiredSkills.length + jd.preferredSkills.length;
  return Math.ceil(total * 0.4);
}
