import {existsSync,writeFileSync,readFileSync} from 'node:fs'
import {agentCoreDeployment} from '../src/runtime/deployment'
if(existsSync('.env.local'))process.loadEnvFile('.env.local')
const [image,role,runtimeId]=process.argv.slice(2)
if(!image||!role)throw new Error('Usage: npm run agent:config -- <ECR image URI> <execution role ARN> [existing runtime ID]')
const config=agentCoreDeployment(image,role,process.env)
if(runtimeId){
 const {agentRuntimeName,...update}=config
 if(!agentRuntimeName||!/^[a-zA-Z][a-zA-Z0-9_]*-[a-zA-Z0-9]+$/.test(runtimeId))throw new Error('Invalid runtime ID')
 writeFileSync('.agentcore-update.json',JSON.stringify({...update,agentRuntimeId:runtimeId,metadataConfiguration:{requireMMDSV2:true}},null,2),{mode:0o600})
 console.info('Wrote .agentcore-update.json (contains server secrets; do not commit or print).')
}else{
 writeFileSync('.agentcore-runtime.json',JSON.stringify(config,null,2),{mode:0o600})
 console.info('Wrote .agentcore-runtime.json (contains server secrets; do not commit or print).')
}
// Validate the generated file without printing its secret-bearing contents.
JSON.parse(readFileSync(runtimeId?'.agentcore-update.json':'.agentcore-runtime.json','utf8'))
