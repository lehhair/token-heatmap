import { type Plugin } from "@opencode-ai/plugin"

const GLOBAL_STATE_KEY = Symbol.for("token-tracker.background-state")

interface BackgroundState {
  started?: boolean
  worker?: Worker | null
}

function backgroundState(): BackgroundState {
  const root = globalThis as any
  if (!root[GLOBAL_STATE_KEY]) root[GLOBAL_STATE_KEY] = {}
  return root[GLOBAL_STATE_KEY]
}

function startBackgroundSync() {
  const state = backgroundState()
  if (state.started || state.worker) return
  state.started = true

  try {
    console.log("[token-tracker] starting background sync")
    const worker = new Worker(new URL("./token-tracker-worker.ts", import.meta.url), {
      type: "module",
    })
    state.worker = worker
    worker.unref?.()
    worker.addEventListener("message", (event: any) => {
      if (event.data?.type === "error") console.log(`[token-tracker] sync failed: ${event.data.message}`)
      if (event.data?.type === "done") console.log("[token-tracker] background sync done")
      worker.terminate()
      state.worker = null
    })
    worker.addEventListener("error", (event: any) => {
      console.log(`[token-tracker] worker failed: ${event.message}`)
      worker.terminate()
      state.worker = null
    })
  } catch (error: any) {
    console.log(`[token-tracker] failed to start background sync: ${error?.message || String(error)}`)
  }
}

export const TokenTracker: Plugin = async () => {
  startBackgroundSync()
  return {}
}
