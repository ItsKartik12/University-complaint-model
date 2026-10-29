#!/usr/bin/env node
// First-administrator bootstrap helper.
//
// ACICS deliberately has no administrator-registration endpoint. The first
// administrator is created one of two ways:
//
//   Local / fresh deployment: set ACICS_BOOTSTRAP_ADMIN_EMAIL,
//   ACICS_BOOTSTRAP_ADMIN_PASSWORD and ACICS_BOOTSTRAP_ADMIN_NAME, start the
//   app once, then remove the password variable. The worker creates the account
//   only while no administrator exists (see ensureBootstrapAdmin).
//
//   Production D1: this script runs `wrangler d1 execute --remote` with an
//   explicit --remote --yes confirmation. The schema must already exist (load
//   the deployed site once so ensureAcics creates it).
//
// Local SQLite files are never modified directly: Miniflare's D1 storage
// rejects external writers, and corrupting it breaks every later request.

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js')

function parseArgs(argv) {
  const options = { local: true, force: false, yes: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--email' || arg === '--name' || arg === '--password') {
      const value = argv[++i]
      if (!value) fail(`Missing value for ${arg}`)
      options[arg.slice(2)] = value
    } else if (arg === '--remote') options.local = false
    else if (arg === '--local') options.local = true
    else if (arg === '--force') options.force = true
    else if (arg === '--yes') options.yes = true
    else if (arg === '--help' || arg === '-h') usage(0)
    else fail(`Unknown argument: ${arg}`)
  }
  return options
}

function usage(exitCode) {
  console.log(`Usage: bun run bootstrap:admin --email <address> --name "<Full Name>" [options]

Options:
  --password <value>  Use a specific password instead of a generated one
  --local             Print the local environment-bootstrap instructions (default)
  --remote            Create the administrator in deployed D1 (requires --yes)
  --force             Allow a further administrator even if one already exists
  --yes               Confirm a remote write

First-administrator rules: the account is created only while no ADMIN role
exists. Never expose this as an HTTP registration endpoint.`)
  process.exit(exitCode)
}

function fail(message, code = 1) {
  console.error(`bootstrap-admin: ${message}`)
  process.exit(code)
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function generatedPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const symbols = '!@#$%^&*-_'
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  const body = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('')
  return `${body.slice(0, 10)}${symbols[bytes[0] % symbols.length]}${body.slice(10)}9`
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, keyMaterial, 256)
  const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return { hash: hex(bits), salt: hex(salt) }
}

function runWrangler(sql) {
  const args = ['d1', 'execute', 'DB', '--remote', '--json', '--command', sql]
  try {
    const stdout = execFileSync(process.execPath, [wrangler, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const start = stdout.indexOf('[')
    if (start === -1) throw new Error(`Unexpected wrangler output: ${stdout.slice(0, 200)}`)
    return JSON.parse(stdout.slice(start))
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : ''
    const stdout = error.stdout ? String(error.stdout).trim() : ''
    fail(['wrangler d1 execute failed.', stderr, stdout].filter(Boolean).join('\n'))
  }
}

function rows(result) {
  return result.flatMap((entry) => entry.results ?? [])
}

async function insertRemote(record, now) {
  const schema = rows(runWrangler(`SELECT name FROM sqlite_master WHERE type='table' AND name='acics_users'`))
  if (!schema.length) fail('ACICS tables are missing in the remote database. Load the deployed site once so the schema initializes, then retry.')
  const existingEmail = rows(runWrangler(`SELECT sub FROM acics_users WHERE lower(email)=${quote(record.email)}`))
  if (existingEmail.length) fail(`An account with ${record.email} already exists. Use the administrator console to change its roles.`)
  const admins = rows(runWrangler(`SELECT COUNT(*) AS count FROM acics_user_roles WHERE role='ADMIN'`))[0]?.count ?? 0
  if (admins > 0 && !options.force) {
    fail(`An administrator already exists (${admins}). Use --force only if you intentionally need another bootstrap administrator.`)
  }
  runWrangler(
    `INSERT INTO acics_users (sub, full_name, email, role, password_hash, password_salt, failed_attempts, locked_until, active, account_status, created_at, updated_at)
     VALUES (${quote(record.sub)}, ${quote(record.name)}, ${quote(record.email)}, 'ADMIN', ${quote(record.hash)}, ${quote(record.salt)}, 0, NULL, 1, 'ACTIVE', ${now}, ${now})`,
  )
  runWrangler(`INSERT INTO acics_user_roles (user_sub, role, granted_by, granted_at) VALUES (${quote(record.sub)}, 'ADMIN', 'bootstrap', ${now})`)
  runWrangler(
    `INSERT INTO acics_actions (id, complaint_id, actor_id, action_type, new_value, remarks, visibility, created_at)
     VALUES (${quote(`action-${crypto.randomUUID()}`)}, 'SYSTEM', ${quote(record.sub)}, 'ADMIN_BOOTSTRAPPED', 'ADMIN', ${quote(`Bootstrapped administrator ${record.email}`)}, 'INTERNAL', ${now})`,
  )
  const verified = rows(runWrangler(`SELECT sub FROM acics_users WHERE sub=${quote(record.sub)}`))
  if (!verified.length) fail('Insert failed verification. No account was created.')
}

const options = parseArgs(process.argv.slice(2))
if (!options.email || !options.name) usage(1)
const email = options.email.trim().toLowerCase()
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Provide a valid email address.')
if (options.name.trim().length < 2) fail('Provide the administrator’s full name.')
if (!options.local && !options.yes) fail('Remote bootstrap writes to production D1. Re-run with --remote --yes.')

const password = options.password ?? generatedPassword()
if (password.length < 12) fail('Choose a password of at least 12 characters.')

if (options.local) {
  console.log(`Local databases are bootstrapped through the worker, not by editing SQLite.
Add these lines to .dev.vars (git-ignored), then start the app once:

  ACICS_BOOTSTRAP_ADMIN_EMAIL=${email}
  ACICS_BOOTSTRAP_ADMIN_NAME=${options.name.trim()}
  ACICS_BOOTSTRAP_ADMIN_PASSWORD=${password}

  bun run dev

The administrator is created only while no administrator exists. Sign in
through the Administrator Portal, then delete the ACICS_BOOTSTRAP_ADMIN_* lines
and restart. The default local demo database already contains a seeded
administrator, so this step is for fresh or production-like databases.`)
  process.exit(0)
}

const { hash, salt } = await hashPassword(password)
const now = Date.now()
const record = { sub: `admin-${crypto.randomUUID()}`, name: options.name.trim(), email, hash, salt }
await insertRemote(record, now)

console.log(`\nAdministrator created in the remote D1 database.`)
console.log(`  Name:     ${record.name}`)
console.log(`  Email:    ${record.email}`)
console.log(`  Password: ${password}`)
console.log('\nStore this password in a password manager now; it is not shown again.')
console.log('Sign in through the Administrator Portal. Change the password after first use.\n')
