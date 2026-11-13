// 빌드 산출물(dist)에 비밀 키가 섞여 들어가지 않았는지 확인한다.
//  - sb_secret_ 로 시작하는 실제 키
//  - role 이 service_role 인 JWT
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? 'dist'
const files = []
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(js|html|css|json|map|txt)$/.test(f)) files.push(p)
  }
}
walk(root)

let bad = 0
for (const f of files) {
  const text = readFileSync(f, 'utf8')
  if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(text)) {
    console.error(`::error file=${f}::sb_secret_ key found`)
    bad++
  }
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]+/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'))
      if (payload.role === 'service_role') {
        console.error(`::error file=${f}::service_role JWT found`)
        bad++
      }
    } catch {
      /* JWT 형태가 아니면 무시 */
    }
  }
}
if (bad) process.exit(1)
console.log(`checked ${files.length} files: no secret keys`)
