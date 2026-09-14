'use client'
import {useState,type FormEvent} from 'react'
import {useRouter} from 'next/navigation'
import {performMutation} from '@/lib/http'
export function RestoreCloseoutSource({estimateId}:{estimateId:string}){
 const router=useRouter(),[busy,setBusy]=useState(false),[error,setError]=useState('')
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const body=new FormData(event.currentTarget);await performMutation(async()=>{const response=await fetch(`/api/estimates/${estimateId}/closeout/restore`,{method:'POST',body});const data:unknown=await response.json();if(!response.ok)throw new Error(typeof data==='object'&&data!==null&&'error'in data&&typeof data.error==='string'?data.error:'The file could not be restored.')},{busy:setBusy,error:setError},()=>router.refresh())}
 return <form onSubmit={submit}><label>Restore original actuals (must match saved cost lines)<input name="actualFile" type="file" accept=".csv,.xlsx" required/></label><button className="btn" disabled={busy}>{busy?'Restoring…':'Restore original file'}</button>{error&&<p role="alert" className="error">{error}</p>}</form>
}
