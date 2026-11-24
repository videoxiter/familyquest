import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  achievementsFor,
  adminQueue,
  familyFeed,
  ledgerFor,
  levels,
  loginMembers,
  myProfile,
  myToday,
  rewardsBundle,
} from './api'

export function useProfile(enabled = true) {
  return useQuery({
    queryKey: ['profile'],
    queryFn: myProfile,
    enabled,
    staleTime: 10_000,
  })
}

export function useLoginMembers() {
  return useQuery({
    queryKey: ['login-members'],
    queryFn: loginMembers,
    staleTime: 60_000,
  })
}

export function useToday() {
  return useQuery({ queryKey: ['today'], queryFn: () => myToday(null) })
}

export function useFeed() {
  return useQuery({ queryKey: ['feed'], queryFn: () => familyFeed(40) })
}

export function useAdminQueue(enabled: boolean) {
  return useQuery({ queryKey: ['admin-queue'], queryFn: adminQueue, enabled })
}

export function useRewards() {
  return useQuery({ queryKey: ['rewards'], queryFn: rewardsBundle })
}

export function useLevels() {
  return useQuery({ queryKey: ['levels'], queryFn: levels, staleTime: Infinity })
}

export function useAchievements(memberId: string | null) {
  return useQuery({
    queryKey: ['achievements', memberId],
    queryFn: () => achievementsFor(memberId as string),
    enabled: Boolean(memberId),
  })
}

export function useLedger(memberId: string | null) {
  return useQuery({
    queryKey: ['ledger', memberId],
    queryFn: () => ledgerFor(memberId as string),
    enabled: Boolean(memberId),
  })
}

/** Действие, после которого обновляем всё: приложение маленькое, кэш дешевле сбросить. */
export function useAction<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries()
    },
  })
}
