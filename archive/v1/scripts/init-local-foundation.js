#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const db = require('./db');

const KNOWLEDGE_ROOT = path.join(db.OPENCLAW_HOME, 'knowledge');

const KNOWLEDGE_DIRS = [
  'inbox',
  'projects',
  'areas',
  'content',
  'ideas',
  'reference',
  'archive',
  'templates',
];

const SEED_FILES = [
  {
    relativePath: 'README.md',
    content: `# Local Knowledge Vault

This folder is the shared knowledge surface for you, your agents, and Obsidian.

The important constraint is that it stays plain Markdown first. Obsidian is an optional reader/editor on top, not a hard dependency in the automation path.

## Top-level shape

- \`inbox/\` for quick captures that have not been sorted yet
- \`projects/\` for durable project context
- \`areas/\` for ongoing domains like fitness, work, and learning
- \`content/\` for active content items that mix DB tracking with Markdown payloads
- \`ideas/\` for incubating thoughts that are not tasks yet
- \`reference/\` for reusable docs, research, playbooks, and guidelines
- \`archive/\` for retired material
- \`templates/\` for note starters

## Working rules

- Keep one folder per project at \`projects/<slug>/\`
- Keep active content work under \`content/\`; use \`reference/content/\` for evergreen guidance
- Prefer file paths and Markdown links over hidden database-only context
- Promote ideas into tasks only when they become truly actionable
- Use the DB for tracking and querying; use this vault for reading and thinking

## Obsidian

If you want the app, open \`${KNOWLEDGE_ROOT}\` as an Obsidian vault. The file layout works even if Obsidian is never installed.
`,
  },
  {
    relativePath: 'content/README.md',
    content: `# Content Hub

This folder is the active local content system.

It is intentionally hybrid:

- SQLite tracks status, review state, publish date, project label, and platforms
- Markdown stores the actual draft, notes, research, and published copy

## Shape

- \`fence/\` for Fence-linked content items
- \`personal-brand/\` for general personal brand work
- \`other/\` for anything that does not belong in the first two buckets yet
- \`archive/\` for retired or superseded content items

## Per-item convention

Each content item should live in its own folder:

- \`overview.md\` for tracking context and intent
- \`draft.md\` for the current working copy
- \`notes.md\` for research, feedback, and rationale
- \`published.md\` only after the piece actually ships

## Related paths

- \`reference/content/\` for evergreen guardrails and voice docs
- \`projects/fence/marketing/\` for broader project marketing assets
`,
  },
  {
    relativePath: 'templates/project-overview.md',
    content: `# Project: <Name>

## Why this exists

## Current state

## Constraints

## Next milestone

## Open questions

## Key refs
- 
`,
  },
  {
    relativePath: 'templates/idea.md',
    content: `# Idea: <Title>

## Problem or itch

## Why it might matter

## Signals or evidence

## What would make this worth pursuing?

## Next move
- Keep parked
- Research
- Promote to task
`,
  },
  {
    relativePath: 'templates/content-item-overview.md',
    content: `# Content Item: <Title>

## Tracking

- Status:
- Review:
- Asset type:
- Project:
- Platforms:
- Publish date:
- Source:

## Working Files

- \`draft.md\`
- \`notes.md\`
- \`published.md\`

## Intent

## Source
`,
  },
];

function ensureDir(dirPath) {
  const existed = fs.existsSync(dirPath);
  fs.mkdirSync(dirPath, { recursive: true });
  return !existed;
}

function writeIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) return false;
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

function bootstrapLocalFoundation() {
  const createdDirectories = [];
  const createdFiles = [];

  ensureDir(KNOWLEDGE_ROOT);
  for (const relativeDir of KNOWLEDGE_DIRS) {
    const absoluteDir = path.join(KNOWLEDGE_ROOT, relativeDir);
    if (ensureDir(absoluteDir)) {
      createdDirectories.push(path.relative(db.OPENCLAW_HOME, absoluteDir));
    }
  }

  for (const seed of SEED_FILES) {
    const filePath = path.join(KNOWLEDGE_ROOT, seed.relativePath);
    ensureDir(path.dirname(filePath));
    if (writeIfMissing(filePath, seed.content)) {
      createdFiles.push(path.relative(db.OPENCLAW_HOME, filePath));
    }
  }

  const summary = db.getStatusSummary();
  db.closeDb();

  return {
    knowledgeRoot: KNOWLEDGE_ROOT,
    dbPath: summary.dbPath,
    createdDirectories,
    createdFiles,
    tables: summary.tables,
    migrations: summary.migrations,
  };
}

function main() {
  const result = bootstrapLocalFoundation();
  const asJson = process.argv.includes('--json');

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Knowledge root: ${result.knowledgeRoot}`);
  console.log(`DB path: ${result.dbPath}`);
  console.log(`Created directories: ${result.createdDirectories.length}`);
  console.log(`Created files: ${result.createdFiles.length}`);
}

module.exports = {
  KNOWLEDGE_ROOT,
  bootstrapLocalFoundation,
};

if (require.main === module) {
  main();
}
