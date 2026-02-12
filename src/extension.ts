/**
 * Agent Pipeline Extension - Main entry point.
 *
 * Orchestrates the multi-agent pipeline for Cursor IDE:
 * - Registers commands (start, approve, reject, reset, copyPrompt, setupRules)
 * - Sets up the sidebar webview
 * - Auto-configures MCP server in the target project
 * - Auto-copies .mdc rule files to the target project
 * - Watches for file changes in .agent_pipeline/
 * - Generates and manages prompts for each pipeline phase
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PipelineManager } from './pipeline/PipelineManager';
import { generatePrompt } from './pipeline/PromptGenerator';
import { SidebarProvider } from './views/SidebarProvider';

let pipelineManager: PipelineManager;
let sidebarProvider: SidebarProvider;
let fileWatcher: vscode.FileSystemWatcher | undefined;
let autoCompleteTimeout: NodeJS.Timeout | undefined;
let autoCompleteSaveCount = 0;

export function activate(context: vscode.ExtensionContext) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showWarningMessage(
      'Agent Pipeline: No workspace folder open. Please open a folder first.'
    );
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  const extensionPath = context.extensionPath;

  // Initialize PipelineManager
  pipelineManager = new PipelineManager(workspaceRoot);

  // Initialize Sidebar Provider
  sidebarProvider = new SidebarProvider(context.extensionUri, pipelineManager);

  // Register webview provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      sidebarProvider
    )
  );

  // ------- Auto-Setup: MCP Config & Rules -------

  try {
    setupMcpConfig(workspaceRoot, extensionPath);
  } catch (err: any) {
    console.error('Agent Pipeline: MCP config setup failed:', err.message);
  }

  // Delay rules check so Cursor UI is fully loaded before showing the notification
  setTimeout(async () => {
    try {
      await checkAndPromptRulesSetup(workspaceRoot, extensionPath);
    } catch (err: any) {
      console.error('Agent Pipeline: Rules setup failed:', err.message);
    }
  }, 3000);

  // ------- Register Commands -------

  // Start Pipeline
  context.subscriptions.push(
    vscode.commands.registerCommand('agentPipeline.start', async () => {
      if (!pipelineManager.canStart()) {
        const reset = await vscode.window.showWarningMessage(
          'Pipeline is already running. Reset first?',
          'Reset & Start',
          'Cancel'
        );
        if (reset === 'Reset & Start') {
          pipelineManager.reset();
        } else {
          return;
        }
      }

      const taskDescription = await vscode.window.showInputBox({
        prompt: 'Describe the task for the agent pipeline',
        placeHolder: 'e.g., Add user authentication with JWT tokens',
        ignoreFocusOut: true,
      });

      if (!taskDescription) {
        return; // User cancelled
      }

      try {
        pipelineManager.start(taskDescription);
        vscode.window.showInformationMessage(
          `Agent Pipeline started: ${taskDescription}`
        );

        // Auto-generate and copy the first prompt
        await copyCurrentPrompt(workspaceRoot);
      } catch (error: any) {
        vscode.window.showErrorMessage(
          `Failed to start pipeline: ${error.message}`
        );
      }
    })
  );

  // Approve & Continue
  context.subscriptions.push(
    vscode.commands.registerCommand('agentPipeline.approve', async () => {
      if (!pipelineManager.canApprove()) {
        vscode.window.showWarningMessage(
          'Nothing to approve. Pipeline is not in a review phase.'
        );
        return;
      }

      try {
        pipelineManager.approve();

        const phase = pipelineManager.getCurrentPhase();
        if (phase === 'completed') {
          vscode.window.showInformationMessage(
            'Agent Pipeline completed successfully!'
          );
        } else {
          vscode.window.showInformationMessage(
            `Approved! Moving to: ${phase}`
          );
          // Auto-generate the next prompt
          await copyCurrentPrompt(workspaceRoot);
        }
      } catch (error: any) {
        vscode.window.showErrorMessage(`Approve failed: ${error.message}`);
      }
    })
  );

  // Reject & Retry
  context.subscriptions.push(
    vscode.commands.registerCommand('agentPipeline.reject', async () => {
      if (!pipelineManager.canReject()) {
        vscode.window.showWarningMessage(
          'Nothing to reject. Pipeline is not in a review phase.'
        );
        return;
      }

      const feedback = await vscode.window.showInputBox({
        prompt: 'Provide feedback for the retry (optional)',
        placeHolder: 'e.g., Error handling is missing for edge case X',
        ignoreFocusOut: true,
      });

      try {
        pipelineManager.reject(feedback || undefined);
        vscode.window.showInformationMessage(
          `Rejected. Retrying: ${pipelineManager.getCurrentPhase()}`
        );

        // Auto-generate the retry prompt
        await copyCurrentPrompt(workspaceRoot);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Reject failed: ${error.message}`);
      }
    })
  );

  // Reset Pipeline
  context.subscriptions.push(
    vscode.commands.registerCommand('agentPipeline.reset', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Reset the entire pipeline? All outputs will be cleared.',
        { modal: true },
        'Reset'
      );

      if (confirm === 'Reset') {
        pipelineManager.reset();
        vscode.window.showInformationMessage('Agent Pipeline reset.');
      }
    })
  );

  // Copy Current Prompt
  context.subscriptions.push(
    vscode.commands.registerCommand('agentPipeline.copyPrompt', async () => {
      await copyCurrentPrompt(workspaceRoot);
    })
  );

  // Complete Current Phase (manual transition)
  context.subscriptions.push(
    vscode.commands.registerCommand('agentPipeline.completePhase', async () => {
      if (!pipelineManager.isAgentActive()) {
        vscode.window.showWarningMessage(
          'No active agent phase to complete.'
        );
        return;
      }

      const activeAgent = pipelineManager.getActiveAgent() || 'agent';

      const content = await vscode.window.showInputBox({
        prompt: `Paste the ${activeAgent} output here (or leave empty to skip)`,
        placeHolder: 'Paste AI output or leave empty...',
        ignoreFocusOut: true,
      });

      // Even if content is empty, allow completion (user might not have output to paste)
      const outputText = content || `[Phase completed manually by user - no output captured]`;

      try {
        pipelineManager.saveCurrentOutput(outputText);
        const phase = pipelineManager.getCurrentPhase();
        vscode.window.showInformationMessage(
          `Phase completed! Now in: ${phase}. Review and approve or reject.`
        );
      } catch (error: any) {
        vscode.window.showErrorMessage(`Complete phase failed: ${error.message}`);
      }
    })
  );

  // Setup Rules (manual trigger)
  context.subscriptions.push(
    vscode.commands.registerCommand('agentPipeline.setupRules', async () => {
      try {
        await copyRulesToWorkspace(workspaceRoot, extensionPath);
        vscode.window.showInformationMessage(
          'Agent Pipeline: Rule files have been set up in .cursor/rules/'
        );
      } catch (error: any) {
        vscode.window.showErrorMessage(
          `Agent Pipeline: Failed to setup rules: ${error.message}`
        );
      }
    })
  );

  // ------- File Watcher -------
  // Watch for changes in .agent_pipeline/ to detect MCP server writes

  setupFileWatcher(workspaceRoot, context);

  // ------- Auto-Complete on File Save -------
  // When an agent is active and files are saved, auto-complete the phase after a debounce

  setupAutoCompleteOnSave(workspaceRoot, context);

  // Log activation
  console.log('Agent Pipeline extension activated');
}

// ============================================================
// MCP Config Auto-Setup
// ============================================================

/**
 * Automatically configure the MCP server in the workspace's .cursor/mcp.json.
 * Uses the extension's absolute path so the MCP server is found regardless of
 * which workspace the extension is installed in.
 */
