// @tag:adult-role

export const ADULT_ROLES = ['admin', 'manager', 'member'] as const
export type AdultRole = typeof ADULT_ROLES[number]

/** A server without roles makes every adult an admin, the way its parents always were. */
export const roleOf = (adult: { adultRole?: AdultRole } | undefined): AdultRole => adult?.adultRole ?? 'admin'

export const roleAllows = (role: AdultRole, needed: AdultRole): boolean => ADULT_ROLES.indexOf(role) <= ADULT_ROLES.indexOf(needed)

export const ROLE_TITLES: Record<AdultRole, string> = {
  admin: 'Админ',
  manager: 'Управляющий',
  member: 'Член семьи'
}

export const ROLE_DESCRIPTIONS: Record<AdultRole, string> = {
  admin: 'всё: время, настройки, взрослые, приглашения, удаление семьи',
  manager: 'даёт время и настраивает, может выйти из семьи',
  member: 'только смотрит; может переименовать себя и выйти'
}

export const isAdultRole = (value: unknown): value is AdultRole => typeof value === 'string' && (ADULT_ROLES as readonly string[]).includes(value)
