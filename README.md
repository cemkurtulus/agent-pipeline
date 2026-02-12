# Agent Pipeline

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/cmkurtulus.agent-pipeline?label=VS%20Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=cmkurtulus.agent-pipeline)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/cmkurtulus.agent-pipeline)](https://marketplace.visualstudio.com/items?itemName=cmkurtulus.agent-pipeline)

**[Install from VS Marketplace](https://marketplace.visualstudio.com/items?itemName=cmkurtulus.agent-pipeline)**

Multi-agent pipeline orchestrator for Cursor IDE. Automates the software development workflow through 4 specialized AI agents: **Planner**, **Implementer**, **Reviewer**, and **Tester**.

Each agent has a specific role, receives auto-generated context-rich prompts, and passes its output to the next agent in the chain — creating a structured, reviewable development process.

---

## Table of Contents

- [Pipeline Flow](#pipeline-flow)
- [Agents](#agents)
- [Model Configuration](#model-configuration)
- [Installation](#installation)
- [Getting Started](#getting-started)
- [Commands](#commands)
- [Sidebar UI](#sidebar-ui)
- [Settings](#settings)
- [MCP Tools](#mcp-tools)
- [Rule Files (.mdc)](#rule-files-mdc)
- [Building from Source](#building-from-source)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Pipeline Flow

```
Start → Planner → [Review] → Implementer → [Review] → Reviewer → [Review] → Tester → Done
```

Each agent phase follows this cycle:

1. Extension generates a prompt with task description + project context + previous agent outputs
2. Prompt is automatically copied to your clipboard
3. A notification tells you which **AI model** to select in Cursor Chat
4. You paste the prompt into Cursor Chat (`Cmd+L`)
5. The AI works according to the agent's `.mdc` rules and prompt instructions
6. The AI saves its output via the `pipeline_save_output` MCP tool (or you can complete manually)
7. You review the output in the sidebar and **approve** or **reject**
8. On approve: pipeline advances to the next agent. On reject: current agent retries with your feedback

---

## Agents

### Planner

**Role:** Analyzes the task and creates a detailed implementation plan.

**What it produces:**
- Overview of what needs to be done
- List of files to create, modify, or delete
- Ordered implementation steps with dependencies
- Data flow diagrams
- Risk analysis and mitigations
- Acceptance criteria

**Default model:** `claude-4.5-sonnet`

---

### Implementer

**Role:** Writes the actual code following the Planner's output.

**What it produces:**
- New files and code changes as specified in the plan
- Summary of all files created and modified
- List of added dependencies
- Notes on any deviations from the plan

**Default model:** `claude-4.6-opus`

> **Tip:** Claude 4.6 Opus is the most capable model and is recommended for complex implementations. For simpler tasks, `claude-4.5-sonnet` offers a good balance of speed and quality.

---

### Reviewer

**Role:** Performs a code review of the Implementer's work. **Does NOT write or modify any code.**

**What it produces:**
- Overall assessment: **APPROVE** or **REQUEST_CHANGES**
- Summary of findings
- Issues found with severity (Critical / Major / Minor), file location, and fix suggestion
- Positive observations
- Test recommendations for the Tester agent

**Review criteria:**
- Correctness — Does the code match the plan?
- Code Quality — Clean code, DRY, proper naming
- Security — No vulnerabilities, proper input validation
- Performance — No obvious bottlenecks
- Error Handling — Edge cases covered
- Readability — Well-documented and understandable

**Default model:** `gpt-5.2`

> **Note:** The Reviewer prompt explicitly instructs the AI to only read and evaluate — never create or modify files. If the Reviewer tries to implement code, reject and retry.

---

### Tester

**Role:** Creates and runs tests for the implementation.

**What it produces:**
- Test files (unit tests, integration tests)
- Test summary — number of tests and what they cover
- Coverage notes — areas covered and gaps
- Run instructions — how to execute the tests

**Testing strategy:**
- Unit tests for individual functions/methods
- Integration tests for component interactions
- Edge case and boundary condition tests
- Regression tests to ensure nothing is broken

**Default model:** `claude-4.5-sonnet`

---

## Model Configuration

Each agent can use a different AI model. This lets you optimize cost and quality — for example, use a fast model for planning and a powerful model for implementation.

### Changing Models via Settings

1. Open Settings: `Cmd + ,`
2. Search for `agentPipeline.models`
3. Set the model for each agent:

| Setting | Description | Default |
|---------|-------------|---------|
| `agentPipeline.models.planner` | Model for the Planner agent | `claude-4.5-sonnet` |
| `agentPipeline.models.implementer` | Model for the Implementer agent | `claude-4.6-opus` |
| `agentPipeline.models.reviewer` | Model for the Reviewer agent | `gpt-5.2` |
| `agentPipeline.models.test` | Model for the Tester agent | `claude-4.5-sonnet` |

### Available Models

#### Current Models (Feb 2026)

| Model | Provider | Context | Notes |
|-------|----------|---------|-------|
| `claude-4.6-opus` | Anthropic | 200k / 1M max | Most capable — recommended for implementation |
| `claude-4.5-sonnet` | Anthropic | 200k / 1M max | Fast and capable — great all-rounder |
| `composer-1.5` | Cursor | 200k | Cursor's built-in model |
| `gemini-3-pro` | Google | 200k / 1M max | Google's most capable model |
| `gemini-3-flash` | Google | 200k / 1M max | Fast Google model |
| `gpt-5.3-codex` | OpenAI | 272k | OpenAI's latest coding model |
| `gpt-5.2` | OpenAI | 272k | OpenAI flagship |
| `grok-code` | xAI | 256k | xAI coding model |

#### Previous Generation (BYOK)

| Model | Provider | Notes |
|-------|----------|-------|
| `claude-3.5-sonnet` | Anthropic | Previous gen fast model |
| `claude-3-opus` | Anthropic | Previous gen most capable |
| `claude-3-haiku` | Anthropic | Previous gen fastest |
| `gpt-4o` | OpenAI | Previous gen flagship |
| `gpt-4o-mini` | OpenAI | Previous gen lightweight |
| `gpt-4-turbo` | OpenAI | Previous gen turbo |
| `gpt-4` | OpenAI | Previous gen base |
| `gemini-1.5-pro` | Google | Previous gen pro |
| `gemini-1.5-flash` | Google | Previous gen flash |
| `deepseek-v3` | DeepSeek | Open-source model |
| `deepseek-r1` | DeepSeek | Open-source reasoning |
| `o1-mini` | OpenAI | Reasoning model (mini) |
| `o1-preview` | OpenAI | Reasoning model |

> **Note:** You can also type any custom model name that Cursor supports. The dropdown is a convenience — not a limitation.

### Where Models Appear

- **Sidebar:** Each agent step shows its configured model as a badge
- **Prompt:** The generated prompt includes a model reminder at the top
- **Notification:** When copying a prompt, the notification tells you which model to select
- **Settings button:** The sidebar has a "Configure Models" button that opens Settings directly

### Recommended Configurations

**Cost-optimized:**
| Agent | Model |
|-------|-------|
| Planner | `gemini-3-flash` |
| Implementer | `claude-4.5-sonnet` |
| Reviewer | `composer-1.5` |
| Tester | `gemini-3-flash` |

**Quality-optimized (default):**
| Agent | Model |
|-------|-------|
| Planner | `claude-4.5-sonnet` |
| Implementer | `claude-4.6-opus` |
| Reviewer | `gpt-5.2` |
| Tester | `claude-4.5-sonnet` |

**Maximum power:**
| Agent | Model |
|-------|-------|
| Planner | `claude-4.6-opus` |
| Implementer | `claude-4.6-opus` |
| Reviewer | `claude-4.6-opus` |
| Tester | `gpt-5.3-codex` |

---

## Installation

### From VSIX (Recommended)

1. Get the `.vsix` file (e.g., `agent-pipeline-0.4.0.vsix`)
2. In Cursor: `Cmd+Shift+P` → **"Extensions: Install from VSIX..."**
3. Select the `.vsix` file
4. **Reload Cursor** (`Cmd+Shift+P` → "Developer: Reload Window")

On first activation, the extension will automatically:
- Configure the MCP server in `.cursor/mcp.json`
- Prompt you to install agent rule files (`.mdc`) in `.cursor/rules/`

### From Source (Development)

```bash
cd extension
npm install
npm run compile
# Press F5 to launch Extension Development Host
```

---

## Getting Started

### Step-by-step Walkthrough

1. **Open the sidebar:** Click the pipeline icon in the Activity Bar (left side)
2. **Start a pipeline:** Click "Start Pipeline" and describe your task
   - Example: *"Add user authentication with JWT tokens and refresh token support"*
3. **Planner phase:**
   - A prompt is auto-copied to your clipboard
   - Select the model shown in the notification (e.g., `claude-3.5-sonnet`)
   - Open Cursor Chat (`Cmd+L`) and paste the prompt
   - The AI will analyze the task and produce a plan
   - When done, the sidebar updates to "Review Plan"
4. **Review the plan:**
   - Read the Planner's output in the sidebar (expand "Agent Outputs")
   - Click **"Approve & Continue"** if satisfied, or **"Reject & Retry"** with feedback
5. **Implementer phase:**
   - Same flow: copy prompt → select model → paste in Chat → AI implements the code
   - The AI follows the Planner's output to write code
6. **Reviewer phase:**
   - The Reviewer reads the plan and implementation, then produces a review report
   - It does NOT modify any files — only reviews
7. **Tester phase:**
   - The Tester creates tests based on the plan, implementation, and review
8. **Done!** All phases completed.

### Auto-Complete on File Save

By default, the extension watches for file saves while an agent is active. When files stop being saved (after a 5-second debounce), the phase is automatically completed and you get a notification to review.

This means you don't need to manually click "Complete Phase" — the extension detects when the AI is done by observing file save activity.

You can configure this in Settings:
- `agentPipeline.autoComplete.enabled` — Enable/disable auto-complete (default: `true`)
- `agentPipeline.autoComplete.debounceSeconds` — Seconds to wait after last save (default: `5`, range: 2-30)

### If the AI Doesn't Call the MCP Tool

Sometimes the AI may not automatically call `pipeline_save_output`. If a phase gets stuck on "Working..." and auto-complete doesn't trigger:

1. Click **"Complete Phase"** in the sidebar
2. Optionally paste the AI's output into the input box
3. The pipeline advances to the review step

---

## Commands

All commands are available via `Cmd+Shift+P`:

| Command | Description |
|---------|-------------|
| `Agent Pipeline: Start Pipeline` | Begin a new pipeline with a task description |
| `Agent Pipeline: Approve & Continue` | Approve current phase output and advance to the next agent |
| `Agent Pipeline: Reject & Retry` | Reject output and retry the current phase (with optional feedback) |
| `Agent Pipeline: Copy Current Prompt` | Re-copy the active agent's prompt to clipboard |
| `Agent Pipeline: Complete Current Phase` | Manually complete a phase if the AI didn't call the MCP tool |
| `Agent Pipeline: Reset Pipeline` | Clear all pipeline state, outputs, and start fresh |
| `Agent Pipeline: Setup Rule Files` | Install or update `.mdc` agent rules in the workspace |

---

## Sidebar UI

The sidebar shows:

- **Pipeline Steps** — Visual progress indicator with status for each agent (Pending / Working / Awaiting Review / Done) and the configured model badge
- **Task** — The current task description
- **Current Phase** — Active phase with status badge and instructions
- **Agent Outputs** — Expandable section showing each agent's output (click to expand/collapse)
- **Action Buttons:**
  - **Start Pipeline** — visible when idle
  - **Copy Prompt** — visible when an agent is active
  - **Complete Phase** — visible when an agent is active (manual completion)
  - **Approve & Continue** — visible during review phases
  - **Reject & Retry** — visible during review phases
  - **Reset** — visible when pipeline is running
  - **Configure Models** — always visible, opens model settings

---

## Settings

All settings are under the `agentPipeline` namespace:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `agentPipeline.autoComplete.enabled` | boolean | `true` | Auto-complete phase when files are saved |
| `agentPipeline.autoComplete.debounceSeconds` | number | `5` | Seconds to wait after last file save before auto-completing |
| `agentPipeline.models.planner` | string | `claude-4.5-sonnet` | AI model for the Planner agent |
| `agentPipeline.models.implementer` | string | `claude-4.6-opus` | AI model for the Implementer agent |
| `agentPipeline.models.reviewer` | string | `gpt-5.2` | AI model for the Reviewer agent |
| `agentPipeline.models.test` | string | `claude-4.5-sonnet` | AI model for the Tester agent |

Settings can be configured at:
- **User level** — applies to all workspaces
- **Workspace level** — applies only to the current project (overrides user settings)

---

## MCP Tools

The extension includes an MCP server that exposes tools for the AI to interact with the pipeline. These are called automatically by the AI when working within a pipeline phase.

| Tool | Description |
|------|-------------|
| `pipeline_get_task` | Returns the current task description and pipeline status |
| `pipeline_get_outputs` | Returns outputs from previous agents (by agent name) |
| `pipeline_save_output` | Saves the current agent's output and triggers phase transition |
| `pipeline_get_context` | Returns project file tree and detected tech stack |
| `pipeline_get_status` | Returns full pipeline status including phase history |

The MCP server is automatically configured in `.cursor/mcp.json` when the extension activates. It uses an absolute path to the server bundled inside the extension, so it works regardless of which workspace you open.

---

## Rule Files (.mdc)

The extension ships with 5 rule files that tell Cursor's AI how to behave as each agent:

| File | Purpose |
|------|---------|
| `global.mdc` | Shared rules — always active, defines the pipeline concept and MCP tool usage |
| `planner.mdc` | Planner agent behavior — task analysis, plan structure, output format |
| `implementer.mdc` | Implementer agent behavior — coding guidelines, output format |
| `reviewer.mdc` | Reviewer agent behavior — review-only (no code changes), checklist, output format |
| `test.mdc` | Tester agent behavior — testing strategy, frameworks, output format |

These are installed to `.cursor/rules/` in your workspace. You can customize them to fit your project's needs.

### Reinstalling Rules

If you modify the rules and want to restore the originals:

```
Cmd+Shift+P → "Agent Pipeline: Setup Rule Files"
```

---

## Building from Source

### Prerequisites

- Node.js >= 18
- npm

### Build

```bash
# Install dependencies
npm install

# Build extension + MCP server
npm run build:all

# Package as VSIX
npx vsce package
```

This creates `agent-pipeline-0.5.0.vsix` ready for distribution.

### Development

```bash
# Build in development mode
npm run compile

# Watch for changes
npm run watch

# Press F5 in Cursor/VS Code to launch Extension Development Host
```

### Project Structure

```
extension/
├── src/
│   ├── extension.ts              # Main entry point, commands, auto-setup
│   ├── pipeline/
│   │   ├── AgentConfig.ts        # Agent definitions, phases, model defaults
│   │   ├── PipelineManager.ts    # State machine, phase transitions
│   │   └── PromptGenerator.ts    # Context-rich prompt generation per agent
│   ├── utils/
│   │   ├── storage.ts            # Pipeline state persistence (.agent_pipeline/)
│   │   └── fileAnalyzer.ts       # Workspace analysis (file tree, tech stack)
│   ├── views/
│   │   └── SidebarProvider.ts    # Webview sidebar (inline HTML/CSS/JS)
│   └── mcp/
│       └── server.ts             # MCP server exposing pipeline tools
├── resources/
│   ├── icons/pipeline.svg        # Activity bar icon
│   └── rules/*.mdc               # Agent rule files
├── package.json                   # Extension manifest, settings, commands
├── webpack.config.js              # Extension bundle config
├── webpack.mcp.config.js          # MCP server bundle config
└── tsconfig.json                  # TypeScript config
```

---

## Troubleshooting

### Sidebar is empty after installation
- Make sure you reloaded Cursor after installing the VSIX (`Cmd+Shift+P` → "Developer: Reload Window")
- Check that the pipeline icon appears in the Activity Bar (left side)

### Agent phase stuck on "Working..."
- The AI may not have called the `pipeline_save_output` MCP tool
- Click **"Complete Phase"** in the sidebar to manually advance
- You can paste the AI's output into the input box, or leave it empty

### Reviewer is writing code instead of reviewing
- This was fixed in v0.4.0 with stronger prompt instructions
- If it still happens, click **"Reject & Retry"** — the retry prompt reinforces the review-only role
- Check that `reviewer.mdc` in `.cursor/rules/` contains the "DO NOT write code" instructions

### MCP server not connecting
- Check `.cursor/mcp.json` in your workspace — it should contain an `agent-pipeline` entry
- Run `Cmd+Shift+P` → "Agent Pipeline: Setup Rule Files" to re-trigger setup
- Restart Cursor if needed

### Rule files not installed
- Run `Cmd+Shift+P` → "Agent Pipeline: Setup Rule Files"
- Check that `.cursor/rules/` contains `global.mdc`, `planner.mdc`, `implementer.mdc`, `reviewer.mdc`, `test.mdc`

### Model not available in Cursor
- Make sure the model is enabled in your Cursor subscription
- You can type any model name in Settings — the dropdown list is just a convenience

---

## License

MIT
