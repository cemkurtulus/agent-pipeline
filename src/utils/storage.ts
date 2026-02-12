/**
 * Storage utility for managing pipeline state and agent outputs.
 * All data is stored in .agent_pipeline/ directory at workspace root.
 */

import * as fs from 'fs';
import * as path from 'path';

const PIPELINE_DIR = '.agent_pipeline';
const STATE_FILE = 'state.json';
const OUTPUTS_DIR = 'outputs';

export interface PipelineState {
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

export function getDefaultState(): PipelineState {
  const now = new Date().toISOString();
  return {
    currentPhase: 'idle',
    taskDescription: '',
    outputs: {},
    history: [],
    createdAt: now,
    updatedAt: now,
  };
}

function getPipelineDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, PIPELINE_DIR);
}

function getOutputsDir(workspaceRoot: string): string {
  return path.join(getPipelineDir(workspaceRoot), OUTPUTS_DIR);
}

function getStateFilePath(workspaceRoot: string): string {
  return path.join(getPipelineDir(workspaceRoot), STATE_FILE);
}

/**
 * Ensure the pipeline directory structure exists.
 */
export function ensurePipelineDir(workspaceRoot: string): void {
  const pipelineDir = getPipelineDir(workspaceRoot);
  const outputsDir = getOutputsDir(workspaceRoot);

  if (!fs.existsSync(pipelineDir)) {
    fs.mkdirSync(pipelineDir, { recursive: true });
  }
  if (!fs.existsSync(outputsDir)) {
    fs.mkdirSync(outputsDir, { recursive: true });
  }
}

/**
 * Load the current pipeline state from disk.
 */
export function loadState(workspaceRoot: string): PipelineState {
  const stateFile = getStateFilePath(workspaceRoot);
  if (!fs.existsSync(stateFile)) {
    return getDefaultState();
  }
  try {
    const raw = fs.readFileSync(stateFile, 'utf-8');
    return JSON.parse(raw) as PipelineState;
  } catch {
    return getDefaultState();
  }
}

/**
 * Save the pipeline state to disk.
 */
export function saveState(workspaceRoot: string, state: PipelineState): void {
  ensurePipelineDir(workspaceRoot);
  state.updatedAt = new Date().toISOString();
  const stateFile = getStateFilePath(workspaceRoot);
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Save an agent's output to a markdown file.
 */
export function saveAgentOutput(
  workspaceRoot: string,
  agentName: string,
  content: string
): string {
  ensurePipelineDir(workspaceRoot);
  const outputFile = path.join(getOutputsDir(workspaceRoot), `${agentName}.md`);
  fs.writeFileSync(outputFile, content, 'utf-8');
  return outputFile;
}

/**
 * Read an agent's output from disk.
 */
export function readAgentOutput(
  workspaceRoot: string,
  agentName: string
): string | null {
  const outputFile = path.join(getOutputsDir(workspaceRoot), `${agentName}.md`);
  if (!fs.existsSync(outputFile)) {
    return null;
  }
  try {
    return fs.readFileSync(outputFile, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Read all agent outputs.
 */
export function readAllOutputs(
  workspaceRoot: string
): Record<string, string> {
  const outputsDir = getOutputsDir(workspaceRoot);
  const result: Record<string, string> = {};

  if (!fs.existsSync(outputsDir)) {
    return result;
  }

  const files = fs.readdirSync(outputsDir);
  for (const file of files) {
    if (file.endsWith('.md')) {
      const agentName = path.basename(file, '.md');
      try {
        result[agentName] = fs.readFileSync(
          path.join(outputsDir, file),
          'utf-8'
        );
      } catch {
        // skip unreadable files
      }
    }
  }

  return result;
}

/**
 * Clear all pipeline data (reset).
 */
export function clearPipelineData(workspaceRoot: string): void {
  const pipelineDir = getPipelineDir(workspaceRoot);
  if (fs.existsSync(pipelineDir)) {
    fs.rmSync(pipelineDir, { recursive: true, force: true });
  }
  ensurePipelineDir(workspaceRoot);
}

/**
 * Get the outputs directory path (for file watchers).
 */
export function getOutputsDirPath(workspaceRoot: string): string {
  return getOutputsDir(workspaceRoot);
}

/**
 * Get the state file path (for file watchers).
 */
export function getStateFilePathPublic(workspaceRoot: string): string {
  return getStateFilePath(workspaceRoot);
}
