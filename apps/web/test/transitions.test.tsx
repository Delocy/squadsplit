import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { groupHandlers } from './group-fixtures'
import { fakeApi, renderApp } from './harness'
import { mockReducedMotion, stubViewTransitions } from './motion-mock'

vi.mock('@clerk/react', () => import('./clerk-mock'))

let restore = () => {}
afterEach(() => {
  cleanup()
  restore()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const summary = { id: 'g1', name: 'Bali Trip', emoji: '🧡', currency: 'SGD', role: 'owner', myBalanceCents: 0 }

describe('page transitions', () => {
  it('moves from the group list to a group with a view transition', async () => {
    const vt = stubViewTransitions()
    restore = vt.restore
    fakeApi(groupHandlers({}, { 'GET /groups': () => ({ status: 200, body: [summary] }) }))
    const router = renderApp('/groups')
    fireEvent.click(await screen.findByRole('link', { name: /Bali Trip/ }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
    expect(await screen.findByRole('region', { name: 'Group stats' })).toBeTruthy()
    expect(vt.start).toHaveBeenCalled()
  })

  it('moves between a group and its settings and wheel pages with view transitions', async () => {
    const vt = stubViewTransitions()
    restore = vt.restore
    fakeApi(groupHandlers())
    const router = renderApp('/groups/g1')
    fireEvent.click(await screen.findByRole('link', { name: 'Group settings' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1/settings'))
    fireEvent.click(await screen.findByRole('link', { name: 'Back to the group' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
    fireEvent.click(await screen.findByRole('link', { name: /Who pays next/ }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1/wheel'))
    expect(vt.start).toHaveBeenCalledTimes(3)
  })

  it('swaps pages instantly under reduced motion', async () => {
    mockReducedMotion(true)
    const vt = stubViewTransitions()
    restore = vt.restore
    fakeApi(groupHandlers({}, { 'GET /groups': () => ({ status: 200, body: [summary] }) }))
    const router = renderApp('/groups')
    fireEvent.click(await screen.findByRole('link', { name: /Bali Trip/ }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
    expect(vt.start).not.toHaveBeenCalled()
  })

  it('just navigates in a browser without view transitions', async () => {
    fakeApi(groupHandlers({}, { 'GET /groups': () => ({ status: 200, body: [summary] }) }))
    const warn = vi.spyOn(console, 'warn')
    const router = renderApp('/groups')
    fireEvent.click(await screen.findByRole('link', { name: /Bali Trip/ }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
    expect(warn).not.toHaveBeenCalled()
  })

  it('opens the expense dialog without a page transition (the dialog animates itself)', async () => {
    const vt = stubViewTransitions()
    restore = vt.restore
    fakeApi(groupHandlers())
    renderApp('/groups/g1')
    fireEvent.click((await screen.findAllByRole('link', { name: /Add expense/ }))[0]!)
    expect(await screen.findByRole('dialog', { name: 'New expense' })).toBeTruthy()
    expect(vt.start).not.toHaveBeenCalled()
  })
})

describe('scroll', () => {
  it('starts a new page at the top, but keeps the group where it was under the expense dialog', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo')
    fakeApi(groupHandlers())
    const router = renderApp('/groups/g1')
    const add = (await screen.findAllByRole('link', { name: /Add expense/ }))[0]!
    scrollTo.mockClear()

    fireEvent.click(add)
    const dialog = await screen.findByRole('dialog', { name: 'New expense' })
    fireEvent.click(dialog.querySelector('button.x')!)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g1'))
    await screen.findByRole('region', { name: 'Group stats' })
    expect(scrollTo).not.toHaveBeenCalledWith(0, 0)

    fireEvent.click(screen.getByRole('link', { name: 'Group settings' }))
    await vi.waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 0))
  })
})
