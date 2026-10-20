/**
 * Structural subset of the DeepSeek Harness types this plugin uses.
 *
 * The plugin is deliberately runtime-dependency-free: it imports nothing at
 * runtime (only Node builtins) and reaches every harness capability through the
 * Cordis context. These local interfaces describe exactly the fields the
 * plugin reads or writes, so the build never needs the harness type packages.
 *
 * 中文：本插件使用的 DeepSeek Harness 类型的结构化子集。
 * 插件刻意做到运行时零依赖：运行时不 import 任何东西（只用 Node 内置模块），所有宿主
 * 能力都通过 Cordis context 获取。这些本地接口只描述插件实际读写的字段，所以构建永远
 * 不需要宿主的类型包。
 */
/**
 * One model-facing content block. Only `text` blocks are interpreted here.
 * 中文：一个模型可见 content 块。这里只解释 `text` 块。
 */
export interface ContentBlock {
    readonly type: string;
    readonly text?: string;
    readonly [key: string]: unknown;
}
/**
 * One model-facing message. Identity is the durable message id.
 * 中文：一条模型可见消息。身份是持久 message id。
 */
export interface MessageLike {
    readonly id: string;
    readonly role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
    readonly content: readonly ContentBlock[];
    readonly source: Readonly<Record<string, unknown>>;
    readonly [key: string]: unknown;
}
/**
 * Surface placement declared by a message-producing session event.
 * 中文：产生消息的 session 事件所声明的 surface 放置方式。
 */
export type SurfaceOp = 'append' | {
    readonly op: 'replace';
    readonly startSeq: number;
    readonly endSeq: number;
};
/**
 * One committed session event, as far as this plugin observes it.
 * 中文：本插件观察到的一个已提交 session 事件。
 */
export interface SessionEventLike {
    readonly type: string;
    readonly seq: number;
    readonly time: number;
    readonly data: unknown;
    readonly surfaceOp?: SurfaceOp;
    readonly sourceEventSeqs?: readonly number[];
}
/**
 * Live derived surface: the current message-producing event sequences.
 * 中文：live 派生 surface：当前产生消息的事件 seq 集合。
 */
export interface SessionSurfaceLike {
    readonly nodes: readonly number[];
}
/**
 * Route metadata snapshot written by the agent loop.
 * 中文：agent loop 写入的路由元数据快照。
 */
export interface RequestContextLike {
    readonly provider?: string;
    readonly model?: string;
    readonly contextWindow?: number;
}
/**
 * The subset of one Session this plugin needs.
 * 中文：本插件需要的单个 Session 子集。
 */
export interface SessionLike {
    readonly id: string;
    readonly seq: number;
    readonly surface: SessionSurfaceLike;
    snapshotEvents(): readonly SessionEventLike[];
    append(type: string, data: unknown, opts?: {
        readonly surfaceOp?: SurfaceOp;
        readonly sourceEventSeqs?: readonly number[];
    }): SessionEventLike;
    requestContext?(): RequestContextLike | undefined;
}
/**
 * The subset of the host SessionStore this plugin needs.
 * 中文：本插件需要的宿主 SessionStore 子集。
 */
export interface SessionsLike {
    get(id: string): SessionLike | undefined;
}
/**
 * The subset of one Agent this plugin needs.
 * 中文：本插件需要的单个 Agent 子集。
 */
export interface AgentLike {
    readonly session: SessionLike;
}
/**
 * The subset of a tool execution context this plugin needs.
 * 中文：本插件需要的工具执行上下文子集。
 */
export interface ToolRunContextLike {
    readonly agent?: AgentLike;
    readonly signal: AbortSignal;
}
/**
 * Supported JSON-Schema subset (mirrors the harness tool schema dialect).
 * 中文：支持的 JSON-Schema 子集（对应宿主 tool schema 方言）。
 */
export interface JsonSchema {
    readonly type?: string;
    readonly description?: string;
    readonly properties?: Readonly<Record<string, JsonSchema>>;
    readonly required?: readonly string[];
    readonly items?: JsonSchema;
    readonly oneOf?: readonly JsonSchema[];
    readonly enum?: readonly unknown[];
    readonly additionalProperties?: boolean;
    readonly minimum?: number;
    readonly maximum?: number;
    readonly minLength?: number;
    readonly maxLength?: number;
    readonly default?: unknown;
}
/**
 * One registered tool definition.
 * 中文：一个已注册的工具定义。
 */
export interface ToolDefinitionLike {
    readonly name: string;
    readonly description: string;
    readonly parameters: JsonSchema;
    readonly output: {
        readonly schema: JsonSchema;
        render(args: unknown, value: unknown): readonly ContentBlock[];
    };
    execute(args: unknown, exec: ToolRunContextLike): Promise<unknown>;
    presentCall?(args: unknown): unknown;
    presentResult?(args: unknown, result: unknown): unknown;
}
/**
 * Tool registry service (`ctx.tools`).
 * 中文：工具注册表服务（`ctx.tools`）。
 */
export interface ToolRegistryLike {
    register(definition: ToolDefinitionLike): () => void;
}
/**
 * System prompt registry service (`ctx.systemPrompt`).
 * 中文：system prompt 注册表服务（`ctx.systemPrompt`）。
 */
export interface SystemPromptSectionLike {
    readonly name: string;
    readonly order: number;
    readonly text: string | ((context: unknown) => string);
}
/**
 * System prompt registry service (`ctx.systemPrompt`).
 * 中文：system prompt 注册表服务（`ctx.systemPrompt`）。
 */
export interface SystemPromptLike {
    section(section: SystemPromptSectionLike): () => void;
}
/**
 * One token-meter measurement, as far as this plugin reads it.
 * 中文：本插件读取的一份 token meter 测量结果。
 */
export interface TokenMeasurementLike {
    readonly totalTokens?: number;
    readonly surfaceTokens?: number;
    /**
     * Present only when the token meter was patched to price decoration.
     * 中文：只有 token meter 被打过补丁、能计算装饰成本时才存在。
     */
    readonly decorationOverheadTokens?: number;
    readonly baseline?: {
        readonly kind?: string;
    };
}
/**
 * Optional token meter service (`ctx.tokenMeter`).
 * 中文：可选的 token meter 服务（`ctx.tokenMeter`）。
 */
export interface TokenMeterLike {
    measure(session: SessionLike): TokenMeasurementLike;
}
/**
 * The subset of the Cordis plugin context this plugin uses.
 * 中文：本插件使用的 Cordis 插件上下文子集。
 */
export interface PluginContextLike {
    get(name: string): unknown;
    provide(name: string, value: unknown, check?: () => boolean): () => void;
    effect(fn: () => void | (() => void), label?: string): void;
    on(event: string, listener: (...args: any[]) => any, options?: {
        readonly prepend?: boolean;
    }): () => void;
    readonly systemPrompt: SystemPromptLike;
}
