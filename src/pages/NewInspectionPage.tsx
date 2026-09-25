import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Field, Select, TextInput } from '@/components/ui'
import { getInspection, newId, saveInspection, type LocalInspection } from '@/lib/db'
import { currentPosition } from '@/lib/image'

const PARISHES = [
  'Ascension', 'East Baton Rouge', 'Livingston', 'West Baton Rouge',
  'Iberville', 'Pointe Coupee', 'St. Helena', 'Tangipahoa', 'Other',
]

const MATERIALS: Array<[string, string]> = [
  ['unknown', 'Not sure yet'],
  ['architectural_shingle', 'Architectural shingle'],
  ['asphalt_shingle', '3-tab asphalt shingle'],
  ['metal', 'Metal'],
  ['tile', 'Tile'],
  ['flat_tpo', 'Flat — TPO'],
  ['flat_modified_bitumen', 'Flat — modified bitumen'],
  ['wood_shake', 'Wood shake'],
  ['slate', 'Slate'],
]

export default function NewInspectionPage() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    addressLine1: '',
    city: '',
    parish: 'Ascension',
    postalCode: '',
    customerFirstName: '',
    customerLastName: '',
    customerPhone: '',
    customerEmail: '',
    propertyType: 'residential' as LocalInspection['propertyType'],
    stories: '1',
    roofMaterial: 'unknown',
  })

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function start() {
    if (!form.addressLine1.trim()) return
    setBusy(true)
    setError(null)
    const now = new Date().toISOString()
    const id = newId()

    const inspection: LocalInspection = {
      id,
      createdAt: now,
      updatedAt: now,
      status: 'in_progress',
      addressLine1: form.addressLine1.trim(),
      propertyType: form.propertyType,
      roofMaterial: form.roofMaterial,
      syncState: 'local',
      ...(form.city.trim() ? { city: form.city.trim() } : {}),
      ...(form.parish ? { parish: form.parish } : {}),
      ...(form.postalCode.trim() ? { postalCode: form.postalCode.trim() } : {}),
      ...(form.customerFirstName.trim() ? { customerFirstName: form.customerFirstName.trim() } : {}),
      ...(form.customerLastName.trim() ? { customerLastName: form.customerLastName.trim() } : {}),
      ...(form.customerPhone.trim() ? { customerPhone: form.customerPhone.trim() } : {}),
      ...(form.customerEmail.trim() ? { customerEmail: form.customerEmail.trim() } : {}),
      ...(form.stories ? { stories: Number(form.stories) } : {}),
    }

    try {
      await saveInspection(inspection)
    } catch (err) {
      // Without this the button sits disabled forever and the rep taps a dead
      // control. Storage can genuinely fail - a full device is the common one.
      setBusy(false)
      setError(
        err instanceof Error
          ? `Could not save on this device: ${err.message}`
          : 'Could not save on this device.',
      )
      return
    }

    navigate(`/inspection/${id}`, { replace: true })

    /**
     * The GPS fix is chased AFTER the inspection exists, not before it.
     *
     * Waiting on it cost up to five seconds of a dead-looking button, which is
     * exactly long enough for a rep to decide the app is broken and tap again.
     * The address is what the office needs; coordinates are a convenience for
     * mapping. So: open the inspection immediately, and fold the position in
     * when it arrives. If it never arrives - metal building, no fix, denied
     * permission - nothing is lost and nothing was waited on.
     */
    void currentPosition(8000).then(async (pos) => {
      if (!pos) return
      const latest = await getInspection(id)
      if (!latest) return
      await saveInspection({
        ...latest,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      })
    })
  }

  return (
    <div className="space-y-4 pb-4">
      <div>
        <h1 className="font-display text-xl tracking-wide">New inspection</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
          Address is all that is required to start. Everything else can be filled in from the roof.
        </p>
      </div>

      <Card className="space-y-3">
        <Field label="Property address" hint="Required">
          <TextInput
            value={form.addressLine1}
            onChange={set('addressLine1')}
            placeholder="14235 Airline Hwy"
            autoComplete="street-address"
            enterKeyHint="next"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City">
            <TextInput value={form.city} onChange={set('city')} placeholder="Gonzales" />
          </Field>
          <Field label="ZIP">
            <TextInput value={form.postalCode} onChange={set('postalCode')} placeholder="70737" inputMode="numeric" />
          </Field>
        </div>
        <Field label="Parish">
          <Select value={form.parish} onChange={set('parish')}>
            {PARISHES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </Select>
        </Field>
      </Card>

      <Card className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Homeowner first name">
            <TextInput value={form.customerFirstName} onChange={set('customerFirstName')} placeholder="Dale" autoComplete="given-name" />
          </Field>
          <Field label="Last name">
            <TextInput value={form.customerLastName} onChange={set('customerLastName')} placeholder="Boudreaux" autoComplete="family-name" />
          </Field>
        </div>
        <Field label="Phone">
          <TextInput value={form.customerPhone} onChange={set('customerPhone')} placeholder="(225) 555-0142" inputMode="tel" autoComplete="tel" />
        </Field>
        <Field label="Email">
          <TextInput value={form.customerEmail} onChange={set('customerEmail')} placeholder="optional" inputMode="email" autoComplete="email" />
        </Field>
      </Card>

      <Card className="space-y-3">
        <Field label="Property type">
          <Select value={form.propertyType} onChange={set('propertyType')}>
            <option value="residential">Residential</option>
            <option value="multi_family">Multi-family</option>
            <option value="commercial">Commercial</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Stories">
            <Select value={form.stories} onChange={set('stories')}>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3+</option>
            </Select>
          </Field>
          <Field label="Roof material">
            <Select value={form.roofMaterial} onChange={set('roofMaterial')}>
              {MATERIALS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {error && (
        <p className="rounded-lg bg-amber-100 px-3 py-2 text-[13px] text-amber-700 ring-1 ring-amber-300">
          {error}
        </p>
      )}

      <Button full onClick={() => void start()} disabled={busy || !form.addressLine1.trim()}>
        {busy ? 'Starting…' : 'Start inspection'}
      </Button>
    </div>
  )
}
