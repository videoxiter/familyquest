/**
 * Web push: подписка устройства на уведомления.
 *
 * Работает без Telegram: Android Chrome — сразу; iPhone — только если приложение
 * добавлено на экран «Домой» (iOS 16.4+).
 */
import { supabase } from './supabase'

const vapidKey = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim()

export const pushConfigured = Boolean(vapidKey)

export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index)
  }
  return output
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  return (await navigator.serviceWorker.getRegistration()) ?? null
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration()
  if (!reg) return null
  return reg.pushManager.getSubscription()
}

export type PushResult = { ok: boolean; message: string }

export async function enablePush(): Promise<PushResult> {
  if (!pushConfigured) {
    return { ok: false, message: 'На сборке нет публичного ключа уведомлений' }
  }
  if (!pushSupported()) {
    return { ok: false, message: 'Этот браузер не поддерживает уведомления' }
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false, message: 'Уведомления запрещены в настройках браузера' }
  }

  const reg = await registration()
  if (!reg) {
    return { ok: false, message: 'Приложение ещё не установлено на устройство' }
  }

  const existing = await reg.pushManager.getSubscription()
  const subscription =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey as string),
    }))

  const json = subscription.toJSON()
  const { error } = await supabase.rpc('push_subscribe', {
    p_endpoint: subscription.endpoint,
    p_p256dh: json.keys?.p256dh ?? '',
    p_auth: json.keys?.auth ?? '',
    p_agent: navigator.userAgent,
  })

  if (error) return { ok: false, message: error.message }
  return { ok: true, message: 'Уведомления включены' }
}

export async function disablePush(): Promise<PushResult> {
  const subscription = await currentSubscription()
  if (!subscription) return { ok: true, message: 'Уведомления и так выключены' }

  await supabase.rpc('push_unsubscribe', { p_endpoint: subscription.endpoint })
  await subscription.unsubscribe()
  return { ok: true, message: 'Уведомления выключены' }
}

export async function sendTestPush(): Promise<PushResult> {
  const { error } = await supabase.rpc('push_test', { p_member: null })
  if (error) return { ok: false, message: error.message }
  return { ok: true, message: 'Тестовое уведомление отправлено' }
}
