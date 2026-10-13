// Receipt storage API in front of Cloudflare R2. Everything else is served as static assets.
//   PUT /api/receipts/:groupId        body = image  ->  { key }
//   GET /api/receipts/:groupId/:file                ->  image
//   PUT /api/avatars                  body = image  ->  { key }   (key = avatars/<userId>/<uuid>.jpg, own user only)
//   GET /api/avatars/:userId/:file                  ->  image
// Callers must send their Supabase access token; for receipts they must be a member of the group (checked via RLS).

type R2Object = { body: ReadableStream; httpEtag: string }
type Env = {
  RECEIPTS: {
    put(key: string, value: ArrayBuffer, opts: { httpMetadata: { contentType: string } }): Promise<unknown>
    get(key: string): Promise<R2Object | null>
  }
  ASSETS: { fetch(req: Request): Promise<Response> }
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
}

const MAX_BYTES = 600 * 1024
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const ROUTE = new RegExp(`^/api/receipts/(${UUID})(?:/(${UUID}\\.jpg))?$`)

const AVATAR_ROUTE = new RegExp(`^/api/avatars(?:/(${UUID})/(${UUID}\.jpg))?$`)
const MAX_AVATAR_BYTES = 200 * 1024

const json = (body: unknown, status = 200) => Response.json(body, { status })

async function userId(env: Env, token: string): Promise<string | null> {
  const me = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } })
  return me.ok ? ((await me.json()) as { id: string }).id : null
}

async function isMember(env: Env, token: string, groupId: string): Promise<string | null> {
  const headers = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  const me = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers })
  if (!me.ok) return null
  const { id } = (await me.json()) as { id: string }
  const rows = await fetch(
    `${env.SUPABASE_URL}/rest/v1/group_members?select=user_id&group_id=eq.${groupId}&user_id=eq.${id}`,
    { headers },
  )
  if (!rows.ok) return null
  return ((await rows.json()) as unknown[]).length > 0 ? id : null
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req)

    const token = req.headers.get('Authorization')?.replace(/^Bearer /, '')

    const a = AVATAR_ROUTE.exec(url.pathname)
    if (a) {
      const uid = token ? await userId(env, token) : null
      if (!uid) return json({ error: 'Forbidden' }, 403)
      const [, owner, avatarFile] = a
      if (req.method === 'PUT' && !avatarFile) {
        if (req.headers.get('Content-Type') !== 'image/jpeg') return json({ error: 'JPEG only' }, 415)
        const bytes = await req.arrayBuffer()
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_BYTES) return json({ error: 'Image too large' }, 413)
        const key = `avatars/${uid}/${crypto.randomUUID()}.jpg`
        await env.RECEIPTS.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } })
        return json({ key })
      }
      if (req.method === 'GET' && avatarFile) {
        const obj = await env.RECEIPTS.get(`avatars/${owner}/${avatarFile}`)
        if (!obj) return json({ error: 'Not found' }, 404)
        return new Response(obj.body, {
          headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable', ETag: obj.httpEtag },
        })
      }
      return json({ error: 'Method not allowed' }, 405)
    }

    const m = ROUTE.exec(url.pathname)
    if (!m) return json({ error: 'Not found' }, 404)
    const [, groupId, file] = m

    if (!token || !(await isMember(env, token, groupId))) return json({ error: 'Forbidden' }, 403)

    if (req.method === 'PUT' && !file) {
      if (req.headers.get('Content-Type') !== 'image/jpeg') return json({ error: 'JPEG only' }, 415)
      const bytes = await req.arrayBuffer()
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return json({ error: 'Image too large' }, 413)
      const key = `${groupId}/${crypto.randomUUID()}.jpg`
      await env.RECEIPTS.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } })
      return json({ key })
    }

    if (req.method === 'GET' && file) {
      const obj = await env.RECEIPTS.get(`${groupId}/${file}`)
      if (!obj) return json({ error: 'Not found' }, 404)
      return new Response(obj.body, {
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable', ETag: obj.httpEtag },
      })
    }

    return json({ error: 'Method not allowed' }, 405)
  },
}
