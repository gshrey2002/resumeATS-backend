const LATEX_API_URL = 'https://latex.ytotech.com/builds/sync';

export async function compileLatexToPdf(latexCode: string): Promise<Buffer> {
  const response = await fetch(LATEX_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      compiler: 'pdflatex',
      resources: [{ main: true, content: latexCode }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LaTeX compilation failed (${response.status}): ${text}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
