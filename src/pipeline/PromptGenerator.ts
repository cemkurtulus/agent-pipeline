/**
 * PromptGenerator - Generates context-rich prompts for each agent phase.
 * Combines task description, project context, and previous agent outputs.
 */

import { PipelinePhase, AGENTS, getAgentForPhase } from './AgentConfig';
import { PipelineState } from '../utils/storage';
import { generateContextString } from '../utils/fileAnalyzer';

export interface GeneratedPrompt {
  agentName: string;
  prompt: string;
  phase: PipelinePhase;
  model: string;
}

/**
 * Generate the prompt for the current pipeline phase.
 * @param modelOverrides - Optional map of agent name → model name from VS Code settings.
 */
export function generatePrompt(
  state: PipelineState,
  workspaceRoot: string,
  modelOverrides?: Record<string, string>
): GeneratedPrompt | null {
  const phase = state.currentPhase as PipelinePhase;
  const agent = getAgentForPhase(phase);

  if (!agent) {
    return null;
  }

  // Resolve the model: user setting > agent default
  const model = modelOverrides?.[agent.name] || agent.defaultModel;

  const projectContext = generateContextString(workspaceRoot);
  const previousOutputs = buildPreviousOutputsSection(state, agent.requiredInputs);
  const agentInstructions = getAgentInstructions(agent.name);

  const prompt = assemblePrompt({
    taskDescription: state.taskDescription,
    projectContext,
    previousOutputs,
    agentInstructions,
    agentName: agent.displayName,
    phase,
    model,
  });

  return {
    agentName: agent.name,
    prompt,
    phase,
    model,
  };
}

// ------- Prompt Assembly -------

interface PromptParts {
  taskDescription: string;
  projectContext: string;
  previousOutputs: string;
  agentInstructions: string;
  agentName: string;
  phase: PipelinePhase;
  model: string;
}

function assemblePrompt(parts: PromptParts): string {
  let prompt = '';
  const isReviewer = parts.phase === 'reviewing';
  const isTester = parts.phase === 'testing';

  prompt += `# ${parts.agentName} Agent\n\n`;
  prompt += `> **Model:** \`${parts.model}\` — Please make sure you have selected this model in Cursor Chat before pasting.\n\n`;

  // For reviewer and tester: put role instructions BEFORE the task so the AI knows its role first
  if (isReviewer || isTester) {
    prompt += parts.agentInstructions;
    prompt += `\n## Original Task (for context — DO NOT implement this)\n${parts.taskDescription}\n\n`;
  } else {
    prompt += `## Task\n${parts.taskDescription}\n\n`;
  }

  prompt += parts.projectContext;

  if (parts.previousOutputs) {
    prompt += parts.previousOutputs;
  }

  // For non-reviewer/tester agents, instructions come after context
  if (!isReviewer && !isTester) {
    prompt += parts.agentInstructions;
  }

  prompt += '\n---\n';
  prompt += `**IMPORTANT:** When you are done, save your output using the \`pipeline_save_output\` MCP tool with agent_name="${getAgentForPhase(parts.phase)?.outputKey || parts.phase}".\n`;

  return prompt;
}

// ------- Previous Outputs -------

function buildPreviousOutputsSection(
  state: PipelineState,
  requiredInputs: string[]
): string {
  if (requiredInputs.length === 0) {
    return '';
  }

  let section = '## Previous Agent Outputs\n\n';
  let hasOutput = false;

  for (const inputKey of requiredInputs) {
    const output = state.outputs[inputKey];
    if (output) {
      const agent = AGENTS[inputKey];
      section += `### ${agent?.displayName || inputKey} Output\n`;
      section += `${output}\n\n`;
      hasOutput = true;
    }
  }

  return hasOutput ? section : '';
}

// ------- Agent-Specific Instructions -------

function getAgentInstructions(agentName: string): string {
  switch (agentName) {
    case 'planner':
      return getPlannerInstructions();
    case 'implementer':
      return getImplementerInstructions();
    case 'reviewer':
      return getReviewerInstructions();
    case 'test':
      return getTestInstructions();
    default:
      return '';
  }
}

