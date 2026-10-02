#!/usr/bin/env node

/**
 * Automated Changelog Generator for JSON Tools
 *
 * Reads Git commit history following Conventional Commits,
 * embeds clickable GitHub commit and comparison references,
 * categorizes commits into standard "Keep a Changelog" sections,
 * and updates CHANGELOG.md with the latest release notes.
 *
 * Usage:
 *   node scripts/generate-changelog.js [--version <ver>] [--from <tag>] [--dry-run] [--unreleased]
 *   npm run changelog
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const CHANGELOG_PATH = path.join(ROOT_DIR, 'CHANGELOG.md');
const PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');

// Parse CLI flags
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isUnreleased = args.includes('--unreleased');
const isNoLinks = args.includes('--no-links');

function getArgValue(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const customVersion = getArgValue('--version');
const customFrom = getArgValue('--from');
const customTo = getArgValue('--to') || 'HEAD';

function getLatestTag() {
  try {
    const tags = execSync('git tag --sort=-v:refname', { encoding: 'utf-8', cwd: ROOT_DIR })
      .trim()
      .split('\n')
      .map(t => t.trim())
      .filter(Boolean);
    return tags[0] || null;
  } catch {
    return null;
  }
}

function getRepoWebUrl(pkg) {
  let url = (pkg && pkg.repository && (pkg.repository.url || pkg.repository)) || '';
  if (!url) {
    try {
      url = execSync('git config --get remote.origin.url', { encoding: 'utf-8', cwd: ROOT_DIR }).trim();
    } catch {}
  }
  if (!url) return '';
  if (url.startsWith('git@github.com:')) {
    url = url.replace('git@github.com:', 'https://github.com/');
  }
  url = url.replace(/^git\+/, '').replace(/\.git$/, '');
  return url;
}

function formatDate(date = new Date()) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

function getNextVersion(currentVersion) {
  const parts = currentVersion.replace(/^v/, '').split('.').map(Number);
  if (parts.length >= 2) {
    parts[1] += 1; // Bump minor version for new features
    if (parts.length === 3) parts[2] = 0;
    return `v${parts.join('.')}`;
  }
  return 'v0.2.0';
}

function getCommits(fromTag, toRef) {
  const range = fromTag ? `${fromTag}..${toRef}` : toRef;
  const cmd = `git log ${range} --pretty=format:"%H|%s"`;
  try {
    const output = execSync(cmd, { encoding: 'utf-8', cwd: ROOT_DIR }).trim();
    if (!output) return [];
    return output.split('\n').map(line => {
      const firstPipe = line.indexOf('|');
      const hash = line.slice(0, firstPipe).trim();
      const subject = line.slice(firstPipe + 1).trim();
      return { hash, subject };
    });
  } catch (err) {
    console.error(`Failed to read git commits for range ${range}:`, err.message);
    return [];
  }
}

const SECTION_CONFIG = {
  added: { title: '### Added' },
  security: { title: '### Security' },
  performance: { title: '### Performance' },
  fixed: { title: '### Fixed' },
  changed: { title: '### Changed' },
  documentation: { title: '### Documentation' }
};

const SECTION_ORDER = ['added', 'security', 'performance', 'fixed', 'changed', 'documentation'];

const TYPE_TO_SECTION = {
  feat: 'added',
  add: 'added',
  security: 'security',
  perf: 'performance',
  fix: 'fixed',
  refactor: 'changed',
  chore: 'changed',
  docs: 'documentation'
};

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatScope(scope) {
  if (!scope) return '';
  const specialMap = {
    ai: 'AI',
    ui: 'UI',
    pii: 'PII',
    etl: 'ETL',
    api: 'API',
    url: 'URL',
    curl: 'cURL',
    sse: 'SSE',
    ws: 'WebSocket',
    jsonc: 'JSONC',
    typegen: 'TypeGen',
    csp: 'CSP',
    tests: 'Tests',
    'mock-server': 'Mock Server'
  };
  const lower = scope.toLowerCase();
  return specialMap[lower] || capitalize(scope);
}

function parseCommit(fullSubject) {
  // Take only the first sentence / title if message contains multiple thoughts or dashes
  const subject = fullSubject.split(' - ')[0].trim();

  // Matches: type(scope)!: message OR type: message
  const match = subject.match(/^([a-zA-Z]+)(?:\(([^)]+)\))?!?: (.+)$/);
  if (match) {
    const type = match[1].toLowerCase();
    const scope = match[2] ? match[2].trim() : '';
    const message = match[3].trim();
    const section = TYPE_TO_SECTION[type] || 'changed';
    return { section, scope, message };
  }

  // Fallback heuristic for non-conventional commit messages
  const lower = subject.toLowerCase();
  let section = 'changed';
  if (/^(?:feat|add|support|introduce|allow)/i.test(lower)) {
    section = 'added';
  } else if (/^(?:fix|correct|handle|resolve)/i.test(lower)) {
    section = 'fixed';
  } else if (/^(?:perf|optimize|speed)/i.test(lower)) {
    section = 'performance';
  } else if (/^(?:security|secure|guard)/i.test(lower)) {
    section = 'security';
  } else if (/^(?:doc|readme)/i.test(lower)) {
    section = 'documentation';
  }

  return { section, scope: '', message: subject };
}

function generateReleaseMarkdown(versionHeader, commits, repoUrl) {
  const groups = {
    added: [],
    security: [],
    performance: [],
    fixed: [],
    changed: [],
    documentation: []
  };

  const seenMessages = new Set();

  for (const { hash, subject } of commits) {
    const { section, scope, message } = parseCommit(subject);
    if (!SECTION_CONFIG[section]) continue;

    let formattedMsg = capitalize(message);
    const cleanMsg = formattedMsg.replace(/\.+$/, '');

    const shortHash = hash ? hash.slice(0, 7) : '';
    let commitLink = '';
    if (shortHash) {
      if (repoUrl && !isNoLinks) {
        commitLink = ` ([${shortHash}](${repoUrl}/commit/${hash}))`;
      } else {
        commitLink = ` (${shortHash})`;
      }
    }

    const scopePrefix = scope ? `**${formatScope(scope)}** – ` : '';
    const entry = `- ${scopePrefix}${cleanMsg}${commitLink}.`;

    // Deduplicate identical entries
    if (!seenMessages.has(entry)) {
      seenMessages.add(entry);
      groups[section].push(entry);
    }
  }

  const sections = [];
  sections.push(versionHeader);

  for (const secKey of SECTION_ORDER) {
    const items = groups[secKey];
    if (items && items.length > 0) {
      sections.push('');
      sections.push(SECTION_CONFIG[secKey].title);
      sections.push('');
      sections.push(items.join('\n'));
    }
  }

  sections.push('');
  sections.push('---');
  sections.push('');
  return sections.join('\n');
}

function run() {
  console.log('Generating Changelog from Git Commit History...');

  const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf-8'));
  const repoUrl = getRepoWebUrl(pkg);
  const latestTag = customFrom || getLatestTag();
  console.log(`  Repository:   ${repoUrl || '(local)'}`);
  console.log(`  Baseline Tag: ${latestTag || '(initial commit)'}`);
  console.log(`  Target Ref:   ${customTo}`);

  try {
    const unpushedCount = execSync('git rev-list @{upstream}..HEAD --count 2>/dev/null || echo 0', { encoding: 'utf-8', cwd: ROOT_DIR }).trim();
    if (Number(unpushedCount) > 0 && !isNoLinks) {
      console.log(`\n  ⚠️  Notice: You have ${unpushedCount} local commits not yet pushed to origin/main.`);
      console.log(`     GitHub commit links (e.g. /commit/<hash>) will return 404 until you run "git push".`);
      console.log(`     (Tip: pass --no-links if you want plain commit hashes without hyperlinks)\n`);
    }
  } catch {}

  const commits = getCommits(latestTag, customTo);
  console.log(`  Found ${commits.length} commits since ${latestTag || 'start'}`);

  if (commits.length === 0) {
    console.log('No new commits found. Changelog is up to date.');
    return;
  }

  let versionHeader = '';
  const nextVer = customVersion
    ? (customVersion.startsWith('v') ? customVersion : `v${customVersion}`)
    : getNextVersion(pkg.version || '0.1.0');

  if (isUnreleased) {
    const compareLink = repoUrl && latestTag && !isNoLinks ? ` (${repoUrl}/compare/${latestTag}...HEAD)` : '';
    versionHeader = `## [Unreleased]${compareLink}`;
  } else if (repoUrl && latestTag && !isNoLinks) {
    versionHeader = `## [${nextVer}](${repoUrl}/compare/${latestTag}...${nextVer}) - ${formatDate()}`;
  } else {
    versionHeader = `## [${nextVer}] - ${formatDate()}`;
  }

  const releaseMarkdown = generateReleaseMarkdown(versionHeader, commits, repoUrl);

  if (isDryRun) {
    console.log('\n--- DRY RUN OUTPUT ---\n');
    console.log(releaseMarkdown);
    console.log('--- END DRY RUN ---');
    return;
  }

  // Update CHANGELOG.md
  let existingContent = '';
  if (fs.existsSync(CHANGELOG_PATH)) {
    existingContent = fs.readFileSync(CHANGELOG_PATH, 'utf-8');
  }

  // Check if a section with the target version already exists in CHANGELOG.md (idempotent updates)
  const targetTagMatch = versionHeader.match(/^##\s+\[([^\]]+)\]/);
  const targetTag = targetTagMatch ? targetTagMatch[1] : '';

  if (targetTag) {
    const existingVersionRegex = new RegExp(`(^##\\s+\\[${targetTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\][\\s\\S]*?)(?=^##\\s+\\[|\\Z)`, 'm');
    if (existingVersionRegex.test(existingContent)) {
      const updated = existingContent.replace(existingVersionRegex, `${releaseMarkdown.trim()}\n\n`);
      fs.writeFileSync(CHANGELOG_PATH, updated.trim() + '\n', 'utf-8');
      console.log(`\n✅ Successfully refreshed existing section ${targetTag} with commit links in ${CHANGELOG_PATH} (${commits.length} commits)!\n`);
      return;
    }
  }

  let newContent = '';
  const firstVersionMatch = existingContent.match(/^##\s+\[/m);
  if (firstVersionMatch && firstVersionMatch.index !== undefined) {
    const beforeFirstVersion = existingContent.slice(0, firstVersionMatch.index).trim();
    const fromFirstVersion = existingContent.slice(firstVersionMatch.index);
    newContent = `${beforeFirstVersion}\n\n${releaseMarkdown}\n${fromFirstVersion}`;
  } else if (existingContent.startsWith('# Changelog')) {
    newContent = `# Changelog\n\n${releaseMarkdown}\n${existingContent.replace('# Changelog', '').trim()}`;
  } else {
    newContent = `# Changelog\n\n${releaseMarkdown}\n${existingContent}`;
  }

  fs.writeFileSync(CHANGELOG_PATH, newContent.trim() + '\n', 'utf-8');
  console.log(`\n✅ Successfully updated ${CHANGELOG_PATH} with ${versionHeader} (${commits.length} commits)!\n`);
}

run();
