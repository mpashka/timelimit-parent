// @tag:category-limits

/** The server keeps a category title in a VARCHAR(255) column: 255 characters, counted as code points. */
export const CATEGORY_TITLE_MAX = 255

/** Why a title will not do, in words for the parent; null when it will. The title is the parent's own — never translated. */
export function categoryTitleProblem (title: string): string | null {
  const trimmed = title.trim()
  if (trimmed === '') return 'Название не может быть пустым.'
  const length = [...trimmed].length
  if (length > CATEGORY_TITLE_MAX) return `Не длиннее ${CATEGORY_TITLE_MAX} знаков, сейчас ${length}.`
  return null
}
