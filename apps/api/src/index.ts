import { createApp } from './app'
import { clerkDeps } from './deps'
import type { Bindings } from './env'

export default {
  fetch: (req, env, ctx) => createApp(clerkDeps(env)).fetch(req, env, ctx),
} satisfies ExportedHandler<Bindings>
