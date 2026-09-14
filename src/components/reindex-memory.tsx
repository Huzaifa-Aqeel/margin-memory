'use client'
import {useState} from 'react'
import {useRouter} from 'next/navigation'
import {RefreshCw} from 'lucide-react'
import {postJson,performMutation} from '@/lib/http'
export function ReindexMemory({estimateId}:{estimateId?:string}){
 const router=useRouter();const[busy,setBusy]=useState(false);const[error,setError]=useState('');const[msg,setMsg]=useState('')
 async function run(){setMsg('');await performMutation(()=>postJson(estimateId?`/api/estimates/${estimateId}/closeout`:'/api/memory/reindex'),{busy:setBusy,error:setError},data=>{setMsg(Array.isArray(data.warnings)&&data.warnings.length?data.warnings.map(String).join(' '):'Saved progress. Any remaining work is shown below; retry if needed.');router.refresh()})}
 return <div><button className="btn" disabled={busy} onClick={run}><RefreshCw size={15}/>{busy?'Updating…':estimateId?'Retry closeout follow-up':'Update company memory'}</button>{(error||msg)&&<div role="status" className={error?'error':'helper'} style={{marginTop:8}}>{error||msg}</div>}</div>
}
