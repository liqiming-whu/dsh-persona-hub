import { useCallback, useSyncExternalStore } from 'react'
import type {
  PersonaHubSettings,
  PersonaItem,
  PersonasSnapshot,
  TimeInjectionReport,
  UsageTelemetry,
} from '../index.ts'

export interface HubStatusPayload {
  ok: true
  sessionId: string | null
  sessionPersona: string | null
  sessionAvailable: boolean
  settings: PersonaHubSettings
  personas: PersonasSnapshot
  usage?: UsageTelemetry
  promptPreview?: string
  time?: TimeInjectionReport
}

type SessionKey = string | null
interface StatusSnapshot {
  data: HubStatusPayload | null
  error: string | null
}
interface StatusResource {
  snapshot: StatusSnapshot
  listeners: Set<() => void>
  detailSubscribers: number
  request?: AbortController
  poll?: ReturnType<typeof setInterval>
}

const emptySnapshot: StatusSnapshot = { data: null, error: null }
const resources = new Map<SessionKey, StatusResource>()
const statusPath = '/api/persona-hub/status'

export function personaLabel(persona?: PersonaItem | null): string {
  if (!persona) return '未启用人设'
  return persona.displayName.replace(/\s*[(（][^)）]*[)）]\s*$/, '').trim() || persona.displayName
}

async function requestStatus(path: string, key: SessionKey, init: RequestInit = {}): Promise<HubStatusPayload> {
  const res = await fetch(path, { cache: 'no-store', ...init })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json() as HubStatusPayload
  if (data.ok !== true || data.sessionId !== key) throw new Error('人设状态与当前会话不匹配')
  return data
}

function publish(resource: StatusResource, snapshot: StatusSnapshot) {
  resource.snapshot = snapshot
  for (const notify of resource.listeners) notify()
}

async function refreshStatus(key: SessionKey): Promise<void> {
  const resource = resources.get(key)
  if (!resource || resource.request) return
  const request = resource.request = new AbortController()
  const params = new URLSearchParams()
  if (key !== null) params.set('sessionId', key)
  if (!resource.detailSubscribers) params.set('view', 'summary')
  try {
    const data = await requestStatus(`${statusPath}?${params}`, key, { signal: request.signal })
    if (!request.signal.aborted) publish(resource, { data, error: null })
  } catch {
    if (!request.signal.aborted) publish(resource, { ...resource.snapshot, error: '无法读取人设状态' })
  } finally {
    if (resource.request === request) resource.request = undefined
  }
}

function cancelRefresh(resource: StatusResource): void {
  resource.request?.abort()
  resource.request = undefined
}

function subscribe(key: SessionKey, detail: boolean, notify: () => void): () => void {
  let resource = resources.get(key)
  if (!resource) {
    resource = { snapshot: emptySnapshot, listeners: new Set(), detailSubscribers: 0 }
    resources.set(key, resource)
    resource.poll = setInterval(() => {
      if (!document.hidden) void refreshStatus(key)
    }, 5000)
  }
  resource.listeners.add(notify)
  if (detail && resource.detailSubscribers++ === 0) cancelRefresh(resource)
  void refreshStatus(key)
  return () => {
    resource.listeners.delete(notify)
    if (detail) resource.detailSubscribers--
    if (resource.listeners.size === 0) {
      clearInterval(resource.poll)
      cancelRefresh(resource)
      resources.delete(key)
    }
  }
}

export function useHubStatus(key: SessionKey, detail = false) {
  const snapshot = useSyncExternalStore(
    useCallback(notify => subscribe(key, detail, notify), [key, detail]),
    useCallback(() => resources.get(key)?.snapshot ?? emptySnapshot, [key]),
  )
  const refresh = useCallback(() => refreshStatus(key), [key])
  return { ...snapshot, refresh }
}

let writeQueue: Promise<unknown> = Promise.resolve()

function post(path: string, key: SessionKey, body: unknown): Promise<HubStatusPayload> {
  const result = writeQueue.then(async () => {
    const data = await requestStatus(path, key, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    for (const [subscribedKey, resource] of resources) {
      if (subscribedKey === key) {
        cancelRefresh(resource)
        publish(resource, { data, error: null })
      } else if (key === null) {
        // Profile defaults are shared, but the effective persona must be recomputed for each session.
        cancelRefresh(resource)
        void refreshStatus(subscribedKey)
      }
    }
    return data
  })
  writeQueue = result.catch(() => {})
  return result
}

export function postHubSwitch(patch: Partial<PersonaHubSettings>): Promise<HubStatusPayload> {
  return post('/api/persona-hub/switch', null, patch)
}

export function postSessionPersona(sessionId: string, personaId: string | null): Promise<HubStatusPayload> {
  return post('/api/persona-hub/session', sessionId, { sessionId, personaId })
}