function setupMcpConfig(workspaceRoot: string, extensionPath: string): void {
  const cursorDir = path.join(workspaceRoot, '.cursor');
  const mcpConfigPath = path.join(cursorDir, 'mcp.json');
  const serverPath = path.join(extensionPath, 'dist', 'mcp', 'server.js');

  // Ensure .cursor directory exists
  if (!fs.existsSync(cursorDir)) {
    fs.mkdirSync(cursorDir, { recursive: true });
  }

  // Read existing mcp.json or start fresh
  let mcpConfig: any = {};
  if (fs.existsSync(mcpConfigPath)) {
    try {
      mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
    } catch {
      mcpConfig = {};
    }
  }

  // Ensure mcpServers object exists
  if (!mcpConfig.mcpServers) {
    mcpConfig.mcpServers = {};
  }

  // Check if update is needed
  const existing = mcpConfig.mcpServers['agent-pipeline'];
  const expectedArgs = [serverPath];
  const needsUpdate =
    !existing ||
    !existing.args ||
    existing.args[0] !== serverPath;

  if (needsUpdate) {
    mcpConfig.mcpServers['agent-pipeline'] = {
      command: 'node',
      args: expectedArgs,
      env: {
        AGENT_PIPELINE_WORKSPACE: workspaceRoot,
      },
    };

    fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
    console.log(`Agent Pipeline: MCP config updated at ${mcpConfigPath}`);
  }
}

// ============================================================
// Rules Auto-Setup
// ============================================================

/**
 * Check if .cursor/rules/ has the agent pipeline rules.
 * If not, prompt the user to install them.
 */
