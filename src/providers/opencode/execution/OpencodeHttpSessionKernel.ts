import { randomUUID } from 'node:crypto';

import { getProviderAdditionalArguments } from '@/core/providers/ProviderAdditionalArguments';
import type { SubagentProgress } from '@/core/types';
import type { AcpPromptRequest, AcpSessionConfigOption } from '@/providers/acp';

import { isRecord, OpencodeHttpClient, OpencodeHttpError, type OpencodeHttpEvent } from '../http/OpencodeHttpClient';
import { projectOpencodeFormQuestions } from '../http/OpencodeHttpForms';
import { OpencodeShellOutput } from '../http/OpencodeShellOutput';
import { normalizeOpencodeAgentModes, type OpencodeMode } from '../modes';
import { normalizeOpencodeToolInput, normalizeOpencodeToolName, normalizeOpencodeToolUseResult } from '../normalization/opencodeToolNormalization';
import { AUX_AGENT_IDS, buildAgentConfig, getSystemPromptSettings } from '../runtime/OpencodeExecutionAgents';
import { prepareOpencodeLaunchArtifacts } from '../runtime/OpencodeLaunchArtifacts';
import {
  type OpencodeKernelConnectOptions,
  type OpencodeNativeOutput,
  type OpencodeNativeSessionInfo,
  type OpencodeSessionKernel,
  type OpencodeSessionKernelOptions,
  OpencodeSessionMissingError,
} from './OpencodeSessionContract';

type PendingPrompt = {
  resolve: (value: { stopReason: 'end_turn' | 'cancelled'; userMessageId?: string; nativeAssistantId?: string }) => void;
  reject: (error: Error) => void;
  userMessageId?: string;
  nativeAssistantId?: string;
  inputId?: string;
  announced: boolean;
  assistantMessageStarted: boolean;
  started: boolean;
  steerable: boolean;
  idle: boolean;
};
interface PendingSteer { text: string; admission: Promise<'admitted' | 'refused' | 'unknown'>; resolve: (delivered: boolean) => void; reject: (error: Error) => void; recall: Promise<void> | null }
interface NativeModel { providerID: string; id: string; variant?: string }
interface NativeChild { outputSessionId: string; toolCallId: string; turnId: string; interactionTurnId: string; background: boolean; text: Map<string, string>; startedAt: number; toolUses: number; totalTokens: number; lastToolName?: string }
interface NativeTool { name: string; input: Record<string, unknown>; sessionId: string; output: string | null; shell?: OpencodeShellOutput }

/** V2 uses native HTTP events and interactions; ACP is only the v1 wire protocol. */
export class OpencodeHttpSessionKernel implements OpencodeSessionKernel {
  private client: OpencodeHttpClient | null = null;
  private disposed = false;
  private readonly controller = new AbortController();
  private sessionId: string | null = null;
  private databasePath: string | null = null;
  private model: NativeModel | null = null;
  private models: Array<Record<string, unknown>> = [];
  private modes: OpencodeMode[] = [];
  private commands = new Set<string>();
  private profile: OpencodeKernelConnectOptions['profile'] = 'managed';
  private autoApprove = false;
  private readonly text = new Map<string, string>();
  private readonly children = new Map<string, NativeChild>();
  private readonly tools = new Map<string, NativeTool>();
  private readonly previewStops = new Set<string>();
  private readonly globalForms = new Map<string, { settled: boolean }>();
  private readonly interactions = new Map<string, AbortController>();
  private pending: PendingPrompt | null = null;
  private readonly steers = new Map<string, PendingSteer>();
  private cancellation: Promise<unknown> | null = null;

  constructor(private readonly options: OpencodeSessionKernelOptions, private readonly cliPath: string, private readonly environment: NodeJS.ProcessEnv) {}

  setAutoApprove(enabled: boolean): void {
    this.autoApprove = enabled && this.profile === 'managed';
  }

