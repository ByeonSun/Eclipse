import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { fetchRoster, type Member } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { buildRosterIndex, type RosterIndex, type RosterMember } from '../lib/matching'

interface RosterCtx {
  members: Member[]
  byId: Map<string, Member>
  rosterForMatch: RosterMember[]
  index: RosterIndex
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

const Ctx = createContext<RosterCtx | null>(null)

export function RosterProvider({ children }: { children: ReactNode }) {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const reload = useCallback(async () => {
    const my = ++seq.current
    setLoading(true)
    try {
      const rows = await fetchRoster()
      if (my === seq.current) {
        setMembers(rows)
        setError(null)
      }
    } catch (e) {
      if (my === seq.current) setError(errorMessage(e))
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const value = useMemo(() => {
    const rosterForMatch: RosterMember[] = members.map((m) => ({
      id: m.id,
      nickname: m.nickname,
      aliases: m.member_aliases.map((a) => a.alias),
      archived: !!m.archived_at,
    }))
    return {
      members,
      byId: new Map(members.map((m) => [m.id, m])),
      rosterForMatch,
      index: buildRosterIndex(rosterForMatch),
      loading,
      error,
      reload,
    }
  }, [members, loading, error, reload])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRoster(): RosterCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('RosterProvider 가 없습니다.')
  return c
}
