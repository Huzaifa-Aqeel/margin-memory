import {it,expect} from 'vitest'
import {z} from 'zod'
import {readAll} from '../src/lib/repository/pagination'
it('reads beyond a server row cap without omitting line items',async()=>{const rows=Array.from({length:1201},(_,id)=>({id}));const result=await readAll(async(from,to)=>({data:rows.slice(from,to+1),error:null}),z.object({id:z.number()}));expect(result).toEqual(rows)})
it('does not return partial financial data on page failure',async()=>{await expect(readAll(async(from)=>from?{data:null,error:new Error('failed page')}:{data:[1,2],error:null},z.number(),2)).rejects.toThrow('failed page')})