  async connect(options: OpencodeKernelConnectOptions): Promise<void> {
    this.profile = options.profile;
    const bridgeConnection = options.obsidianWorkspaceToolBridgeConnection;
    const runtimeEnv = {
      ...this.environment,
      ...(bridgeConnection ? { CLAUDIAN_OBSIDIAN_TOOL_TOKEN: bridgeConnection.token } : {}),
    };
    const artifacts = await prepareOpencodeLaunchArtifacts({
      artifactsSubdir: this.options.artifactsSubdir ?? `opencode/execution/${this.options.sessionInstanceId}`,
      ...(options.profile === 'managed' ? {} : { defaultAgentId: AUX_AGENT_IDS[options.profile], managedAgents: [buildAgentConfig(options.profile, Boolean(bridgeConnection))] }),
      runtimeEnv,
      obsidianWorkspaceToolEndpoint: bridgeConnection?.endpoint,
      systemPrompt: options.systemInstructions.kind === 'none'
        ? { kind: 'none' }
        : options.systemInstructions.kind === 'explicit'
          ? { kind: 'explicit', key: options.systemInstructions.instructions, text: options.systemInstructions.instructions }
          : { kind: 'default', settings: getSystemPromptSettings(this.options.plugin, this.options.config.vaultWorkingDirectory) },
      workspaceRoot: this.options.config.vaultWorkingDirectory,
    });
    this.controller.signal.throwIfAborted();
    this.databasePath = artifacts.databasePath;
    this.client = new OpencodeHttpClient(this.cliPath, this.options.config.vaultWorkingDirectory, {
      ...runtimeEnv, OPENCODE_CONFIG: artifacts.configPath, OPENCODE_CONFIG_CONTENT: artifacts.configContent,
    }, getProviderAdditionalArguments(this.options.plugin.settings, 'opencode'));
    await this.client.subscribe(event => this.handleEvent(event), error => this.fail(error));
    await this.client.waitForActivation(this.controller.signal);
    const deadline = Date.now() + 5000;
    do {
      const catalog = await this.client.request<{ data: Array<Record<string, unknown>> }>('/api/model');
      this.models = catalog.data.filter(model => model.enabled === true);
      if (this.models.length) break;
      await this.delay(25);
    } while (Date.now() < deadline);
    const catalog = await this.client.request<{ data: Array<{ name: string }> }>('/api/command');
    this.commands = new Set(catalog.data.map(command => command.name));
    this.modes = normalizeOpencodeAgentModes(
      await this.client.request('/api/agent'),
    );
  }

  async openSession(resumeSessionId?: string): Promise<OpencodeNativeSessionInfo> {
    let data: Record<string, unknown>;
    try {
      ({ data } = await this.requireClient().request<{ data: Record<string, unknown> }>(resumeSessionId ? `/api/session/${encodeURIComponent(resumeSessionId)}` : '/api/session',
        resumeSessionId ? {} : { method: 'POST', body: { location: { directory: this.options.config.vaultWorkingDirectory }, ...(this.profile === 'managed' ? {} : { agent: AUX_AGENT_IDS[this.profile] }) } }));
    } catch (error) {
      if (resumeSessionId && error instanceof OpencodeHttpError && error.status === 404) throw new OpencodeSessionMissingError(resumeSessionId, error);
      throw error;
    }
    if (typeof data.id !== 'string' || (resumeSessionId && data.id !== resumeSessionId)) throw new Error('Invalid OpenCode session response.');
    this.sessionId = data.id;
    return {
      sessionId: data.id,
      nativeVersion: 2,
      databasePath: this.databasePath,
      models: { currentModelId: '', availableModels: this.models.map(model => ({ modelId: `${model.providerID}/${model.id}`, name: `${model.providerID}/${model.name}` })) },
      modes: { availableModes: this.modes, currentModeId: this.modes[0]?.id ?? '' },
    };
  }

