import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Resend } from 'resend'
import { sendInviteEmail } from '../server/services/mailer'

const resendSend = vi.hoisted(() => vi.fn())
vi.mock('resend', () => ({
  Resend: vi.fn(function MockResend() {
    return { emails: { send: resendSend } }
  }),
}))

describe('invite mailer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resendSend.mockReset()
  })

  it('skips sending when Resend configuration is incomplete', async () => {
    await expect(sendInviteEmail({
      to: 'member@example.test',
      inviterName: 'Owner',
      workspaceName: 'Kobi team',
      acceptUrl: 'https://kobi.test/invite/token',
    })).resolves.toEqual({ sent: false })
    expect(Resend).not.toHaveBeenCalled()
  })

  it('reports successful provider sends and passes the invite payload', async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null })
    resendSend.mockImplementation(send)

    await expect(sendInviteEmail({
      to: 'member@example.test',
      inviterName: 'Owner',
      workspaceName: 'Kobi team',
      acceptUrl: 'https://kobi.test/invite/token',
      apiKey: 'resend-key',
      from: 'Kobi <noreply@kobi.test>',
    })).resolves.toEqual({ sent: true })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      from: 'Kobi <noreply@kobi.test>',
      to: ['member@example.test'],
      subject: 'Owner invited you to Kobi team on Kobi',
      text: expect.stringContaining('https://kobi.test/invite/token'),
    }))
  })

  it('converts provider errors and exceptions into an unsent result', async () => {
    resendSend
      .mockResolvedValueOnce({ data: null, error: { message: 'rejected' } })
      .mockRejectedValueOnce(new Error('network failure'))
    const input = {
      to: 'member@example.test',
      inviterName: 'Owner',
      workspaceName: 'Kobi team',
      acceptUrl: 'https://kobi.test/invite/token',
      apiKey: 'resend-key',
      from: 'Kobi <noreply@kobi.test>',
    }

    await expect(sendInviteEmail(input)).resolves.toEqual({ sent: false })
    await expect(sendInviteEmail(input)).resolves.toEqual({ sent: false })
  })
})
