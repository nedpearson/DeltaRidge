import { fireEvent,render,screen,waitFor,cleanup } from '@testing-library/react'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import FreeRoofCheckPage from '@/pages/FreeRoofCheckPage'
const invoke=vi.fn()
vi.mock('@/lib/supabase',()=>({getSupabase:()=>({functions:{invoke}})}))
vi.mock('@/features/acquisition/SecurityCheck',()=>({default:({onToken}:{onToken:(s:string)=>void})=><button type="button" onClick={()=>onToken('verified-test-token')}>Complete test security check</button>}))
beforeEach(()=>{invoke.mockReset()})
afterEach(cleanup)
async function fillRequest() {
  fireEvent.click(screen.getByRole('button',{name:/without storm/}))
  fireEvent.change(screen.getByLabelText('Property address, city and ZIP'),{target:{value:'123 Example Street, Baton Rouge LA 70809'}})
  fireEvent.change(screen.getByLabelText('Your name'),{target:{value:'Test Homeowner'}})
  fireEvent.change(screen.getByLabelText('Email'),{target:{value:'test@example.com'}})
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByText('Complete test security check'))
  fireEvent.click(screen.getByRole('button',{name:'Request free inspection'}))
}
describe('public inspection form persistence',()=>{
  it('confirms receipt only after successful server persistence',async()=>{
    invoke.mockResolvedValue({data:{success:true,status:'requested'},error:null})
    render(<FreeRoofCheckPage />);await fillRequest()
    await waitFor(()=>expect(screen.getByText('Your request is saved')).toBeTruthy())
    expect(screen.getByText(/no appointment is booked yet/)).toBeTruthy()
    expect(invoke.mock.calls[0]?.[1].body.contactConsent).toBe(true)
  })
  it('keeps failed submissions retryable with the same idempotency key',async()=>{
    invoke.mockResolvedValueOnce({data:null,error:new Error('network')}).mockResolvedValueOnce({data:{success:true},error:null})
    render(<FreeRoofCheckPage />);await fillRequest()
    await waitFor(()=>expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.queryByText('Your request is saved')).toBeNull()
    fireEvent.click(screen.getByText('Complete test security check'))
    fireEvent.click(screen.getByRole('button',{name:'Request free inspection'}))
    await waitFor(()=>expect(screen.getByText('Your request is saved')).toBeTruthy())
    expect(invoke.mock.calls[0]?.[1].body.requestKey).toBe(invoke.mock.calls[1]?.[1].body.requestKey)
  })
})
