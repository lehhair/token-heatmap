import { type Plugin } from "@opencode-ai/plugin"
import { Database } from "bun:sqlite"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "fs"
import { Buffer } from "buffer"
import { gzipSync } from "zlib"
import { join } from "path"
import { homedir } from "os"

const CONFIG_KEY = "token-tracker"
const DEFAULT_SYNC_DAYS = 1
const STARTUP_DELAY_MS = 5000
const LOCK_STALE_MS = 10 * 60 * 1000
const MAX_WORKFLOW_PAYLOAD_CHARS = 60000

let syncInFlight: Promise<void> | null = null

interface GithubWorkflowConfig {
  owner?: string
  repo?: string
  workflow?: string
  ref?: string
  token?: string
  tokenEnv?: string
}

interface TrackerConfig {
  repo?: string
  days?: number
  startupDelayMs?: number
  github?: GithubWorkflowConfig
}

function loadConfig(): TrackerConfig {
  const home = homedir()
  const candidates = [
    join(home, ".config", "opencode", CONFIG_KEY + ".json"),
  ]
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || ""
    if (appData) candidates.unshift(join(appData, "opencode", CONFIG_KEY + ".json"))
  }
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf-8"))
      } catch {}
    }
  }
  return {}
}

function findDbPath(): string {
  if (process.env.OPENCODE_DB && existsSync(process.env.OPENCODE_DB)) {
    return process.env.OPENCODE_DB
  }
  const home = homedir()
  const candidates = [
    join(home, ".local", "share", "opencode", "opencode.db"),
  ]
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || ""
    if (localAppData) candidates.push(join(localAppData, "opencode", "opencode.db"))
    candidates.push(join(home, "AppData", "Local", "opencode", "opencode.db"))
  }
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return ""
}

function dayStartMs(day: Date): number {
  return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())
}

function msToDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function latestDailyDate(existing: Record<string, any> | null): Date | null {
  if (!existing?.daily?.length) return null
  let latest: Date | null = null
  for (const entry of existing.daily) {
    if (!entry?.date) continue
    const day = new Date(entry.date + "T00:00:00Z")
    if (Number.isNaN(day.getTime())) continue
    if (!latest || day > latest) latest = day
  }
  return latest
}

function hasExistingDaily(existing: Record<string, any> | null): boolean {
  return latestDailyDate(existing) !== null
}

function incrementalSinceMs(existing: Record<string, any> | null, days: number): number | null {
  if (days <= 0) return null
  const today = new Date()
  const cutoff = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  cutoff.setUTCDate(cutoff.getUTCDate() - days)
  const latest = latestDailyDate(existing)
  if (latest && latest < cutoff) return dayStartMs(latest)
  return dayStartMs(cutoff)
}

function stripLegacyCost(value: any): any {
  if (Array.isArray(value)) return value.map(stripLegacyCost)
  if (value && typeof value === "object") {
    const clean: Record<string, any> = {}
    for (const [key, child] of Object.entries(value)) {
      if (key !== "cost" && key !== "total_cost" && key !== "provider") clean[key] = stripLegacyCost(child)
    }
    return clean
  }
  return value
}

function withoutUpdatedAt(data: Record<string, any> | null): Record<string, any> | null {
  if (!data) return null
  const clean = { ...data }
  delete clean.updated_at
  return clean
}

function dataChanged(existing: Record<string, any> | null, next: Record<string, any>): boolean {
  if (!existing) return true
  const cleanExisting = stripLegacyCost(existing)
  return JSON.stringify(existing) !== JSON.stringify(cleanExisting) ||
    JSON.stringify(withoutUpdatedAt(cleanExisting)) !== JSON.stringify(withoutUpdatedAt(next))
}

function lockPath(): string {
  return join(homedir(), ".config", "opencode", CONFIG_KEY + ".lock")
}

function acquireLock(): number | null {
  const path = lockPath()
  try {
    if (existsSync(path) && Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) rmSync(path, { force: true })
    return openSync(path, "wx")
  } catch {
    return null
  }
}

function releaseLock(fd: number | null) {
  if (fd === null) return
  try { closeSync(fd) } catch {}
  try { rmSync(lockPath(), { force: true }) } catch {}
}

async function dispatchWorkflow(config: GithubWorkflowConfig | undefined, upload: Record<string, any>) {
  if (!config?.owner || !config?.repo) return
  const token = config.token || process.env[config.tokenEnv || "TOKEN_HEATMAP_GITHUB_TOKEN"]
  if (!token) {
    console.log("[token-tracker] GitHub token env not set, skipping workflow dispatch")
    return
  }

  const workflow = config.workflow || "update-token-stats.yml"
  const ref = config.ref || "master"
  const payload = gzipSync(JSON.stringify(upload)).toString("base64")
  if (payload.length > MAX_WORKFLOW_PAYLOAD_CHARS) {
    console.log(`[token-tracker] payload too large for workflow dispatch (${payload.length} chars), skipping upload`)
    return
  }

  const res = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      ref,
      inputs: { payload },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.log(`[token-tracker] workflow dispatch failed: ${res.status} ${body}`)
    return
  }
  console.log(`[token-tracker] dispatched GitHub workflow (${upload.mode})`)
}

