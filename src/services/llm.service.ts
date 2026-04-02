import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { createHash } from 'crypto';
import { ATSScore } from './ats-scorer.service';
import { ParsedJobDescription } from './jd-parser.service';

let genAI: GoogleGenerativeAI | null = null;
let groqClient: Groq | null = null;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 10000;

const responseCache = new Map<string, { result: string; timestamp: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

function getCacheKey(latex: string, jdTitle: string, missingKw: string[]): string {
  return createHash('md5').update(latex + jdTitle + missingKw.join(',')).digest('hex');
}

function getGeminiClient(): GoogleGenerativeAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!genAI) genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI;
}

function getGroqClient(): Groq | null {
  if (!process.env.GROQ_API_KEY) return null;
  if (!groqClient) groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groqClient;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('429') || msg.includes('quota') || msg.includes('rate') || msg.includes('too many');
  }
  return false;
}

async function callGroq(systemPrompt: string, userPrompt: string): Promise<string | null> {
  const client = getGroqClient();
  if (!client) return null;

  const models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'];

  for (const model of models) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.log(`[Groq] ${model} attempt ${attempt + 1}`);
        const response = await client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: 4096,
        });
        const text = response.choices[0]?.message?.content;
        if (text) {
          console.log(`[Groq] Success with ${model}`);
          return text;
        }
      } catch (error) {
        if (isRateLimitError(error)) {
          const delay = RETRY_DELAY_MS * (attempt + 1);
          console.warn(`[Groq] Rate limited on ${model}, waiting ${delay}ms...`);
          await sleep(delay);
          continue;
        }
        console.error(`[Groq] ${model} error:`, (error as Error).message);
        break;
      }
    }
  }
  return null;
}

async function callGemini(prompt: string): Promise<string | null> {
  const client = getGeminiClient();
  if (!client) return null;

  const models = ['gemini-2.0-flash-lite', 'gemini-1.5-flash'];

  for (const modelName of models) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.log(`[Gemini] ${modelName} attempt ${attempt + 1}`);
        const model = client.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        if (text) {
          console.log(`[Gemini] Success with ${modelName}`);
          return text;
        }
      } catch (error) {
        if (isRateLimitError(error)) {
          const delay = RETRY_DELAY_MS * (attempt + 1);
          console.warn(`[Gemini] Rate limited on ${modelName}, waiting ${delay}ms...`);
          await sleep(delay);
          continue;
        }
        console.error(`[Gemini] ${modelName} error:`, (error as Error).message);
        break;
      }
    }
  }
  return null;
}

async function callLLM(systemPrompt: string, userPrompt: string): Promise<string | null> {
  const providers: Array<{ name: string; call: () => Promise<string | null> }> = [];
  if (process.env.GROQ_API_KEY) providers.push({ name: 'Groq', call: () => callGroq(systemPrompt, userPrompt) });
  if (process.env.GEMINI_API_KEY) providers.push({ name: 'Gemini', call: () => callGemini(systemPrompt + '\n\n' + userPrompt) });

  for (const provider of providers) {
    console.log(`[LLM] Trying: ${provider.name}`);
    const response = await provider.call();
    if (response) return response;
  }
  return null;
}

// --- JD Keyword Extraction via LLM ---

export interface ExtractedJDKeywords {
  requiredSkills: string[];
  preferredSkills: string[];
  domainKeywords: string[];
  certifications: string[];
  tools: string[];
}

const jdKeywordCache = new Map<string, { result: ExtractedJDKeywords; timestamp: number }>();

export async function extractJDKeywordsWithLLM(jdText: string): Promise<ExtractedJDKeywords | null> {
  const cacheKey = createHash('md5').update(jdText).digest('hex');
  const cached = jdKeywordCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log('[JD-LLM] Returning cached keyword extraction');
    return cached.result;
  }

  const systemPrompt = `You are an expert job description analyzer that works across ALL industries and domains — tech, finance, healthcare, legal, marketing, education, manufacturing, etc.

Extract skills, keywords, and requirements from the job description. Be thorough — capture every skill, tool, technology, methodology, certification, and domain term mentioned.

Return a JSON object with these fields:
- "requiredSkills": hard skills, technical skills, tools that are required or mandatory
- "preferredSkills": nice-to-have skills, preferred qualifications
- "domainKeywords": industry-specific terminology, methodologies, frameworks, standards (e.g. "GAAP", "HIPAA", "Six Sigma", "Agile", "SEO")
- "certifications": any certifications or licenses mentioned (e.g. "CPA", "PMP", "AWS Solutions Architect", "RN")
- "tools": specific software, platforms, tools mentioned (e.g. "SAP", "Salesforce", "Excel", "Figma", "QuickBooks")

Output ONLY valid JSON. No markdown, no explanation.`;

  const userPrompt = jdText;

  console.log(`[JD-LLM] Extracting keywords — prompt ~${Math.round((systemPrompt.length + userPrompt.length) / 4)} tokens`);

  const response = await callLLM(systemPrompt, userPrompt);
  if (!response) return null;

  try {
    let cleaned = response.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    const parsed = JSON.parse(cleaned);
    const result: ExtractedJDKeywords = {
      requiredSkills: Array.isArray(parsed.requiredSkills) ? parsed.requiredSkills : [],
      preferredSkills: Array.isArray(parsed.preferredSkills) ? parsed.preferredSkills : [],
      domainKeywords: Array.isArray(parsed.domainKeywords) ? parsed.domainKeywords : [],
      certifications: Array.isArray(parsed.certifications) ? parsed.certifications : [],
      tools: Array.isArray(parsed.tools) ? parsed.tools : [],
    };

    console.log(`[JD-LLM] Extracted: ${result.requiredSkills.length} required, ${result.preferredSkills.length} preferred, ${result.domainKeywords.length} domain, ${result.certifications.length} certs, ${result.tools.length} tools`);

    jdKeywordCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  } catch (e) {
    console.warn('[JD-LLM] Failed to parse keyword extraction:', (e as Error).message);
    return null;
  }
}

