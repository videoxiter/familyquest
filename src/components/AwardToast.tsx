/** Всплывающая награда: «+15 🪙 · +18 опыта · Вынести мусор». */
export function AwardToast({
  award,
}: {
  award: { title: string; coins: number; xp: number; key: number } | null
}) {
  if (!award) return null

  return (
    <div
      key={award.key}
      className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4"
      role="status"
      aria-live="polite"
    >
      <div className="anim-award flex items-center gap-2 rounded-2xl border border-accent/50 bg-ink-800/95 px-4 py-2.5 text-sm shadow-xl">
        <span className="font-semibold text-accent">
          {award.coins > 0 ? `+${award.coins} 🪙` : 'без баллов'}
        </span>
        {award.xp > 0 && <span className="text-mist-300">+{award.xp} опыта</span>}
        <span className="text-mist-500">·</span>
        <span className="max-w-40 truncate text-mist-300">{award.title}</span>
      </div>
    </div>
  )
}
