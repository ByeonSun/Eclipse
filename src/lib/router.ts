// GitHub Pages 하위 경로와 새로고침에 안전한 해시 라우팅: https://user.github.io/repo/#/sheet?period=week
import { useSyncExternalStore } from 'react'

export interface Route {
  path: string
  segments: string[]
  query: URLSearchParams
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/'
  const [p, q = ''] = raw.split('?')
  const path = p.startsWith('/') ? p : `/${p}`
  return { path, segments: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) }
}

let current = parse(typeof window !== 'undefined' ? window.location.hash : '')
const subs = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    current = parse(window.location.hash)
    subs.forEach((f) => f())
  })
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => current,
  )
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const hash = to.startsWith('#') ? to : `#${to}`
  if (opts.replace) {
    history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}${hash}`)
    current = parse(hash)
    subs.forEach((f) => f())
  } else {
    window.location.hash = hash
  }
}

export function href(to: string): string {
  return `#${to}`
}
