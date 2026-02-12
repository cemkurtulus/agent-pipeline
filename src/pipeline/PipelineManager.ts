/**
 * PipelineManager - Core state machine for the agent pipeline.
 * Manages phase transitions, state persistence, and event dispatching.
 */

import * as vscode from 'vscode';
import {
  PipelinePhase,
  AGENTS,
  REVIEW_PHASES,
  getAgentForPhase,
  getNextPhaseAfterApproval,
  getRetryPhase,
} from './AgentConfig';
import {
  PipelineState,
  getDefaultState,
  loadState,
  saveState,
  saveAgentOutput,
  readAgentOutput,
  readAllOutputs,
  clearPipelineData,
  ensurePipelineDir,
} from '../utils/storage';

export interface PipelineEvent {
  type: 'phaseChanged' | 'outputSaved' | 'pipelineReset' | 'error';
  phase?: PipelinePhase;
  agentName?: string;
  message?: string;
}

export class PipelineManager {
  private state: PipelineState;
  private workspaceRoot: string;

  private readonly _onEvent = new vscode.EventEmitter<PipelineEvent>();
  public readonly onEvent = this._onEvent.event;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    ensurePipelineDir(workspaceRoot);
    this.state = loadState(workspaceRoot);
  }

  // ------- State accessors -------

  public getState(): PipelineState {
    return { ...this.state };
  }

  public getCurrentPhase(): PipelinePhase {
    return this.state.currentPhase as PipelinePhase;
  }

  public getTaskDescription(): string {
    return this.state.taskDescription;
  }

  public getOutputs(): Record<string, string> {
    return readAllOutputs(this.workspaceRoot);
  }

  public getOutput(agentName: string): string | null {
    return readAgentOutput(this.workspaceRoot, agentName);
  }

  // ------- Pipeline operations -------

  /**
   * Start a new pipeline with a task description.
   */
  public start(taskDescription: string): void {
    if (this.state.currentPhase !== 'idle' && this.state.currentPhase !== 'completed') {
      throw new Error(
        `Cannot start pipeline: currently in phase "${this.state.currentPhase}". Reset first.`
      );
    }

    this.state = getDefaultState();
    this.state.taskDescription = taskDescription;
    this.state.currentPhase = 'planning';
    this.addHistory('planning', 'started', `Task: ${taskDescription}`);
    this.persist();

    this._onEvent.fire({ type: 'phaseChanged', phase: 'planning' });
  }

  /**
   * Save the output of the current agent.
   * Automatically transitions to the review phase.
   */
  public saveCurrentOutput(content: string): void {
    const phase = this.getCurrentPhase();
    const agent = getAgentForPhase(phase);

    if (!agent) {
      throw new Error(`No agent assigned to phase "${phase}". Cannot save output.`);
    }

    // Save output to file
    saveAgentOutput(this.workspaceRoot, agent.outputKey, content);

    // Update state
    this.state.outputs[agent.outputKey] = content;
    this.addHistory(phase, 'output_saved', `Agent: ${agent.name}`);

    // Transition to review phase
    const reviewPhase = agent.reviewPhase;
    this.state.currentPhase = reviewPhase;
    this.addHistory(reviewPhase, 'entered', `Awaiting review for ${agent.name}`);
    this.persist();

    this._onEvent.fire({ type: 'outputSaved', agentName: agent.name });
    this._onEvent.fire({ type: 'phaseChanged', phase: reviewPhase });
  }

  /**
   * Approve the current review phase and advance to the next agent.
   */
  public approve(): void {
    const phase = this.getCurrentPhase();

    if (!REVIEW_PHASES.includes(phase) && phase !== 'testing') {
      throw new Error(`Cannot approve: not in a review phase (current: "${phase}").`);
    }

    const nextPhase = getNextPhaseAfterApproval(phase);
    this.addHistory(phase, 'approved', `Advancing to ${nextPhase}`);
    this.state.currentPhase = nextPhase;
    this.addHistory(nextPhase, 'entered');
    this.persist();

    this._onEvent.fire({ type: 'phaseChanged', phase: nextPhase });

    if (nextPhase === 'completed') {
      vscode.window.showInformationMessage('Agent Pipeline: All phases completed!');
    }
  }

  /**
   * Reject the current review and retry the agent.
   */
  public reject(feedback?: string): void {
    const phase = this.getCurrentPhase();

    if (!REVIEW_PHASES.includes(phase) && phase !== 'testing') {
      throw new Error(`Cannot reject: not in a review phase (current: "${phase}").`);
    }

    const retryPhase = getRetryPhase(phase);
    this.addHistory(phase, 'rejected', feedback || 'No feedback provided');
    this.state.currentPhase = retryPhase;
    this.addHistory(retryPhase, 'entered', 'Retry after rejection');
    this.persist();

    this._onEvent.fire({ type: 'phaseChanged', phase: retryPhase });
  }

  /**
   * Reset the entire pipeline.
   */
  public reset(): void {
    clearPipelineData(this.workspaceRoot);
    this.state = getDefaultState();
    saveState(this.workspaceRoot, this.state);

    this._onEvent.fire({ type: 'pipelineReset' });
    this._onEvent.fire({ type: 'phaseChanged', phase: 'idle' });
  }

  /**
   * Reload state from disk (e.g., after MCP server writes).
   */
  public reload(): void {
    this.state = loadState(this.workspaceRoot);
    this._onEvent.fire({
      type: 'phaseChanged',
      phase: this.getCurrentPhase(),
    });
  }

  // ------- Helpers -------

  /**
   * Check if the pipeline is in a state where a specific action is allowed.
   */
  public canStart(): boolean {
    return this.state.currentPhase === 'idle' || this.state.currentPhase === 'completed';
  }

  public canApprove(): boolean {
    const phase = this.getCurrentPhase();
    return REVIEW_PHASES.includes(phase);
  }

  public canReject(): boolean {
    return this.canApprove();
  }

  public isAgentActive(): boolean {
    const phase = this.getCurrentPhase();
    return ['planning', 'implementing', 'reviewing', 'testing'].includes(phase);
  }

  public getActiveAgent(): string | undefined {
    const agent = getAgentForPhase(this.getCurrentPhase());
    return agent?.name;
  }

  // ------- Private -------

  private addHistory(phase: string, action: string, detail?: string): void {
    this.state.history.push({
      phase,
      action,
      timestamp: new Date().toISOString(),
      detail,
    });
  }

  private persist(): void {
    saveState(this.workspaceRoot, this.state);
  }

  public dispose(): void {
    this._onEvent.dispose();
  }
}
