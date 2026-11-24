import { useOutletContext } from 'react-router-dom'
import { addReaction, prettyError, removeReaction } from '../lib/api'
import { feedText, relative } from '../lib/format'
import { useAction, useFeed } from '../lib/queries'
import type { FeedItem, Profile } from '../lib/types'
import { Avatar, Card, Empty, SectionTitle, Spinner } from '../components/ui'
import { useState } from 'react'

const EMOJIS = ['🔥', '👏', '😂']

export default function Feed() {
  const me = useOutletContext<Profile>()
  const feed = useFeed()
  const add = useAction((args: { feedId: number; emoji: string }) =>
    addReaction(args.feedId, me.id, args.emoji),
  )
  const remove = useAction((args: { feedId: number; emoji: string }) =>
    removeReaction(args.feedId, me.id, args.emoji),
  )
  const [error, setError] = useState<string | null>(null)

  async function toggle(item: FeedItem, emoji: string) {
    const mine = item.reactions.some((r) => r.emoji === emoji && r.member === me.id)
    try {
      if (mine) await remove.mutateAsync({ feedId: item.id, emoji })
      else await add.mutateAsync({ feedId: item.id, emoji })
      setError(null)
    } catch (e) {
      setError(prettyError(e))
    }
  }

  return (
    <div className="space-y-4">
      <SectionTitle action={<span className="text-xs text-mist-500">{me.family.name}</span>}>
        Что происходит
      </SectionTitle>

      {error && (
        <p className="rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm text-amber-200">
          {error}
        </p>
      )}

      {feed.isLoading && (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}

      {feed.data?.length === 0 && <Empty>Пока тихо. Выполни первую задачу — и здесь появится запись.</Empty>}

      <div className="space-y-2">
        {(feed.data ?? []).map((item) => {
          const text = feedText(item.kind, item.payload)
          return (
            <Card key={item.id} className="p-3.5">
              <div className="flex gap-3">
                <Avatar emoji={item.actor_emoji ?? '🙂'} color={item.actor_color ?? '#6aa8ff'} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug">
                    <span className="font-medium">{item.actor_name ?? 'Кто-то'}</span>{' '}
                    <span className="text-mist-300">{text}</span>
                  </p>
                  <div className="mt-0.5 text-xs text-mist-500">{relative(item.created_at)}</div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {EMOJIS.map((emoji) => {
                      const list = item.reactions.filter((r) => r.emoji === emoji)
                      const mine = list.some((r) => r.member === me.id)
                      return (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => void toggle(item, emoji)}
                          className={
                            'rounded-full border px-2 py-0.5 text-xs transition-colors ' +
                            (mine
                              ? 'border-accent/50 bg-accent-soft text-accent'
                              : 'border-white/10 bg-white/5 text-mist-300 hover:bg-white/10')
                          }
                        >
                          {emoji}
                          {list.length > 0 ? ` ${list.length}` : ''}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
