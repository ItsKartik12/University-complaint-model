import { describe, expect, it } from 'bun:test'
import { createMockD1 } from './d1-mock'
import { ensureAcics } from '../src/worker/acics'

describe('D1 Mock and Seed', () => {
  it('creates tables and seeds 10 institutions and 22 complaints', async () => {
    const db = createMockD1()
    await ensureAcics(db)

    const users = await db.prepare('SELECT COUNT(*) as count FROM acics_users').first<any>()
    expect(Number(users.count)).toBe(6)

    const insts = await db.prepare('SELECT COUNT(*) as count FROM acics_institutions').first<any>()
    expect(Number(insts.count)).toBe(10)

    const complaints = await db.prepare('SELECT COUNT(*) as count FROM acics_complaints').first<any>()
    expect(Number(complaints.count)).toBe(22)

    const bureaus = await db.prepare('SELECT COUNT(*) as count FROM acics_bureaus').first<any>()
    expect(Number(bureaus.count)).toBe(3)
  })
})
