export async function fetchOllamaModels(endpoint: string): Promise<string[]> {
  try {
    // Basic timeout implementation
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${endpoint}/api/tags`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`Ollama API Error: ${res.status} ${res.statusText}`);
    const json = await res.json() as any;
    return (json.models || []).map((m: any) => m.name);
  } catch (e) {
    console.error('Failed to fetch models:', e);
    return [];
  }
}

export async function callOllama(endpoint: string, model: string, prompt: string, dataSample: string): Promise<string> {
  const systemPrompt = `You are a JavaScript expert. Write JavaScript expression to filter/map the \`data\` variable based on the user request.
Input data structure sample: ${dataSample}

Rules:
1. Return ONLY the JavaScript code. NO markdown, NO explanations.
2. The input \`data\` variable contains the JSON context.
3. INTELLIGENTLY DETECT THE ARRAY: If \`data\` is an object wrapping the target array (e.g. \`data.rows\`, \`data.items\`, \`data.data\`), your code MUST access that property. If \`data\` is the array, use it directly.
4. Ensure the expression returns the result (e.g. \`return data.items.filter(...)\`).
`;

  const res = await fetch(`${endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: `Request: ${prompt}`,
      system: systemPrompt,
      stream: false,
      options: { temperature: 0.2 }
    })
  });

  if (!res.ok) throw new Error(`Ollama API Error: ${res.status} ${res.statusText}`);
  const json = await res.json() as any;
  let code = json.response.trim();
  // Strip markdown code blocks if present
  code = code.replace(/^```(javascript|js)?\s*/i, '').replace(/\s*```$/, '');
  return code;
}

export async function fetchGeminiModels(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!res.ok) throw new Error(`Gemini API Error: ${res.status}`);
    const data = await res.json() as any;
    // Filter for generateContent supported models
    return (data.models || [])
      .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m: any) => m.name.replace('models/', ''));
  } catch (e: any) {
    console.error('Failed to fetch Gemini models:', e);
    throw e;
  }
}

export async function callGemini(apiKey: string, model: string, prompt: string, dataSample: string): Promise<string> {
  const systemInstruction = `You are a JavaScript expert. Write JavaScript expression to filter/map the \`data\` variable based on the user request.
Input data structure sample: ${dataSample}
Rules:
1. Return ONLY the JavaScript code. NO markdown, NO explanations.
2. The input \`data\` variable contains the JSON context.
3. INTELLIGENTLY DETECT THE ARRAY: If \`data\` is an object wrapping the target array (e.g. \`data.rows\`, \`data.items\`, \`data.data\`), your code MUST access that property. If \`data\` is the array, use it directly.
4. Ensure the expression returns the result (e.g. \`return data.items.filter(...)\`).
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

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

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API Error: ${res.status} ${errText}`);
  }

  const json = await res.json() as any;
  const candidate = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!candidate) throw new Error('No content generated');

  let code = candidate.trim();
  code = code.replace(/^```(javascript|js)?\s*/i, '').replace(/\s*```$/, '');
  return code;
}
