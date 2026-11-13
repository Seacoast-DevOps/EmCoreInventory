import { authenticatedFetch as fetch } from './test-client.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createInventoryServer } from './index.js'

test('seed, verification, transfers and seals persist correctly',async()=>{
 const db=new DatabaseSync(':memory:');const server=createInventoryServer(db)
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const base='http://127.0.0.1:'+server.address().port+'/api/'
 const get=async()=>fetch(base+'inventory').then(r=>r.json())
 const post=async(path,body)=>{const res=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:res.status,data:await res.json()}}
 try{
 let state=await get();assert.equal(state.boxes.length,13)
 for(const unit of [42,43,44]){
  const narc=state.items.filter(i=>i.box_id===`unit-${unit}-narcotic`);assert.equal(narc.length,11);assert.equal(narc.filter(i=>i.medication==='Fentanyl').length,5)
  assert.equal(state.items.filter(i=>i.box_id===`unit-${unit}-pelican`).length,13)
  assert.equal(state.items.filter(i=>i.box_id===`unit-${unit}-out`).length,7)
 }
 const item=state.items.find(i=>i.box_id==='unit-42-out')
 assert.equal((await post('verify',{itemId:item.id,verified:true})).status,200)
 assert.ok((await get()).items.find(i=>i.id===item.id).verified_at)
 const move={itemId:item.id,sourceId:item.box_id,destinationId:'unit-42-narcotic'}
 const denied=await post('move',move);assert.equal(denied.status,409);assert.equal(denied.data.sealedBoxes.length,1)
 state=await get();assert.equal(state.items.find(i=>i.id===item.id).box_id,item.box_id);assert.equal(state.boxes.find(b=>b.id===move.destinationId).sealed,1)
 assert.equal((await post('move',{...move,brokenSeals:[{id:move.destinationId,seal:'wrong'}]})).status,409)
 assert.equal((await post('move',{...move,brokenSeals:[{id:move.destinationId,seal:'12345678'}]})).status,200)
 state=await get();assert.equal(state.boxes.find(b=>b.id===move.destinationId).sealed,0);assert.equal(state.items.find(i=>i.id===item.id).verified_at,null)
 assert.equal((await post('move',move)).status,409,'stale source rejected')
 const sealedItem=state.items.find(i=>i.box_id==='unit-43-narcotic')
 const both={itemId:sealedItem.id,sourceId:sealedItem.box_id,destinationId:'unit-44-narcotic'}
 assert.equal((await post('move',both)).data.sealedBoxes.length,2)
 assert.equal((await post('move',{...both,brokenSeals:[{id:both.sourceId,seal:'12345678'}]})).status,409)
 assert.equal((await post('move',{...both,brokenSeals:[{id:both.sourceId,seal:'12345678'},{id:both.destinationId,seal:'12345678'}]})).status,200)
 assert.equal((await post('move',{itemId:item.id,sourceId:'unit-42-narcotic',destinationId:'storage-bls'})).status,200)
 assert.equal((await post('move',{itemId:item.id,sourceId:'storage-bls',destinationId:'storage-bls'})).status,400)
 assert.equal((await post('verify',{itemId:item.id,verified:'true'})).status,400)
 assert.equal(db.prepare("SELECT count(*) AS n FROM inventory_events WHERE action='move'").get().n,3)
 const count=(await get()).items.length;createInventoryServer(db).close();assert.equal((await get()).items.length,count,'seeding is idempotent')
 }finally{await new Promise(resolve=>server.close(resolve));db.close()}
})
