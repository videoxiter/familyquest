import { useState } from 'react'

/**
 * Картинка, которую можно дорисовать позже: если файла нет — просто ничего не рисуем,
 * верстка не ломается. Файлы кладутся в public/art/ (см. ART.md).
 */
export function Art({
  src,
  alt,
  className,
}: {
  src: string
  alt: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  if (failed) return null

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}
