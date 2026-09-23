#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { performance } = require('perf_hooks');

// ANSI Color Helpers
const useColor = !process.env.NO_COLOR && (process.stdout.isTTY || process.env.FORCE_COLOR);
const c = {
  reset: useColor ? '\x1b[0m' : '',
  bold: useColor ? '\x1b[1m' : '',
  dim: useColor ? '\x1b[2m' : '',
  green: useColor ? '\x1b[32m' : '',
  red: useColor ? '\x1b[31m' : '',
  yellow: useColor ? '\x1b[33m' : '',
  cyan: useColor ? '\x1b[36m' : '',
  gray: useColor ? '\x1b[90m' : '',
  bgRed: useColor ? '\x1b[41m\x1b[37m\x1b[1m' : '',
  bgGreen: useColor ? '\x1b[42m\x1b[30m\x1b[1m' : ''
};

const ROOT_DIR = path.resolve(__dirname, '..');
const SCRIPTS_DIR = path.join(ROOT_DIR, 'scripts');
const TESTS_DIR = path.join(ROOT_DIR, 'tests');

// 1. Discover all test files
function discoverTestFiles() {
  const testFiles = [];

  // Look in scripts/
  if (fs.existsSync(SCRIPTS_DIR)) {
    const files = fs.readdirSync(SCRIPTS_DIR);
    for (const file of files) {
      if (file === 'run-tests.js') continue;
      if (file.startsWith('test-') || file.startsWith('validate-') || file.endsWith('.test.js')) {
        testFiles.push({
          name: file,
          relPath: path.join('scripts', file),
          absPath: path.join(SCRIPTS_DIR, file),
          alias: file.replace(/^test-/, '').replace(/\.test\.js$/, '').replace(/\.js$/, '')
        });
      }
    }
  }

  // Look in tests/ if it exists
  if (fs.existsSync(TESTS_DIR)) {
    const files = fs.readdirSync(TESTS_DIR);
    for (const file of files) {
      if (file.endsWith('.test.js') || file.endsWith('.js')) {
        testFiles.push({
          name: file,
          relPath: path.join('tests', file),
          absPath: path.join(TESTS_DIR, file),
          alias: file.replace(/^test-/, '').replace(/\.test\.js$/, '').replace(/\.js$/, '')
        });
      }
    }
  }

  // Logical sorting: validation first, then alphabetical
  testFiles.sort((a, b) => {
    if (a.name.includes('validate') && !b.name.includes('validate')) return -1;
    if (!a.name.includes('validate') && b.name.includes('validate')) return 1;
    return a.name.localeCompare(b.name);
  });

  return testFiles;
}

// 2. Parse CLI arguments
function parseArgs(args) {
  const filters = [];
  let bail = false;
  let listOnly = false;
  let verbose = false;
  let showHelp = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp = true;
    } else if (arg === '--list' || arg === '-l') {
      listOnly = true;
    } else if (arg === '--bail' || arg === '-b') {
      bail = true;
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg.startsWith('--filter=')) {
      filters.push(arg.slice('--filter='.length));
    } else if (arg === '-f' || arg === '--filter') {
      if (args[i + 1]) {
        filters.push(args[++i]);
      }
    } else if (!arg.startsWith('-')) {
      filters.push(arg);
    }
  }

  return { filters, bail, listOnly, verbose, showHelp };
}

// 3. Print CLI Help
function printHelp(allSuites) {
  console.log(`
${c.bold}JSON Query Tools — Test Runner${c.reset}

${c.bold}USAGE:${c.reset}
  npm test
  npm test -- [filter...] [options]
  node scripts/run-tests.js [filter...] [options]

${c.bold}FILTERING:${c.reset}
  npm test -- csv                  Run only the CSV test suite
  npm test -- standalone history   Run standalone and history suites
  npm test -- fetcher              Run URL fetcher suite
  npm test -- validate             Run webview syntax validation
  npm test -- -f=csv               Filter using -f flag

${c.bold}OPTIONS:${c.reset}
  -l, --list                       List all discovered test suites without running
  -b, --bail                       Stop running immediately on first test failure
  -v, --verbose                    Stream all test output live
  -h, --help                       Show this help menu

${c.bold}DISCOVERED TEST SUITES (${allSuites.length}):${c.reset}
${allSuites.map(s => `  • ${c.cyan}${s.name.padEnd(24)}${c.reset} ${c.dim}(alias: ${s.alias})${c.reset}`).join('\n')}
`);
}

// 4. Run a single test file in child process
function runSuite(suite, verbose) {
  return new Promise((resolve) => {
    const startTime = performance.now();
    let stdoutData = '';
    let stderrData = '';

    const child = spawn(process.execPath, [suite.absPath], {
      cwd: ROOT_DIR,
      env: { ...process.env, FORCE_COLOR: useColor ? '1' : '0' }
    });

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
      if (verbose) process.stdout.write(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
      if (verbose) process.stderr.write(chunk);
    });

    child.on('close', (code) => {
      const durationMs = Math.round(performance.now() - startTime);
      resolve({
        suite,
        passed: code === 0,
        exitCode: code,
        durationMs,
        stdout: stdoutData,
        stderr: stderrData
      });
    });

    child.on('error', (err) => {
      const durationMs = Math.round(performance.now() - startTime);
      resolve({
        suite,
        passed: false,
        exitCode: 1,
        durationMs,
        stdout: stdoutData,
        stderr: (stderrData ? stderrData + '\n' : '') + err.message
      });
    });
  });
}

