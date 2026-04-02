import { extractJDKeywordsWithLLM, ExtractedJDKeywords } from './llm.service';

export interface ParsedJobDescription {
  requiredSkills: string[];
  preferredSkills: string[];
  keywords: string[];
  responsibilities: string[];
  experienceYears: number | null;
  jobTitle: string;
}

/**
 * Primary parser: LLM extraction enriched with regex-based structural parsing.
 * Works for ANY domain — tech, finance, healthcare, legal, marketing, etc.
 * Falls back to regex-only if LLM is unavailable.
 */
export async function parseJobDescriptionWithLLM(jdText: string): Promise<ParsedJobDescription> {
  const regexResult = parseJobDescriptionRegex(jdText);

  const llmKeywords = await extractJDKeywordsWithLLM(jdText);
  if (!llmKeywords) {
    console.warn('[JD] LLM extraction failed, using regex-only fallback');
    return regexResult;
  }

  return mergeResults(regexResult, llmKeywords);
}

function mergeResults(regex: ParsedJobDescription, llm: ExtractedJDKeywords): ParsedJobDescription {
  const required = dedup([
    ...llm.requiredSkills,
    ...llm.tools,
    ...llm.certifications,
    ...regex.requiredSkills,
  ]);

  const preferred = dedup([
    ...llm.preferredSkills,
    ...llm.domainKeywords,
    ...regex.preferredSkills,
  ]);

  const allKeywords = dedup([...required, ...preferred]);

  return {
    requiredSkills: required,
    preferredSkills: preferred,
    keywords: allKeywords,
    responsibilities: regex.responsibilities,
    experienceYears: regex.experienceYears,
    jobTitle: regex.jobTitle,
  };
}

function dedup(arr: string[]): string[] {
  const seen = new Map<string, string>();
  for (const item of arr) {
    const key = item.toLowerCase().trim();
    if (key && !seen.has(key)) seen.set(key, item);
  }
  return Array.from(seen.values());
}

// --- Regex-based fallback (fast, zero-cost, no API needed) ---

const WELL_KNOWN_KEYWORDS = [
  'javascript', 'typescript', 'python', 'java', 'c++', 'c#', 'go', 'rust', 'ruby', 'php', 'swift', 'kotlin',
  'react', 'angular', 'vue', 'node.js', 'express', 'django', 'flask', 'spring',
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'ci/cd',
  'mongodb', 'postgresql', 'mysql', 'redis', 'elasticsearch',
  'rest', 'graphql', 'microservices', 'serverless',
  'git', 'linux', 'agile', 'scrum',
  'machine learning', 'deep learning', 'nlp', 'tensorflow', 'pytorch',
  'sql', 'nosql', 'data structures', 'algorithms', 'system design',
  'excel', 'sap', 'salesforce', 'quickbooks', 'tableau', 'power bi',
  'gaap', 'ifrs', 'hipaa', 'sox', 'gdpr',
  'six sigma', 'lean', 'pmp', 'cpa', 'cfa', 'seo', 'sem',
  'figma', 'sketch', 'adobe', 'photoshop', 'illustrator',
];

const SOFT_SKILL_KEYWORDS = [
  'leadership', 'communication', 'teamwork', 'problem-solving', 'analytical',
  'collaboration', 'mentoring', 'cross-functional', 'stakeholder',
];

export function parseJobDescriptionRegex(jdText: string): ParsedJobDescription {
  const lowerJd = jdText.toLowerCase();

  const matchedKeywords = WELL_KNOWN_KEYWORDS.filter((kw) =>
    lowerJd.includes(kw.toLowerCase())
  );

  const softSkills = SOFT_SKILL_KEYWORDS.filter((kw) =>
    lowerJd.includes(kw.toLowerCase())
  );

  const responsibilities = extractResponsibilities(jdText);
  const experienceYears = extractExperienceYears(jdText);
  const jobTitle = extractJobTitle(jdText);

  return {
    requiredSkills: dedup(matchedKeywords),
    preferredSkills: dedup(softSkills),
    keywords: dedup([...matchedKeywords, ...softSkills]),
    responsibilities,
    experienceYears,
    jobTitle,
  };
}

function extractResponsibilities(text: string): string[] {
  const lines = text.split('\n');
  return lines
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-') || l.startsWith('•') || l.match(/^\d+\./))
    .map((l) => l.replace(/^[-•\d.]\s*/, '').trim())
    .filter((l) => l.length > 10);
}

function extractExperienceYears(text: string): number | null {
  const patterns = [
    /(\d+)\+?\s*(?:years?|yrs?)\s*(?:of)?\s*(?:experience|exp)/i,
    /experience[:\s]*(\d+)\+?\s*(?:years?|yrs?)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return parseInt(match[1], 10);
  }

  return null;
}

function extractJobTitle(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length > 0 && lines[0].length < 100) {
    return lines[0];
  }
  return 'Unknown Role';
}
