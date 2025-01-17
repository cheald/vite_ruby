import { basename, posix } from 'path'
import type { ConfigEnv, PluginOption, UserConfig, ViteDevServer } from 'vite'
import createDebugger from 'debug'

import { cleanConfig, configOptionFromEnv } from './utils'
import { filterEntrypointsForRollup, loadConfiguration, resolveGlobs } from './config'
import { assetsManifestPlugin } from './manifest'

export * from './types'

// Public: The resolved project root.
export const projectRoot = configOptionFromEnv('root') || process.cwd()

// Internal: Additional paths to watch.
let watchAdditionalPaths: string[] = []

// Public: Vite Plugin to detect entrypoints in a Ruby app, and allows to load a shared JSON configuration file that can be read from Ruby.
export default function ViteRubyPlugin (): PluginOption[] {
  return [
    {
      name: 'vite-plugin-ruby',
      config,
      configureServer,
    },
    assetsManifestPlugin(),
  ]
}

const debug = createDebugger('vite-plugin-ruby:config')

// Internal: Resolves the configuration from environment variables and a JSON
// config file, and configures the entrypoints and manifest generation.
function config (userConfig: UserConfig, env: ConfigEnv): UserConfig {
  const config = loadConfiguration(env.mode, projectRoot, userConfig)
  const { assetsDir, base, outDir, server, root, entrypoints, ssrBuild } = config

  const isLocal = config.mode === 'development' || config.mode === 'test'

  const build = {
    emptyOutDir: userConfig.build?.emptyOutDir ?? (ssrBuild || isLocal),
    sourcemap: !isLocal,
    ...userConfig.build,
    assetsDir,
    manifest: !ssrBuild,
    outDir,
    rollupOptions: {
      input: Object.fromEntries(filterEntrypointsForRollup(entrypoints)),
      output: ssrBuild ? {} : {
        ...outputOptions(assetsDir),
        ...userConfig.build?.rollupOptions?.output,
      },
    },
  }

  const envDir = userConfig.envDir || projectRoot

  debug({ base, build, envDir, root, server, entrypoints: Object.fromEntries(entrypoints) })

  watchAdditionalPaths = resolveGlobs(projectRoot, root, config.watchAdditionalPaths || [])

  const alias = { '~/': `${root}/`, '@/': `${root}/` }

  return cleanConfig({
    resolve: { alias },
    base,
    envDir,
    root,
    server,
    build,
    viteRuby: config,
  })
}

// Internal: Allows to watch additional paths outside the source code dir.
function configureServer (server: ViteDevServer) {
  server.watcher.add(watchAdditionalPaths)
}

function outputOptions (assetsDir: string) {
  // Internal: Avoid nesting entrypoints unnecessarily.
  const outputFileName = (ext: string) => ({ name }: { name: string }) => {
    const shortName = basename(name).split('.')[0]
    return posix.join(assetsDir, `${shortName}.[hash].${ext}`)
  }

  return {
    entryFileNames: outputFileName('js'),
    chunkFileNames: outputFileName('js'),
    assetFileNames: outputFileName('[ext]'),
  }
}