// 5. Main Execution Loop
async function main() {
  const rawArgs = process.argv.slice(2);
  const options = parseArgs(rawArgs);
  const allSuites = discoverTestFiles();

  if (options.showHelp) {
    printHelp(allSuites);
    process.exit(0);
  }

  if (options.listOnly) {
    console.log(`\n${c.bold}Available Test Suites (${allSuites.length}):${c.reset}`);
    for (const s of allSuites) {
      console.log(`  ${c.green}•${c.reset} ${c.bold}${s.name}${c.reset} ${c.dim}(path: ${s.relPath}, filter alias: "${s.alias}")${c.reset}`);
    }
    console.log(`\nRun specific tests using: ${c.cyan}npm test -- <alias>${c.reset}\n`);
    process.exit(0);
  }

  // Filter test files if filters are specified
  let targetSuites = allSuites;
  if (options.filters.length > 0) {
    targetSuites = allSuites.filter((suite) => {
      return options.filters.some((f) => {
        const lowerFilter = f.toLowerCase();
        return (
          suite.name.toLowerCase().includes(lowerFilter) ||
          suite.alias.toLowerCase().includes(lowerFilter) ||
          suite.relPath.toLowerCase().includes(lowerFilter)
        );
      });
    });
  }

  if (targetSuites.length === 0) {
    console.error(`\n${c.red}✖ No test suites matched the filter: "${options.filters.join(', ')}"${c.reset}`);
    console.log(`Available test suites:`);
    allSuites.forEach(s => console.log(`  • ${s.alias} (${s.name})`));
    console.log(`\nExample: ${c.cyan}npm test -- csv${c.reset}\n`);
    process.exit(1);
  }

  console.log(`\n${c.bold}🧪 Running ${targetSuites.length} of ${allSuites.length} test suites...${c.reset}\n`);

  const results = [];
  let hasFailures = false;
  const overallStart = performance.now();

  for (let i = 0; i < targetSuites.length; i++) {
    const suite = targetSuites[i];
    const indexStr = `${c.dim}[${i + 1}/${targetSuites.length}]${c.reset}`;
    process.stdout.write(` ${indexStr} Running ${c.bold}${suite.name}${c.reset}... `);

    const result = await runSuite(suite, options.verbose);
    results.push(result);

    if (result.passed) {
      // Overwrite/complete line with success
      if (!options.verbose) {
        process.stdout.write(`\r ${indexStr} ${c.green}✔ ${suite.name}${c.reset} ${c.dim}(${result.durationMs}ms)${c.reset}\n`);
      } else {
        console.log(`\n ${indexStr} ${c.green}✔ ${suite.name}${c.reset} ${c.dim}(${result.durationMs}ms)${c.reset}`);
      }
    } else {
      hasFailures = true;
      if (!options.verbose) {
        process.stdout.write(`\r ${indexStr} ${c.red}✖ ${suite.name}${c.reset} ${c.dim}(${result.durationMs}ms)${c.reset}\n`);
      } else {
        console.log(`\n ${indexStr} ${c.red}✖ ${suite.name}${c.reset} ${c.dim}(${result.durationMs}ms)${c.reset}`);
      }

      // Display failure details
      console.log(`\n${c.bgRed} FAIL ${c.reset} ${c.bold}${suite.name}${c.reset}`);
      const output = (result.stderr || result.stdout || 'Test failed with no output.').trim();
      const indented = output
        .split('\n')
        .map(line => `    ${line}`)
        .join('\n');
      console.log(`${indented}\n`);

      if (options.bail) {
        console.log(`${c.yellow}Execution halted due to --bail flag.${c.reset}\n`);
        break;
      }
    }
  }

  const overallDurationSec = ((performance.now() - overallStart) / 1000).toFixed(2);
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  console.log(`\n${c.dim}${'─'.repeat(60)}${c.reset}`);
  if (hasFailures) {
    console.log(`${c.bgRed} FAILED ${c.reset} ${c.red}${c.bold}${failedCount} of ${results.length} test suite(s) failed${c.reset}`);
    const failedNames = results.filter(r => !r.passed).map(r => `  ${c.red}✖ ${r.suite.name}${c.reset}`);
    console.log(failedNames.join('\n'));
  } else {
    console.log(`${c.bgGreen} PASSED ${c.reset} ${c.green}${c.bold}All ${passedCount} test suite(s) passed successfully!${c.reset}`);
  }
  console.log(`${c.dim}Suites:${c.reset}   ${passedCount > 0 ? c.green + passedCount + ' passed' + c.reset + ', ' : ''}${failedCount > 0 ? c.red + failedCount + ' failed' + c.reset + ', ' : ''}${targetSuites.length} total`);
  console.log(`${c.dim}Duration:${c.reset} ${overallDurationSec}s`);
  console.log(`${c.dim}${'─'.repeat(60)}${c.reset}\n`);

  process.exit(hasFailures ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n${c.red}Fatal test runner error:${c.reset}`, err);
  process.exit(1);
});
