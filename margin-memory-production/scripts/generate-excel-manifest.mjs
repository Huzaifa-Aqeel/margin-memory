import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const origin=(process.env.OFFICE_ADDIN_ORIGIN||process.argv[2]||'').replace(/\/$/,'')
if(!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin))throw new Error('Set OFFICE_ADDIN_ORIGIN to the public HTTPS origin hosting Margin Memory, for example https://margin.example.com.')
const root=resolve(import.meta.dirname,'..')
const template=await readFile(resolve(root,'office-addin/manifest.template.xml'),'utf8')
const output=template.replaceAll('{{ORIGIN}}',origin)
const directory=resolve(root,'.generated/excel');await mkdir(directory,{recursive:true})
await writeFile(resolve(directory,'manifest.xml'),output)
console.log(`Excel manifest written to ${resolve(directory,'manifest.xml')}`)
