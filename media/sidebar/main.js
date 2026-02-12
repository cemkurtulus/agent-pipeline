// @ts-nocheck
/**
 * Sidebar Webview Script
 * Handles UI rendering and communication with the extension.
 */

(function () {
  // Acquire VS Code API
  const vscode = acquireVsCodeApi();

  // Phase display names and mappings
  const PHASE_LABELS = {
    idle: 'Ready',
    planning: 'Planning...',
    plan_review: 'Review Plan',
    implementing: 'Implementing...',
    impl_review: 'Review Implementation',
    reviewing: 'Reviewing...',
    review_done: 'Review Done',
    testing: 'Testing...',
    completed: 'Completed',
  };

  const AGENT_PHASES = {
    planner: ['planning', 'plan_review'],
    implementer: ['implementing', 'impl_review'],
    reviewer: ['reviewing', 'review_done'],
    test: ['testing'],
  };

  const PHASE_ORDER = [
    'planning', 'plan_review',
    'implementing', 'impl_review',
    'reviewing', 'review_done',
    'testing',
    'completed',
  ];

  // DOM elements
  const elements = {
    btnStart: document.getElementById('btn-start'),
    btnCopy: document.getElementById('btn-copy'),
    btnComplete: document.getElementById('btn-complete'),
    btnApprove: document.getElementById('btn-approve'),
    btnReject: document.getElementById('btn-reject'),
    btnReset: document.getElementById('btn-reset'),
    taskSection: document.getElementById('task-section'),
    taskDescription: document.getElementById('task-description'),
    phaseSection: document.getElementById('phase-section'),
    phaseInfo: document.getElementById('phase-info'),
    outputSection: document.getElementById('output-section'),
    outputList: document.getElementById('output-list'),
    outputToggle: document.getElementById('output-toggle'),
  };

  // Current state
  let currentState = null;
  let outputsExpanded = true;

  // ------- Event Listeners -------

  elements.btnStart.addEventListener('click', () => {
    vscode.postMessage({ command: 'start' });
  });

  elements.btnCopy.addEventListener('click', () => {
    vscode.postMessage({ command: 'copyPrompt' });
  });

  elements.btnApprove.addEventListener('click', () => {
    vscode.postMessage({ command: 'approve' });
  });

  elements.btnReject.addEventListener('click', () => {
    vscode.postMessage({ command: 'reject' });
  });

  elements.btnReset.addEventListener('click', () => {
    vscode.postMessage({ command: 'reset' });
  });

  elements.btnComplete.addEventListener('click', () => {
    vscode.postMessage({ command: 'completePhase' });
  });

  elements.outputToggle.addEventListener('click', () => {
    outputsExpanded = !outputsExpanded;
    const icon = elements.outputToggle.querySelector('.toggle-icon');
    if (icon) {
      icon.classList.toggle('collapsed', !outputsExpanded);
    }
    elements.outputList.style.display = outputsExpanded ? 'block' : 'none';
  });

  // ------- Message Handler -------

  window.addEventListener('message', (event) => {
    const message = event.data;

    if (message.command === 'stateUpdate') {
      currentState = message.data;
      render(currentState);
    }
  });

  // ------- Rendering -------

  function render(state) {
    if (!state) { return; }

    renderPipelineSteps(state);
    renderTaskSection(state);
    renderPhaseSection(state);
    renderOutputs(state);
    renderActions(state);
  }

  function renderPipelineSteps(state) {
    const phase = state.currentPhase;
    const phaseIndex = PHASE_ORDER.indexOf(phase);

    for (const [agent, phases] of Object.entries(AGENT_PHASES)) {
      const stepEl = document.getElementById(`step-${agent}`);
      const statusEl = document.getElementById(`status-${agent}`);
      if (!stepEl || !statusEl) { continue; }

      // Remove all state classes
      stepEl.classList.remove('active', 'completed', 'review');

      const agentWorkPhase = phases[0]; // e.g., 'planning'
      const agentReviewPhase = phases[1]; // e.g., 'plan_review'
      const agentWorkIndex = PHASE_ORDER.indexOf(agentWorkPhase);

      if (phase === 'completed') {
        stepEl.classList.add('completed');
        statusEl.textContent = 'Done';
      } else if (phases.includes(phase)) {
        // This agent's phase is active
        if (phase === agentWorkPhase) {
          stepEl.classList.add('active');
          statusEl.textContent = 'Working...';
        } else if (phase === agentReviewPhase) {
          stepEl.classList.add('review');
          statusEl.textContent = 'Awaiting review';
        }
      } else if (phaseIndex > PHASE_ORDER.indexOf(phases[phases.length - 1])) {
        // Past this agent
        stepEl.classList.add('completed');
        statusEl.textContent = 'Done';
      } else {
        // Future agent
        statusEl.textContent = 'Pending';
      }
    }

    // Update connectors
    const connectors = document.querySelectorAll('.step-connector');
    const stepElements = document.querySelectorAll('.step');

    connectors.forEach((conn, idx) => {
      conn.classList.remove('active', 'completed');

      // connector idx is between step idx and step idx+1
      const prevStep = stepElements[idx];
      if (prevStep && prevStep.classList.contains('completed')) {
        conn.classList.add('completed');
      } else if (prevStep && (prevStep.classList.contains('active') || prevStep.classList.contains('review'))) {
        conn.classList.add('active');
      }
    });
  }

  function renderTaskSection(state) {
    if (state.taskDescription && state.currentPhase !== 'idle') {
      elements.taskSection.style.display = 'block';
      elements.taskDescription.textContent = state.taskDescription;
    } else {
      elements.taskSection.style.display = 'none';
    }
  }

  function renderPhaseSection(state) {
    const phase = state.currentPhase;

    if (phase === 'idle') {
      elements.phaseSection.style.display = 'none';
      return;
    }

    elements.phaseSection.style.display = 'block';

    let badgeClass = 'idle';
    if (phase === 'completed') {
      badgeClass = 'completed';
    } else if (phase.includes('review') || phase === 'review_done') {
      badgeClass = 'review';
    } else {
      badgeClass = 'active';
    }

    let phaseMessage = '';
    if (state.isAgentActive) {
      phaseMessage = `<strong>${state.activeAgent}</strong> agent is working. Copy the prompt and paste it into Cursor Chat.`;
    } else if (state.canApprove) {
      phaseMessage = 'Review the output and approve to continue or reject to retry.';
    } else if (phase === 'completed') {
      phaseMessage = 'All pipeline stages completed successfully.';
    }

    elements.phaseInfo.innerHTML = `
      <span class="phase-badge ${badgeClass}">${PHASE_LABELS[phase] || phase}</span>
      <div class="phase-message">${phaseMessage}</div>
    `;
  }

  function renderOutputs(state) {
    const outputs = state.outputs || {};
    const keys = Object.keys(outputs);

    if (keys.length === 0) {
      elements.outputSection.style.display = 'none';
      return;
    }

    elements.outputSection.style.display = 'block';
    elements.outputList.innerHTML = '';

    const agentOrder = ['planner', 'implementer', 'reviewer', 'test'];

    for (const agent of agentOrder) {
      if (!outputs[agent]) { continue; }

      const item = document.createElement('div');
      item.className = 'output-item';

      const header = document.createElement('div');
      header.className = 'output-item-header';
      header.innerHTML = `
        <span>${agent.charAt(0).toUpperCase() + agent.slice(1)}</span>
        <span class="toggle-icon collapsed">&#9660;</span>
      `;

      const content = document.createElement('div');
      content.className = 'output-item-content';
      content.textContent = truncateOutput(outputs[agent], 500);

      header.addEventListener('click', () => {
        const isExpanded = content.classList.contains('expanded');
        content.classList.toggle('expanded');
        const icon = header.querySelector('.toggle-icon');
        if (icon) {
          icon.classList.toggle('collapsed', isExpanded);
        }
      });

      item.appendChild(header);
      item.appendChild(content);
      elements.outputList.appendChild(item);
    }
  }

  function renderActions(state) {
    const phase = state.currentPhase;

    // Show/hide buttons based on state
    elements.btnStart.style.display = state.canStart ? 'block' : 'none';
    elements.btnCopy.style.display = state.isAgentActive ? 'block' : 'none';
    elements.btnComplete.style.display = state.isAgentActive ? 'block' : 'none';
    elements.btnApprove.style.display = state.canApprove ? 'block' : 'none';
    elements.btnReject.style.display = state.canReject ? 'block' : 'none';
    elements.btnReset.style.display = phase !== 'idle' ? 'block' : 'none';
  }

  // ------- Helpers -------

  function truncateOutput(text, maxLen) {
    if (!text) { return ''; }
    if (text.length <= maxLen) { return text; }
    return text.substring(0, maxLen) + '\n... (truncated)';
  }

  // ------- Init -------

  // Request initial state
  vscode.postMessage({ command: 'getState' });
})();