// --- Resume Optimization ---

export async function optimizeResumeLatex(
  originalLatex: string,
  jd: ParsedJobDescription,
  atsScore: ATSScore,
): Promise<string> {
  const cacheKey = getCacheKey(originalLatex, jd.jobTitle, atsScore.missingKeywords);
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log('[Cache] Returning cached result');
    return cached.result;
  }

  const missingKw = atsScore.missingKeywords.join(', ');
  const skills = [...new Set([...jd.requiredSkills, ...jd.preferredSkills])].join(', ');

  // Strategy 1: Full rewrite (most reliable, highest scores)
  const rewriteResult = await tryRewriteStrategy(originalLatex, jd.jobTitle, missingKw, skills);
  if (rewriteResult) {
    responseCache.set(cacheKey, { result: rewriteResult, timestamp: Date.now() });
    return rewriteResult;
  }

  // Strategy 2: Find/replace edits (fallback if rewrite fails)
  console.log('[LLM] Rewrite strategy failed, trying edit strategy...');
  const editResult = await tryEditStrategy(originalLatex, jd.jobTitle, missingKw, skills);
  if (editResult) {
    responseCache.set(cacheKey, { result: editResult, timestamp: Date.now() });
    return editResult;
  }

  throw new Error(
    'Failed to optimize resume. LLM providers may be rate-limited — wait a minute and try again.',
  );
}

async function tryEditStrategy(
  originalLatex: string,
  jobTitle: string,
  missingKw: string,
  skills: string,
): Promise<string | null> {
  const systemPrompt = `You are an ATS resume optimizer. You will receive a LaTeX resume and must return a JSON array of text replacements to integrate ALL missing keywords while maintaining professional formatting.

CRITICAL RULES:
1. The "find" value must be a VERBATIM substring copied exactly from the resume — including LaTeX commands like \\textbf{}, \\item, etc.
2. The "replace" value is the improved version with keywords integrated naturally.
3. Only change text content to add keywords. Keep all LaTeX structure intact.
4. Each "find" must be unique and long enough (15+ chars) to match exactly one location.
5. Make as many edits as needed to integrate ALL missing keywords (up to 12).
6. Make sure to edit the Skills/Tools section to add missing technical keywords.
7. Output ONLY a raw JSON array. No markdown, no explanation.

FORMATTING RULES:
- Replacement text must be similar length to the original — do NOT turn a 10-word bullet into a 40-word paragraph.
- Bullet points must start with a strong action verb and stay within 1-2 lines.
- When adding skills to a Skills section, keep the same categorized format (e.g. \\textbf{Languages:} ...).
- Never make text so long it would overflow page margins.

Example output:
[{"find":"Built and maintained web applications","replace":"Built and maintained scalable web applications using React and Node.js"}]`;

  const userPrompt = `Target role: ${jobTitle}
Missing keywords to integrate: ${missingKw}
Required skills: ${skills}

FULL RESUME (use exact text from this for "find" values):
${originalLatex}`;

  console.log(`[LLM] Edit strategy — prompt ~${Math.round((systemPrompt.length + userPrompt.length) / 4)} tokens`);

  const response = await callLLM(systemPrompt, userPrompt);
  if (!response) return null;

  try {
    return applyEdits(originalLatex, response);
  } catch (e) {
    console.warn(`[LLM] Edit strategy failed:`, (e as Error).message);
    return null;
  }
}

