# Push-уведомления — что уже готово и что сделать тебе

## Как работает

```
pg_cron (каждые 5 минут)
   └─ public.push_tick()
        ├─ ищет задачи с дедлайном в ближайший час
        ├─ помечает их в push_log (чтобы не повторяться)
        └─ отправляет список в Edge Function «push» через pg_net
                                            │
                                            ▼
                              Supabase Edge Function (Deno)
                               ├─ берёт подписки устройства из push_subscriptions
                               ├─ подписывает VAPID-ключом
                               └─ шлёт уведомление в браузер
                                            │
                                            ▼
                              service worker показывает пуш
```

Без Telegram и без серверов. Android — работает в браузере; iPhone — только если приложение
добавлено на экран «Домой» (iOS 16.4+).

## Что уже сделано (в коде)

- Таблица `push_subscriptions`, журнал `push_log`, функции `push_subscribe`,
  `push_unsubscribe`, `my_push_state`, `push_test`, `push_tick` — [0006_push.sql](supabase/migrations/0006_push.sql).
- Расписание `fq-push-tick` каждые 5 минут.
- Обработчик `push` и `notificationclick` в service worker.
- Экран «Прогресс» → «Уведомления»: включить / выключить / тестовое (родителю).
- Edge Function-отправитель: [supabase/functions/push/index.ts](supabase/functions/push/index.ts).
- VAPID-ключи сгенерированы: `.secrets/vapid.json` (папка в `.gitignore`).

## Шаг 1. Ключи

Открой файл `G:\LMStudio\VSCode\Projects\HomeWork\.secrets\vapid.json`. Там:

```json
{ "publicKey": "BD_...", "privateKey": "Wx...", "createdAt": "..." }
```

Публичный ключ — `BD_...` (он не секрет, попадает в браузер).
Приватный — `Wx...` (секрет, никому не показывай).

## Шаг 2. Переменная сборки (GitHub)

https://github.com/videoxiter/familyquest/settings/variables/actions → **New repository variable**:

| Name | Value |
|---|---|
| `VITE_VAPID_PUBLIC_KEY` | `publicKey` из файла |

После этого пересобери сайт: **Actions → Деплой на GitHub Pages → Run workflow**.

## Шаг 3. Функция в Supabase

1. Открой https://supabase.com/dashboard/project/zjnzttxuzdfhebudnjzm/functions
2. **Deploy a new function** → **Via Editor** (или «Create a new function»).
3. Название: **`push`** (ровно так).
4. Удали шаблонный код и вставь содержимое [supabase/functions/push/index.ts](supabase/functions/push/index.ts).
5. **Deploy**.
6. Выключи проверку JWT для этой функции, иначе cron не пройдёт: в настройках функции
   найди **Enforce JWT verification** и выключи (защита у нас своя — заголовок `x-push-secret`).

## Шаг 4. Секреты функции

https://supabase.com/dashboard/project/zjnzttxuzdfhebudnjzm/settings/functions → **Secrets** →
добавь четыре:

| Имя | Значение |
|---|---|
| `VAPID_PUBLIC_KEY` | `publicKey` из файла |
| `VAPID_PRIVATE_KEY` | `privateKey` из файла |
| `VAPID_SUBJECT` | `mailto:твой@email` |
| `PUSH_SECRET` | придумай длинный пароль (32+ символа) |

## Шаг 5. Связать базу с функцией

SQL Editor → выполни (подставь свой адрес функции и тот же `PUSH_SECRET`):

```sql
insert into public.app_settings (key, value)
values ('push_function', jsonb_build_object(
  'url', 'https://zjnzttxuzdfhebudnjzm.supabase.co/functions/v1/push',
  'secret', 'ТОТ_ЖЕ_PUSH_SECRET'
))
on conflict (key) do update set value = excluded.value, updated_at = now();
```

## Шаг 6. Проверка

1. На телефоне открой https://videoxiter.github.io/familyquest/
   - **Android:** можно сразу, но лучше «Установить приложение».
   - **iPhone:** обязательно «Поделиться» → «На экран Домой», и открывать с иконки.
2. Прогресс → **Уведомления** → **Включить** → разреши уведомления.
3. Родитель: **Отправить тестовое уведомление** → должно прийти в течение пары секунд.
4. Если не пришло — смотри логи функции: Supabase → Edge Functions → `push` → Logs.

## Автоматические напоминания

`push_tick()` сам находит задачи, до дедлайна которых меньше часа, и отправляет
каждому исполнителю: «Скоро дедлайн · Вынести мусор — до 19:30». Повторов не будет —
задача помечается в `push_log`.

Проверить руками:

```sql
select public.push_tick();
select * from public.push_log order by created_at desc limit 10;
```

## Что можно добавить дальше

- Уведомление «в очереди появилась новая задача» (сейчас только напоминания о сроке).
- Утренний дайджест «твои задачи на сегодня» в 8:00.
- Недельный итог в воскресенье.
