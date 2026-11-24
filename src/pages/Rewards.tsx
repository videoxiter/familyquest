import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { prettyError, redeemReward } from '../lib/api'
import { useAction, useRewards } from '../lib/queries'
import type { Profile } from '../lib/types'
import { Badge, Button, Card, Empty, SectionTitle, Spinner } from '../components/ui'

const TIER_LABEL: Record<string, string> = {
  micro: 'маленький',
  medium: 'средний',
  global: 'большой',
}

export default function Rewards() {
  const me = useOutletContext<Profile>()
  const bundle = useRewards()
  const redeem = useAction<string, { redemption_id: string; coins_spent: number }>(redeemReward)
  const [flash, setFlash] = useState<string | null>(null)

  async function onRedeem(id: string, title: string, price: number) {
    try {
      await redeem.mutateAsync(id)
      setFlash(`«${title}» — твой. Списано ${price} 🪙. Скажи родителям, они подтвердят.`)
      window.setTimeout(() => setFlash(null), 4000)
    } catch (e) {
      setFlash(prettyError(e))
      window.setTimeout(() => setFlash(null), 4000)
    }
  }

  const items = bundle.data?.rewards ?? []
  const redemptions = bundle.data?.redemptions ?? []

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-mist-500">В кошельке</span>
          <span className="text-2xl font-semibold text-accent">{me.coins} 🪙</span>
        </div>
        <p className="mt-1 text-xs text-mist-500">
          Монеты нельзя увести в минус: тратишь только то, что заработал.
        </p>
      </Card>

      {flash && (
        <div className="animate-pop rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-accent">
          {flash}
        </div>
      )}

      <section>
        <SectionTitle>Что можно обменять</SectionTitle>
        {bundle.isLoading && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}
        {items.length === 0 && !bundle.isLoading && <Empty>Родители ещё не добавили призы.</Empty>}

        <div className="space-y-2">
          {items.map((reward) => {
            const affordable = me.coins >= reward.price_coins
            return (
              <Card key={reward.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{reward.title}</h3>
                      <Badge tone="muted">{TIER_LABEL[reward.tier] ?? reward.tier}</Badge>
                    </div>
                    {reward.description && (
                      <p className="mt-1 text-sm text-mist-500">{reward.description}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-accent">
                    {reward.price_coins} 🪙
                  </span>
                </div>
                <Button
                  className="mt-3 w-full"
                  variant={affordable ? 'primary' : 'soft'}
                  disabled={!affordable || redeem.isPending}
                  onClick={() => void onRedeem(reward.id, reward.title, reward.price_coins)}
                >
                  {affordable
                    ? 'Обменять'
                    : `Не хватает ${reward.price_coins - me.coins} 🪙`}
                </Button>
              </Card>
            )
          })}
        </div>
      </section>

      {redemptions.length > 0 && (
        <section>
          <SectionTitle>Мои обмены</SectionTitle>
          <div className="space-y-1.5">
            {redemptions.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate">{item.title}</span>
                <span className="shrink-0 text-xs text-mist-500">{item.coins_spent} 🪙</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
