import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Join() {
  const { code } = useParams()
  const nav = useNavigate()
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.rpc('join_group', { code }).then(({ data, error }) => {
      if (error) setErr(error.message)
      else nav(`/g/${data}`, { replace: true })
    })
  }, [code, nav])

  return err ? <p className="error">{err}</p> : <p className="center muted">Joining group…</p>
}
