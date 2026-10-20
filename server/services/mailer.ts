import { Resend } from 'resend'

export type InviteEmailInput = {
  to: string
  inviterName: string
  workspaceName: string
  acceptUrl: string
  apiKey?: string
  from?: string
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character] ?? character))

export const sendInviteEmail = async ({ to, inviterName, workspaceName, acceptUrl, apiKey, from }: InviteEmailInput) => {
  if (!apiKey || !from) {
    console.warn('[mailer] Invite email skipped because Resend is not configured')
    return { sent: false }
  }

  try {
    const safeUrl = new URL(acceptUrl)
    if (safeUrl.protocol !== 'http:' && safeUrl.protocol !== 'https:') throw new Error('Invite URL must use http or https')
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({
      from,
      to: [to],
      subject: `${inviterName} invited you to ${workspaceName} on Kobi`,
      text: `${inviterName} invited you to join ${workspaceName} on Kobi. Accept the invitation: ${acceptUrl}`,
      html: `<p>${escapeHtml(inviterName)} invited you to join <strong>${escapeHtml(workspaceName)}</strong> on Kobi.</p><p><a href="${escapeHtml(safeUrl.toString())}">Accept invitation</a></p>`,
    })
    if (error) {
      console.warn('[mailer] Invite email failed', error)
      return { sent: false }
    }
    return { sent: Boolean(data?.id) }
  } catch (error) {
    console.warn('[mailer] Invite email failed', error)
    return { sent: false }
  }
}
