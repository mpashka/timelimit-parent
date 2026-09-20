// @tag:parent-console

/**
 * What the browser is allowed to remember: nothing secret. The parent session lives in an
 * HttpOnly cookie the page never sees, the family state lives in the BFF
 * (docs/implementation/web-admin.md, "Вход и где лежит секрет").
 */

const PREFIX = 'tlp.'

/** Keys of the console that kept the device token and the family state in the browser. */
const LEGACY_KEYS = ['auth', 'state', 'sequenceNumber']

export const readLocal = (key: string): string | null => localStorage.getItem(PREFIX + key)
export const writeLocal = (key: string, value: string): void => localStorage.setItem(PREFIX + key, value)

export function clearLocal (): void {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(PREFIX)) localStorage.removeItem(key)
  }
}

export const forgetLegacySecrets = (): void => LEGACY_KEYS.forEach((key) => localStorage.removeItem(PREFIX + key))

export function countAdvancedOpened (): void {
  localStorage.setItem('advancedOpened', String(Number(localStorage.getItem('advancedOpened') ?? '0') + 1))
}
