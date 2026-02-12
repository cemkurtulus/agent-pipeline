/**
 * Agent definitions and pipeline phase configuration.
 */

export type PipelinePhase =
  | 'idle'
  | 'planning'
  | 'plan_review'
  | 'implementing'
  | 'impl_review'
  | 'reviewing'
  | 'review_done'
  | 'testing'
  | 'completed';

export interface AgentDefinition {
  name: string;
  displayName: string;
  phase: PipelinePhase;
  reviewPhase: PipelinePhase;
  description: string;
  mdcFile: string;
  requiredInputs: string[];
  outputKey: string;
  defaultModel: string;
}

/**
 * Known model options for Cursor IDE.
 * Users can also type a custom model name in the settings.
 */
export const KNOWN_MODELS: string[] = [
  // Current Cursor models (Feb 2026)
  'claude-4.6-opus',
  'claude-4.5-sonnet',
  'composer-1.5',
  'gemini-3-pro',
  'gemini-3-flash',
  'gpt-5.3-codex',
  'gpt-5.2',
  'grok-code',
  // Previous generation (BYOK)
  'claude-3.5-sonnet',
  'claude-3-opus',
  'claude-3-haiku',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'gpt-4',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'deepseek-v3',
  'deepseek-r1',
  'o1-mini',
  'o1-preview',
];

export const AGENTS: Record<string, AgentDefinition> = {
  planner: {
    name: 'planner',
    displayName: 'Planner',
    phase: 'planning',
    reviewPhase: 'plan_review',
    description: 'Analyzes the task and creates a detailed implementation plan',
    mdcFile: 'planner.mdc',
    requiredInputs: [],
    outputKey: 'planner',
    defaultModel: 'claude-4.5-sonnet',
  },
  implementer: {
    name: 'implementer',
    displayName: 'Implementer',
    phase: 'implementing',
    reviewPhase: 'impl_review',
    description: 'Implements the code changes according to the plan',
    mdcFile: 'implementer.mdc',
    requiredInputs: ['planner'],
    outputKey: 'implementer',
    defaultModel: 'claude-4.6-opus',
  },
  reviewer: {
    name: 'reviewer',
    displayName: 'Reviewer',
    phase: 'reviewing',
    reviewPhase: 'review_done',
    description: 'Reviews the implementation for quality, security, and best practices',
    mdcFile: 'reviewer.mdc',
    requiredInputs: ['planner', 'implementer'],
    outputKey: 'reviewer',
    defaultModel: 'gpt-5.2',
  },
  test: {
    name: 'test',
    displayName: 'Tester',
    phase: 'testing',
    reviewPhase: 'completed',
    description: 'Creates and runs tests for the implementation',
    mdcFile: 'test.mdc',
    requiredInputs: ['planner', 'implementer', 'reviewer'],
    outputKey: 'test',
    defaultModel: 'claude-4.5-sonnet',
  },
};

export const PHASE_ORDER: PipelinePhase[] = [
  'idle',
  'planning',
  'plan_review',
  'implementing',
  'impl_review',
  'reviewing',
  'review_done',
  'testing',
  'completed',
];

export const PHASE_AGENT_MAP: Record<string, string> = {
  planning: 'planner',
  implementing: 'implementer',
  reviewing: 'reviewer',
  testing: 'test',
};

export const REVIEW_PHASES: PipelinePhase[] = [
  'plan_review',
  'impl_review',
  'review_done',
];

/**
 * Get the agent definition for a given active phase.
 */
export function getAgentForPhase(phase: PipelinePhase): AgentDefinition | undefined {
  const agentName = PHASE_AGENT_MAP[phase];
  return agentName ? AGENTS[agentName] : undefined;
}

/**
 * Get the configured model for an agent, falling back to the default.
 * Reads from VS Code workspace/user settings: agentPipeline.models.<agentName>
 */
export function getModelForAgent(agentName: string): string {
  const agent = AGENTS[agentName];
  if (!agent) {
    return 'claude-4.5-sonnet';
  }

  // Dynamic import not possible for vscode module in pure config file,
  // so this is called from extension code that passes the config value.
  return agent.defaultModel;
}

/**
 * Get the next working phase after a review approval.
 */
export function getNextPhaseAfterApproval(currentPhase: PipelinePhase): PipelinePhase {
  const idx = PHASE_ORDER.indexOf(currentPhase);
  if (idx === -1 || idx >= PHASE_ORDER.length - 1) {
    return 'completed';
  }
  return PHASE_ORDER[idx + 1];
}

/**
 * Get the previous working phase for a rejection/retry.
 */
export function getRetryPhase(currentPhase: PipelinePhase): PipelinePhase {
  switch (currentPhase) {
    case 'plan_review':
      return 'planning';
    case 'impl_review':
      return 'implementing';
    case 'review_done':
      return 'implementing'; // reviewer says fix needed → back to implementer
    case 'testing':
      return 'implementing'; // test failed → back to implementer
    default:
      return currentPhase;
  }
}
