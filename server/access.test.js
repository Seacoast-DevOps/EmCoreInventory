import { authenticatedFetch as fetch } from './test-client.js'

import test from 'node:test'

import assert from 'node:assert/strict'

import { DatabaseSync } from 'node:sqlite'

import { createInventoryServer } from './index.js'



async function fixture(run){

 const db=new DatabaseSync(':memory:'),server=createInventoryServer(db)

 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))

 const base='http://127.0.0.1:'+server.address().port+'/api/'

 const call=async(path,body,profile='service-admin')=>{const res=await fetch(base+path,{headers:{'Content-Type':'application/json','X-EMCore-Profile':profile},...(body?{method:'POST',body:JSON.stringify(body)}:{})});return {status:res.status,data:await res.json()}}

 try{await run({db,call})}finally{await new Promise(resolve=>server.close(resolve));db.close()}

}

test('batch creation defaults to Unassigned with shared lot/expiry and individual permanent codes',()=>fixture(async({call})=>{

 const before=(await call('inventory')).data,drug=before.definitions.find(drug=>drug.name==='Aspirin')

 const body={definitionId:drug.id,quantity:3,batchCreate:true,lotNumber:'LOT-42',expirationDate:'2028-12-31',codeMode:'auto'}

 const created=await call('drugs',body);assert.equal(created.status,200)

 const items=created.data.items.filter(item=>item.lot_number==='LOT-42')

 assert.equal(items.length,3);assert.equal(new Set(items.map(item=>item.code)).size,3)

 assert.ok(items.every(item=>item.status==='unassigned'&&item.box_id==='unassigned'&&item.expires_on==='2028-12-31'&&item.batch_id===items[0].batch_id))

 assert.equal(created.data.checks.some(check=>check.boxId==='unassigned'),false)

 assert.equal((await call('checks/start',{boxId:'unassigned',kind:'scheduled'})).status,400)

 assert.equal((await call('incidents',{reason:'used',incidentNumber:'UNASSIGNED',items:[{id:items[0].id,boxId:'unassigned',given:1,wasted:0}]})).status,409)

 const moved=await call('move',{itemId:items[0].id,sourceId:'unassigned',destinationId:'unit-42-out'})

 assert.equal(moved.status,200);assert.equal(moved.data.items.find(item=>item.id===items[0].id).status,'available')

 const history=(await call('history?item='+items[0].code)).data

 assert.equal(JSON.parse(history.events.find(event=>event.action==='received').details).lotNumber,'LOT-42')

 const count=(await call('inventory')).data.items.length

 assert.equal((await call('drugs',{...body,expirationDate:'2028-02-31'})).status,400)

 assert.equal((await call('drugs',{...body,lotNumber:''})).status,400)

 assert.equal((await call('inventory')).data.items.length,count)

}))

test('preview profiles enforce API actions; read-only and check-only profiles cannot bypass UI restrictions',()=>fixture(async({call})=>{

 const state=(await call('inventory')).data,item=state.items.find(item=>item.box_id==='unit-42-out')

 assert.equal((await call('inventory',undefined,'emt-readonly')).status,200)

 assert.equal((await call('move',{itemId:item.id,sourceId:item.box_id,destinationId:'unit-42-pelican'},'emt-readonly')).status,403)

 assert.equal((await call('checks/start',{boxId:'unit-42-out',kind:'scheduled'},'emt-readonly')).status,403)

 const check=await call('checks/start',{boxId:'unit-42-out',kind:'scheduled'},'emt-checker');assert.equal(check.status,200)

 const draft=check.data.checks.find(check=>check.boxId==='unit-42-out').draft

 assert.equal((await call('checks/verify',{boxId:'unit-42-out',revision:draft.revision,itemId:item.id,verified:true},'emt-checker')).status,200)

 assert.equal((await call('classes',{name:'Unauthorized'},'emt-checker')).status,403)

 assert.equal((await call('logs',undefined,'emt-checker')).status,403)

 assert.equal((await call('inventory',undefined,'missing-profile')).status,403)

 const denied=await call('logs?type=access&q=Access%20denied');assert.equal(denied.status,200);assert.ok(denied.data.total>=4)

}))

