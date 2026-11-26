// Проверка Edge Function (Deno) без установленного Deno.
// TypeScript разбирает файл и сообщает только про неизвестные "Deno" и "npm:" —
// значит синтаксис цел. Любая другая ошибка означает настоящую проблему.
// Запуск: npm run test:edge
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const target = join(root, 'supabase', 'functions', 'push', 'index.ts')
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')

const ALLOWED = new Set([
  2307, // Cannot find module 'npm:...' — нормально вне Deno
  2304, // Cannot find name 'Deno' — нормально вне Deno
])

let output = ''
try {
  output = execFileSync(
    process.execPath,
    [
      tsc,
      '--noEmit',
      '--skipLibCheck',
      '--target',
      'ES2022',
      '--module',
      'ESNext',
      '--moduleResolution',
      'bundler',
      '--lib',
      'ES2022,DOM',
      target,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
} catch (error) {
  output = `${error.stdout ?? ''}${error.stderr ?? ''}`
}

const problems = output
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const match = line.match(/^(.*?)\((\d+),(\d+)\): error TS(\d+): (.*)$/)
    if (!match) return null
    return { file: match[1], line: match[2], code: Number(match[4]), message: match[5] }
  })
  .filter((item) => item !== null)

const unexpected = problems.filter((problem) => !ALLOWED.has(problem.code))

if (unexpected.length > 0) {
  console.log('✗ edge-функция содержит настоящие ошибки:')
  for (const problem of unexpected) {
    console.log(`  ${problem.line}: TS${problem.code} — ${problem.message}`)
  }
  process.exit(1)
}

console.log(
  `✓ edge-функция разбирается без синтаксических ошибок (пропущено ${problems.length} ошибок окружения Deno)`,
)
