export type AppBuildInfo = { version: string; commit: string; builtAt: string | null }

declare const __DOSTIGATOR_BUILD__: AppBuildInfo

// Local preview stands use separate Vite configs. The release config replaces this
// constant in both the client bundle and the public build-info.json artifact.
export const buildInfo: AppBuildInfo = typeof __DOSTIGATOR_BUILD__ === 'undefined'
  ? { version: '0.1.1', commit: 'local', builtAt: null }
  : __DOSTIGATOR_BUILD__
