import { describe,it,expect } from 'vitest'
import { captureAttribution,validateIntake,acquisitionEconomics,type InspectionIntake } from '@/features/acquisition/intake'
const input:InspectionIntake={requestKey:'12345678-1234-1234-1234-123456789012',name:'Test Homeowner',address:'123 Example Street, Baton Rouge LA 70809',phone:'(225) 555-0100',email:'',preferredDay:'2026-10-10',notes:'Check flashing',contactConsent:true,website:'',attribution:{}}
describe('inspection acquisition trust boundary',()=>{
  it('requires explicit contact permission and a usable contact',()=>{
    expect(validateIntake(input,'2026-10-07')).toBeNull()
    expect(validateIntake({...input,contactConsent:false},'2026-10-07')).toMatch(/Authorize/)
    expect(validateIntake({...input,phone:'',email:''},'2026-10-07')).toMatch(/phone number or email/)
    expect(validateIntake({...input,phone:'123'},'2026-10-07')).toMatch(/valid US/)
    expect(validateIntake({...input,email:'invalid'},'2026-10-07')).toMatch(/valid email/)
  })
  it('rejects stale dates and oversized notes',()=>{
    expect(validateIntake({...input,preferredDay:'2026-10-01'},'2026-10-07')).toMatch(/future/)
    expect(validateIntake({...input,notes:'a'.repeat(2001)},'2026-10-07')).toMatch(/2,000/)
  })
  it('captures only supported campaign fields, with bounded values',()=>{
    expect(captureAttribution('?utm_source=google&ref=realtor-1&organization_id=bad&token=secret')).toEqual({utm_source:'google',ref:'realtor-1'})
    expect(captureAttribution('?utm_campaign='+ 'a'.repeat(500)).utm_campaign).toHaveLength(200)
  })
  it('reports undefined unit economics as unknown, never zero',()=>{
    expect(acquisitionEconomics(10000,100,30,10)).toEqual({cpl:100,appointmentRate:0.3,closeRate:1/3,cac:1000})
    expect(acquisitionEconomics(100,0,0,0)).toEqual({cpl:null,appointmentRate:null,closeRate:null,cac:null})
  })
})