function getPlannerInstructions(): string {
  return `
## Your Role: Planner

You are the **Planner** agent. Your job is to analyze the task and create a comprehensive implementation plan.

### Expected Output

Create a detailed plan that includes:

1. **Overview** - Brief summary of what needs to be done
2. **File Changes** - List of files to create/modify/delete with descriptions
3. **Implementation Steps** - Ordered list of steps with dependencies
4. **Data Flow** - How data moves through the system
5. **Risk Analysis** - Potential issues and mitigations
6. **Acceptance Criteria** - How to verify the implementation is correct

### Guidelines

- Be specific about file paths and function names
- Consider edge cases and error handling
- Identify dependencies between steps
- Estimate complexity for each step (low/medium/high)
- Consider backward compatibility
`;
}

function getImplementerInstructions(): string {
  return `
## Your Role: Implementer

You are the **Implementer** agent. Your job is to write the actual code following the plan provided by the Planner.

### Guidelines

- Follow the plan step by step
- Write clean, well-documented code
- Include error handling
- Follow the project's existing code style and conventions
- Create/modify files as specified in the plan
- Add inline comments for complex logic
- Ensure imports and dependencies are correct

### Expected Output

Provide a summary of all changes made:
1. **Files Created** - New files with brief descriptions
2. **Files Modified** - Changed files with what was changed
3. **Dependencies Added** - Any new packages/dependencies
4. **Notes** - Any deviations from the plan and why
`;
}

function getReviewerInstructions(): string {
  return `
## YOUR ROLE: CODE REVIEWER

> **CRITICAL: You are a CODE REVIEWER. You must NOT write or implement any code.**
> **Your ONLY job is to READ and EVALUATE the existing implementation.**
> **DO NOT create files. DO NOT modify files. DO NOT implement anything.**

You are the **Reviewer** agent in a multi-agent pipeline. The Planner agent created a plan, and the Implementer agent has already written the code. Your job is to **review what was already implemented** — not to implement anything yourself.

### What You Must Do

1. **Read** the Planner's plan and the Implementer's output (provided below)
2. **Examine** the actual code files that were created or modified
3. **Evaluate** the implementation against the criteria below
4. **Write a review report** — nothing else

### Review Criteria

1. **Correctness** - Does the code do what the plan specified?
2. **Code Quality** - Clean code, DRY principles, proper naming
3. **Security** - No vulnerabilities, proper input validation, no secrets in code
4. **Performance** - No obvious performance issues, proper data structures
5. **Error Handling** - Proper error handling and edge cases
6. **Readability** - Code is understandable and well-documented
7. **Testing** - Are there obvious test cases that should be written?

### Expected Output Format

Your output must be a structured review report:

1. **Overall Assessment** — Write exactly one of: **APPROVE** or **REQUEST_CHANGES**
2. **Summary** — 2-3 sentence overall assessment
3. **Issues Found** — List each issue with:
   - Severity: CRITICAL / MAJOR / MINOR
   - File & line: where the issue is
   - Description: what is wrong
   - Suggestion: how to fix it
4. **Positive Observations** — What was done well
5. **Test Recommendations** — Tests that the Tester agent should write

> **REMINDER: Do NOT write code. Do NOT create or modify any files. Only produce a review report.**
`;
}

function getTestInstructions(): string {
  return `
## Your Role: Tester

You are the **Tester** agent. Your job is to create and verify tests for the implementation.

### Testing Strategy

1. **Unit Tests** - Test individual functions/methods
2. **Integration Tests** - Test component interactions
3. **Edge Cases** - Test boundary conditions and error cases
4. **Regression** - Ensure existing functionality isn't broken

### Guidelines

- Use the project's testing framework (detect from project context)
- Write descriptive test names
- Cover both happy paths and error cases
- Mock external dependencies
- Aim for meaningful coverage, not just high numbers

### Expected Output

1. **Test Files Created** - List of test files
2. **Test Summary** - Number of tests, what they cover
3. **Coverage Notes** - Areas covered and any gaps
4. **Run Instructions** - How to execute the tests
`;
}
