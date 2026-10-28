import { Database } from 'bun:sqlite'

export function createMockD1(): D1Database {
  const sqlite = new Database(':memory:')
  sqlite.run('PRAGMA foreign_keys = ON;')

  function formatParams(args: unknown[]): any[] {
    return args.map((arg) => (arg === undefined ? null : arg))
  }

  function createStatement(sql: string, params: unknown[] = []): D1PreparedStatement {
    return {
      bind(...newParams: unknown[]) {
        return createStatement(sql, newParams)
      },
      async all<T = Record<string, unknown>>() {
        try {
          const stmt = sqlite.prepare(sql)
          const results = stmt.all(...formatParams(params)) as T[]
          return {
            results,
            success: true,
            meta: { duration: 1, changes: 0, last_row_id: 0, served_by: 'mock-d1' } as any,
          }
        } catch (err: any) {
          throw new Error(`D1 all() error on [${sql}]: ${err.message}`)
        }
      },
      async first<T = Record<string, unknown>>(colName?: string) {
        try {
          const stmt = sqlite.prepare(sql)
          const row = stmt.get(...formatParams(params)) as any
          if (!row) return null
          if (colName) return row[colName] ?? null
          return row as T
        } catch (err: any) {
          throw new Error(`D1 first() error on [${sql}]: ${err.message}`)
        }
      },
      async run() {
        try {
          const stmt = sqlite.prepare(sql)
          const info = stmt.run(...formatParams(params))
          return {
            success: true,
            meta: {
              duration: 1,
              changes: info.changes,
              last_row_id: Number(info.lastInsertRowid),
              served_by: 'mock-d1',
            } as any,
          }
        } catch (err: any) {
          throw new Error(`D1 run() error on [${sql}]: ${err.message}`)
        }
      },
      async raw() {
        const stmt = sqlite.prepare(sql)
        return stmt.values(...formatParams(params)) as any
      },
    } as unknown as D1PreparedStatement
  }

  return {
    prepare(sql: string) {
      return createStatement(sql)
    },
    async batch(statements: D1PreparedStatement[]) {
      const results: D1Result[] = []
      sqlite.run('BEGIN TRANSACTION;')
      try {
        for (const stmt of statements) {
          // If statement has a query (SELECT), run all, else run
          const sql = (stmt as any)._sql || ''
          const res = await (stmt as any).all().catch(async () => await stmt.run())
          results.push(res)
        }
        sqlite.run('COMMIT;')
        return results
      } catch (err) {
        sqlite.run('ROLLBACK;')
        throw err
      }
    },
    async exec(query: string) {
      sqlite.run(query)
      return { count: 1, duration: 1 }
    },
    dump() {
      throw new Error('Not implemented')
    },
  } as unknown as D1Database
}
