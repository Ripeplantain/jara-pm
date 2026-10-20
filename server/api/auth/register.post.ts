import { registerSchema } from '#shared/schemas/auth'
import { createUserWithPersonalWorkspace } from '~~/server/services/auth'
import { acceptInvite, inspectInvite } from '~~/server/services/workspace-invites'
import { useDatabase } from '~~/server/utils/database'
import { captureServerEvent } from '~~/server/utils/posthog'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, registerSchema.parse)
  const db = useDatabase(event)
  if (body.inviteToken) {
    const invite = inspectInvite(db, body.inviteToken)
    if (invite.status !== 'valid' || invite.email !== body.email) {
      throw createError({ status: 422, statusText: 'Invite is invalid or does not match this email' })
    }
  }
  const passwordHash = await hashPassword(body.password)
  let user: { id: string, email: string, name: string }

  try {
    user = createUserWithPersonalWorkspace(db, {
      email: body.email,
      name: body.name,
      passwordHash,
    }).user
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      throw createError({ status: 409, statusText: 'Email already registered' })
    }
    throw error
  }

  await setUserSession(event, { user, loggedInAt: new Date().toISOString() })
  if (body.inviteToken) {
    acceptInvite(db, user, body.inviteToken)
    captureServerEvent(event, user.id, 'invite_accepted')
  }
  captureServerEvent(event, user.id, 'user_signed_up', { method: 'password' })
  setResponseStatus(event, 201)
  return user
})