async function checkAndPromptRulesSetup(
  workspaceRoot: string,
  extensionPath: string
): Promise<void> {
  const rulesDir = path.join(workspaceRoot, '.cursor', 'rules');
  const requiredRules = ['global.mdc', 'planner.mdc', 'implementer.mdc', 'reviewer.mdc', 'test.mdc'];

  // Check if all rules exist
  const allExist = requiredRules.every((rule) =>
    fs.existsSync(path.join(rulesDir, rule))
  );

  if (!allExist) {
    const action = await vscode.window.showInformationMessage(
      'Agent Pipeline: Rule files (.mdc) are missing. Set them up now?',
      'Setup Rules',
      'Later'
    );

    if (action === 'Setup Rules') {
      await copyRulesToWorkspace(workspaceRoot, extensionPath);
      vscode.window.showInformationMessage(
        'Agent Pipeline: Rule files installed in .cursor/rules/'
      );
    }
  }
}

/**
 * Copy .mdc rule files from the extension's resources/rules/ to the workspace.
 */
async function copyRulesToWorkspace(
  workspaceRoot: string,
  extensionPath: string
): Promise<void> {
  const sourceDir = path.join(extensionPath, 'resources', 'rules');
  const targetDir = path.join(workspaceRoot, '.cursor', 'rules');

  console.log(`Agent Pipeline: Copying rules from ${sourceDir} to ${targetDir}`);

  // Check source directory exists
  if (!fs.existsSync(sourceDir)) {
    const msg = `Source rules directory not found: ${sourceDir}`;
    console.error(`Agent Pipeline: ${msg}`);
    vscode.window.showErrorMessage(`Agent Pipeline: ${msg}`);
    return;
  }

  // Ensure target directory structure exists
  try {
    const cursorDir = path.join(workspaceRoot, '.cursor');
    if (!fs.existsSync(cursorDir)) {
      fs.mkdirSync(cursorDir, { recursive: true });
    }
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
  } catch (err: any) {
    const msg = `Failed to create rules directory: ${err.message}`;
    console.error(`Agent Pipeline: ${msg}`);
    vscode.window.showErrorMessage(`Agent Pipeline: ${msg}`);
    return;
  }

  // Copy each .mdc file
  const ruleFiles = ['global.mdc', 'planner.mdc', 'implementer.mdc', 'reviewer.mdc', 'test.mdc'];
  let copiedCount = 0;

  for (const file of ruleFiles) {
    const sourcePath = path.join(sourceDir, file);
    const targetPath = path.join(targetDir, file);

    try {
      if (!fs.existsSync(sourcePath)) {
        console.warn(`Agent Pipeline: Source rule file not found: ${sourcePath}`);
        continue;
      }

      const content = fs.readFileSync(sourcePath, 'utf-8');

      // Skip if identical
      if (fs.existsSync(targetPath)) {
        const existingContent = fs.readFileSync(targetPath, 'utf-8');
        if (content === existingContent) {
          copiedCount++;
          continue;
        }
      }

      fs.writeFileSync(targetPath, content, 'utf-8');
      copiedCount++;
      console.log(`Agent Pipeline: Copied ${file}`);
    } catch (err: any) {
      console.error(`Agent Pipeline: Failed to copy ${file}: ${err.message}`);
    }
  }

  console.log(`Agent Pipeline: ${copiedCount}/${ruleFiles.length} rules installed to ${targetDir}`);
}

// ============================================================
// Prompt Generation
// ============================================================

/**
 * Read the user-configured model for each agent from VS Code settings.
 */
function getModelOverrides(): Record<string, string> {
  const config = vscode.workspace.getConfiguration('agentPipeline.models');
  return {
    planner: config.get<string>('planner') || 'claude-4.5-sonnet',
    implementer: config.get<string>('implementer') || 'claude-4.6-opus',
    reviewer: config.get<string>('reviewer') || 'gpt-5.2',
    test: config.get<string>('test') || 'claude-4.5-sonnet',
  };
}

/**
 * Generate the prompt for the current phase and copy it to clipboard.
 */
async function copyCurrentPrompt(workspaceRoot: string): Promise<void> {
  if (!pipelineManager.isAgentActive()) {
    vscode.window.showWarningMessage(
      'No active agent phase. Cannot generate prompt.'
    );
    return;
  }

  const state = pipelineManager.getState();
  const modelOverrides = getModelOverrides();
  const generated = generatePrompt(state, workspaceRoot, modelOverrides);

  if (!generated) {
    vscode.window.showWarningMessage('Could not generate prompt for current phase.');
    return;
  }

  await vscode.env.clipboard.writeText(generated.prompt);

  const openChat = await vscode.window.showInformationMessage(
    `${generated.agentName} prompt copied! Switch model to **${generated.model}** and paste into Cursor Chat (Cmd+L).`,
    'Open Chat',
    'Change Model'
  );

  if (openChat === 'Open Chat') {
    // Try to open Cursor's chat panel
    try {
      await vscode.commands.executeCommand('aipopup.action.modal.generate');
    } catch {
      try {
        await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
      } catch {
        // Silently fail if command doesn't exist
      }
    }
  } else if (openChat === 'Change Model') {
    // Open settings for model configuration
    await vscode.commands.executeCommand(
      'workbench.action.openSettings',
      'agentPipeline.models'
    );
  }
}