test('medication classes and per-medication role rules persist and restrict stock and records',()=>fixture(async({call})=>{

 const initial=(await call('inventory')).data,drug=initial.definitions.find(drug=>drug.name==='Aspirin'),item=initial.items.find(item=>item.definition_id===drug.id&&item.box_id==='unit-42-out')

 const cls=await call('classes',{name:'Test class',description:'Classification test'});assert.equal(cls.status,200)

 const classId=cls.data.classes.find(item=>item.name==='Test class').id

 const draftIncident=await call('incidents/draft',{incidentNumber:'HIDDEN-MED',reason:'used',notes:'',items:[{id:item.id,boxId:item.box_id,given:1,wasted:0}]})

 assert.equal(draftIncident.status,200)

 assert.equal((await call('checks/start',{boxId:item.box_id,kind:'scheduled'})).status,200)

 const payload={...drug,medicationClassId:classId,parTargets:[],accessRules:{view:{anyTags:['Paramedic','AEMT'],allTags:[]},transfer:{anyTags:['Paramedic'],allTags:['Can Transfer']}}}

 const saved=await call('definitions',payload);assert.equal(saved.status,200)

 assert.equal(saved.data.definitions.find(item=>item.id===drug.id).medicationClassId,classId)

 const emt=(await call('inventory',undefined,'emt-checker')).data

 assert.equal(emt.items.some(item=>item.definition_id===drug.id),false)

 assert.equal((await call('history?item='+item.code,undefined,'emt-checker')).status,403)

 assert.equal((await call('checks?boxId='+item.box_id,undefined,'emt-checker')).status,403)

 assert.equal((await call('incident?id='+draftIncident.data.savedIncident.incident.id,undefined,'emt-checker')).status,403)

 assert.equal(emt.incidents.some(incident=>incident.incident_number==='HIDDEN-MED'),false)

 assert.equal((await call('checks/start',{boxId:item.box_id,kind:'scheduled'},'emt-checker')).status,403)

 assert.equal((await call('move',{itemId:item.id,sourceId:item.box_id,destinationId:'unit-42-pelican'},'aemt-user')).status,403)

 assert.equal((await call('move',{itemId:item.id,sourceId:item.box_id,destinationId:'unit-42-pelican'},'paramedic-user')).status,200)

 assert.equal((await call('definitions',{...payload,accessRules:{view:{anyTags:['Not a tag'],allTags:[]}}})).status,400)

}))

test('global action rules and custom profile combinations take effect immediately with recovery guard',()=>fixture(async({call})=>{

 const state=(await call('inventory')).data,item=state.items.find(item=>item.box_id==='unit-42-out')

 const policy={resource:'inventory.transfer',rule:{anyTags:['Service Admin'],allTags:[]}}

 assert.equal((await call('access/rules',policy)).status,200)

 assert.equal((await call('move',{itemId:item.id,sourceId:item.box_id,destinationId:'unit-42-pelican'},'paramedic-user')).status,403)

 assert.equal((await call('access/rules',{resource:'policies.edit',rule:{anyTags:['EMT'],allTags:[]}})).status,400)

 assert.equal((await call('access/rules',{resource:'inventory.transfer',rule:{anyTags:['Can Transfer'],allTags:[]}})).status,200)

 const profile=await call('access/profiles',{name:'Custom checker and transfer',tags:['EMT','User','Can Check','Can Transfer']});assert.equal(profile.status,200)

 const id=profile.data.access.profiles.find(profile=>profile.name==='Custom checker and transfer').id

 assert.equal((await call('move',{itemId:item.id,sourceId:item.box_id,destinationId:'unit-42-pelican'},id)).status,200)

 assert.equal((await call('drugs',{definitionId:item.definition_id,quantity:1},id)).status,403)

}))

test('witness capability is enforced and logs include actor, lot, and paginated historical events',()=>fixture(async({call})=>{

 const state=(await call('inventory')).data,item=state.items.find(item=>item.medication==='Fentanyl'&&item.box_id==='storage-narcotic')

 const body={reason:'used',incidentNumber:'ACCESS-1',items:[{id:item.id,boxId:item.box_id,given:25,wasted:75}],witness:'Test witness'}

 assert.equal((await call('incidents',{...body,witness:undefined},'paramedic-no-witness')).status,422)

 assert.equal((await call('incidents',body,'paramedic-no-witness')).status,200)

 const lot=await call('drugs',{definitionId:state.definitions.find(drug=>drug.name==='Aspirin').id,quantity:1,lotNumber:'LOG-LOT',expirationDate:'2029-01-01',batchCreate:true})

 assert.equal(lot.status,200)

 const entries=await call('logs?type=item&q=LOG-LOT');assert.equal(entries.status,200);assert.equal(entries.data.total,1);assert.equal(entries.data.entries[0].actor,'Service Admin — Paramedic (@test-admin)')

 const all=(await call('logs')).data;assert.equal(all.entries.length,100);assert.equal(all.hasMore,true)

 assert.ok((await call('logs?offset=100')).data.entries.length>0)

}))

