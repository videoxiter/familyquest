// Генерирует пару VAPID-ключей для web-push и кладёт их в .secrets/vapid.json
// (папка в .gitignore). Запуск: npm run vapid
//
// Публичный ключ — его можно показывать, он уезжает в браузер.
// Приватный — секрет: только в Supabase → Edge Functions → Secrets.
import { createECDH } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dir = join(root, '.secrets')
const file = join(dir, 'vapid.json')

const b64url = (buffer) =>
  Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

if (existsSync(file)) {
  const existing = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(file, 'utf8')))
  console.log('Ключи уже есть, не перезаписываю.')
  console.log(`публичный: ${existing.publicKey}`)
  process.exit(0)
}

const ecdh = createECDH('prime256v1')
ecdh.generateKeys()

const keys = {
  publicKey: b64url(ecdh.getPublicKey()),
  privateKey: b64url(ecdh.getPrivateKey()),
  createdAt: new Date().toISOString(),
}

mkdirSync(dir, { recursive: true })
writeFileSync(file, `${JSON.stringify(keys, null, 2)}\n`, 'utf8')

console.log(`Ключи записаны в ${file}`)
console.log('')
console.log(`VAPID_PUBLIC_KEY  = ${keys.publicKey}`)
console.log('VAPID_PRIVATE_KEY = (в файле, в чат не выводится)')
