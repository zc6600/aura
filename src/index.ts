// Aura OS TypeScript SDK Entrypoint

import { VERSION } from './utils/version.js';

export { VERSION };

export function getVersion(): string {
  return VERSION;
}

// Web Server
export { WebServer } from './cli/shell/webServer.js';
export { ContextAssembler } from './core/context/assembler.js';
// Context Layer
export { ContextBase, ContextOverflowError } from './core/context/base.js';
export { ContextManager } from './core/context/manager.js';
export { ContextPayload } from './core/context/payload.js';
export type { AuraEventMap, JobInfo } from './core/events.js';
// Typed event system
export {
  AuraEventBus,
  EventEmitterAdapter,
  TypedEventBus,
} from './core/events.js';
// Interface Bridge
export { Bridge } from './core/interface/bridge.js';
export { AgentLoop } from './core/kernel/agentLoop.js';
export type { ExecutionOptions } from './core/kernel/executionEngine.js';
export { ExecutionEngine } from './core/kernel/executionEngine.js';
export { GitState } from './core/kernel/gitState.js';
export { Hooks } from './core/kernel/hooks.js';
// Kernel interfaces
export type {
  HookFn,
  IEventBus,
  IHooks,
  IRunner,
  PlanEvent,
  PlanResult,
  ToolCall,
  ToolResult,
} from './core/kernel/interfaces.js';
export { Job } from './core/kernel/job.js';
export { NarrativeService } from './core/kernel/narrativeService.js';
export { Planner } from './core/kernel/planner.js';
export type {
  ProcessLogSubscription,
  ProcessMetadata,
} from './core/kernel/processRuntime.js';
export { ProcessRuntime } from './core/kernel/processRuntime.js';
export { RalphLoop } from './core/kernel/ralphLoop.js';
// Kernel Layer
export { ToolRegistry } from './core/kernel/registry.js';
export { Runner } from './core/kernel/runner.js';
export { ShadowBackup } from './core/kernel/shadowBackup.js';
export { WorkspaceRuntime } from './core/kernel/workspaceRuntime.js';
export { Client as LLMClient } from './core/llm/client.js';
// LLM Layer
export * as Env from './core/llm/env.js';
export * as LLMErrors from './core/llm/errors.js';
export { ResponseParser } from './core/llm/parsers/responseParser.js';
export * as Prompts from './core/llm/prompts/compose.js';
export * as PromptRegistry from './core/llm/prompts/registry.js';
export { MemoryBase } from './core/memory/base.js';
export { MemoryConfig } from './core/memory/config.js';
export {
  CallbackEventBus,
  EventBus,
  MemoryEventBus,
  NullEventBus,
} from './core/memory/eventBus.js';
export { MemoryMetabolizer } from './core/memory/metabolizer.js';
export { MemoryPolicy } from './core/memory/policy.js';
export { MemoryProvider } from './core/memory/provider.js';
export { MemoryRecorder } from './core/memory/recorder.js';
export { SessionManager } from './core/memory/sessionManager.js';
// Memory Layer
export { SQLiteStore } from './core/memory/sqliteStore.js';
export type { Result } from './core/result.js';
// Result type
export { Err, mapResult, Ok, unwrap, unwrapOr } from './core/result.js';
export * as ConfigManager from './utils/configManager.js';
export { loadTyped } from './utils/configManager.js';
export type {
  AuraConfig,
  LLMConfig,
  RalphConfig,
  SecurityConfig,
  StateManagementConfig,
  SystemConfig,
  ToolProtocolConfig,
} from './utils/configSchema.js';
// Config Schema (Zod-validated)
export {
  AuraConfigSchema,
  LLMConfigSchema,
  parseAuraConfig,
  RalphConfigSchema,
  SecurityConfigSchema,
  StateManagementConfigSchema,
  SystemConfigSchema,
  ToolProtocolConfigSchema,
} from './utils/configSchema.js';
export * as PathResolver from './utils/pathResolver.js';
