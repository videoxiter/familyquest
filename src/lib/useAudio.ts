import { useSyncExternalStore } from 'react'
import { getMusicEnabled, getSoundEnabled, subscribeAudio } from './audio'

/** Текущее состояние переключателей звука, синхронное между компонентами. */
export function useAudio() {
  const music = useSyncExternalStore(subscribeAudio, getMusicEnabled, () => false)
  const sound = useSyncExternalStore(subscribeAudio, getSoundEnabled, () => true)
  return { music, sound }
}
