import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import AccountPanel from '@/features/auth/AccountPanel'
const auth = vi.hoisted(() => ({ signInWithEmail: vi.fn(), resetPassword: vi.fn(), savePassword: vi.fn(), recoveringPassword: false }))
vi.mock('@/lib/supabase', () => ({ supabaseConfigured: () => true }))
vi.mock('@/features/auth/session', () => ({ useSession: () => ({ ready: true, session: null, ...auth }) }))
beforeEach(() => { cleanup(); vi.clearAllMocks(); auth.recoveringPassword = false; auth.savePassword.mockResolvedValue({ error: null }); auth.signInWithEmail.mockResolvedValue({ error: null }); auth.resetPassword.mockResolvedValue({ error: null }) })
it('submits a password instead of requesting an OTP', async () => {
 render(<AccountPanel />)
 const inputs = document.querySelectorAll('input')
 fireEvent.change(inputs[0]!, { target: { value: 'rep@example.com' } })
 fireEvent.change(inputs[1]!, { target: { value: 'unique-password' } })
 fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
 await waitFor(() => expect(auth.signInWithEmail).toHaveBeenCalledWith('rep@example.com', 'unique-password'))
 expect(auth.resetPassword).not.toHaveBeenCalled()
})
it('offers recovery with a non-enumerating confirmation', async () => {
 render(<AccountPanel />)
 fireEvent.change(document.querySelector('input')!, { target: { value: 'rep@example.com' } })
 fireEvent.click(screen.getByRole('button', { name: 'Set or reset password' }))
 await waitFor(() => expect(screen.getByRole('status').textContent).toContain('If this account exists'))
})
it('recovers from a network failure and enables retry', async () => {
 auth.signInWithEmail.mockRejectedValue(new Error('network'))
 render(<AccountPanel />)
 const inputs = document.querySelectorAll('input')
 fireEvent.change(inputs[0]!, { target: { value: 'rep@example.com' } })
 fireEvent.change(inputs[1]!, { target: { value: 'unique-password' } })
 fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
 await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Please try again'))
 expect(screen.getByRole('button', { name: 'Sign in' }).hasAttribute('disabled')).toBe(false)
})

it('shows recovery fields and saves only matching new passwords', async () => {
 auth.recoveringPassword = true
 render(<AccountPanel />)
 const inputs = document.querySelectorAll('input')
 expect(inputs).toHaveLength(2)
 fireEvent.change(inputs[0]!, { target: { value: 'new-password-123' } })
 fireEvent.change(inputs[1]!, { target: { value: 'different-password' } })
 expect(screen.getByRole('button', { name: 'Save password' }).hasAttribute('disabled')).toBe(true)
 fireEvent.change(inputs[1]!, { target: { value: 'new-password-123' } })
 fireEvent.click(screen.getByRole('button', { name: 'Save password' }))
 await waitFor(() => expect(auth.savePassword).toHaveBeenCalledWith('new-password-123'))
})
