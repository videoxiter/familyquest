export const CATEGORIES = [
  'дом',
  'кухня',
  'мусор',
  'уборка',
  'питомцы',
  'развитие',
  'семья',
  'бюрократия',
] as const

const EMOJI: Record<string, string> = {
  дом: '🏠',
  кухня: '🍳',
  мусор: '🗑️',
  уборка: '🧹',
  питомцы: '🐕',
  развитие: '📚',
  семья: '👨‍👩‍👦',
  бюрократия: '📄',
}

export function categoryEmoji(category: string | null | undefined): string {
  if (!category) return '📌'
  return EMOJI[category] ?? '📌'
}