  async setConfigOption(request: Record<string, unknown>): Promise<{ configOptions?: AcpSessionConfigOption[] }> {
    const route = `/api/session/${encodeURIComponent(String(request.sessionId))}`;
    const value = String(request.value);
    if (request.configId === 'mode') {
      const agent = this.modes.find(mode => mode.id === value || mode.name === value)?.id ?? value;
      await this.requireClient().request(`${route}/agent`, { method: 'POST', body: { agent } });
    } else if (request.configId === 'model') {
      const slash = value.indexOf('/');
      if (slash < 1) throw new Error('Invalid OpenCode model selection.');
      this.model = { providerID: value.slice(0, slash), id: value.slice(slash + 1) };
      await this.requireClient().request(`${route}/model`, { method: 'POST', body: { model: this.model } });
    } else if (request.configId === 'effort' && this.model) {
      this.model = { providerID: this.model.providerID, id: this.model.id, ...(value === 'default' ? {} : { variant: value }) };
      await this.requireClient().request(`${route}/model`, { method: 'POST', body: { model: this.model } });
    }
    const selected = this.models.find(model => model.id === this.model?.id && model.providerID === this.model?.providerID);
    const variants = Array.isArray(selected?.variants) ? selected.variants.filter(isRecord).flatMap(variant => typeof variant.id === 'string' ? [variant.id] : []) : [];
    return { configOptions: [{ id: 'effort', category: 'thought_level', name: 'Effort', type: 'select', currentValue: this.model?.variant ?? 'default', options: [...new Set([...variants, 'default'])].map(value => ({ value, name: value })) }] };
  }

  async prompt(request: AcpPromptRequest): Promise<{ stopReason: 'end_turn' | 'cancelled'; userMessageId?: string }> {
    if (this.pending) throw new Error('OpenCode already has an active request.');
    this.previewStops.delete(request.sessionId);
    const text = request.prompt.filter(block => block.type === 'text').map(block => block.text).join('\n');
    const files = request.prompt.flatMap(block => block.type === 'image' ? [{ uri: `data:${block.mimeType};base64,${block.data}` }] : []);
    const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text);
    const command = match && this.commands.has(match[1]) ? match : null;
    const previousMessage = command ? await this.latestMessage(request.sessionId) : undefined;
    let resolve!: PendingPrompt['resolve'];
    let reject!: PendingPrompt['reject'];
    const completion = new Promise<{ stopReason: 'end_turn' | 'cancelled'; userMessageId?: string; nativeAssistantId?: string }>((yes, no) => { resolve = yes; reject = no; });
    const pending: PendingPrompt = {
      resolve,
      reject,
      inputId: command ? undefined : nativeMessageId(),
      announced: false,
      assistantMessageStarted: false,
      started: false,
      steerable: false,
      idle: false,
    };
    this.pending = pending;
    // A native error may arrive before the admission request resolves.
    void completion.catch(() => undefined);
    try {
      const admitted = await this.requireClient().request<{ data?: { id?: string } }>(`/api/session/${encodeURIComponent(request.sessionId)}/${command ? 'command' : 'prompt'}`, {
        method: 'POST', ...(command ? { timeoutMs: 0 } : {}), body: { ...(command ? { name: command[1] } : { id: pending.inputId }), text: command ? command[2] ?? '' : text, ...(files.length ? { files } : {}) },
      });
      this.captureAdmission(admitted?.data?.id);
      if (!command && this.pending === pending) pending.steerable = true;
      // A command can complete without starting an agent loop (for example a status command).
      if (command) {
        void this.requireClient().request(`/api/experimental/session/${encodeURIComponent(request.sessionId)}/wait`, { method: 'POST', timeoutMs: 0 })
          .then(async () => {
            if (this.pending !== pending || pending.started) return;
            // Idle HTTP responses can overtake SSE. A new assistant/idle message
            // means execution occurred: its terminal event must close the turn.
            const latest = await this.latestMessage(request.sessionId);
            if (this.pending !== pending || pending.started) return;
            if (latest?.id !== previousMessage?.id && ['assistant', 'idle', 'compaction'].includes(String(latest?.type))) return;
            this.finish();
          }).catch(error => { if (this.pending === pending) this.fail(error); });
      }
    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    return completion;
  }

