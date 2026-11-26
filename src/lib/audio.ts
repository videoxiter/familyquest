/**
 * Звук в приложении: фоновая музыка, эффекты событий и голосовые реплики членов семьи.
 *
 * Правила:
 *  - музыка и звуки включаются независимо, выбор запоминается в localStorage;
 *  - браузеры не дают играть звук до первого касания, поэтому unlockAudio()
 *    вызывается на первый клик/клавишу;
 *  - голос звучит только от другого члена семьи (свой голос человек не слышит);
 *  - если файла нет — просто тишина, никаких ошибок в консоли.
 */

const MUSIC_KEY = 'fq:music'
const SOUND_KEY = 'fq:sound'

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : raw === '1'
  } catch {
    return fallback
  }
}

let musicEnabled = readFlag(MUSIC_KEY, false)
let soundEnabled = readFlag(SOUND_KEY, true)

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

export function subscribeAudio(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export const getMusicEnabled = () => musicEnabled
export const getSoundEnabled = () => soundEnabled

let music: HTMLAudioElement | null = null

function musicElement(): HTMLAudioElement {
  if (!music) {
    music = new Audio('./audio/music-loop.wav')
    music.loop = true
    music.volume = 0.18
    music.preload = 'none'
  }
  return music
}

function startMusic() {
  void musicElement().play().catch(() => undefined)
}

function stopMusic() {
  music?.pause()
}

export function setMusicEnabled(on: boolean): void {
  musicEnabled = on
  try {
    localStorage.setItem(MUSIC_KEY, on ? '1' : '0')
  } catch {
    /* приватный режим — просто не запоминаем */
  }
  emit()
  if (on) startMusic()
  else stopMusic()
}

export function setSoundEnabled(on: boolean): void {
  soundEnabled = on
  try {
    localStorage.setItem(SOUND_KEY, on ? '1' : '0')
  } catch {
    /* приватный режим */
  }
  emit()
  if (on) playSound('award')
}

// ───────────────────────────── эффекты ─────────────────────────────────────

export type SoundName =
  | 'award'
  | 'levelup'
  | 'claim'
  | 'release'
  | 'approve'
  | 'reject'
  | 'remind'
  | 'badge'

const sfxCache = new Map<SoundName, HTMLAudioElement>()

export function playSound(name: SoundName): void {
  if (!soundEnabled) return

  let element = sfxCache.get(name)
  if (!element) {
    element = new Audio(`./audio/sfx/${name}.wav`)
    element.volume = 0.55
    element.preload = 'auto'
    sfxCache.set(name, element)
  }

  try {
    element.currentTime = 0
  } catch {
    /* ещё не загрузился — не страшно */
  }
  void element.play().catch(() => undefined)
}

// ───────────────────────────── голоса ──────────────────────────────────────

type VoiceMap = Record<string, string>

let voiceMap: VoiceMap = {}
let voiceLoad: Promise<void> | null = null

/** manifest.json собирается скриптом scripts/scan-voices.mjs из файлов в public/audio/voice. */
export function loadVoices(): Promise<void> {
  if (voiceLoad) return voiceLoad

  voiceLoad = fetch('./audio/voice/manifest.json')
    .then((response) => (response.ok ? response.json() : {}))
    .then((data: unknown) => {
      voiceMap = data && typeof data === 'object' ? (data as VoiceMap) : {}
    })
    .catch(() => {
      voiceMap = {}
    })

  return voiceLoad
}

const SPEAKERS = ['papa', 'mama', 'alyosha']

/** Все события, для которых существуют голосовые реплики (проверяется скриптом voices). */
export const VOICE_EVENTS = [
  'task_done',
  'task_claimed',
  'task_approved',
  'task_rejected',
  'task_late',
  'level_up',
  'achievement',
  'streak_7',
  'daily_reminder',
] as const

/**
 * На каждое событие человек слышит ДВУХ других членов семьи:
 * первый говорит реплику «1», второй — реплику «2».
 * Файлы называются <событие>-<1|2>-<говорящий>.wav, поэтому свой голос не звучит.
 */
export function playVoice(
  event: string,
  listenerLogin: string | null,
  _actorLogin: string | null = null,
): void {
  if (!soundEnabled) return
  if (Object.keys(voiceMap).length === 0) return

  const others = SPEAKERS.filter((speaker) => speaker !== listenerLogin)
  const first = others[0]
  const second = others[1]

  const line1 =
    voiceMap[`${event}-1-${first}`] ?? (second ? voiceMap[`${event}-1-${second}`] : undefined)
  const line2 =
    voiceMap[`${event}-2-${second}`] ?? (first ? voiceMap[`${event}-2-${first}`] : undefined)

  const sequence = [line1, line2].filter((url): url is string => Boolean(url))
  if (sequence.length === 0) return

  // Приглушаем музыку, пока говорят, и возвращаем громкость в конце.
  const ducked = music
  const previousVolume = ducked?.volume ?? 0
  if (ducked) ducked.volume = 0.05

  const restore = () => {
    if (ducked) ducked.volume = previousVolume
  }

  const playAt = (index: number) => {
    if (index >= sequence.length) {
      restore()
      return
    }

    const voice = new Audio(sequence[index])
    voice.addEventListener('ended', () => window.setTimeout(() => playAt(index + 1), 200), {
      once: true,
    })
    voice.addEventListener('error', () => playAt(index + 1), { once: true })
    void voice.play().catch(() => playAt(index + 1))
  }

  playAt(0)
}

// ───────────────────────────── разблокировка ───────────────────────────────

let unlocked = false

/** Вызывается на первое касание: браузер разрешает звук только после жеста. */
export function unlockAudio(): void {
  if (unlocked) return
  unlocked = true
  if (musicEnabled) startMusic()
  void loadVoices()
}