function queryLongestTurns(dbPath: string, sinceMs: number | null): Record<string, number> {
  const db = new Database(dbPath, { readonly: true })
  try {
    const rows = sinceMs === null ? db.query(`
        SELECT
          date(m.time_created / 1000, 'unixepoch') as day,
          MAX(
            json_extract(m.data, '$.time.completed') -
            json_extract(m.data, '$.time.created')
          ) as longest_turn_ms
        FROM message m
        WHERE json_extract(m.data, '$.role') = 'assistant'
          AND json_extract(m.data, '$.time.completed') IS NOT NULL
        GROUP BY day
      `).all() as any[] : db.query(`
        SELECT
          date(m.time_created / 1000, 'unixepoch') as day,
          MAX(
            json_extract(m.data, '$.time.completed') -
            json_extract(m.data, '$.time.created')
          ) as longest_turn_ms
        FROM session s
        CROSS JOIN message m INDEXED BY message_session_time_created_id_idx
          ON m.session_id = s.id
        WHERE s.time_updated >= $since
          AND m.time_created >= $since
          AND json_extract(m.data, '$.role') = 'assistant'
          AND json_extract(m.data, '$.time.completed') IS NOT NULL
        GROUP BY day
      `).all({ $since: sinceMs }) as any[]
    const result: Record<string, number> = {}
    for (const row of rows) {
      result[row.day] = row.longest_turn_ms || 0
    }
    return result
  } catch {
    return {}
  } finally {
    db.close()
  }
}

function queryTokens(dbPath: string, sinceMs: number | null): Array<Record<string, any>> {
  const db = new Database(dbPath, { readonly: true })
  
  let rows: any[]
  try {
    rows = sinceMs === null ? db.query(`
        SELECT
          date(p.time_created / 1000, 'unixepoch') as day,
          COUNT(DISTINCT s.id) as sessions,
          SUM(json_extract(p.data, '$.tokens.input')) as tokens_input,
          SUM(json_extract(p.data, '$.tokens.output')) as tokens_output,
          SUM(json_extract(p.data, '$.tokens.cache.read')) as tokens_cache_read,
          SUM(json_extract(p.data, '$.tokens.cache.write')) as tokens_cache_write,
          SUM(json_extract(p.data, '$.tokens.reasoning')) as tokens_reasoning
        FROM part p
        JOIN session s ON p.session_id = s.id
        WHERE json_extract(p.data, '$.type') = 'step-finish'
        GROUP BY day
        ORDER BY day
      `).all() : db.query(`
        SELECT
          date(p.time_created / 1000, 'unixepoch') as day,
          COUNT(DISTINCT p.session_id) as sessions,
          SUM(json_extract(p.data, '$.tokens.input')) as tokens_input,
          SUM(json_extract(p.data, '$.tokens.output')) as tokens_output,
          SUM(json_extract(p.data, '$.tokens.cache.read')) as tokens_cache_read,
          SUM(json_extract(p.data, '$.tokens.cache.write')) as tokens_cache_write,
          SUM(json_extract(p.data, '$.tokens.reasoning')) as tokens_reasoning
        FROM session s
        CROSS JOIN part p INDEXED BY part_session_idx ON p.session_id = s.id
        WHERE s.time_updated >= $since
          AND p.time_created >= $since
          AND json_extract(p.data, '$.type') = 'step-finish'
        GROUP BY day
        ORDER BY day
      `).all({ $since: sinceMs })
  } catch {
    rows = sinceMs === null ? db.query(`
        SELECT
          date(time_created / 1000, 'unixepoch') as day,
          COUNT(*) as sessions,
          SUM(tokens_input) as tokens_input,
          SUM(tokens_output) as tokens_output,
          SUM(tokens_cache_read) as tokens_cache_read,
          SUM(tokens_cache_write) as tokens_cache_write,
          SUM(tokens_reasoning) as tokens_reasoning
        FROM session
        WHERE time_created > 0
        GROUP BY day
        ORDER BY day
      `).all() : db.query(`
        SELECT
          date(time_created / 1000, 'unixepoch') as day,
          COUNT(*) as sessions,
          SUM(tokens_input) as tokens_input,
          SUM(tokens_output) as tokens_output,
          SUM(tokens_cache_read) as tokens_cache_read,
          SUM(tokens_cache_write) as tokens_cache_write,
          SUM(tokens_reasoning) as tokens_reasoning
        FROM session
        WHERE time_updated >= $since
        GROUP BY day
        ORDER BY day
      `).all({ $since: sinceMs })
  }
  db.close()

  const turns = queryLongestTurns(dbPath, sinceMs)

  return rows.map((r: any) => ({
    date: r.day,
    sessions: r.sessions || 0,
    tokens_input: r.tokens_input || 0,
    tokens_output: r.tokens_output || 0,
    tokens_cache_read: r.tokens_cache_read || 0,
    tokens_cache_write: r.tokens_cache_write || 0,
    tokens_reasoning: r.tokens_reasoning || 0,
    longest_turn_ms: turns[r.day] || 0,
  }))
}

