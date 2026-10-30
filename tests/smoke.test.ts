import { describe, expect, it } from 'bun:test'
import { createMockD1 } from './d1-mock'
import { ensureAcics } from '../src/backend/acics'

describe('D1 Mock and Seed', () => {
  it('creates tables and seeds institutions, complaints, and role-aware accounts', async () => {
    const db = createMockD1()
    await ensureAcics(db)

    const users = await db.prepare('SELECT COUNT(*) as count FROM acics_users').first<any>()
    expect(Number(users.count)).toBe(9)

    // Multi-role support is backed by a join table, including accounts that are
    // pending or suspended and therefore hold no portal access.
    const roleRows = await db.prepare('SELECT COUNT(*) as count FROM acics_user_roles').first<any>()
    expect(Number(roleRows.count)).toBe(9)

    const pending = await db.prepare("SELECT COUNT(*) as count FROM acics_users WHERE account_status='PENDING_APPROVAL'").first<any>()
    expect(Number(pending.count)).toBe(1)

    const suspended = await db.prepare("SELECT COUNT(*) as count FROM acics_users WHERE account_status='SUSPENDED'").first<any>()
    expect(Number(suspended.count)).toBe(1)

    const insts = await db.prepare('SELECT COUNT(*) as count FROM acics_institutions').first<any>()
    expect(Number(insts.count)).toBe(10)

    const complaints = await db.prepare('SELECT COUNT(*) as count FROM acics_complaints').first<any>()
    expect(Number(complaints.count)).toBe(22)

    const bureaus = await db.prepare('SELECT COUNT(*) as count FROM acics_bureaus').first<any>()
    expect(Number(bureaus.count)).toBe(3)
  })
})
