#!/usr/bin/env node

/**
 * MCP Server for the Agent Pipeline.
 * Provides tools that Cursor AI can use to interact with the pipeline state.
 *
 * Tools:
 * - pipeline_get_task: Get the current task description
 * - pipeline_get_outputs: Get outputs from previous agents
 * - pipeline_save_output: Save the current agent's output
 * - pipeline_get_context: Get project context (file tree, tech stack)
 * - pipeline_get_status: Get full pipeline status
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

// ------- Storage functions (duplicated to keep MCP server standalone) -------

const PIPELINE_DIR = '.agent_pipeline';
const STATE_FILE = 'state.json';
const OUTPUTS_DIR = 'outputs';

interface PipelineState {
  currentPhase: string;
  taskDescription: string;
  outputs: Record<string, string>;
  history: Array<{
    phase: string;
    action: string;
    timestamp: string;
    detail?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

function findWorkspaceRoot(): string {
  // Try to find workspace root from environment or cwd
  const envRoot = process.env.AGENT_PIPELINE_WORKSPACE;
  if (envRoot && fs.existsSync(envRoot)) {
    return envRoot;
  }

  // Walk up from cwd to find a directory with .agent_pipeline
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, PIPELINE_DIR))) {
      return dir;
    }
    // Also check for common project markers
    if (
      fs.existsSync(path.join(dir, 'package.json')) ||
      fs.existsSync(path.join(dir, '.git'))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }

  return process.cwd();
}

function ensureDirs(workspaceRoot: string): void {
  const pipelineDir = path.join(workspaceRoot, PIPELINE_DIR);
  const outputsDir = path.join(pipelineDir, OUTPUTS_DIR);
  if (!fs.existsSync(pipelineDir)) {
    fs.mkdirSync(pipelineDir, { recursive: true });
  }
  if (!fs.existsSync(outputsDir)) {
    fs.mkdirSync(outputsDir, { recursive: true });
  }
}

function loadState(workspaceRoot: string): PipelineState {
  const stateFile = path.join(workspaceRoot, PIPELINE_DIR, STATE_FILE);
  if (!fs.existsSync(stateFile)) {
    return {
      currentPhase: 'idle',
      taskDescription: '',
      outputs: {},
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  } catch {
    return {
      currentPhase: 'idle',
      taskDescription: '',
      outputs: {},
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}

function saveState(workspaceRoot: string, state: PipelineState): void {
  ensureDirs(workspaceRoot);
  state.updatedAt = new Date().toISOString();
  const stateFile = path.join(workspaceRoot, PIPELINE_DIR, STATE_FILE);
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');
}

function buildFileTree(
  dir: string,
  prefix: string,
  depth: number,
  maxDepth = 4,
  maxFiles = 150
): string {
  if (depth > maxDepth) {
    return prefix + '... (max depth)\n';
  }

  const ignoreDirs = new Set([
    'node_modules', '.git', '.agent_pipeline', 'dist', 'build',
    '__pycache__', '.venv', 'venv', '.next', 'coverage',
  ]);

  let result = '';
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return result;
  }

  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) { return -1; }
    if (!a.isDirectory() && b.isDirectory()) { return 1; }
    return a.name.localeCompare(b.name);
  });

  let count = 0;
  for (const entry of entries) {
    if (ignoreDirs.has(entry.name) || entry.name.startsWith('.')) {
      continue;
    }

    count++;
    if (count > maxFiles) {
      result += prefix + '... (truncated)\n';
      break;
    }

    if (entry.isDirectory()) {
      result += `${prefix}${entry.name}/\n`;
      result += buildFileTree(
        path.join(dir, entry.name),
        prefix + '  ',
        depth + 1,
        maxDepth,
        maxFiles
      );
    } else {
      result += `${prefix}${entry.name}\n`;
    }
  }

  return result;
}

// ------- MCP Server Setup -------

const workspaceRoot = findWorkspaceRoot();

const server = new McpServer(
  {
    name: 'agent-pipeline',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ------- Tool: pipeline_get_task -------

server.tool(
  'pipeline_get_task',
  'Get the current pipeline task description and status',
  {},
  async () => {
    const state = loadState(workspaceRoot);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              taskDescription: state.taskDescription,
              currentPhase: state.currentPhase,
              hasOutputs: Object.keys(state.outputs).length,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ------- Tool: pipeline_get_outputs -------

server.tool(
  'pipeline_get_outputs',
  'Get outputs from previous pipeline agents. Optionally filter by agent name.',
  {
    agent_name: z
      .string()
      .optional()
      .describe(
        'Name of the agent whose output to retrieve (planner, implementer, reviewer, test). If omitted, returns all outputs.'
      ),
  },
  async (args) => {
    const state = loadState(workspaceRoot);

    if (args.agent_name) {
      const output = state.outputs[args.agent_name];
      if (!output) {
        // Try reading from file
        const outputFile = path.join(
          workspaceRoot,
          PIPELINE_DIR,
          OUTPUTS_DIR,
          `${args.agent_name}.md`
        );
        if (fs.existsSync(outputFile)) {
          const fileContent = fs.readFileSync(outputFile, 'utf-8');
          return {
            content: [
              {
                type: 'text' as const,
                text: fileContent,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: `No output found for agent "${args.agent_name}".`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: output,
          },
        ],
      };
    }

    // Return all outputs
    const allOutputs: Record<string, string> = {};
    for (const [key, val] of Object.entries(state.outputs)) {
      allOutputs[key] = val;
    }

    // Also check for file-based outputs
    const outputsDir = path.join(workspaceRoot, PIPELINE_DIR, OUTPUTS_DIR);
    if (fs.existsSync(outputsDir)) {
      const files = fs.readdirSync(outputsDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const name = path.basename(file, '.md');
          if (!allOutputs[name]) {
            try {
              allOutputs[name] = fs.readFileSync(
                path.join(outputsDir, file),
                'utf-8'
              );
            } catch {
              // skip
            }
          }
        }
      }
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(allOutputs, null, 2),
        },
      ],
    };
  }
);

// ------- Tool: pipeline_save_output -------

server.tool(
  'pipeline_save_output',
  'Save the current agent output to the pipeline. This marks the current agent phase as complete.',
  {
    agent_name: z
      .string()
      .describe(
        'Name of the agent saving output (planner, implementer, reviewer, test)'
      ),
    output: z.string().describe('The agent output content to save (markdown)'),
  },
  async (args) => {
    const state = loadState(workspaceRoot);

    // Save to state
    state.outputs[args.agent_name] = args.output;

    // Save to file
    ensureDirs(workspaceRoot);
    const outputFile = path.join(
      workspaceRoot,
      PIPELINE_DIR,
      OUTPUTS_DIR,
      `${args.agent_name}.md`
    );
    fs.writeFileSync(outputFile, args.output, 'utf-8');

    // Add history entry
    state.history.push({
      phase: state.currentPhase,
      action: 'output_saved',
      timestamp: new Date().toISOString(),
      detail: `Agent ${args.agent_name} saved output`,
    });

    // Determine review phase transition
    const phaseMap: Record<string, string> = {
      planner: 'plan_review',
      implementer: 'impl_review',
      reviewer: 'review_done',
      test: 'completed',
    };

    const nextPhase = phaseMap[args.agent_name];
    if (nextPhase) {
      state.currentPhase = nextPhase;
      state.history.push({
        phase: nextPhase,
        action: 'entered',
        timestamp: new Date().toISOString(),
        detail: `Transitioned after ${args.agent_name} output`,
      });
    }

    saveState(workspaceRoot, state);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Output saved for agent "${args.agent_name}". Pipeline moved to phase: ${nextPhase || state.currentPhase}.`,
        },
      ],
    };
  }
);

// ------- Tool: pipeline_get_context -------

server.tool(
  'pipeline_get_context',
  'Get project context including file structure and detected tech stack',
  {},
  async () => {
    const fileTree = buildFileTree(workspaceRoot, '', 0);

    // Detect tech stack
    const techStack: string[] = [];
    const indicators: Record<string, string> = {
      'package.json': 'Node.js',
      'tsconfig.json': 'TypeScript',
      'requirements.txt': 'Python',
      'pyproject.toml': 'Python',
      'go.mod': 'Go',
      'Cargo.toml': 'Rust',
      'Dockerfile': 'Docker',
    };

    for (const [file, tech] of Object.entries(indicators)) {
      if (fs.existsSync(path.join(workspaceRoot, file))) {
        techStack.push(tech);
      }
    }

    const context = {
      workspaceRoot,
      techStack,
      fileTree,
    };

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(context, null, 2),
        },
      ],
    };
  }
);

// ------- Tool: pipeline_get_status -------

server.tool(
  'pipeline_get_status',
  'Get the full pipeline status including phase, history, and all outputs',
  {},
  async () => {
    const state = loadState(workspaceRoot);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              currentPhase: state.currentPhase,
              taskDescription: state.taskDescription,
              outputAgents: Object.keys(state.outputs),
              historyCount: state.history.length,
              recentHistory: state.history.slice(-5),
              createdAt: state.createdAt,
              updatedAt: state.updatedAt,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ------- Start Server -------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server is running and listening on stdio
}

main().catch((error) => {
  console.error('MCP Server error:', error);
  process.exit(1);
});