function queryModels(dbPath: string, sinceMs: number | null): Record<string, Array<Record<string, any>>> {
  const db = new Database(dbPath, { readonly: true })
  try {
    const rows = sinceMs === null ? db.query(`
        SELECT
          date(p.time_created / 1000, 'unixepoch') as day,
          json_extract(m.data, '$.modelID') as model,
          SUM(json_extract(p.data, '$.tokens.input')) as tokens_input,
          SUM(json_extract(p.data, '$.tokens.output')) as tokens_output,
          SUM(json_extract(p.data, '$.tokens.cache.read')) as tokens_cache_read,
          SUM(json_extract(p.data, '$.tokens.cache.write')) as tokens_cache_write,
          SUM(json_extract(p.data, '$.tokens.reasoning')) as tokens_reasoning,
          COUNT(DISTINCT m.id) as messages
        FROM part p
        JOIN message m ON p.message_id = m.id
        WHERE json_extract(p.data, '$.type') = 'step-finish'
          AND json_extract(m.data, '$.modelID') IS NOT NULL
        GROUP BY day, model
        ORDER BY day, messages DESC
      `).all() as any[] : db.query(`
        SELECT
          date(p.time_created / 1000, 'unixepoch') as day,
          json_extract(m.data, '$.modelID') as model,
          SUM(json_extract(p.data, '$.tokens.input')) as tokens_input,
          SUM(json_extract(p.data, '$.tokens.output')) as tokens_output,
          SUM(json_extract(p.data, '$.tokens.cache.read')) as tokens_cache_read,
          SUM(json_extract(p.data, '$.tokens.cache.write')) as tokens_cache_write,
          SUM(json_extract(p.data, '$.tokens.reasoning')) as tokens_reasoning,
          COUNT(DISTINCT m.id) as messages
        FROM session s
        CROSS JOIN part p INDEXED BY part_session_idx ON p.session_id = s.id
        JOIN message m ON p.message_id = m.id
        WHERE s.time_updated >= $since
          AND p.time_created >= $since
          AND json_extract(p.data, '$.type') = 'step-finish'
          AND json_extract(m.data, '$.modelID') IS NOT NULL
        GROUP BY day, model
        ORDER BY day, messages DESC
      `).all({ $since: sinceMs }) as any[]
    const result: Record<string, Array<Record<string, any>>> = {}
    for (const row of rows) {
      if (!result[row.day]) result[row.day] = []
      const model = row.model || "unknown"
      let existing = result[row.day].find((entry) => entry.model === model)
      if (!existing) {
        existing = {
          model,
          tokens_input: 0,
          tokens_output: 0,
          tokens_cache_read: 0,
          tokens_cache_write: 0,
          tokens_reasoning: 0,
          messages: 0,
        }
        result[row.day].push(existing)
      }
      existing.tokens_input += row.tokens_input || 0
      existing.tokens_output += row.tokens_output || 0
      existing.tokens_cache_read += row.tokens_cache_read || 0
      existing.tokens_cache_write += row.tokens_cache_write || 0
      existing.tokens_reasoning += row.tokens_reasoning || 0
      existing.messages += row.messages || 0
    }
    for (const day of Object.keys(result)) {
      result[day].sort((a, b) => (b.messages || 0) - (a.messages || 0))
    }
    return result
  } catch {
    return {}
  } finally {
    db.close()
  }
}

