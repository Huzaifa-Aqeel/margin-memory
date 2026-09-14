'use client'

import Script from 'next/script'
import { useEffect, useState } from 'react'

export default function ExcelAuthComplete(){
 const[ready,setReady]=useState(false)
 useEffect(()=>{if(!ready)return;Office.onReady(()=>{try{Office.context.ui.messageParent('margin-memory-authenticated')}catch{window.close()}})},[ready])
 return <div className="excel-pane centered"><Script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js" onLoad={()=>setReady(true)}/><span className="brand-mark">M</span><h1>Signed in</h1><p className="subtle">Returning to Margin Memory in Excel…</p></div>
}