// ============================================================
// File Watcher
// ============================================================

/**
 * Set up file system watcher for pipeline state changes (from MCP server).
 */
function setupFileWatcher(
  workspaceRoot: string,
  context: vscode.ExtensionContext
): void {
  const pipelinePattern = new vscode.RelativePattern(
    workspaceRoot,
    '.agent_pipeline/**'
  );

  fileWatcher = vscode.workspace.createFileSystemWatcher(pipelinePattern);

  // Debounce reload to avoid rapid-fire updates
  let reloadTimeout: NodeJS.Timeout | undefined;

  const debouncedReload = () => {
    if (reloadTimeout) {
      clearTimeout(reloadTimeout);
    }
    reloadTimeout = setTimeout(() => {
      pipelineManager.reload();
      sidebarProvider._updateWebview();
    }, 500);
  };

  fileWatcher.onDidChange(debouncedReload);
  fileWatcher.onDidCreate(debouncedReload);
  fileWatcher.onDidDelete(debouncedReload);

  context.subscriptions.push(fileWatcher);
}

// ============================================================
// Auto-Complete on File Save
// ============================================================

/**
 * Directories/patterns to ignore when detecting file saves for auto-complete.
 */
const AUTO_COMPLETE_IGNORE = [
  '.agent_pipeline',
  '.cursor',
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  '.vscode',
];

/**
 * Watch for file saves in the workspace. When an agent is active and files
 * are being saved, auto-complete the phase after a debounce period.
 *
 * Logic:
 * - Each file save resets the debounce timer
 * - When no more saves come within the debounce window, the phase completes
 * - This captures the pattern of AI finishing work (burst of saves → silence)
 */
function setupAutoCompleteOnSave(
  workspaceRoot: string,
  context: vscode.ExtensionContext
): void {
  const saveListener = vscode.workspace.onDidSaveTextDocument((document) => {
    // Check if auto-complete is enabled
    const config = vscode.workspace.getConfiguration('agentPipeline.autoComplete');
    const enabled = config.get<boolean>('enabled', true);
    if (!enabled) {
      return;
    }

    // Only trigger when an agent is actively working
    if (!pipelineManager.isAgentActive()) {
      return;
    }

    // Ignore files in excluded directories
    const relativePath = path.relative(workspaceRoot, document.uri.fsPath);
    const shouldIgnore = AUTO_COMPLETE_IGNORE.some(
      (dir) => relativePath.startsWith(dir + path.sep) || relativePath === dir
    );
    if (shouldIgnore) {
      return;
    }

    // Track save count for the notification
    autoCompleteSaveCount++;

    // Get debounce delay from settings (default 5 seconds)
    const debounceSeconds = config.get<number>('debounceSeconds', 5);
    const debounceMs = debounceSeconds * 1000;

    // Reset the timer on each save
    if (autoCompleteTimeout) {
      clearTimeout(autoCompleteTimeout);
    }

    autoCompleteTimeout = setTimeout(() => {
      // Double-check agent is still active (may have been completed via MCP tool)
      if (!pipelineManager.isAgentActive()) {
        autoCompleteSaveCount = 0;
        return;
      }

      const activeAgent = pipelineManager.getActiveAgent() || 'agent';
      const saveCount = autoCompleteSaveCount;
      autoCompleteSaveCount = 0;

      try {
        pipelineManager.saveCurrentOutput(
          `[Auto-completed: ${saveCount} file(s) saved, no further activity for ${debounceSeconds}s]`
        );
        const phase = pipelineManager.getCurrentPhase();

        vscode.window.showInformationMessage(
          `${activeAgent} phase auto-completed (${saveCount} file saves detected). Now in: ${phase}`,
          'Review'
        ).then((action) => {
          if (action === 'Review') {
            // Focus the sidebar
            vscode.commands.executeCommand('agentPipelineSidebar.focus');
          }
        });

        console.log(
          `Agent Pipeline: Auto-completed ${activeAgent} phase after ${saveCount} file saves`
        );
      } catch (error: any) {
        console.error(`Agent Pipeline: Auto-complete failed: ${error.message}`);
      }
    }, debounceMs);
  });

  context.subscriptions.push(saveListener);
}

export function deactivate() {
  if (pipelineManager) {
    pipelineManager.dispose();
  }
  if (fileWatcher) {
    fileWatcher.dispose();
  }
  if (autoCompleteTimeout) {
    clearTimeout(autoCompleteTimeout);
  }
}
