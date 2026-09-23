import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '@/lib/dataDir';

const MACHINE_ID_FILE = path.join(DATA_DIR, 'machine-id');
const AUTH_DIR = path.join(DATA_DIR, 'auth');
const CLI_SECRET_FILE = path.join(AUTH_DIR, 'cli-secret');
const CLI_AUTH_SALT = '9r-cli-auth';
const MACHINE_ID_ENV = 'NINEROUTER_MACHINE_ID';
let cachedRawId = null;
let cachedCliSecret = null;

// 64 lowercase hex — the same shape node-machine-id's default output has, so every
// consumer that parses this value keeps working. Generated, never read from the machine.
function generateRawMachineId() {
  return crypto.randomBytes(32).toString('hex');
}

// Called once per server boot. Each run gets a fresh id, shared with the CLI (and any
// other process) through MACHINE_ID_FILE, since they cannot see this process's memory.
export function initMachineId() {
  const raw = process.env[MACHINE_ID_ENV] || generateRawMachineId();
  process.env[MACHINE_ID_ENV] = raw;
  writeMachineIdFile(raw);
  cachedRawId = raw;
  return raw;
}

// tmp + rename so a CLI reading concurrently never sees a half-written file, and loud on
// failure: a swallowed error here only surfaces later as a 401 on x-9r-cli-token.
function writeMachineIdFile(raw) {
  const tmpFile = `${MACHINE_ID_FILE}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(tmpFile, raw, { mode: 0o600 });
    fs.renameSync(tmpFile, MACHINE_ID_FILE);
  } catch (error) {
    console.warn(`[machine-id] failed to persist ${MACHINE_ID_FILE}: ${error?.message || error}`);
    try {
      fs.rmSync(tmpFile, { force: true });
    } catch {}
  }
}

// Readers stay read-only: writing here would let a process that booted with an older id
// clobber the value the running server handed to the CLI. Order mirrors the writer's:
// own value → file (the run's shared id) → boot-time env → process-local random.
function loadRawMachineId() {
  if (cachedRawId) return cachedRawId;
  try {
    cachedRawId = fs.readFileSync(MACHINE_ID_FILE, 'utf8').trim();
    if (cachedRawId) return cachedRawId;
  } catch {}
  cachedRawId = process.env[MACHINE_ID_ENV] || generateRawMachineId();
  return cachedRawId;
}

// Random secret persisted on first run → unpredictable CLI token even when machineId leaks.
function loadCliSecret() {
  if (cachedCliSecret) return cachedCliSecret;
  try {
    cachedCliSecret = fs.readFileSync(CLI_SECRET_FILE, 'utf8').trim();
    if (cachedCliSecret) return cachedCliSecret;
  } catch {}
  cachedCliSecret = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    fs.writeFileSync(CLI_SECRET_FILE, cachedCliSecret, { mode: 0o600 });
  } catch {}
  return cachedCliSecret;
}

export async function getConsistentMachineId(salt = null) {
  const saltValue = salt || process.env.MACHINE_ID_SALT || 'endpoint-proxy-salt';
  const raw = loadRawMachineId();
  const extra = saltValue === CLI_AUTH_SALT ? loadCliSecret() : '';
  return crypto.createHash('sha256').update(raw + saltValue + extra).digest('hex').substring(0, 16);
}

export async function getRawMachineId() {
  return loadRawMachineId();
}

/**
 * Check if we're running in browser or server environment
 * @returns {boolean} True if in browser, false if in server
 */
export function isBrowser() {
  return typeof window !== 'undefined';
}
