import { useEffect, useMemo } from 'react'
import { Art } from './Art'
import { Button } from './ui'

const COLORS = ['#6aa8ff', '#7ecb8f', '#f0f6fc', '#ffd166']

/** Праздник при повышении уровня: конфетти и карточка с новым званием. */
export function LevelUp({
  level,
  onDone,
}: {
  level: { idx: number; name: string }
  onDone: () => void
}) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 3200)
    return () => window.clearTimeout(timer)
  }, [onDone])

  const pieces = useMemo(
    () =>
      Array.from({ length: 30 }, (_, index) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.7,
        duration: 1.9 + Math.random() * 1.2,
        color: COLORS[index % COLORS.length],
        rotate: Math.random() * 180,
      })),
    [],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 px-6 backdrop-blur-sm"
      onClick={onDone}
      role="presentation"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {pieces.map((piece, index) => (
          <span
            key={index}
            className="confetti-piece"
            style={{
              left: `${piece.left}%`,
              top: 0,
              backgroundColor: piece.color,
              animationDelay: `${piece.delay}s`,
              animationDuration: `${piece.duration}s`,
              transform: `rotate(${piece.rotate}deg)`,
            }}
          />
        ))}
      </div>

      <div className="anim-celebrate w-full max-w-sm rounded-3xl border border-accent/40 bg-ink-900/95 p-6 text-center shadow-2xl">
        <Art
          src="./art/level-up.png"
          alt=""
          className="mx-auto mb-2 h-32 w-32 object-contain"
        />
        <div className="text-4xl">🏆</div>
        <div className="mt-3 text-sm tracking-wide text-mist-500 uppercase">Новый уровень</div>
        <div className="mt-1 text-2xl font-bold text-accent">{level.name}</div>
        <div className="mt-1 text-sm text-mist-500">{level.idx}-й уровень</div>
        <Button className="mt-5 w-full" onClick={onDone}>
          Идём дальше
        </Button>
      </div>
    </div>
  )
}
