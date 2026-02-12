/**
 * SidebarProvider - WebviewViewProvider for the Agent Pipeline sidebar.
 * All HTML/CSS/JS is inline to avoid file-loading issues in packaged extensions.
 */

import * as vscode from 'vscode';
import { PipelineManager } from '../pipeline/PipelineManager';
import { AGENTS } from '../pipeline/AgentConfig';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'agentPipelineSidebar';

  private _view?: vscode.WebviewView;
  private _pipelineManager: PipelineManager;

  constructor(
    _extensionUri: vscode.Uri,
    pipelineManager: PipelineManager
  ) {
    this._pipelineManager = pipelineManager;

    this._pipelineManager.onEvent(() => {
      this._updateWebview();
    });

    // Refresh sidebar when model settings change
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('agentPipeline.models')) {
        this._updateWebview();
      }
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    const nonce = getNonce();
    webviewView.webview.html = getFullInlineHtml(nonce);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'start':
          await vscode.commands.executeCommand('agentPipeline.start');
          break;
        case 'approve':
          await vscode.commands.executeCommand('agentPipeline.approve');
          break;
        case 'reject':
          await vscode.commands.executeCommand('agentPipeline.reject');
          break;
        case 'reset':
          await vscode.commands.executeCommand('agentPipeline.reset');
          break;
        case 'copyPrompt':
          await vscode.commands.executeCommand('agentPipeline.copyPrompt');
          break;
        case 'completePhase':
          await vscode.commands.executeCommand('agentPipeline.completePhase');
          break;
        case 'configureModels':
          await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            'agentPipeline.models'
          );
          break;
        case 'getState':
          this._updateWebview();
          break;
      }
    });

    this._updateWebview();
  }

  public _updateWebview(): void {
    if (!this._view) {
      return;
    }

    const state = this._pipelineManager.getState();
    const outputs = this._pipelineManager.getOutputs();

    // Read model config from VS Code settings
    const config = vscode.workspace.getConfiguration('agentPipeline.models');
    const agentModels: Record<string, string> = {};
    for (const [key, agent] of Object.entries(AGENTS)) {
      agentModels[key] = config.get<string>(key) || agent.defaultModel;
    }

    this._view.webview.postMessage({
      command: 'stateUpdate',
      data: {
        currentPhase: state.currentPhase,
        taskDescription: state.taskDescription,
        outputs,
        history: state.history.slice(-10),
        canStart: this._pipelineManager.canStart(),
        canApprove: this._pipelineManager.canApprove(),
        canReject: this._pipelineManager.canReject(),
        isAgentActive: this._pipelineManager.isAgentActive(),
        activeAgent: this._pipelineManager.getActiveAgent(),
        agentModels,
      },
    });
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function getFullInlineHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
:root { --step-size: 28px; --connector-width: 2px; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-sideBar-background); padding: 12px; line-height: 1.5; }
h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-sideBarSectionHeader-foreground); margin-bottom: 4px; }
.pipeline-header { margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border)); }
.pipeline-steps { margin-bottom: 16px; }
.step { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 4px; transition: background-color 0.15s; }
.step:hover { background: var(--vscode-list-hoverBackground); }
.step-indicator { width: var(--step-size); height: var(--step-size); min-width: var(--step-size); border-radius: 50%; border: 2px solid var(--vscode-input-border); background: transparent; display: flex; align-items: center; justify-content: center; transition: all 0.2s; position: relative; }
.step.active .step-indicator { border-color: var(--vscode-progressBar-background); background: var(--vscode-progressBar-background); }
.step.active .step-indicator::after { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-sideBar-background); animation: pulse 1.5s ease-in-out infinite; }
.step.completed .step-indicator { border-color: var(--vscode-testing-iconPassed, #73c991); background: var(--vscode-testing-iconPassed, #73c991); }
.step.completed .step-indicator::after { content: '\\2713'; color: var(--vscode-sideBar-background); font-size: 14px; font-weight: bold; animation: none; }
.step.review .step-indicator { border-color: var(--vscode-editorWarning-foreground, #cca700); background: var(--vscode-editorWarning-foreground, #cca700); }
.step.review .step-indicator::after { content: '\\23F8'; font-size: 10px; animation: none; }
.step-connector { width: var(--connector-width); height: 12px; background: var(--vscode-input-border); margin-left: calc(8px + var(--step-size) / 2 - var(--connector-width) / 2); transition: background-color 0.2s; }
.step-connector.active { background: var(--vscode-progressBar-background); }
.step-connector.completed { background: var(--vscode-testing-iconPassed, #73c991); }
.step-info { display: flex; flex-direction: column; gap: 1px; }
.step-name { font-size: 12px; font-weight: 500; color: var(--vscode-foreground); }
.step.active .step-name { color: var(--vscode-progressBar-background); font-weight: 600; }
.step-status { font-size: 11px; color: var(--vscode-descriptionForeground); }
.step-model { font-size: 10px; color: var(--vscode-descriptionForeground); opacity: 0.8; margin-top: 1px; }
.step-model .model-tag { display: inline-block; padding: 1px 5px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 9px; font-weight: 500; letter-spacing: 0.3px; }
.section { margin-bottom: 12px; background: var(--vscode-editor-background); border-radius: 4px; border: 1px solid var(--vscode-panel-border); overflow: hidden; }
.section-header { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-sideBarSectionHeader-foreground); padding: 8px 10px; background: var(--vscode-sideBarSectionHeader-background); border-bottom: 1px solid var(--vscode-panel-border); }
.section-header.clickable { cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
.section-header.clickable:hover { background: var(--vscode-list-hoverBackground); }
.toggle-icon { font-size: 10px; transition: transform 0.2s; }
.toggle-icon.collapsed { transform: rotate(-90deg); }
.task-description { padding: 8px 10px; font-size: 12px; color: var(--vscode-foreground); word-break: break-word; }
.phase-info { padding: 8px 10px; font-size: 12px; }
.phase-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; margin-bottom: 4px; }
.phase-badge.active { background: var(--vscode-progressBar-background); color: #fff; }
.phase-badge.review { background: var(--vscode-editorWarning-foreground, #cca700); color: #000; }
.phase-badge.completed { background: var(--vscode-testing-iconPassed, #73c991); color: #000; }
.phase-badge.idle { background: var(--vscode-input-border); color: var(--vscode-foreground); }
.phase-message { margin-top: 6px; font-size: 12px; color: var(--vscode-descriptionForeground); }
.output-list { max-height: 300px; overflow-y: auto; }
.output-item { border-bottom: 1px solid var(--vscode-panel-border); }
.output-item:last-child { border-bottom: none; }
.output-item-header { padding: 6px 10px; font-size: 12px; font-weight: 500; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
.output-item-header:hover { background: var(--vscode-list-hoverBackground); }
.output-item-content { padding: 8px 10px; font-size: 11px; font-family: var(--vscode-editor-font-family); white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow-y: auto; display: none; background: var(--vscode-textBlockQuote-background); border-top: 1px solid var(--vscode-panel-border); }
.output-item-content.expanded { display: block; }
.actions { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
.btn { border: none; padding: 8px 12px; border-radius: 4px; font-size: 12px; font-weight: 500; cursor: pointer; transition: opacity 0.15s; text-align: center; font-family: var(--vscode-font-family); }
.btn:hover { opacity: 0.85; }
.btn:active { opacity: 0.7; }
.btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.btn-primary:hover { background: var(--vscode-button-hoverBackground); opacity: 1; }
.btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
.btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); opacity: 1; }
.btn-success { background: var(--vscode-testing-iconPassed, #73c991); color: #000; }
.btn-danger { background: var(--vscode-testing-iconFailed, #f14c4c); color: #fff; }
.btn-ghost { background: transparent; color: var(--vscode-descriptionForeground); border: 1px solid var(--vscode-input-border); }
.btn-ghost:hover { background: var(--vscode-list-hoverBackground); opacity: 1; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }
  </style>
</head>
<body>
  <div id="app">
    <div class="pipeline-header"><h2>Agent Pipeline</h2></div>
    <div class="pipeline-steps" id="pipeline-steps">
      <div class="step" data-phase="planning" id="step-planner"><div class="step-indicator"></div><div class="step-info"><span class="step-name">Planner</span><span class="step-status" id="status-planner">Pending</span><span class="step-model" id="model-planner"></span></div></div>
      <div class="step-connector"></div>
      <div class="step" data-phase="implementing" id="step-implementer"><div class="step-indicator"></div><div class="step-info"><span class="step-name">Implementer</span><span class="step-status" id="status-implementer">Pending</span><span class="step-model" id="model-implementer"></span></div></div>
      <div class="step-connector"></div>
      <div class="step" data-phase="reviewing" id="step-reviewer"><div class="step-indicator"></div><div class="step-info"><span class="step-name">Reviewer</span><span class="step-status" id="status-reviewer">Pending</span><span class="step-model" id="model-reviewer"></span></div></div>
      <div class="step-connector"></div>
      <div class="step" data-phase="testing" id="step-test"><div class="step-indicator"></div><div class="step-info"><span class="step-name">Tester</span><span class="step-status" id="status-test">Pending</span><span class="step-model" id="model-test"></span></div></div>
    </div>
    <div class="section" id="task-section" style="display:none;"><div class="section-header">Task</div><div class="task-description" id="task-description"></div></div>
    <div class="section" id="phase-section" style="display:none;"><div class="section-header">Current Phase</div><div class="phase-info" id="phase-info"></div></div>
    <div class="section" id="output-section" style="display:none;"><div class="section-header clickable" id="output-toggle">Agent Outputs <span class="toggle-icon">&#9660;</span></div><div class="output-list" id="output-list"></div></div>
    <div class="actions" id="actions">
      <button class="btn btn-primary" id="btn-start">Start Pipeline</button>
      <button class="btn btn-secondary" id="btn-copy" style="display:none;">Copy Prompt</button>
      <button class="btn btn-primary" id="btn-complete" style="display:none;">Complete Phase</button>
      <button class="btn btn-success" id="btn-approve" style="display:none;">Approve &amp; Continue</button>
      <button class="btn btn-danger" id="btn-reject" style="display:none;">Reject &amp; Retry</button>
      <button class="btn btn-ghost" id="btn-reset" style="display:none;">Reset</button>
      <button class="btn btn-ghost" id="btn-models" title="Configure which AI model each agent uses">&#9881; Configure Models</button>
    </div>
  </div>
  <script nonce="${nonce}">
(function(){
  var vscode=acquireVsCodeApi();
  var PHASE_LABELS={idle:'Ready',planning:'Planning...',plan_review:'Review Plan',implementing:'Implementing...',impl_review:'Review Implementation',reviewing:'Reviewing...',review_done:'Review Done',testing:'Testing...',completed:'Completed'};
  var AGENT_PHASES={planner:['planning','plan_review'],implementer:['implementing','impl_review'],reviewer:['reviewing','review_done'],test:['testing']};
  var PHASE_ORDER=['planning','plan_review','implementing','impl_review','reviewing','review_done','testing','completed'];
  var el={btnStart:document.getElementById('btn-start'),btnCopy:document.getElementById('btn-copy'),btnComplete:document.getElementById('btn-complete'),btnApprove:document.getElementById('btn-approve'),btnReject:document.getElementById('btn-reject'),btnReset:document.getElementById('btn-reset'),btnModels:document.getElementById('btn-models'),taskSection:document.getElementById('task-section'),taskDescription:document.getElementById('task-description'),phaseSection:document.getElementById('phase-section'),phaseInfo:document.getElementById('phase-info'),outputSection:document.getElementById('output-section'),outputList:document.getElementById('output-list'),outputToggle:document.getElementById('output-toggle')};
  var outputsExpanded=true;
  el.btnStart.addEventListener('click',function(){vscode.postMessage({command:'start'});});
  el.btnCopy.addEventListener('click',function(){vscode.postMessage({command:'copyPrompt'});});
  el.btnComplete.addEventListener('click',function(){vscode.postMessage({command:'completePhase'});});
  el.btnApprove.addEventListener('click',function(){vscode.postMessage({command:'approve'});});
  el.btnReject.addEventListener('click',function(){vscode.postMessage({command:'reject'});});
  el.btnReset.addEventListener('click',function(){vscode.postMessage({command:'reset'});});
  el.btnModels.addEventListener('click',function(){vscode.postMessage({command:'configureModels'});});
  el.outputToggle.addEventListener('click',function(){outputsExpanded=!outputsExpanded;var icon=el.outputToggle.querySelector('.toggle-icon');if(icon)icon.classList.toggle('collapsed',!outputsExpanded);el.outputList.style.display=outputsExpanded?'block':'none';});
  window.addEventListener('message',function(event){var msg=event.data;if(msg.command==='stateUpdate')render(msg.data);});
  function render(s){if(!s)return;renderSteps(s);renderTask(s);renderPhase(s);renderOutputs(s);renderActions(s);}
  function renderSteps(s){var phase=s.currentPhase;var pi=PHASE_ORDER.indexOf(phase);var models=s.agentModels||{};for(var agent in AGENT_PHASES){var phases=AGENT_PHASES[agent];var stepEl=document.getElementById('step-'+agent);var statusEl=document.getElementById('status-'+agent);var modelEl=document.getElementById('model-'+agent);if(!stepEl||!statusEl)continue;stepEl.classList.remove('active','completed','review');if(phase==='completed'){stepEl.classList.add('completed');statusEl.textContent='Done';}else if(phases.indexOf(phase)!==-1){if(phase===phases[0]){stepEl.classList.add('active');statusEl.textContent='Working...';}else{stepEl.classList.add('review');statusEl.textContent='Awaiting review';}}else if(pi>PHASE_ORDER.indexOf(phases[phases.length-1])){stepEl.classList.add('completed');statusEl.textContent='Done';}else{statusEl.textContent='Pending';}if(modelEl&&models[agent]){modelEl.innerHTML='<span class="model-tag">'+models[agent]+'</span>';}}var conns=document.querySelectorAll('.step-connector');var steps=document.querySelectorAll('.step');conns.forEach(function(c,i){c.classList.remove('active','completed');var prev=steps[i];if(prev&&prev.classList.contains('completed'))c.classList.add('completed');else if(prev&&(prev.classList.contains('active')||prev.classList.contains('review')))c.classList.add('active');});}
  function renderTask(s){if(s.taskDescription&&s.currentPhase!=='idle'){el.taskSection.style.display='block';el.taskDescription.textContent=s.taskDescription;}else{el.taskSection.style.display='none';}}
  function renderPhase(s){var phase=s.currentPhase;if(phase==='idle'){el.phaseSection.style.display='none';return;}el.phaseSection.style.display='block';var bc='idle';if(phase==='completed')bc='completed';else if(phase.indexOf('review')!==-1||phase==='review_done')bc='review';else bc='active';var msg='';var models=s.agentModels||{};if(s.isAgentActive){var agentModel=models[s.activeAgent]||'';msg='<strong>'+s.activeAgent+'</strong> agent is working.';if(agentModel)msg+=' Use model: <strong>'+agentModel+'</strong>';msg+='<br/>Copy the prompt and paste it into Cursor Chat.';}else if(s.canApprove)msg='Review the output and approve to continue or reject to retry.';else if(phase==='completed')msg='All pipeline stages completed successfully.';el.phaseInfo.innerHTML='<span class="phase-badge '+bc+'">'+(PHASE_LABELS[phase]||phase)+'</span><div class="phase-message">'+msg+'</div>';}
  function renderOutputs(s){var outputs=s.outputs||{};var keys=Object.keys(outputs);if(keys.length===0){el.outputSection.style.display='none';return;}el.outputSection.style.display='block';el.outputList.innerHTML='';var order=['planner','implementer','reviewer','test'];for(var i=0;i<order.length;i++){var agent=order[i];if(!outputs[agent])continue;var item=document.createElement('div');item.className='output-item';var header=document.createElement('div');header.className='output-item-header';header.innerHTML='<span>'+agent.charAt(0).toUpperCase()+agent.slice(1)+'</span><span class="toggle-icon collapsed">&#9660;</span>';var content=document.createElement('div');content.className='output-item-content';var txt=outputs[agent]||'';content.textContent=txt.length>500?txt.substring(0,500)+'\\n... (truncated)':txt;(function(c,h){h.addEventListener('click',function(){var expanded=c.classList.contains('expanded');c.classList.toggle('expanded');var ic=h.querySelector('.toggle-icon');if(ic)ic.classList.toggle('collapsed',expanded);});})(content,header);item.appendChild(header);item.appendChild(content);el.outputList.appendChild(item);}}
  function renderActions(s){var phase=s.currentPhase;el.btnStart.style.display=s.canStart?'block':'none';el.btnCopy.style.display=s.isAgentActive?'block':'none';el.btnComplete.style.display=s.isAgentActive?'block':'none';el.btnApprove.style.display=s.canApprove?'block':'none';el.btnReject.style.display=s.canReject?'block':'none';el.btnReset.style.display=phase!=='idle'?'block':'none';}
  vscode.postMessage({command:'getState'});
})();
  </script>
</body>
</html>`;
}
