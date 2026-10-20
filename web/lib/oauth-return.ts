/** sessionStorage keys so an X OAuth round-trip can resume the screen that started it. */
export const OAUTH_RETURN_KEY = 'tc_oauth_return'
export const OAUTH_TASK_KEY = 'tc_oauth_task'

export function rememberOauthReturn(path: string, task?: string) {
  sessionStorage.setItem(OAUTH_RETURN_KEY, path)
  if (task) sessionStorage.setItem(OAUTH_TASK_KEY, task)
  else sessionStorage.removeItem(OAUTH_TASK_KEY)
}
