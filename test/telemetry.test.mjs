import assert from 'node:assert/strict'
import test from 'node:test'
import { getDshUsageTelemetry } from '../lib/index.js'

test('getDshUsageTelemetry computes steps, turns, images, and context pressure from DSH sessions', () => {
  const now = Date.now()
  const mockSession = {
    id: 'session-test-1',
    header: { createdAt: now - 10000 },
    snapshotEvents() {
      return [
        { type: 'user/message', time: now - 9000, data: { content: 'hello' } },
        {
          type: 'request/header',
          time: now - 8500,
          data: { header: { config: { provider: 'google', model: 'gemini-4-argon', reasoningEffort: 'high' } } },
        },
        { type: 'step/start', time: now - 8000, data: { turn: 1, step: 1 } },
        { type: 'tool/call', time: now - 7000, data: { name: 'codex_image_generate', arguments: '{}' } },
        { type: 'step/start', time: now - 6000, data: { turn: 1, step: 2 } },
      ]
    },
  }

  const mockCtx = {
    get(key) {
      if (key === 'sessions') {
        return {
          list: () => [mockSession],
        }
      }
      if (key === 'tokenMeter') {
        return {
          contextPressure: () => ({ pressureTokens: 50000, contextWindow: 200000 }),
        }
      }
      if (key === 'agentDefaultModel') {
        return {
          currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
        }
      }
      return undefined
    },
  }

  const usage = getDshUsageTelemetry(mockCtx, 'session-test-1', now)
  assert.equal(usage.available, true)
  assert.equal(usage.convId, 'session-test-1')
  assert.equal(usage.convSteps, 2)
  assert.equal(usage.convUserTurns, 1)
  assert.equal(usage.convImages, 1)
  assert.equal(usage.todaySteps, 2)
  assert.equal(usage.todayImages, 1)
  assert.equal(usage.todayConvs, 1)
  assert.equal(usage.currentModel, 'gemini-4-argon (high)')
  assert.equal(usage.pressureTokens, 50000)
  assert.equal(usage.contextWindow, 200000)
  assert.equal(usage.contextLoadPct, 25)
})
