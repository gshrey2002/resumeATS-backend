export interface ResumeSection {
  type: 'summary' | 'skills' | 'experience' | 'education' | 'projects' | 'certifications' | 'unknown';
  title: string;
  content: string;
  startIndex: number;
  endIndex: number;
}

export interface ParsedResume {
  preamble: string;
  sections: ResumeSection[];
  rawLatex: string;
}

const SECTION_PATTERNS = [
  /\\section\{([^}]+)\}/g,
  /\\subsection\{([^}]+)\}/g,
  /\\resumeSubheading/g,
];

const SECTION_TYPE_MAP: Record<string, ResumeSection['type']> = {
  summary: 'summary',
  objective: 'summary',
  'professional summary': 'summary',
  profile: 'summary',
  skills: 'skills',
  'technical skills': 'skills',
  'core competencies': 'skills',
  technologies: 'skills',
  experience: 'experience',
  'work experience': 'experience',
  'professional experience': 'experience',
  employment: 'experience',
  education: 'education',
  academic: 'education',
  projects: 'projects',
  'personal projects': 'projects',
  certifications: 'certifications',
  certificates: 'certifications',
  awards: 'certifications',
};

function classifySection(title: string): ResumeSection['type'] {
  const normalized = title.toLowerCase().trim();
  return SECTION_TYPE_MAP[normalized] || 'unknown';
}

export function parseLatexResume(latex: string): ParsedResume {
  const sectionRegex = /\\section\{([^}]+)\}/g;
  const sections: ResumeSection[] = [];
  const matches: { title: string; index: number }[] = [];

  let match;
  while ((match = sectionRegex.exec(latex)) !== null) {
    matches.push({ title: match[1], index: match.index });
  }

  const preambleEnd = matches.length > 0 ? matches[0].index : latex.length;
  const preamble = latex.substring(0, preambleEnd);

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : latex.lastIndexOf('\\end{document}');
    const content = latex.substring(start, end !== -1 ? end : latex.length);

    sections.push({
      type: classifySection(matches[i].title),
      title: matches[i].title,
      content,
      startIndex: start,
      endIndex: end !== -1 ? end : latex.length,
    });
  }

  return { preamble, sections, rawLatex: latex };
}

export function extractSkillsFromLatex(sections: ResumeSection[]): string[] {
  const skillsSection = sections.find((s) => s.type === 'skills');
  if (!skillsSection) return [];

  const content = skillsSection.content;
  const cleaned = content
    .replace(/\\section\{[^}]+\}/, '')
    .replace(/\\textbf\{([^}]+)\}/g, '$1')
    .replace(/\\emph\{([^}]+)\}/g, '$1')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\\\/g, ',');

  return cleaned
    .split(/[,|•·]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

export function extractBulletPoints(sections: ResumeSection[]): string[] {
  const expSection = sections.find((s) => s.type === 'experience');
  if (!expSection) return [];

  const itemRegex = /\\item\s*(.*?)(?=\\item|\\end|\\resume|$)/gs;
  const bullets: string[] = [];

  let match;
  while ((match = itemRegex.exec(expSection.content)) !== null) {
    const cleaned = match[1]
      .replace(/\\textbf\{([^}]+)\}/g, '$1')
      .replace(/\\emph\{([^}]+)\}/g, '$1')
      .replace(/\\[a-zA-Z]+/g, '')
      .replace(/[{}]/g, '')
      .trim();
    if (cleaned.length > 5) {
      bullets.push(cleaned);
    }
  }

  return bullets;
}
