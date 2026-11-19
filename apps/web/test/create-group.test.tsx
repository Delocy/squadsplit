import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeApi, renderApp } from './harness'

vi.mock('@clerk/react', () => import('./clerk-mock'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Create group page', () => {
  it('creates the group with SGD by default and opens it', async () => {
    const calls = fakeApi({
      'POST /groups': () => ({ status: 201, body: { id: 'g9', name: 'Bali Trip' } }),
      'GET /groups': () => ({ status: 200, body: [] }),
    })
    const router = renderApp('/groups/new')

    const currency = (await screen.findByLabelText('Currency')) as HTMLSelectElement
    expect(currency.value).toBe('SGD')
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: '  Bali Trip ' } })
    fireEvent.click(screen.getByRole('button', { name: /Create group/ }))

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/groups/g9'))
    expect(calls.find((c) => c.key === 'POST /groups')!.body).toEqual({ name: 'Bali Trip', emoji: '🧡', currency: 'SGD' })
  })

  it('sends the chosen currency', async () => {
    const calls = fakeApi({ 'POST /groups': () => ({ status: 201, body: { id: 'g9' } }) })
    renderApp('/groups/new')
    fireEvent.change(await screen.findByLabelText('Group name'), { target: { value: 'NYC' } })
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'USD' } })
    fireEvent.click(screen.getByRole('button', { name: /Create group/ }))
    await vi.waitFor(() => expect(calls[0]?.body).toMatchObject({ currency: 'USD' }))
  })

  it('asks for a name instead of calling the API when it is blank', async () => {
    const calls = fakeApi({})
    renderApp('/groups/new')
    fireEvent.change(await screen.findByLabelText('Group name'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /Create group/ }))
    expect(await screen.findByText('Give the group a name.')).toBeTruthy()
    expect(calls).toHaveLength(0)
  })

  it('shows the API error message when creating fails', async () => {
    fakeApi({ 'POST /groups': () => ({ status: 422, body: { error: { code: 'validation_failed', message: 'name: Too long' } } }) })
    renderApp('/groups/new')
    fireEvent.change(await screen.findByLabelText('Group name'), { target: { value: 'NYC' } })
    fireEvent.click(screen.getByRole('button', { name: /Create group/ }))
    expect(await screen.findByText('name: Too long')).toBeTruthy()
  })
})
