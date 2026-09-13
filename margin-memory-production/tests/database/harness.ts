import {mkdtempSync,readFileSync,readdirSync} from 'node:fs'
import {tmpdir,userInfo} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import pg from 'pg'
type DatabaseHarnessOptions={beforeMigration?:(migration:string,db:pg.Client)=>Promise<void>}
export async function startDatabase(options:DatabaseHarnessOptions={}){
 const dir=mkdtempSync(join(tmpdir(),'margin-regression-'))
 const bin=process.env.PG_BIN||'/usr/lib/postgresql/18/bin'
 execFileSync(join(bin,'initdb'),['-D',dir,'-A','trust','--no-locale','-E','UTF8'],{stdio:'pipe'})
 execFileSync(join(bin,'pg_ctl'),['-D',dir,'-l',join(dir,'server.log'),'-o',`-k ${dir} -p 55438 -c listen_addresses=`, 'start'],{stdio:'pipe'})
 const config={host:dir,port:55438,database:'postgres',user:userInfo().username}
 const db=new pg.Client(config)
 try{
  await db.connect();await db.query(readFileSync('tests/database/bootstrap.sql','utf8'))
  for(const migration of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()){
   await options.beforeMigration?.(migration,db)
   await db.query(readFileSync(join('supabase/migrations',migration),'utf8'))
  }
 }catch(error){await db.end();execFileSync(join(bin,'pg_ctl'),['-D',dir,'stop','-m','fast'],{stdio:'pipe'});throw error}
 return{db,config,stop:async()=>{await db.end();execFileSync(join(bin,'pg_ctl'),['-D',dir,'stop','-m','fast'],{stdio:'pipe'})}}
}