async function tryRewriteStrategy(
  originalLatex: string,
  jobTitle: string,
  missingKw: string,
  skills: string,
): Promise<string | null> {
  const systemPrompt = `You are an expert ATS resume optimizer AND professional resume formatter. You will receive a LaTeX resume, missing keywords, and required skills. Return a FULL, PRINT-READY optimized LaTeX document.

YOU HAVE TWO EQUAL GOALS:
1. Maximize ATS keyword match — every missing keyword MUST appear.
2. Produce a professionally formatted, ready-to-send resume PDF.

KEYWORD STRATEGY:
- Add missing skills to the Skills/Technical Skills section under appropriate categories
- Rephrase bullet points to naturally include missing keywords
- Enrich the professional summary with key missing terms
- Do NOT fabricate experience — rephrase existing content to incorporate keywords

FORMATTING RULES (critical — the user will download and send this PDF directly):
- Professional Summary: Max 2-3 concise sentences. No dense paragraphs.
- Bullet Points: Each \\item must be 1-2 lines max. Start with a strong action verb (Led, Built, Designed, Optimized, etc.). Include quantifiable results where the original has them.
- Skills Section: Use a clean categorized layout (e.g. \\textbf{Languages:} X, Y, Z). Group by type (Languages, Frameworks, Tools, Cloud, Databases, etc.). Never dump all skills into one long paragraph.
- Page Limits: Content MUST fit within the same page count as the original. If adding keywords makes it overflow, trim verbosity from bullet points instead of removing content.
- Margins & Spacing: NEVER change \\geometry, margins, font size, or spacing commands from the original. Preserve all layout packages and settings exactly.
- LaTeX Quality: Use \\hfill for date alignment, consistent \\textbf/\\textit usage, proper \\item formatting. Ensure the document compiles cleanly.
- No Orphans: Every section must have content. Never leave empty sections.
- Line Length: Keep lines within margin width. If text would overflow, break it into shorter phrases or split into multiple bullets.

OUTPUT:
- Return ONLY the complete LaTeX document, starting with \\documentclass.
- No markdown wrapping, no explanation — raw LaTeX only.`;

  const userPrompt = `Target role: ${jobTitle}
Missing keywords: ${missingKw}
Required skills: ${skills}

Resume to optimize:
${originalLatex}`;

  console.log(`[LLM] Rewrite strategy — prompt ~${Math.round((systemPrompt.length + userPrompt.length) / 4)} tokens`);

  const response = await callLLM(systemPrompt, userPrompt);
  if (!response) return null;

  let cleaned = response.trim();
  if (cleaned.startsWith('```latex')) cleaned = cleaned.slice(8);
  else if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  if (cleaned.includes('\\documentclass') && cleaned.includes('\\begin{document}')) {
    console.log('[LLM] Rewrite strategy succeeded');
    return cleaned;
  }

  console.warn('[LLM] Rewrite strategy returned invalid LaTeX');
  return null;
}

function applyEdits(originalLatex: string, llmResponse: string): string {
  let cleaned = llmResponse.trim();

  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  if (cleaned.startsWith('\\documentclass') || cleaned.startsWith('\\begin')) {
    console.log('[LLM] Got full LaTeX response, using directly');
    return cleaned;
  }

  let edits: Array<{ find: string; replace: string }>;
  try {
    edits = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      edits = JSON.parse(match[0]);
    } else {
      throw new Error('Could not parse LLM response as JSON edits');
    }
  }

  if (!Array.isArray(edits)) throw new Error('LLM response is not an array');

  let result = originalLatex;
  let appliedCount = 0;

  for (const edit of edits) {
    if (!edit.find || !edit.replace) continue;

    if (result.includes(edit.find)) {
      result = result.replace(edit.find, edit.replace);
      appliedCount++;
      continue;
    }

    // Fuzzy match: normalize whitespace and try again
    const normalizedFind = edit.find.replace(/\s+/g, ' ').trim();
    const normalizedResult = result.replace(/\s+/g, ' ');
    const idx = normalizedResult.indexOf(normalizedFind);
    if (idx !== -1) {
      const before = normalizedResult.slice(0, idx);
      const originalStart = countOriginalChars(result, before.length);
      const originalEnd = findOriginalEnd(result, originalStart, edit.find);
      if (originalEnd > originalStart) {
        result = result.slice(0, originalStart) + edit.replace + result.slice(originalEnd);
        appliedCount++;
        continue;
      }
    }

    console.log(`[Edit] Could not match: "${edit.find.slice(0, 60)}..."`);
  }

  console.log(`[LLM] Applied ${appliedCount}/${edits.length} edits`);

  if (appliedCount === 0) {
    throw new Error('No edits could be applied — LLM output did not match resume text');
  }

  return result;
}

function countOriginalChars(original: string, normalizedPos: number): number {
  let ni = 0;
  let oi = 0;
  while (oi < original.length && ni < normalizedPos) {
    if (/\s/.test(original[oi])) {
      while (oi < original.length && /\s/.test(original[oi])) oi++;
      ni++;
    } else {
      oi++;
      ni++;
    }
  }
  return oi;
}

function findOriginalEnd(original: string, start: number, find: string): number {
  const targetLen = find.replace(/\s+/g, ' ').trim().length;
  let ni = 0;
  let oi = start;
  while (oi < original.length && ni < targetLen) {
    if (/\s/.test(original[oi])) {
      while (oi < original.length && /\s/.test(original[oi])) oi++;
      ni++;
    } else {
      oi++;
      ni++;
    }
  }
  return oi;
}
