import { useEffect, useState } from 'react'
import { Card } from '@/components/ui'
import { getSupabase } from '@/lib/supabase'
interface Grid { observed_at: string; imported_at: string; valid_cell_count: number; missing_cell_count: number; cells: [number,number,number][] }
export default function MrmsGridPanel() {
 const [grid,setGrid]=useState<Grid|null>(null)
 const [notice,setNotice]=useState('Checking the latest decoded grid…')
 useEffect(()=>{
  let active=true
  const db=getSupabase();if(!db) {setNotice('Sign in to view imported hail grids.');return}
  void db.from('mrms_grids').select('observed_at,imported_at,valid_cell_count,missing_cell_count,cells').order('observed_at',{ascending:false}).limit(1).maybeSingle().then(({data,error})=>{
   if(!active)return
   if(error||!data)setNotice('No decoded MRMS grid is available. The scheduled integration worker must complete an import.')
   else {setGrid(data as Grid);setNotice('')}
  })
  return ()=>{active=false}
 },[])
 const fresh=grid && Date.now()-Date.parse(grid.observed_at)<=2*3600000
 return <Card className="p-5"><h3 className="font-bold">NOAA radar hail grid</h3>
 {notice?<p className="mt-2 text-sm text-text-secondary">{notice}</p>:grid&&<>
  <p className="mt-2 text-sm">{fresh?'Latest territory grid imported':'Imported grid is stale'} · {new Date(grid.observed_at).toLocaleString()}</p>
  {grid.valid_cell_count===0 && <p className="mt-2 text-sm text-status-warning">NOAA reports missing radar data throughout this territory. This does not establish that no hail occurred.</p>}
  <p className="mt-1 text-sm text-text-secondary">{grid.valid_cell_count.toLocaleString()} valid radar cells; {grid.cells.length.toLocaleString()} contain estimated hail. {grid.missing_cell_count.toLocaleString()} cells have missing data. {grid.valid_cell_count>0 && <>Largest estimate: {grid.cells.reduce((max,cell)=>Math.max(max,cell[2]),0).toFixed(2)} inches.</>}</p>
  <p className="mt-2 text-xs text-text-secondary">MESH is a radar estimate over the preceding 24 hours. Confirm roof damage through inspection; a radar estimate does not prove damage at a property.</p>
 </>}</Card>
}
