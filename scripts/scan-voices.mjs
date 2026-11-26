// Собирает манифест голосовых реплик: public/audio/voice/manifest.json
// Запуск: npm run voices
// Имя файла: <событие>-<говорящий>.<ext>, например task_done-mama.mp3
import { mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dir = join(root, 'public', 'audio', 'voice')
const out = join(dir, 'manifest.json')

mkdirSync(dir, { recursive: true })

const ALLOWED = new Set(['mp3', 'wav', 'ogg', 'm4a', 'webm'])

let files = []
try {
  files = readdirSync(dir).filter((file) => {
    const ext = file.split('.').pop()?.toLowerCase() ?? ''
    return ALLOWED.has(ext) && file !== 'manifest.json'
  })
} catch {
  console.log('папки public/audio/voice ещё нет — манифест будет пустым')
}

const manifest = {}
const skipped = []

for (const file of files.sort()) {
  const base = file.replace(/\.[^.]+$/, '')
  // <событие>-<1|2>-<говорящий>, например task_done-2-alyosha
  const match = base.match(/^([a-z0-9_]+)-([12])-(papa|mama|alyosha)$/i)
  if (!match) {
    skipped.push(file)
    continue
  }
  const [, event, line, speaker] = match
  manifest[`${event.toLowerCase()}-${line}-${speaker.toLowerCase()}`] = `./audio/voice/${file}`
}

// Предупреждение о слишком больших файлах
for (const file of files) {
  const size = statSync(join(dir, file)).size
  if (size > 600 * 1024) {
    console.log(`⚠ ${file} — ${Math.round(size / 1024)} КБ, реплика должна быть короткой`)
  }
}

writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

const count = Object.keys(manifest).length
console.log(`манифест: ${count} реплик`)
if (skipped.length > 0) {
  console.log(`пропущены (имя не по схеме <событие>-<1|2>-<papa|mama|alyosha>): ${skipped.join(', ')}`)
}

// Сверяемся со списком VOICE_EVENTS из src/lib/audio.ts
const audioSource = readFileSync(join(root, 'src', 'lib', 'audio.ts'), 'utf8')
const eventsBlock = audioSource.match(/VOICE_EVENTS\s*=\s*\[([\s\S]*?)\]/)
const known = new Set(
  (eventsBlock?.[1] ?? '').match(/'([a-z0-9_]+)'/g)?.map((item) => item.replace(/'/g, '')) ?? [],
)
const unknown = [
  ...new Set(
    Object.keys(manifest).map((key) => key.replace(/-[12]-(papa|mama|alyosha)$/, '')),
  ),
].filter((event) => !known.has(event))
if (unknown.length > 0) {
  console.log(`⚠ неизвестные события (в коде таких нет): ${unknown.join(', ')}`)
}
