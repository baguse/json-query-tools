export async function fetchOllamaModels(endpoint: string, timeoutMs: number = 5000): Promise<string[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${endpoint}/api/tags`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Ollama API Error: ${res.status} ${res.statusText}`);
    const json = await res.json() as any;
    return (json.models || []).map((m: any) => m.name);
  } catch (e) {
    console.error('Failed to fetch models:', e);
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Strips markdown code blocks and conversational preambles/postambles from AI model output.
 * Extracts the code contained within ``` fences (e.g. ```javascript, ```js, or untyped ```).
 * If no code block is found, returns the trimmed code string.
 */
export function stripMarkdownCode(code: string): string {
  // First prefer an explicit javascript/js/typescript/ts code block
  const jsMatch = code.match(/```(?:javascript|js|typescript|ts)\b\s*([\s\S]*?)\s*```/i);
  if (jsMatch) {
    return jsMatch[1].trim();
  }

  // Next match any fenced code block (e.g. untyped ``` or other language)
  const anyMatch = code.match(/```[a-zA-Z]*\s*([\s\S]*?)\s*```/);
  if (anyMatch) {
    return anyMatch[1].trim();
  }

  // Handle unclosed opening code block (e.g. truncated response from LLM)
  const openJsMatch = code.match(/```(?:javascript|js|typescript|ts)\b\s*([\s\S]*)$/i);
  if (openJsMatch) {
    return openJsMatch[1].trim();
  }

  const openMatch = code.match(/```[a-zA-Z]*\s*([\s\S]*)$/);
  if (openMatch) {
    return openMatch[1].trim();
  }

  return code.trim();
}

export async function callOllama(
  endpoint: string,
  model: string,
  prompt: string,
  dataSample: string,
  timeoutMs: number = 30000,
  signal?: AbortSignal
): Promise<string> {
  const systemPrompt = `You are a JavaScript expert. Write JavaScript expression to filter/map the \`data\` variable based on the user request.
Input data structure sample: ${dataSample}

Rules:
1. Return ONLY the JavaScript code. NO markdown, NO explanations.
2. The input \`data\` variable contains the JSON context.
3. INTELLIGENTLY DETECT THE ARRAY: If \`data\` is an object wrapping the target array (e.g. \`data.rows\`, \`data.items\`, \`data.data\`), your code MUST access that property. If \`data\` is the array, use it directly.
4. Ensure the expression returns the result (e.g. \`return data.items.filter(...)\`).
`;

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const abortHandler = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', abortHandler, { once: true });
    }
  }

  try {
    const res = await fetch(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: `Request: ${prompt}`,
        system: systemPrompt,
        stream: false,
        options: { temperature: 0.2 }
      }),
      signal: controller.signal
    });

    if (!res.ok) throw new Error(`Ollama API Error: ${res.status} ${res.statusText}`);
    const json = await res.json() as any;
    let code = json.response.trim();
    // Strip markdown code blocks if present
    code = stripMarkdownCode(code);
    return code;
  } catch (err: any) {
    if (timedOut) {
      throw new Error(`AI generation timed out after ${timeoutMs / 1000}s`);
    }
    if (controller.signal.aborted && signal?.aborted) {
      throw new Error('AI generation was canceled');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener('abort', abortHandler);
    }
  }
}

export async function fetchGeminiModels(
  apiKey: string,
  timeoutMs: number = 10000,
  baseUrl: string = 'https://generativelanguage.googleapis.com'
): Promise<string[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/v1beta/models?key=${apiKey}`, {
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Gemini API Error: ${res.status}`);
    const data = await res.json() as any;
    // Filter for generateContent supported models
    return (data.models || [])
      .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m: any) => m.name.replace('models/', ''));
  } catch (e: any) {
    console.error('Failed to fetch Gemini models:', e);
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function callGemini(
  apiKey: string,
  model: string,
  prompt: string,
  dataSample: string,
  timeoutMs: number = 30000,
  signal?: AbortSignal,
  baseUrl: string = 'https://generativelanguage.googleapis.com'
): Promise<string> {
  const systemInstruction = `You are a JavaScript expert. Write JavaScript expression to filter/map the \`data\` variable based on the user request.
Input data structure sample: ${dataSample}
Rules:
1. Return ONLY the JavaScript code. NO markdown, NO explanations.
2. The input \`data\` variable contains the JSON context.
3. INTELLIGENTLY DETECT THE ARRAY: If \`data\` is an object wrapping the target array (e.g. \`data.rows\`, \`data.items\`, \`data.data\`), your code MUST access that property. If \`data\` is the array, use it directly.
4. Ensure the expression returns the result (e.g. \`return data.items.filter(...)\`).
`;

  const url = `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{
      parts: [{ text: `Request: ${prompt}` }]
    }],
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig: {
      temperature: 0.2
    }
  };

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const abortHandler = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', abortHandler, { once: true });
    }
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API Error: ${res.status} ${errText}`);
    }

    const json = await res.json() as any;
    const candidate = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidate) throw new Error('No content generated');

    let code = candidate.trim();
    code = stripMarkdownCode(code);
    return code;
  } catch (err: any) {
    if (timedOut) {
      throw new Error(`AI generation timed out after ${timeoutMs / 1000}s`);
    }
    if (controller.signal.aborted && signal?.aborted) {
      throw new Error('AI generation was canceled');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener('abort', abortHandler);
    }
  }
}
