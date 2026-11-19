import { drizzle } from 'drizzle-orm/d1'
import type { Bindings } from '../env'
import * as schema from './schema'

export const db = (env: Pick<Bindings, 'DB'>) => drizzle(env.DB, { schema })
export type Db = ReturnType<typeof db>
