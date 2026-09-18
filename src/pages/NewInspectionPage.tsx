import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Field, Select, TextInput } from '@/components/ui'
import { newId, saveInspection, type LocalInspection } from '@/lib/db'
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
    // Location is best-effort and time-boxed. If the rep is in a metal building
    // with no fix, we start the inspection anyway rather than making them wait.
    const pos = await currentPosition(5000)
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
      ...(pos ? { latitude: pos.coords.latitude, longitude: pos.coords.longitude } : {}),
    }

    await saveInspection(inspection)
    navigate(`/inspection/${id}`, { replace: true })
  }

  return (
    <div className="space-y-4 pb-4">
      <div>
        <h1 className="font-display text-xl tracking-wide">New inspection</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-white/45">
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

      <Button full onClick={() => void start()} disabled={busy || !form.addressLine1.trim()}>
        {busy ? 'Getting location…' : 'Start inspection'}
      </Button>
    </div>
  )
}
