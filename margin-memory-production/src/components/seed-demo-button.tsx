'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
export function SeedDemoButton(){const router=useRouter();const[busy,setBusy]=useState(false);const[error,setError]=useState('');async function seed(){setBusy(true);setError('');const res=await fetch('/api/demo/seed',{method:'POST'});const data=await res.json();if(!res.ok){setError(data.error||'Could not load demo data.');setBusy(false);return}router.push(data.estimateId?`/estimates/${data.estimateId}`:'/');router.refresh()}return <div>{error&&<div className="error" style={{marginBottom:8}}>{error}</div>}<button onClick={seed} disabled={busy} className="btn"><Sparkles size={15}/>{busy?'Building company memory…':'Load realistic demo workspace'}</button></div>}
