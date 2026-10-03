// @tag:parent-console

/** The server keeps a category title and a tablet name in the same VARCHAR(255) column: 255 characters, counted as code points. */
export const LABEL_MAX = 255

/** Why a name will not do, in words for the parent; null when it will. The name is the parent's own — never translated. */
export function labelProblem (label: string): string | null {
  const trimmed = label.trim()
  if (trimmed === '') return 'Название не может быть пустым.'
  const length = [...trimmed].length
  if (length > LABEL_MAX) return `Не длиннее ${LABEL_MAX} знаков, сейчас ${length}.`
  return null
}
