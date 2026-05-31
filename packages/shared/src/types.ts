// Shared OpenAI-compatible types used by both API and dashboard

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  stop?: string | string[];
  user?: string;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface UsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: UsageInfo;
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: {
    index: number;
    delta: Partial<ChatMessage>;
    finish_reason: string | null;
  }[];
}

export interface ModelInfo {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

export interface ModelsResponse {
  object: 'list';
  data: ModelInfo[];
}

// Admin/dashboard types
export interface ProviderStatus {
  name: string;
  enabled: boolean;
  hasApiKey: boolean;
  inCooldown: boolean;
  cooldownUntil: string | null;
  priority: number;
}

export interface ModelAliasEntry {
  provider: string;
  model: string;
}

export interface ModelAliasConfig {
  [alias: string]: ModelAliasEntry[];
}

export interface RequestLogEntry {
  id: number;
  provider: string;
  model: string;
  modelAlias: string | null;
  status: 'success' | 'error' | 'timeout' | 'rate_limited';
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface UsageStats {
  totalRequests: number;
  successRate: number;
  avgLatencyMs: number;
  totalTokens: number;
  byProvider: {
    provider: string;
    requests: number;
    successRate: number;
    avgLatencyMs: number;
    totalTokens: number;
  }[];
}
