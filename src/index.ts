// Aura OS TypeScript SDK Entrypoint

export const VERSION = '0.1.0';

export function getVersion(): string {
  return VERSION;
}

export * as PathResolver from './utils/pathResolver.js';
export * as ConfigManager from './utils/configManager.js';
export { loadTyped } from './utils/configManager.js';

// Config Schema (Zod-validated)
export {
  AuraConfigSchema,
  LLMConfigSchema,
  ToolProtocolConfigSchema,
  SecurityConfigSchema,
  StateManagementConfigSchema,
  RalphConfigSchema,
  SystemConfigSchema,
  parseAuraConfig,
} from './utils/configSchema.js';
export type {
  AuraConfig,
  LLMConfig,
  ToolProtocolConfig,
  SecurityConfig,
  StateManagementConfig,
  RalphConfig,
  SystemConfig,
} from './utils/configSchema.js';

// Result type
export { Ok, Err, mapResult, unwrap, unwrapOr } from './core/result.js';
export type { Result } from './core/result.js';

// Typed event system
export { TypedEventBus, AuraEventBus, EventEmitterAdapter } from './core/events.js';
export type { AuraEventMap, JobInfo } from './core/events.js';

// Kernel interfaces
export type {
  IRunner,
  IEventBus,
  IHooks,
  HookFn,
  ToolCall,
  ToolResult,
  PlanEvent,
  PlanResult,
} from './core/kernel/interfaces.js';

// Memory Layer
export { SQLiteStore } from './core/memory/sqliteStore.js';
export { MemoryBase } from './core/memory/base.js';
export { MemoryConfig } from './core/memory/config.js';
export { MemoryPolicy } from './core/memory/policy.js';
export { MemoryRecorder } from './core/memory/recorder.js';
export { MemoryProvider } from './core/memory/provider.js';
export { MemoryMetabolizer } from './core/memory/metabolizer.js';
export { SessionManager } from './core/memory/sessionManager.js';
export { MemoryEventBus, EventBus, CallbackEventBus, NullEventBus } from './core/memory/eventBus.js';

// LLM Layer
export * as Env from './core/llm/env.js';
export { Client as LLMClient } from './core/llm/client.js';
export * as LLMErrors from './core/llm/errors.js';
export * as Prompts from './core/llm/prompts/compose.js';
export * as PromptRegistry from './core/llm/prompts/registry.js';
export { ResponseParser } from './core/llm/parsers/responseParser.js';

// Context Layer
export { ContextBase, ContextOverflowError } from './core/context/base.js';
export { ContextPayload } from './core/context/payload.js';
export { ContextManager } from './core/context/manager.js';
export { ContextAssembler } from './core/context/assembler.js';

// Kernel Layer
export { ToolRegistry } from './core/kernel/registry.js';
export { ExecutionEngine } from './core/kernel/executionEngine.js';
export type { ExecutionOptions } from './core/kernel/executionEngine.js';
export { Planner } from './core/kernel/planner.js';
export { AgentLoop } from './core/kernel/agentLoop.js';
export { RalphLoop } from './core/kernel/ralphLoop.js';
export { Runner } from './core/kernel/runner.js';
export { Job } from './core/kernel/job.js';
export { Hooks } from './core/kernel/hooks.js';
export { GitState } from './core/kernel/gitState.js';
export { ShadowBackup } from './core/kernel/shadowBackup.js';
export { NarrativeService } from './core/kernel/narrativeService.js';
// Interface Bridge
export { Bridge } from './core/interface/bridge.js';

// Web Server
export { WebServer } from './cli/shell/webServer.js';




