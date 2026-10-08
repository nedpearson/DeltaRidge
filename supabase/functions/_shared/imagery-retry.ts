/** Retry read-only imagery requests on transient upstream failures. */
export async function imageryRequest(
 request: (refreshToken: boolean) => Promise<Response>,
 wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve,ms)),
): Promise<Response> {
 let refreshed = false
 for (let attempt=0;attempt<3;attempt++) {
  try {
   const response=await request(refreshed)
   if(response.status===401 && !refreshed) { refreshed=true; await response.body?.cancel(); continue }
   if(![429,500,502,503,504].includes(response.status) || attempt===2) return response
   await response.body?.cancel()
  } catch(error) { if(attempt===2) throw error }
  await wait(300 * 2 ** attempt)
 }
 throw new Error('Imagery request could not complete.')
}
