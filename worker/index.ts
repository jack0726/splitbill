// Receipt storage API in front of Cloudflare R2. Everything else is served as static assets.
//   PUT /api/receipts/:groupId        body = image  ->  { key }
//   GET /api/receipts/:groupId/:file                ->  image
//   PUT /api/avatars                  body = image  ->  { key }   (key = avatars/<userId>/<uuid>.jpg, own user only)
//   GET /api/avatars/:userId/:file                  ->  image
// Callers must send their Supabase access token; for receipts they must be a member of the group (checked via RLS).

type R2Object = { body: ReadableStream; httpEtag: string }
type R2ListedObject = { key: string }
type Env = {
  RECEIPTS: {
    put(key: string, value: ArrayBuffer, opts: { httpMetadata: { contentType: string } }): Promise<unknown>
    get(key: string): Promise<R2Object | null>
    list(opts: { prefix: string; cursor?: string }): Promise<{ objects: R2ListedObject[]; truncated: boolean; cursor?: string }>
    delete(keys: string[]): Promise<void>
  }
  ASSETS: { fetch(req: Request): Promise<Response> }
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  OPENAI_API_KEY?: string
}

const MAX_BYTES = 600 * 1024
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const ROUTE = new RegExp(`^/api/receipts/(${UUID})(?:/(${UUID}\\.jpg))?$`)

const AVATAR_ROUTE = new RegExp(`^/api/avatars(?:/(${UUID})/(${UUID}\.jpg))?$`)
const MAX_AVATAR_BYTES = 200 * 1024
const MAX_AVATAR_SOURCE_BYTES = 1024 * 1024

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

    if (url.pathname === '/api/avatar-generation') {
      if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
      const uid = token ? await userId(env, token) : null
      if (!uid) return json({ error: 'Please sign in to create an avatar' }, 401)
      if (!env.OPENAI_API_KEY) return json({ error: 'Avatar generation is not configured on this server' }, 503)
      if (req.headers.get('Content-Type') !== 'image/jpeg') return json({ error: 'Please send a JPEG photo' }, 415)
      const image = await req.arrayBuffer()
      if (image.byteLength === 0 || image.byteLength > MAX_AVATAR_SOURCE_BYTES) return json({ error: 'Photo must be smaller than 1 MB' }, 413)

      const form = new FormData()
      form.append('model', 'gpt-image-2.5-sunburst')
      form.append('image[]', new File([image], 'selfie.jpg', { type: 'image/jpeg' }))
      form.append('prompt', 'Turn the person in the reference photo into a friendly, polished illustrated profile avatar. Preserve their recognizable face, skin tone, hairstyle, and glasses if present. Show a centered head and shoulders portrait, facing forward, with a simple softly colored circular background. Clean modern 2D editorial illustration, crisp shapes, warm approachable expression. One person only. No text, no logos, no extra objects. Keep the entire head and shoulders inside the square frame.')
      form.append('size', '1024x1024')
      form.append('quality', 'low')
      form.append('output_format', 'jpeg')
      form.append('n', '1')

      try {
        const generated = await fetch('https://api.openai.com/v1/images/edits', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
          body: form,
        })
        const result = (await generated.json().catch(() => null)) as { data?: { b64_json?: string }[]; error?: { message?: string } } | null
        if (!generated.ok) {
          console.error('Avatar generation request failed', generated.status)
          return json({ error: result?.error?.message?.slice(0, 300) ?? 'Could not generate an avatar right now' }, 502)
        }
        const imageBase64 = result?.data?.[0]?.b64_json
        if (!imageBase64) return json({ error: 'Avatar generation returned no image' }, 502)
        return json({ image: imageBase64 })
      } catch (error) {
        console.error('Avatar generation request failed', error instanceof Error ? error.message : 'unknown error')
        return json({ error: 'Could not reach the avatar generation service' }, 502)
      }
    }

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

    const memberId = token ? await isMember(env, token, groupId) : null

    if (req.method === 'DELETE' && !file) {
      if (!token) return json({ error: 'Sign in to delete this group' }, 401)
      try {
        const headers = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
        const groupRes = await fetch(`${env.SUPABASE_URL}/rest/v1/groups?select=created_by&id=eq.${groupId}`, { headers })
        if (!groupRes.ok) return json({ error: `Could not verify group ownership (Supabase returned ${groupRes.status})` }, 502)
        const groups = (await groupRes.json()) as { created_by: string }[]
        if (!groups[0]) return json({ error: 'Group not found or access denied' }, 404)
        const callerId = await userId(env, token)
        if (groups[0].created_by !== callerId) return json({ error: 'Only the group creator can delete it' }, 403)
        let cursor: string | undefined
        do {
          const page = await env.RECEIPTS.list({ prefix: `${groupId}/`, cursor })
          if (page.objects.length) await env.RECEIPTS.delete(page.objects.map((object) => object.key))
          cursor = page.truncated ? page.cursor : undefined
          if (page.truncated && !cursor) throw new Error('R2 returned a truncated page without a continuation cursor')
        } while (cursor)
        return json({ ok: true })
      } catch (error) {
        console.error('Receipt cleanup failed', error)
        return json({ error: error instanceof Error ? `Receipt cleanup failed: ${error.message}` : 'Receipt cleanup failed in R2' }, 502)
      }
    }

    if (!memberId) return json({ error: 'Forbidden' }, 403)

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