function computeStats(daily: Array<Record<string, any>>): Record<string, any> {
  let lifetimeTokens = 0
  let peakDailyTokens = 0
  let longestTurnSec = 0

  for (const d of daily) {
    const total = d.tokens_input + d.tokens_output
    d.tokens = total
    lifetimeTokens += total
    if (total > peakDailyTokens) peakDailyTokens = total
    const sec = Math.floor((d.longest_turn_ms || 0) / 1000)
    if (sec > longestTurnSec) longestTurnSec = sec
  }

  const dailyMap: Record<string, number> = {}
  const datesWithData: string[] = []
  for (const d of daily) {
    dailyMap[d.date] = d.tokens
    if (d.tokens > 0) datesWithData.push(d.date)
  }

  const today = new Date()
  let currentStreak = 0
  let d = new Date(today)
  while (true) {
    const key = d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0")
    if (dailyMap[key] && dailyMap[key] > 0) {
      currentStreak++
      d.setDate(d.getDate() - 1)
    } else {
      break
    }
  }

  let longestStreak = 0
  let streak = 0
  for (const dStr of datesWithData) {
    if (dailyMap[dStr] > 0) {
      streak++
      if (streak > longestStreak) longestStreak = streak
    } else {
      streak = 0
    }
  }

  let totalSessions = 0
  for (const d of daily) {
    totalSessions += d.sessions || 0
  }

  return {
    lifetime_tokens: lifetimeTokens,
    peak_daily_tokens: peakDailyTokens,
    longest_turn_sec: longestTurnSec,
    current_streak_days: currentStreak,
    longest_streak_days: longestStreak,
    total_sessions: totalSessions,
  }
}

function trimToOneYear(daily: Array<Record<string, any>>): Array<Record<string, any>> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 365)
  const cutoffStr = cutoff.getFullYear() + "-" +
    String(cutoff.getMonth() + 1).padStart(2, "0") + "-" +
    String(cutoff.getDate()).padStart(2, "0")
  return daily.filter(d => d.date >= cutoffStr)
}

async function syncData() {
  const lockFd = acquireLock()
  if (lockFd === null) return
  try {
  const config = loadConfig()
  const repo = config.repo || ""

  const dbPath = findDbPath()
  if (!dbPath) {
    console.log("[token-tracker] opencode.db not found, skipping sync")
    return
  }

  const statsDir = repo && existsSync(repo) ? join(repo, "stats") : join(homedir(), "opencode-heatmap", "stats")
  const statsFile = join(statsDir, "opencode-tokens.json")
  const jsFile = join(statsDir, "opencode-tokens.js")

  let existing: Record<string, any> | null = null
  if (existsSync(statsFile)) {
    try {
      existing = JSON.parse(readFileSync(statsFile, "utf-8"))
    } catch {}
  }

  let sinceMs = incrementalSinceMs(existing, config.days ?? DEFAULT_SYNC_DAYS)
  const hasLocalStats = hasExistingDaily(existing)
  if (!hasLocalStats) sinceMs = null

  const newDaily = queryTokens(dbPath, sinceMs)
  if (!newDaily.length) {
    console.log("[token-tracker] no session data found, skipping sync")
    return
  }

  const models = queryModels(dbPath, sinceMs)
  for (const d of newDaily) {
    (d as any).models = models[d.date] || []
  }

  const existingMap: Record<string, any> = {}
  const cleanExisting = stripLegacyCost(existing)
  if (cleanExisting?.daily) {
    for (const d of cleanExisting.daily) existingMap[d.date] = d
  }
  if (sinceMs !== null) {
    const sinceDay = msToDay(sinceMs)
    for (const key of Object.keys(existingMap)) {
      if (key >= sinceDay) delete existingMap[key]
    }
  }
  for (const d of newDaily) existingMap[d.date] = d

  const mergedDaily = Object.values(existingMap).sort((a: any, b: any) => a.date.localeCompare(b.date))
  const stats = computeStats(mergedDaily)
  const trimmed = trimToOneYear(mergedDaily)

  const result = {
    version: 1,
    updated_at: new Date().toISOString(),
    daily: trimmed,
    stats,
  }

  if (!dataChanged(existing, result)) {
    console.log("[token-tracker] no data changes")
    return
  }

  mkdirSync(statsDir, { recursive: true })
  const jsonStr = JSON.stringify(result, null, 2)
  writeFileSync(statsFile, jsonStr, "utf-8")
  writeFileSync(jsFile, "window.__OPENCODE_TOKEN_DATA__ = " + jsonStr + ";\n", "utf-8")

  console.log(`[token-tracker] synced ${trimmed.length} days (full ${mergedDaily.length}), ${stats.total_sessions} sessions, ${stats.lifetime_tokens.toLocaleString()} tokens`)
  await dispatchWorkflow(config.github, {
    mode: hasLocalStats ? "patch" : "full",
    version: 1,
    updated_at: result.updated_at,
    since_day: sinceMs === null ? null : msToDay(sinceMs),
    daily: hasLocalStats ? newDaily : trimmed,
  })
  } finally {
    releaseLock(lockFd)
  }
}

function scheduleSync() {
  if (syncInFlight) return
  syncInFlight = syncData()
    .catch((e: any) => console.log(`[token-tracker] sync failed: ${e.message}`))
    .finally(() => { syncInFlight = null })
}

export const TokenTracker: Plugin = async ({ client }) => {
  const config = loadConfig()
  setTimeout(() => scheduleSync(), config.startupDelayMs ?? STARTUP_DELAY_MS)

  return {
    event: async () => {},
  }
}
