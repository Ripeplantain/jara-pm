import { requireUser } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => requireUser(event))
