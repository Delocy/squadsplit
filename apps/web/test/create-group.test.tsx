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
    await vi.waitFor(() => expect(calls.find((c) => c.key === 'POST /groups')?.body).toMatchObject({ currency: 'USD' }))
  })

  it('sends a nickname for you in the group when you change it from your profile name', async () => {
    const calls = fakeApi({ 'POST /groups': () => ({ status: 201, body: { id: 'g9' } }) })
    renderApp('/groups/new')
    fireEvent.change(await screen.findByLabelText('Group name'), { target: { value: 'NYC' } })
    const nickname = screen.getByLabelText('What should this group call you?') as HTMLInputElement
    await vi.waitFor(() => expect(nickname.value).toBe('Me'))
    fireEvent.change(nickname, { target: { value: ' Captain ' } })
    fireEvent.click(screen.getByRole('button', { name: /Create group/ }))
    await vi.waitFor(() => expect(calls.find((c) => c.key === 'POST /groups')?.body).toMatchObject({ name: 'NYC', nickname: 'Captain' }))
  })

  it('sends no nickname (null) when you clear the field', async () => {
    const calls = fakeApi({ 'POST /groups': () => ({ status: 201, body: { id: 'g9' } }) })
    renderApp('/groups/new')
    fireEvent.change(await screen.findByLabelText('Group name'), { target: { value: 'NYC' } })
    fireEvent.change(screen.getByLabelText('What should this group call you?'), { target: { value: '  ' } })
    fireEvent.click(screen.getByRole('button', { name: /Create group/ }))
    await vi.waitFor(() => expect(calls.find((c) => c.key === 'POST /groups')?.body).toMatchObject({ nickname: null }))
  })

  it('asks for a shorter nickname without emoji instead of calling the API', async () => {
    const calls = fakeApi({})
    renderApp('/groups/new')
    fireEvent.change(await screen.findByLabelText('Group name'), { target: { value: 'NYC' } })
    fireEvent.change(screen.getByLabelText('What should this group call you?'), { target: { value: 'Cap 🍕' } })
    fireEvent.click(screen.getByRole('button', { name: /Create group/ }))
    expect(await screen.findByText('Keep it to 24 characters, with no emoji.')).toBeTruthy()
    expect(calls.some((c) => c.key === 'POST /groups')).toBe(false)
  })

  it('asks for a name instead of calling the API when it is blank', async () => {
    const calls = fakeApi({})
    renderApp('/groups/new')
    fireEvent.change(await screen.findByLabelText('Group name'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /Create group/ }))
    expect(await screen.findByText('Give the group a name.')).toBeTruthy()
    expect(calls.some((c) => c.key === 'POST /groups')).toBe(false)
  })

  it('shows the API error message when creating fails', async () => {
    fakeApi({ 'POST /groups': () => ({ status: 422, body: { error: { code: 'validation_failed', message: 'name: Too long' } } }) })
    renderApp('/groups/new')
    fireEvent.change(await screen.findByLabelText('Group name'), { target: { value: 'NYC' } })
    fireEvent.click(screen.getByRole('button', { name: /Create group/ }))
    expect(await screen.findByText('name: Too long')).toBeTruthy()
  })
})
