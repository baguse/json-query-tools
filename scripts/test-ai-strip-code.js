const assert = require('assert');
const esbuild = require('esbuild');
const path = require('path');

async function runAiStripCodeTests() {
  console.log('Testing AI code fence stripping with preambles and postambles (#1.11)...');

  // Bundle src/ai.ts in memory
  const buildResult = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/ai.ts')],
    bundle: true,
    platform: 'node',
    write: false,
    format: 'cjs'
  });

  const bundledCode = buildResult.outputFiles[0].text;
  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', '__dirname', bundledCode);
  fn(mod, mod.exports, require, path.join(__dirname, '../src'));

  const { stripMarkdownCode } = mod.exports;
  assert.strictEqual(typeof stripMarkdownCode, 'function', 'stripMarkdownCode must be exported');

  // 1. Raw code without markdown code blocks
  assert.strictEqual(
    stripMarkdownCode('return data.filter(x => x.active);'),
    'return data.filter(x => x.active);',
    'Raw code without markdown fences should remain unchanged'
  );
  console.log('  ✓ Raw code without markdown fences is preserved');

  // 2. Standard markdown code fence (```javascript)
  assert.strictEqual(
    stripMarkdownCode('```javascript\nreturn data.map(x => x.id);\n```'),
    'return data.map(x => x.id);',
    'Standard ```javascript code fence should be stripped'
  );
  console.log('  ✓ Standard ```javascript fence is stripped');

  // 3. Standard markdown code fence (```js)
  assert.strictEqual(
    stripMarkdownCode('```js\nreturn data.items.length;\n```'),
    'return data.items.length;',
    'Standard ```js code fence should be stripped'
  );
  console.log('  ✓ Standard ```js fence is stripped');

  // 4. Untyped markdown code fence (```)
  assert.strictEqual(
    stripMarkdownCode('```\nreturn Object.keys(data);\n```'),
    'return Object.keys(data);',
    'Untyped ``` fence should be stripped'
  );
  console.log('  ✓ Untyped ``` fence is stripped');

  // 5. Conversational preamble before code block (The core bug in #1.11)
  const preambleResponse = `Sure! Here is the JavaScript query to find all active admins:

\`\`\`javascript
return data.users.filter(u => u.role === 'admin' && u.isActive);
\`\`\``;
  assert.strictEqual(
    stripMarkdownCode(preambleResponse),
    "return data.users.filter(u => u.role === 'admin' && u.isActive);",
    'Conversational preamble before code block should be stripped'
  );
  console.log('  ✓ Conversational preamble before code fence is stripped');

  // 6. Conversational postamble after code block
  const postambleResponse = `\`\`\`js
return data.map(row => row.total);
\`\`\`

Hope this helps! Let me know if you need any adjustments.`;
  assert.strictEqual(
    stripMarkdownCode(postambleResponse),
    'return data.map(row => row.total);',
    'Conversational postamble after code block should be stripped'
  );
  console.log('  ✓ Conversational postamble after code fence is stripped');

  // 7. Both conversational preamble AND postamble
  const bothResponse = `Here is the expression you need:

\`\`\`javascript
return data.filter(item => item.price > 100);
\`\`\`

This filters out all items with price <= 100.`;
  assert.strictEqual(
    stripMarkdownCode(bothResponse),
    'return data.filter(item => item.price > 100);',
    'Both preamble and postamble should be stripped'
  );
  console.log('  ✓ Both preamble and postamble around code fence are stripped');

  // 8. Multiple code blocks: explanatory data followed by JS query
  const multiBlockResponse = `Based on your sample data structure:
\`\`\`json
{
  "orders": [{ "id": 1, "status": "pending" }]
}
\`\`\`

Use the following JavaScript query:
\`\`\`javascript
return data.orders.filter(o => o.status === 'pending');
\`\`\`
`;
  assert.strictEqual(
    stripMarkdownCode(multiBlockResponse),
    "return data.orders.filter(o => o.status === 'pending');",
    'Should prioritize JavaScript code block when multiple blocks exist'
  );
  console.log('  ✓ Explicit javascript code block prioritized over preceding json block');

  // 9. Unclosed code block (e.g. truncated generation)
  const unclosedResponse = `Here is the query:
\`\`\`js
return data.filter(x => x.score > 50)`;
  assert.strictEqual(
    stripMarkdownCode(unclosedResponse),
    'return data.filter(x => x.score > 50)',
    'Unclosed code block should be cleanly extracted'
  );
  console.log('  ✓ Unclosed code block is extracted gracefully');

  // 10. Code containing backticks/template literals inside the snippet
  const templateLiteralResponse = `\`\`\`javascript
return data.map(user => \`ID: \${user.id} - Name: \${user.name}\`);
\`\`\``;
  assert.strictEqual(
    stripMarkdownCode(templateLiteralResponse),
    'return data.map(user => `ID: ${user.id} - Name: ${user.name}`);',
    'Template literals inside code block should be preserved intact'
  );
  console.log('  ✓ Template literals inside code blocks are preserved intact');

  console.log('\n✅ All AI code stripping tests passed successfully!');
}

runAiStripCodeTests().catch(err => {
  console.error('Fatal error during AI code stripping tests:', err);
  process.exit(1);
});