  /** Delivers additional input through OpenCode v2's native inbox. */
  async steer(request: AcpPromptRequest): Promise<boolean> {
    const pending = this.pending;
    if (!pending?.steerable || pending.idle || this.cancellation || this.disposed || request.sessionId !== this.sessionId) return false;
    const client = this.requireClient();
    const { text, files } = toNativeInput(request);
    const id = nativeMessageId();
    let resolveAdmission!: (outcome: 'admitted' | 'refused' | 'unknown') => void;
    const admission = new Promise<'admitted' | 'refused' | 'unknown'>(resolve => { resolveAdmission = resolve; });
    let resolve!: (delivered: boolean) => void;
    let reject!: (error: Error) => void;
    const delivery = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; });
    void delivery.catch(() => undefined);
    this.steers.set(id, { text, admission, resolve, reject, recall: null });
    void client.request(`/api/session/${encodeURIComponent(request.sessionId)}/prompt`, {
      method: 'POST', body: { id, text, ...(files.length ? { files } : {}), delivery: 'steer' },
    }).then(
      () => resolveAdmission('admitted'),
      error => resolveAdmission(error instanceof OpencodeHttpError && error.status >= 400 && error.status < 500 ? 'refused' : 'unknown'),
    );
    const outcome = await admission;
    if (outcome === 'refused') this.settleSteer(id, false);
    else if (outcome === 'unknown' || this.pending !== pending) void this.recallSteers();
    return delivery;
  }

  cancel(sessionId: string): void {
    this.previewStops.add(sessionId);
    for (const tool of this.tools.values()) {
      if (tool.sessionId === sessionId) {
        tool.shell?.stop();
        tool.output = null;
      }
    }
    this.cancellation ??= this.requireClient().request(`/api/session/${encodeURIComponent(sessionId)}/interrupt?resume=false`, { method: 'POST' }).catch(() => undefined);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    const recalls = this.recallSteers();
    this.disposed = true;
    this.stopTools();
    this.previewStops.clear();
    this.controller.abort();
    for (const [id, controller] of this.interactions) {
      controller.abort();
      this.options.config.interactionPort.dismissInteraction(id, 'session-disposed');
    }
    this.interactions.clear();
    this.pending?.reject(new Error('OpenCode session disposed.'));
    this.pending = null;
    await Promise.all([this.cancellation, recalls]);
    for (const id of [...this.steers.keys()]) this.settleSteer(id, new Error('OpenCode session disposed before the steer was delivered.'));
    await this.client?.dispose();
  }

  private handleEvent(event: OpencodeHttpEvent): void {
    if (this.disposed) return;
    const data = event.data;
    const form = isRecord(data.form) ? data.form : undefined;
    const nativeSessionId = String(form?.sessionID ?? data.sessionID);
    const child = this.children.get(nativeSessionId);
    if (['permission.replied', 'form.replied', 'form.cancelled'].includes(event.type)) {
      const id = String(data.requestID ?? data.id);
      const globalForm = nativeSessionId === 'global' ? this.globalForms.get(id) : undefined;
      if (globalForm) globalForm.settled = true;
      const controller = this.interactions.get(id);
      if (controller && (nativeSessionId === this.sessionId || child || (nativeSessionId === 'global' && this.globalForms.has(id)))) {
        controller.abort();
        this.interactions.delete(id);
        this.options.config.interactionPort.dismissInteraction(id, 'native-rejected');
      }
      return;
    }
    if (event.type === 'form.created' && nativeSessionId === 'global' && form) {
      void this.interactWithGlobalForm(form).catch(error => this.fail(error));
      return;
    }
    if (nativeSessionId !== this.sessionId && !child) return;
    if (event.type === 'session.execution.started') this.previewStops.delete(nativeSessionId);
    else if (event.type.startsWith('session.execution.')) {
      this.previewStops.add(nativeSessionId);
      this.stopTools(nativeSessionId);
    }
    if (child) {
      if (event.type === 'session.text.ended') child.text.set(`${data.assistantMessageID}:${data.ordinal}`, String(data.text));
      if (event.type.startsWith('session.execution.') && event.type !== 'session.execution.started') {
        if (child.background) this.options.onNativeTaskCompleted?.({
          type: 'async_subagent_completed', originatingTurnId: child.turnId, subagentId: nativeSessionId,
          status: event.type === 'session.execution.succeeded' ? 'completed' : 'error',
          result: [...child.text.values()].join('\n') || (data.error ? errorText(data.error) : undefined),
          providerSessionId: this.sessionId ?? undefined,
        });
        this.children.delete(nativeSessionId);
        this.previewStops.delete(nativeSessionId);
      }
      if (!event.type.startsWith('session.tool.') && event.type !== 'permission.asked' && event.type !== 'form.created') return;
    }
    const key = `${nativeSessionId}:${data.assistantMessageID}:${data.id}`;
    const identity = child
      ? { toolCallId: `${nativeSessionId}:${data.id}`, toolScope: { kind: 'subagent' as const, subagentId: child.toolCallId }, parentToolCallId: child.toolCallId }
      : { toolCallId: String(data.id), toolScope: { kind: 'main' as const } };
    switch (event.type) {
      case 'session.execution.started':
        if (this.pending) { this.pending.started = true; this.pending.idle = false; }
        this.options.onNativeTurn?.('started', undefined, !!this.pending);
        this.announcePrompt();
        break;
      case 'session.execution.succeeded':
        if (this.pending && this.steers.size > 0) this.pending.idle = true;
        else if (!this.pending || this.pending.started) this.finish();
        break;
      case 'session.inbox.delivered': {
        const id = String(data.inboxID);
        const steer = this.steers.get(id);
        if (!steer) break;
        this.announcePrompt();
        this.emit({ type: 'user_message_started', content: steer.text, nativeUserMessageId: id });
        this.settleSteer(id, true);
        break;
      }
      case 'session.inbox.cancelled': this.settleSteer(String(data.inboxID), false); break;
      case 'session.execution.interrupted': if (!this.pending || this.pending.started) this.finish('cancelled'); break;
      case 'session.execution.failed': this.fail(new Error(errorText(data.error))); break;
      case 'permission.asked': void this.interact(data, false, child?.interactionTurnId).catch(error => this.fail(error)); break;
      case 'form.created': if (form) void this.interact(form, true, child?.interactionTurnId).catch(error => this.fail(error)); break;
      case 'session.step.started': {
        const id = String(data.assistantMessageID);
        if (this.pending) {
          this.pending.nativeAssistantId = id;
          if (!this.pending.assistantMessageStarted) {
            this.pending.assistantMessageStarted = true;
            this.emit({ type: 'assistant_message_started', nativeAssistantId: id });
          }
        } else {
          this.emit({ type: 'assistant_message_started', nativeAssistantId: id });
        }
        break;
      }
      case 'session.text.delta': case 'session.reasoning.delta':
      case 'session.text.ended': case 'session.reasoning.ended': {
        const kind = event.type.includes('.reasoning.') ? 'thinking_delta' : 'text_delta';
        const key = `${data.assistantMessageID}:${data.ordinal}:${kind}`;
        const previous = this.text.get(key) ?? '';
        const text = typeof data.delta === 'string' ? data.delta : typeof data.text === 'string' ? data.text.slice(previous.length) : '';
        if (event.type.endsWith('.ended')) this.text.delete(key);
        else this.text.set(key, previous + text);
        if (text) this.emit({ type: kind, text });
        break;
      }
      case 'session.tool.input.started':
        this.tools.get(key)?.shell?.stop();
        this.tools.set(key, { name: String(data.name), input: {}, sessionId: nativeSessionId, output: '' });
        break;
      case 'session.tool.called': {
        const tool = this.tools.get(key);
        if (!tool) break;
        tool.input = normalizeOpencodeToolInput(tool.name, isRecord(data.input) ? data.input : {});
        this.emit({ type: 'tool_started', ...identity, name: normalizeOpencodeToolName(tool.name), input: tool.input, providerPayload: { rawName: tool.name, rawInput: data.input } }, child?.outputSessionId);
        if (child) {
          child.toolUses += 1;
          child.lastToolName = normalizeOpencodeToolName(tool.name);
          this.emitSubagentProgress(child);
        }
        break;
      }
      case 'session.tool.progress': {
        const tool = this.tools.get(key);
        const metadata = isRecord(data.metadata) ? data.metadata : {};
        const turnId = child?.turnId ?? this.options.getActiveTurnId();
        if (tool?.name === 'subagent' && typeof metadata.sessionID === 'string' && turnId && !this.children.has(metadata.sessionID)) {
          const background = tool.input.run_in_background === true;
          const interactionTurnId = (background ? this.options.onNativeTaskStarted?.(metadata.sessionID, turnId) : undefined) ?? child?.interactionTurnId ?? turnId;
          this.children.set(metadata.sessionID, { outputSessionId: background ? metadata.sessionID : child?.outputSessionId ?? metadata.sessionID, toolCallId: identity.toolCallId, turnId, interactionTurnId, background, text: new Map(), startedAt: Date.now(), toolUses: 0, totalTokens: 0 });
        }
        if (tool && !this.previewStops.has(nativeSessionId) && tool.output !== null
          && typeof metadata.shellID === 'string') {
          tool.shell ??= new OpencodeShellOutput(this.requireClient(), metadata.shellID, content => {
            if (!this.disposed && this.tools.get(key) === tool) {
              this.emit({ type: 'tool_output', ...identity, content }, child?.outputSessionId);
            }
          });
        } else if (tool && !this.previewStops.has(nativeSessionId) && !tool.shell
          && tool.output !== null && typeof metadata.output === 'string') {
          if (metadata.output.startsWith(tool.output)) {
            const content = metadata.output.slice(tool.output.length);
            tool.output = metadata.output;
            if (content) this.emit({ type: 'tool_output', ...identity, content }, child?.outputSessionId);
          } else {
            tool.output = null;
          }
        }
        break;
      }
      case 'session.tool.success': case 'session.tool.failed': {
        const tool = this.tools.get(key);
        tool?.shell?.stop();
        const content = Array.isArray(data.content) ? data.content.filter(isRecord).flatMap(item => typeof item.text === 'string' ? [item.text] : []).join('\n') : '';
        this.emit({ type: 'tool_completed', ...identity, content: content || (data.error ? errorText(data.error) : ''), isError: event.type.endsWith('.failed'), providerPayload: { rawName: tool?.name, rawInput: tool?.input, rawOutput: { ...data, metadata: data.metadata } }, toolUseResult: tool ? normalizeOpencodeToolUseResult(tool.name, tool.input, { metadata: data.metadata }) : undefined }, child?.outputSessionId);
        this.tools.delete(key);
        break;
      }
      case 'session.step.ended':
        if (child && isRecord(data.tokens)) {
          child.totalTokens += tokenCount(data.tokens.input) + tokenCount(data.tokens.output) + tokenCount(data.tokens.reasoning);
          this.emitSubagentProgress(child);
        }
        this.emitUsage(data.tokens);
        break;
      case 'session.compaction.ended': this.emit({ type: 'context_compacted' }); break;
    }
  }

  private async latestMessage(sessionId: string): Promise<Record<string, unknown> | undefined> {
    const response = await this.requireClient().request<{ data: Array<Record<string, unknown>> }>(`/api/session/${encodeURIComponent(sessionId)}/message?order=desc&limit=1`);
    return response.data[0];
  }

  private async interactWithGlobalForm(form: Record<string, unknown>): Promise<void> {
    if (!isRecord(form.metadata) || form.metadata.kind !== 'mcp-elicitation' || typeof form.id !== 'string' || this.globalForms.has(form.id)) return;
    const state = { settled: false };
    this.globalForms.set(form.id, state);
    let scope: ReturnType<NonNullable<OpencodeSessionKernelOptions['openNativeInteraction']>>;
    try {
      // V2 global events omit location. The location-scoped inventory establishes ownership
      // on this independently leased server before any UI or answer is attached to it.
      const pending = await this.requireClient().request<{ data: Array<Record<string, unknown>> }>('/api/form');
      if (this.disposed || state.settled || !pending.data.some(candidate => candidate.id === form.id && candidate.sessionID === 'global')) return;
      scope = this.options.openNativeInteraction?.();
      if (!scope) throw new Error('OpenCode MCP form has no interaction owner.');
      await this.interact(form, true, scope.turnId);
    } finally {
      scope?.close();
      this.globalForms.delete(form.id);
    }
  }

  private async interact(data: Record<string, unknown>, question: boolean, childTurnId?: string): Promise<void> {
    const id = String(data.id);
    const turnId = childTurnId ?? this.options.getActiveTurnId();
    if (!turnId || this.interactions.has(id)) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([this.controller.signal, controller.signal]);
    this.interactions.set(id, controller);
    const identity = { interactionId: id, sessionInstanceId: this.options.sessionInstanceId, turnId };
    const route = `/api/session/${encodeURIComponent(String(data.sessionID))}/${question ? 'form' : 'permission'}/${encodeURIComponent(id)}`;
    if (!question && this.autoApprove) {
      await this.requireClient().request(`${route}/reply`, { method: 'POST', body: { decision: 'once' } });
      return;
    }
    let projectionError: unknown;
    try {
      if (question) {
        const fields = Array.isArray(data.fields) ? data.fields.filter(isRecord) : [];
        let questions;
        try { questions = projectOpencodeFormQuestions(data); }
        catch (error) {
          projectionError = error;
          await this.requireClient().request(route, { method: 'DELETE' });
          throw error;
        }
        const response = await this.options.config.interactionPort.askUserQuestion({
          ...identity, kind: 'question', input: { questions },
        }, signal);
        if (signal.aborted) return;
        if (response.interactionId !== id || !response.answers) {
          await this.requireClient().request(route, { method: 'DELETE' }); return;
        }
        const answer: Record<string, unknown> = {};
        for (const field of fields) {
          const value = response.answers[String(field.key)];
          if (value === undefined) continue;
          answer[String(field.key)] = Array.isArray(value) ? value : field.type === 'boolean' ? value.toLowerCase() === 'true' : field.type === 'number' || field.type === 'integer' ? Number(value) : value;
        }
        await this.requireClient().request(`${route}/reply`, { method: 'POST', body: { answer } });
      } else {
        const response = await this.options.config.interactionPort.requestApproval({
          ...identity, kind: 'approval', toolName: data.action === 'shell' ? 'bash' : String(data.action), input: { resources: data.resources, ...(isRecord(data.metadata) ? data.metadata : {}) }, description: typeof data.message === 'string' ? data.message : `${data.action}: ${Array.isArray(data.resources) ? data.resources.join(', ') : ''}`,
        }, signal);
        if (signal.aborted) return;
        const reply = response.interactionId === id && response.decision === 'allow' ? 'once' : response.interactionId === id && response.decision === 'allow-always' ? 'always' : 'reject';
        await this.requireClient().request(`${route}/reply`, { method: 'POST', body: { decision: reply } });
      }
    } catch (error) {
      // Native cancellation acknowledges our DELETE before its HTTP response. It must
      // not suppress the explanation for rejecting an unsupported form.
      if (projectionError || !signal.aborted) throw projectionError ?? error;
    } finally {
      if (this.interactions.delete(id)) this.options.config.interactionPort.dismissInteraction(id, 'resolved');
    }
  }

  private emitUsage(value: unknown): void {
    if (!isRecord(value)) return;
    const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
    const cache = isRecord(value.cache) ? value.cache : {};
    const model = this.models.find(model => model.id === this.model?.id && model.providerID === this.model?.providerID);
    const contextWindow = isRecord(model?.limit) ? count(model.limit.context) : 0;
    const inputTokens = count(value.input);
    const cacheReadInputTokens = count(cache.read);
    const cacheCreationInputTokens = count(cache.write);
    const contextTokens = inputTokens + cacheReadInputTokens + cacheCreationInputTokens + count(value.output) + count(value.reasoning);
    this.emit({ type: 'usage_updated', usage: {
      model: this.model ? `${this.model.providerID}/${this.model.id}` : undefined,
      inputTokens, cacheReadInputTokens, cacheCreationInputTokens, contextTokens, contextWindow,
      contextWindowIsAuthoritative: contextWindow > 0, percentage: contextWindow > 0 ? contextTokens / contextWindow * 100 : 0,
    } });
  }

  private captureAdmission(id?: string): void {
    if (this.pending) this.pending.userMessageId = id;
  }
  private emitSubagentProgress(child: NativeChild): void {
    const progress: SubagentProgress = {
      toolCallId: child.toolCallId,
      ...(child.lastToolName ? { lastToolName: child.lastToolName } : {}),
      toolUses: child.toolUses,
      totalTokens: child.totalTokens,
      durationMs: Math.max(0, Date.now() - child.startedAt),
    };
    this.options.onNativeSubagentProgress?.(progress);
  }
  private emit(event: OpencodeNativeOutput, childSessionId?: string): void { this.options.onNativeOutput?.(event, childSessionId); }
  /** The initial submitted prompt boundary must precede any delivered steer boundary. */
  private announcePrompt(): void {
    const pending = this.pending;
    if (!pending?.inputId || pending.announced) return;
    pending.announced = true;
    this.emit({ type: 'user_message_started', nativeUserMessageId: pending.inputId });
  }
  private settleSteer(id: string, outcome: boolean | Error): void {
    const steer = this.steers.get(id);
    if (!steer) return;
    this.steers.delete(id);
    if (outcome instanceof Error) steer.reject(outcome);
    else steer.resolve(outcome);
    if (this.pending?.idle && this.steers.size === 0) this.finish();
  }
  private recallSteers(): Promise<unknown> {
    const client = this.client;
    return Promise.all([...this.steers].map(([id, steer]) => steer.recall ??= steer.admission.then(outcome => {
      if (outcome !== 'refused') return this.recallSteer(id, client);
    })));
  }
  private async recallSteer(id: string, client: OpencodeHttpClient | null): Promise<void> {
    try {
      if (!client) throw new Error('OpenCode HTTP session is not connected.');
      await client.request(`/api/session/${encodeURIComponent(this.sessionId!)}/inbox/${encodeURIComponent(id)}`, { method: 'DELETE' });
      this.settleSteer(id, false);
    } catch (error) {
      this.settleSteer(id, new Error('OpenCode steer delivery could not be confirmed.', { cause: error }));
    }
  }
  private finish(stopReason: 'end_turn' | 'cancelled' = 'end_turn'): void {
    const pending = this.pending;
    this.pending = null;
    this.stopTools(this.sessionId ?? undefined);
    pending?.resolve({
      stopReason,
      userMessageId: pending.userMessageId,
      nativeAssistantId: pending.nativeAssistantId,
    });
    void this.recallSteers();
    this.options.onNativeTurn?.('completed', undefined, !!pending);
  }
  private fail(cause: unknown): void {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    if (this.disposed) return;
    const pending = this.pending;
    this.pending = null;
    this.stopTools(this.sessionId ?? undefined);
    void this.recallSteers();
    pending?.reject(error);
    this.options.onNativeTurn?.('completed', error.message, !!pending);
    if (!pending) this.options.onClosed(error);
  }
  private requireClient(): OpencodeHttpClient {
    if (!this.client || this.disposed) throw new Error('OpenCode HTTP session is not connected.');
    return this.client;
  }
  private stopTools(sessionId?: string): void {
    for (const [key, tool] of this.tools) {
      if (sessionId !== undefined && tool.sessionId !== sessionId) continue;
      tool.shell?.stop();
      this.tools.delete(key);
    }
  }
  private delay(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const signal = this.controller.signal;
      const onAbort = (): void => { window.clearTimeout(timer); reject(new Error('OpenCode session disposed.')); };
      const timer = window.setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

function toNativeInput(request: AcpPromptRequest): { text: string; files: Array<{ uri: string }> } {
  return {
    text: request.prompt.filter(block => block.type === 'text').map(block => block.text).join('\n'),
    files: request.prompt.flatMap(block => block.type === 'image' ? [{ uri: `data:${block.mimeType};base64,${block.data}` }] : []),
  };
}

function nativeMessageId(): string {
  return `msg_${randomUUID().replaceAll('-', '')}`;
}

function errorText(error: unknown): string {
  return isRecord(error) && typeof error.message === 'string' ? error.message : typeof error === 'string' ? error : JSON.stringify(error) ?? 'OpenCode execution failed.';
}

function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}
