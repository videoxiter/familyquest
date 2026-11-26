// FamilyQuest · Edge Function «push» — рассылка web-push уведомлений.
//
// Деплой: Supabase Dashboard → Edge Functions → Deploy a new function → имя `push`
//         → вставить этот файл → Deploy.
// Секреты (Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  — из .secrets/vapid.json
//   VAPID_SUBJECT                        — mailto:твой@адрес
//   PUSH_SECRET                          — любой длинный пароль, тот же, что в app_settings
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY подставляются автоматически.
//
// Вызов: POST /functions/v1/push
//   заголовок x-push-secret: <PUSH_SECRET>
//   тело {"items":[{"member_id":"...","title":"...","body":"...","url":"./#/today"}]}

import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:family@familyquest.local'
const PUSH_SECRET = Deno.env.get('PUSH_SECRET')!

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

const restHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
}

type Item = { member_id: string; title: string; body: string; url?: string }

async function subscriptionsFor(memberId: string) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/push_subscriptions?select=endpoint,p256dh,auth&member_id=eq.${memberId}`,
    { headers: restHeaders },
  )
  if (!response.ok) return []
  return (await response.json()) as { endpoint: string; p256dh: string; auth: string }[]
}

async function dropSubscription(endpoint: string) {
  await fetch(
    `${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`,
    { method: 'DELETE', headers: restHeaders },
  )
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 })
  }

  if (!PUSH_SECRET || request.headers.get('x-push-secret') !== PUSH_SECRET) {
    return new Response('forbidden', { status: 403 })
  }

  let items: Item[] = []
  try {
    const body = await request.json()
    items = Array.isArray(body?.items) ? body.items : []
  } catch {
    return new Response('bad json', { status: 400 })
  }

  let sent = 0
  let removed = 0
  const errors: string[] = []

  for (const item of items) {
    const subscriptions = await subscriptionsFor(item.member_id)
    if (subscriptions.length === 0) continue

    const payload = JSON.stringify({
      title: item.title,
      body: item.body,
      url: item.url ?? './#/today',
    })

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
        )
        sent += 1
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          await dropSubscription(subscription.endpoint)
          removed += 1
        } else {
          errors.push(`${status ?? 'error'}: ${(error as Error).message}`)
        }
      }
    }
  }

  return new Response(JSON.stringify({ sent, removed, errors }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
