export default defineNuxtRouteMiddleware(() => {
  const { loggedIn } = useUserSession()
  if (loggedIn.value) {
    const token = useRoute().query.invite
    if (typeof token === 'string' && token) return navigateTo(`/invite/${token}`)
    return navigateTo('/')
  }
})
