import {it,expect} from 'vitest'
import {readFileSync,readdirSync,existsSync} from 'node:fs'
import {join,dirname,resolve} from 'node:path'
function files(path:string):string[]{return readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(path,e.name)):[join(path,e.name)])}
it('keeps privileged clients outside the browser import graph',()=>{
 const visited=new Set<string>()
 function inspect(path:string){if(visited.has(path))return;visited.add(path);const source=readFileSync(path,'utf8');if(/^['"]use server['"]/m.test(source))return
  expect(source,path).not.toMatch(/SUPABASE_SECRET_KEY|createAdminClient|import ['"]server-only/)
  for(const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){const target=match[1].startsWith('@/')?resolve('src',match[1].slice(2)):match[1].startsWith('.')?resolve(dirname(path),match[1]):null;if(target){const file=[target+'.ts',target+'.tsx',join(target,'index.ts')].find(existsSync);if(file)inspect(file)}}
 }
 for(const path of files('src').filter(p=>/\.tsx?$/.test(p)))if(/^['"]use client['"]/m.test(readFileSync(path,'utf8')))inspect(path)
})

it('keeps credentials out of the shareable environment template',()=>{
 const template=readFileSync('.env.example','utf8')
 expect(template).not.toMatch(/sb_secret_[A-Za-z0-9_-]+/)
 for(const name of ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY'])expect(template).toMatch(new RegExp(`^${name}=$`,'m'))
})
