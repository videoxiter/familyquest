// Склеивает миграции в один файл для вставки в Supabase SQL Editor.
// Запуск: npm run sql:bundle  →  supabase/apply_all.sql
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dir = join(root, 'supabase', 'migrations')

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

const parts = files.map((f) => {
  const body = readFileSync(join(dir, f), 'utf8')
  return `-- ═══════════════════════════════════════════════════════════════\n-- ${f}\n-- ═══════════════════════════════════════════════════════════════\n\n${body}`
})

const header = `-- FamilyQuest: единый файл миграций (сгенерирован, не редактировать вручную).
-- Источник: supabase/migrations/*.sql
-- Применение: Supabase → SQL Editor → вставить целиком → Run.
-- Файл можно применять повторно.

`

writeFileSync(join(root, 'supabase', 'apply_all.sql'), header + parts.join('\n\n'), 'utf8')
console.log(`apply_all.sql собран из ${files.length} файлов: ${files.join(', ')}`)
