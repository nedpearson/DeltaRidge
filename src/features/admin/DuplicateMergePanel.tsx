import { useState } from 'react'
import { getSupabase } from '../../lib/supabase'
import { Button } from '../../components/ui'

export function DuplicateMergePanel() {
  const [targetId, setTargetId] = useState('')
  const [duplicateId, setDuplicateId] = useState('')
  const [status, setStatus] = useState<'idle' | 'merging' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const handleMerge = async () => {
    if (!targetId || !duplicateId) {
      setMessage('Both IDs are required')
      setStatus('error')
      return
    }

    setStatus('merging')
    setMessage('')
    const client = getSupabase()
    if (!client) return

    const { error } = await client.rpc('merge_leads', {
      target_lead_id: targetId,
      duplicate_lead_id: duplicateId
    })

    if (error) {
      setStatus('error')
      setMessage(error.message)
    } else {
      setStatus('success')
      setMessage('Leads merged successfully')
      setTargetId('')
      setDuplicateId('')
    }
  }

  return (
    <div className="bg-bg-card p-4 rounded-xl border border-[var(--color-surface-3)]">
      <h3 className="text-text-primary font-semibold mb-2">Duplicate Merge Tooling</h3>
      <div className="flex flex-col gap-3">
        <div>
          <label className="text-text-secondary text-sm block mb-1">Target Lead ID</label>
          <input
            className="w-full bg-bg-app border border-[var(--color-surface-3)] rounded px-3 py-2 text-text-primary"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            placeholder="UUID of the lead to keep"
          />
        </div>
        <div>
          <label className="text-text-secondary text-sm block mb-1">Duplicate Lead ID</label>
          <input
            className="w-full bg-bg-app border border-[var(--color-surface-3)] rounded px-3 py-2 text-text-primary"
            value={duplicateId}
            onChange={(e) => setDuplicateId(e.target.value)}
            placeholder="UUID of the lead to merge and remove"
          />
        </div>
        <Button onClick={handleMerge} disabled={status === 'merging'}>
          {status === 'merging' ? 'Merging...' : 'Merge Leads'}
        </Button>
        {message && (
          <p className={`text-sm ${status === 'error' ? 'text-status-critical' : 'text-status-success'}`}>
            {message}
          </p>
        )}
      </div>
    </div>
  )
}
