/**
 * 测试用模块解析钩子：把 src/ 里无扩展名的相对 import 补成 `.ts`（含目录索引）。
 *
 * 为什么需要：src/shared 是给打包器吃的源码（moduleResolution: Bundler），相对 import 一律
 * 不写扩展名（`./pickers`）。而单测走 `node --experimental-strip-types` 直连源文件，Node 的
 * ESM 解析器要求完整说明符，`./pickers` 会 ERR_MODULE_NOT_FOUND。
 *
 * 与其为了跑测试给所有源文件加 `.ts` 后缀（需要全局打开 allowImportingTsExtensions，
 * 且会牵动 tsdown / rolldown 两条构建链），不如只在测试进程里补这一层解析。
 *
 * 目录模块（`./balance` → `./balance/index.ts`）一并支持：打包器的 Bundler 解析支持目录索引，
 * src/shared 里按职责拆目录后（见 src/shared/balance/），测试进程也得跟上同一套解析。
 */
/**
 * `@deepseek-ai/*` 宿主包 → 本地替身的映射。
 *
 * 这三个包在 package.json 里是 **peerDependencies**（设计前提：由 DSH 宿主提供），
 * 独立 checkout 的 node_modules 里根本没有它们。打包时 `tsdown.config.mjs` 用 alias
 * 换成了 `src/standalone/shims/*`，类型检查时 `tsconfig.json` 的 `paths` 做同样的事，
 * 但单测走的是 Node 原生 ESM 解析 —— 不补这一层，任何间接 import `host/index.ts`
 * 的测试都会 ERR_MODULE_NOT_FOUND（上游自己的 routes / quit / model-fallback
 * 等 7 个测试文件就是这样挂的）。
 *
 * 映射到替身而不是真包，是刻意的：**测试要测的正是独立模式实际运行的代码**
 * （独立模式产物里就是这些替身）。装真包会让测试验证一份永远不会被发布的实现。
 */
const SHIM_DIR = new URL('../src/standalone/shims/', import.meta.url);

/** 包名 → 替身文件名（与 tsdown.config.mjs 的 alias、tsconfig.json 的 paths 保持一致） */
const HOST_SHIMS = new Map([
  ['@deepseek-ai/dsh-llm', 'dsh-llm.ts'],
  ['@deepseek-ai/dsh-home-paths', 'dsh-home-paths.ts'],
  ['@deepseek-ai/dsh-credentials', 'dsh-credentials.ts'],
]);

export async function resolve(specifier, context, nextResolve) {
  const shim = HOST_SHIMS.get(specifier);
  if (shim !== undefined) {
    return nextResolve(new URL(shim, SHIM_DIR).href, context);
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    if (!/\.[cm]?[jt]sx?$/.test(specifier) && !specifier.endsWith('.json')) {
      for (const candidate of [specifier + '.ts', specifier + '/index.ts']) {
        try {
          return await nextResolve(candidate, context);
        } catch {
          /* 继续试下一个候选；都不行就落回原说明符，让 Node 报它自己的错 */
        }
      }
    }
  }
  return nextResolve(specifier, context);
}
