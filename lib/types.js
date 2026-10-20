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
export {};
