const assert = require('assert');
const path = require('path');
const esbuild = require('esbuild');

async function runTests() {
  console.log('Testing Privacy & Compliance: PII Anonymizer & Sanitizer...');

  // 1. Bundle src/anonymizer.ts in memory
  const anonBundle = await esbuild.build({
    entryPoints: [path.join(__dirname, '../src/anonymizer.ts')],
    bundle: true,
    platform: 'node',
    write: false,
    format: 'cjs'
  });

  const anonMod = { exports: {} };
  const fnAnon = new Function('module', 'exports', 'require', '__dirname', anonBundle.outputFiles[0].text);
  fnAnon(anonMod, anonMod.exports, require, path.join(__dirname, '../src'));

  const {
    anonymize,
    maskPII,
    sanitizeForAi
  } = anonMod.exports;

  // -------------------------------------------------------------
  // Test 1: Format Masking Strategy ('mask')
  // -------------------------------------------------------------
  console.log('  1. Testing Format Masking strategy (mask)...');
  {
    // Emails
    const emailSample = { email: 'alice.smith@example.com', short: 'a@b.com' };
    const maskedEmail = anonymize(emailSample, 'mask');
    assert.strictEqual(maskedEmail.email, 'a****h@example.com');
    assert.strictEqual(maskedEmail.short, '*@b.com');

    // Phone numbers
    const phoneSample = {
      phone1: '+1 (555) 234-5678',
      phone2: '555-876-5432',
      isoDate: '2026-10-01' // Date should NOT be masked as phone
    };
    const maskedPhone = anonymize(phoneSample, 'mask');
    assert.strictEqual(maskedPhone.phone1, '***-***-5678');
    assert.strictEqual(maskedPhone.phone2, '***-***-5432');
    assert.strictEqual(maskedPhone.isoDate, '2026-10-01');

    // Credit Cards with Luhn check
    // Valid Visa test number: 4111111111111111 (passes Luhn)
    const validCard = '4111-1111-1111-1111';
    const fakeNonCard = '1234-5678-9012-3456'; // fails Luhn
    const cardSample = { cc: validCard, orderNum: fakeNonCard };
    const maskedCard = anonymize(cardSample, 'mask');
    assert.strictEqual(maskedCard.cc, '****-****-****-1111');
    assert.strictEqual(maskedCard.orderNum, fakeNonCard); // Preserved

    // National IDs (SSN)
    const ssnSample = { ssn: '123-45-6789' };
    const maskedSsn = anonymize(ssnSample, 'mask');
    assert.strictEqual(maskedSsn.ssn, '***-**-6789');

    // IP Addresses (IPv4 and IPv6)
    const ipSample = {
      ipv4: '192.168.1.105',
      ipv6: '2001:0db8:85a3:0000:0000:8a2e:0370:7334'
    };
    const maskedIp = anonymize(ipSample, 'mask');
    assert.strictEqual(maskedIp.ipv4, '192.168.*.*');
    assert.strictEqual(maskedIp.ipv6, '2001:db8::*');

    // JWT and Bearer Tokens
    const tokenSample = {
      jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozG4T8J_example_signature_token',
      bearer: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz.secret'
    };
    const maskedTokens = anonymize(tokenSample, 'mask');
    assert.ok(maskedTokens.jwt.endsWith('...[REDACTED_JWT]'));
    assert.ok(maskedTokens.jwt.startsWith('eyJhbGci'));
    assert.ok(maskedTokens.bearer.startsWith('Bearer eyJh...[REDACTED]'));

    // Sensitive Key Names
    const keySample = {
      password: 'SuperSecretPassword123!',
      apiKey: 'AIzaSyD-sample-api-key-value',
      access_token: 'secret-token-value-999',
      regularName: 'John Doe'
    };
    const maskedKeys = anonymize(keySample, 'mask');
    assert.strictEqual(maskedKeys.password, 'Sup...[REDACTED]');
    assert.strictEqual(maskedKeys.apiKey, 'AIz...[REDACTED]');
    assert.strictEqual(maskedKeys.access_token, 'sec...[REDACTED]');
    assert.strictEqual(maskedKeys.regularName, 'John Doe');

    // Shortcut maskPII
    const maskShortcut = maskPII(emailSample);
    assert.deepStrictEqual(maskShortcut, maskedEmail);
  }
  console.log('    ✓ Format masking passed');

  // -------------------------------------------------------------
  // Test 2: Semantic Redaction Strategy ('redact')
  // -------------------------------------------------------------
  console.log('  2. Testing Semantic Redaction strategy (redact)...');
  {
    const sample = {
      user: {
        email: 'bob@corp.internal',
        phone: '123-456-7890',
        ssn: '987-65-4321',
        card: '4111-1111-1111-1111',
        ip: '10.20.30.40',
        password: 'my-plaintext-password'
      }
    };
    const redacted = anonymize(sample, 'redact');
    assert.strictEqual(redacted.user.email, '[REDACTED_EMAIL]');
    assert.strictEqual(redacted.user.phone, '[REDACTED_PHONE]');
    assert.strictEqual(redacted.user.ssn, '[REDACTED_SSN]');
    assert.strictEqual(redacted.user.card, '[REDACTED_CARD]');
    assert.strictEqual(redacted.user.ip, '[REDACTED_IP]');
    assert.strictEqual(redacted.user.password, '[REDACTED_SECRET]');
  }
  console.log('    ✓ Semantic redaction passed');

  // -------------------------------------------------------------
  // Test 3: Consistent Synthetic Pseudonyms ('synthetic')
  // -------------------------------------------------------------
  console.log('  3. Testing Consistent Synthetic Pseudonyms strategy (synthetic)...');
  {
    const user1 = { email: 'alice@example.com', phone: '555-123-4567', ip: '192.168.1.5' };
    const user2 = { email: 'alice@example.com', phone: '555-123-4567', ip: '192.168.1.5' };
    const user3 = { email: 'charlie@example.com', phone: '555-987-6543', ip: '10.0.0.1' };

    const syn1 = anonymize(user1, 'synthetic');
    const syn2 = anonymize(user2, 'synthetic');
    const syn3 = anonymize(user3, 'synthetic');

    // Deterministic: Identical inputs MUST produce identical synthetic replacements
    assert.strictEqual(syn1.email, syn2.email);
    assert.strictEqual(syn1.phone, syn2.phone);
    assert.strictEqual(syn1.ip, syn2.ip);

    // Realistic patterns
    assert.ok(syn1.email.startsWith('user_') && syn1.email.endsWith('@example.com'));
    assert.ok(syn1.phone.startsWith('+1-555-01'));
    assert.ok(syn1.ip.startsWith('10.0.0.'));

    // Different inputs produce different synthetic values
    assert.notStrictEqual(syn1.email, syn3.email);
    assert.notStrictEqual(syn1.phone, syn3.phone);
  }
  console.log('    ✓ Consistent synthetic pseudonyms passed');

  // -------------------------------------------------------------
  // Test 4: Hashed Strategy ('hash')
  // -------------------------------------------------------------
  console.log('  4. Testing Hashed strategy (hash)...');
  {
    const sample = {
      email: 'security@example.org',
      phone: '555-444-3333',
      ip: '172.16.0.1'
    };
    const hashed = anonymize(sample, 'hash');
    assert.ok(hashed.email.startsWith('email_'));
    assert.ok(hashed.phone.startsWith('phone_'));
    assert.ok(hashed.ip.startsWith('ip_'));

    // Deterministic hash check
    const hashedAgain = anonymize(sample, 'hash');
    assert.strictEqual(hashed.email, hashedAgain.email);
    assert.strictEqual(hashed.phone, hashedAgain.phone);
    assert.strictEqual(hashed.ip, hashedAgain.ip);
  }
  console.log('    ✓ Hashed strategy passed');

  // -------------------------------------------------------------
  // Test 5: Selective Rule Toggles
  // -------------------------------------------------------------
  console.log('  5. Testing Selective Rule Toggles...');
  {
    const mixed = {
      email: 'admin@company.com',
      phone: '555-111-2222',
      password: 'secret_value_123'
    };

    // Disable email masking
    const resNoEmail = anonymize(mixed, 'redact', { emails: false });
    assert.strictEqual(resNoEmail.email, 'admin@company.com');
    assert.strictEqual(resNoEmail.phone, '[REDACTED_PHONE]');
    assert.strictEqual(resNoEmail.password, '[REDACTED_SECRET]');

    // Disable key names masking
    const resNoKeyNames = anonymize(mixed, 'redact', { keyNames: false });
    assert.strictEqual(resNoKeyNames.email, '[REDACTED_EMAIL]');
    assert.strictEqual(resNoKeyNames.phone, '[REDACTED_PHONE]');
    assert.strictEqual(resNoKeyNames.password, 'secret_value_123');

    // Disable phones masking
    const resNoPhone = anonymize(mixed, 'redact', { phones: false });
    assert.strictEqual(resNoPhone.phone, '555-111-2222');
  }
  console.log('    ✓ Selective rule toggles passed');

  // -------------------------------------------------------------
  // Test 6: AI Prompt Sanitization (sanitizeForAi)
  // -------------------------------------------------------------
  console.log('  6. Testing AI prompt sanitization (sanitizeForAi)...');
  {
    const sensitiveData = {
      customer: 'John Doe',
      email: 'john.doe@corp.net',
      apiKey: 'AIzaSySecretApiKey1234567890',
      token: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig',
      internalNotes: 'Contact customer at 555-890-1234 regarding invoice'
    };

    const sanitizedAiSample = sanitizeForAi(sensitiveData);
    assert.strictEqual(typeof sanitizedAiSample, 'object');
    assert.strictEqual(sanitizedAiSample.apiKey, '[REDACTED_SECRET]');
    assert.strictEqual(sanitizedAiSample.email, '[REDACTED_EMAIL]');
    assert.strictEqual(sanitizedAiSample.token, '[REDACTED_TOKEN]');
    assert.ok(sanitizedAiSample.internalNotes.includes('[REDACTED_PHONE]'));
    assert.strictEqual(sanitizedAiSample.customer, 'John Doe');
  }
  console.log('    ✓ AI prompt sanitization passed');

  // -------------------------------------------------------------
  // Test 7: Evaluator Integration (Expression Execution)
  // -------------------------------------------------------------
  console.log('  7. Testing Evaluator Integration with anonymize and maskPII...');
  {
    const evalBundle = await esbuild.build({
      entryPoints: [path.join(__dirname, '../src/evaluator.ts')],
      bundle: true,
      platform: 'node',
      write: false,
      format: 'cjs',
      plugins: [
        {
          name: 'mock-vscode',
          setup(build) {
            build.onResolve({ filter: /^vscode$/ }, () => ({
              path: 'vscode',
              namespace: 'mock-vscode'
            }));
            build.onLoad({ filter: /.*/, namespace: 'mock-vscode' }, () => ({
              contents: `
                module.exports = {
                  window: {
                    showWarningMessage: () => {},
                    showErrorMessage: () => {}
                  },
                  workspace: {
                    workspaceFolders: [{ uri: { fsPath: __dirname } }],
                    getWorkspaceFolder: () => ({ uri: { fsPath: __dirname } }),
                    getConfiguration: () => ({ get: () => ({}) })
                  }
                };
              `,
              loader: 'js'
            }));
          }
        }
      ]
    });

    const evalMod = { exports: {} };
    const fnEval = new Function('module', 'exports', 'require', '__dirname', evalBundle.outputFiles[0].text);
    fnEval(evalMod, evalMod.exports, require, path.join(__dirname, '../src'));

    const { evaluateExpression } = evalMod.exports;

    const sampleUsers = [
      { id: 1, name: 'Alice', email: 'alice@example.com', ssn: '111-22-3333' },
      { id: 2, name: 'Bob', email: 'bob@example.com', ssn: '444-55-6666' }
    ];

    const boundFiles = [{ alias: 'data', uri: { fsPath: '/test/users.json' } }];
    const dataMap = { data: sampleUsers };

    // Expression: maskPII(data)
    const res1 = await evaluateExpression(boundFiles, dataMap, 'maskPII(data)');
    assert.strictEqual(res1[0].email, 'a***e@example.com');
    assert.strictEqual(res1[0].ssn, '***-**-3333');

    // Expression: anonymize(data, 'redact')
    const res2 = await evaluateExpression(boundFiles, dataMap, 'anonymize(data, "redact")');
    assert.strictEqual(res2[1].email, '[REDACTED_EMAIL]');
    assert.strictEqual(res2[1].ssn, '[REDACTED_SSN]');

    // Expression: mapping with anonymize
    const res3 = await evaluateExpression(boundFiles, dataMap, 'data.map(u => anonymize(u, "synthetic"))');
    assert.ok(res3[0].email.startsWith('user_'));
    assert.strictEqual(res3[0].ssn, '999-00-0000');

    // Expression: anonymize with hash
    const res4 = await evaluateExpression(boundFiles, dataMap, 'anonymize(data, "hash")');
    assert.ok(res4[0].email.startsWith('email_'));
    assert.ok(res4[0].ssn.startsWith('ssn_'));
  }
  console.log('    ✓ Evaluator integration passed');

  // -------------------------------------------------------------
  // Test 8: Webview UI Modal & Autocomplete Validation
  // -------------------------------------------------------------
  console.log('  8. Testing Webview UI Modal & Autocomplete verification...');
  {
    const htmlBundle = await esbuild.build({
      entryPoints: [path.join(__dirname, '../src/webview/html.ts')],
      bundle: true,
      platform: 'node',
      write: false,
      format: 'cjs',
      plugins: [
        {
          name: 'mock-vscode',
          setup(build) {
            build.onResolve({ filter: /^vscode$/ }, () => ({
              path: 'vscode',
              namespace: 'mock-vscode'
            }));
            build.onLoad({ filter: /.*/, namespace: 'mock-vscode' }, () => ({
              contents: `
                module.exports = {
                  workspace: {
                    asRelativePath: (u) => (typeof u === 'string' ? u : (u && u.fsPath) || 'file.json')
                  },
                  Uri: { file: (f) => ({ fsPath: f, toString: () => f }) }
                };
              `,
              loader: 'js'
            }));
          }
        }
      ]
    });

    const htmlMod = { exports: {} };
    const fnHtml = new Function('module', 'exports', 'require', '__dirname', htmlBundle.outputFiles[0].text);
    fnHtml(htmlMod, htmlMod.exports, require, path.join(__dirname, '../src'));

    const { getQueryEditorHtml } = htmlMod.exports;

    const mockWebview = { cspSource: 'vscode-webview:' };
    const html = getQueryEditorHtml(mockWebview, {
      scriptNonce: 'test-nonce',
      boundFiles: [{ alias: 'data', uri: { fsPath: '/mock.json' } }]
    });

    // Verify UI toolbar and modal elements exist
    assert.ok(html.includes('id="anonymizeBtn"'), 'Missing #anonymizeBtn in webview HTML');
    assert.ok(html.includes('id="anonymizerModal"'), 'Missing #anonymizerModal in webview HTML');
    assert.ok(html.includes('id="closeAnonymizerModal"'), 'Missing #closeAnonymizerModal in webview HTML');
    assert.ok(html.includes('id="anonymizePreview"'), 'Missing #anonymizePreview in webview HTML');
    assert.ok(html.includes('id="applyAnonymizedBtn"'), 'Missing #applyAnonymizedBtn in webview HTML');
    assert.ok(html.includes('id="copyAnonymizedBtn"'), 'Missing #copyAnonymizedBtn in webview HTML');
    assert.ok(html.includes('id="openAnonymizedInEditorBtn"'), 'Missing #openAnonymizedInEditorBtn in webview HTML');
    assert.ok(html.includes('id="sendToAiAnonymizedBtn"'), 'Missing #sendToAiAnonymizedBtn in webview HTML');
    assert.ok(html.includes('id="anonStrategyTabs"'), 'Missing #anonStrategyTabs in webview HTML');

    // Verify autocomplete keywords and snippet
    assert.ok(html.includes('maskPII'), 'Missing maskPII in autocomplete/script');
    assert.ok(html.includes('anonymize(') || html.includes('anonymize'), 'Missing anonymize in autocomplete/script');
    assert.ok(html.includes('anonymize_pii'), 'Missing anonymize_pii snippet in webview HTML');
    assert.ok(html.includes('function getEffectiveData()'), 'Missing getEffectiveData function in webview script');
  }
  console.log('    ✓ Webview UI and autocomplete passed');

  console.log('\n🎉 All PII Anonymizer & Sanitizer tests passed successfully!\n');
}

runTests().catch(err => {
  console.error('\n❌ Anonymizer test failed:', err);
  process.exit(1);
});
