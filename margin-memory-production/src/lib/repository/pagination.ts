import type {z} from 'zod'
export async function readAll<T>(fetchPage:(from:number,to:number)=>PromiseLike<{data:unknown;error:unknown}>,schema:z.ZodType<T>,pageSize=500):Promise<T[]>{
 const result:T[]=[]
 for(let from=0;;from+=pageSize){const {data,error}=await fetchPage(from,from+pageSize-1);if(error)throw error;const page=schema.array().parse(data);result.push(...page);if(page.length<pageSize)return result}
}
