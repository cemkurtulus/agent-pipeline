/**
 * FileAnalyzer - Analyzes the workspace to build project context.
 * Provides file tree, tech stack detection, and recent changes info.
 */

import * as fs from 'fs';
import * as path from 'path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.agent_pipeline', 'dist', 'build',
  '__pycache__', '.venv', 'venv', '.next', '.nuxt', 'coverage',
  '.pytest_cache', '.mypy_cache', '.tox', 'egg-info',
]);

const IGNORE_FILES = new Set([
  '.DS_Store', 'Thumbs.db', '.env', '.env.local',
]);

const MAX_DEPTH = 5;
const MAX_FILES = 200;

export interface ProjectContext {
  fileTree: string;
  techStack: string[];
  entryPoints: string[];
  fileCount: number;
  summary: string;
}

/**
 * Build a complete project context from the workspace root.
 */
export function analyzeProject(workspaceRoot: string): ProjectContext {
  const tree = buildFileTree(workspaceRoot, '', 0);
  const techStack = detectTechStack(workspaceRoot);
  const entryPoints = detectEntryPoints(workspaceRoot);

  let fileCount = 0;
  countFiles(workspaceRoot, 0, (count) => { fileCount = count; });

  const summary = buildSummary(techStack, entryPoints, fileCount);

  return {
    fileTree: tree,
    techStack,
    entryPoints,
    fileCount,
    summary,
  };
}

/**
 * Build a text-based file tree representation.
 */
function buildFileTree(dir: string, prefix: string, depth: number): string {
  if (depth > MAX_DEPTH) {
    return prefix + '... (max depth reached)\n';
  }

  let result = '';
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return result;
  }

  // Sort: directories first, then files
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) { return -1; }
    if (!a.isDirectory() && b.isDirectory()) { return 1; }
    return a.name.localeCompare(b.name);
  });

  let fileCounter = 0;

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name) || IGNORE_FILES.has(entry.name)) {
      continue;
    }
    if (entry.name.startsWith('.') && entry.isDirectory()) {
      continue; // skip hidden dirs
    }

    fileCounter++;
    if (fileCounter > MAX_FILES) {
      result += prefix + '... (truncated)\n';
      break;
    }

    if (entry.isDirectory()) {
      result += `${prefix}${entry.name}/\n`;
      result += buildFileTree(
        path.join(dir, entry.name),
        prefix + '  ',
        depth + 1
      );
    } else {
      result += `${prefix}${entry.name}\n`;
    }
  }

  return result;
}

/**
 * Detect technologies used in the project.
 */
function detectTechStack(workspaceRoot: string): string[] {
  const stack: string[] = [];

  const indicators: Record<string, string> = {
    'package.json': 'Node.js',
    'tsconfig.json': 'TypeScript',
    'requirements.txt': 'Python',
    'pyproject.toml': 'Python',
    'Pipfile': 'Python',
    'go.mod': 'Go',
    'Cargo.toml': 'Rust',
    'pom.xml': 'Java (Maven)',
    'build.gradle': 'Java (Gradle)',
    'Gemfile': 'Ruby',
    'composer.json': 'PHP',
    'Dockerfile': 'Docker',
    'docker-compose.yml': 'Docker Compose',
    'docker-compose.yaml': 'Docker Compose',
    '.github': 'GitHub Actions',
    'next.config.js': 'Next.js',
    'next.config.mjs': 'Next.js',
    'next.config.ts': 'Next.js',
    'nuxt.config.ts': 'Nuxt.js',
    'vite.config.ts': 'Vite',
    'vite.config.js': 'Vite',
    'tailwind.config.js': 'Tailwind CSS',
    'tailwind.config.ts': 'Tailwind CSS',
    'prisma': 'Prisma',
    'drizzle.config.ts': 'Drizzle ORM',
    '.env': 'Environment Variables',
  };

  for (const [file, tech] of Object.entries(indicators)) {
    if (fs.existsSync(path.join(workspaceRoot, file))) {
      if (!stack.includes(tech)) {
        stack.push(tech);
      }
    }
  }

  // Detect frameworks from package.json
  const pkgPath = path.join(workspaceRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      const frameworkMap: Record<string, string> = {
        react: 'React',
        vue: 'Vue.js',
        angular: 'Angular',
        svelte: 'Svelte',
        express: 'Express.js',
        fastify: 'Fastify',
        nestjs: 'NestJS',
        '@nestjs/core': 'NestJS',
        jest: 'Jest',
        vitest: 'Vitest',
        mocha: 'Mocha',
        eslint: 'ESLint',
        prettier: 'Prettier',
      };

      for (const [dep, tech] of Object.entries(frameworkMap)) {
        if (allDeps && dep in allDeps && !stack.includes(tech)) {
          stack.push(tech);
        }
      }
    } catch {
      // skip parsing errors
    }
  }

  return stack;
}

/**
 * Detect likely entry point files.
 */
function detectEntryPoints(workspaceRoot: string): string[] {
  const candidates = [
    'src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.js',
    'src/app.ts', 'src/app.js', 'index.ts', 'index.js',
    'app.ts', 'app.js', 'main.py', 'app.py',
    'src/extension.ts', 'cmd/main.go', 'main.go',
    'src/main.rs', 'lib/main.rb',
  ];

  return candidates.filter((f) =>
    fs.existsSync(path.join(workspaceRoot, f))
  );
}

/**
 * Count total files (non-ignored) in the workspace.
 */
function countFiles(dir: string, depth: number, callback: (count: number) => void): number {
  if (depth > MAX_DEPTH) { return 0; }

  let count = 0;
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    callback(count);
    return count;
  }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name) || IGNORE_FILES.has(entry.name)) {
      continue;
    }
    if (entry.name.startsWith('.') && entry.isDirectory()) {
      continue;
    }

    if (entry.isDirectory()) {
      count += countFiles(path.join(dir, entry.name), depth + 1, () => {});
    } else {
      count++;
    }
  }

  callback(count);
  return count;
}

/**
 * Build a human-readable project summary.
 */
function buildSummary(
  techStack: string[],
  entryPoints: string[],
  fileCount: number
): string {
  let summary = `Project contains ${fileCount} files.`;

  if (techStack.length > 0) {
    summary += `\nTech stack: ${techStack.join(', ')}.`;
  }

  if (entryPoints.length > 0) {
    summary += `\nEntry points: ${entryPoints.join(', ')}.`;
  }

  return summary;
}

/**
 * Generate a compact context string for use in prompts.
 */
export function generateContextString(workspaceRoot: string): string {
  const ctx = analyzeProject(workspaceRoot);

  let result = '## Project Context\n\n';
  result += ctx.summary + '\n\n';
  result += '### File Structure\n```\n' + ctx.fileTree + '```\n\n';

  if (ctx.techStack.length > 0) {
    result += '### Tech Stack\n';
    for (const tech of ctx.techStack) {
      result += `- ${tech}\n`;
    }
    result += '\n';
  }

  return result;
}
