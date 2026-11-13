import {randomUUID,createHash} from 'node:crypto'
import {verifyWitnessCredentials} from './auth.js'
import {accessContext,authorize,authorizeMedication,drugForItem} from './permissions.js'
const resolvers=new WeakMap()
export function migrateWitnesses(db){db.exec(`CREATE TABLE IF NOT EXISTS witness_signoffs(id TEXT PRIMARY KEY,actor_user_id TEXT NOT NULL,witness_user_id TEXT NOT NULL,witness_username TEXT NOT NULL,witness_name TEXT NOT NULL,service_id TEXT NOT NULL,action TEXT NOT NULL,request_hash TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS immutable_witness_signoffs BEFORE UPDATE ON witness_signoffs BEGIN SELECT RAISE(ABORT,'Witness signoffs are immutable'); END;
 CREATE TRIGGER IF NOT EXISTS retain_witness_signoffs BEFORE DELETE ON witness_signoffs BEGIN SELECT RAISE(ABORT,'Witness signoffs are permanent'); END;`)}
export function requireAuthenticatedWitness(body){const resolve=resolvers.get(body);if(!resolve)throw Object.assign(new Error('A second user must sign off with their username and password.'),{status:422,witnessRequired:true});resolve()}
export function attachWitness({db,identityDb,context,req,path,body}){
 const credentials=body.witnessCredentials
 delete body.witnessCredentials;delete body.witnessSignoff;delete body.witness;delete body.witnessVerified
 const items=new Map()
 const collect=id=>{if(typeof id==='string'){const item=db.prepare('SELECT * FROM inventory_items WHERE id=?').get(id);if(item)items.set(item.id,item)}}
 collect(body.itemId)
 if(Array.isArray(body.items))for(const item of body.items)collect(item?.id)
 if(path.startsWith('/api/incidents')&&Number.isInteger(body.id))for(const row of db.prepare('SELECT item_id FROM incident_allocations WHERE incident_id=?').all(body.id))collect(row.item_id)
 const boxes=[body.sourceId,body.destinationId,body.boxId,...items.values()].map(box=>box&&typeof box==='object'?box.box_id:box).filter(id=>typeof id==='string')
 if(path==='/api/containers'&&typeof body.id==='string')boxes.push(body.id)
 for(const id of new Set(boxes))for(const item of db.prepare("SELECT * FROM inventory_items WHERE box_id=? AND status IN ('available','opened')").all(id)){
  // Container witnesses cover all contents only when breaking/resealing that container.
  const box=db.prepare('SELECT * FROM inventory_boxes WHERE id=?').get(id)
  if(path==='/api/containers'||box?.sealed)items.set(item.id,item)
 }
 const summary={notes:body.notes||'',correctionNote:body.correctionNote||'',container:path==='/api/containers'?{name:body.name,location:body.location,sealed:body.sealed,seal:body.seal}:null,sealBreaks:Array.isArray(body.brokenSeals)?body.brokenSeals.map(seal=>({seal:seal?.seal,container:typeof seal?.id==='string'?db.prepare('SELECT name FROM inventory_boxes WHERE id=?').get(seal.id)?.name:''})):[],action:({'/api/move':'Transfer medication','/api/drugs':'Receive replacement medication','/api/containers':'Change container seal','/api/incidents':'Save medication incident'}[path]||'Save medication record'),incidentNumber:body.incidentNumber||'',reason:body.reason||'',quantity:body.quantity||null,lotNumber:body.lotNumber||'',destination:typeof body.destinationId==='string'?db.prepare('SELECT location,name FROM inventory_boxes WHERE id=?').get(body.destinationId):null,items:[...items.values()].map(item=>{const dose=body.items?.find?.(row=>row?.id===item.id);return {code:item.code,medication:item.medication,presentation:item.presentation,unit:JSON.parse(item.definition_snapshot||'{}').amountUnit||'',given:dose?.given??null,wasted:dose?.wasted??null}})}
 if(typeof body.definitionId==='string'){const drug=db.prepare('SELECT * FROM drug_definitions WHERE id=?').get(body.definitionId);if(drug)summary.medication=drug.name}
 let verified=false
 resolvers.set(body,()=>{
  if(verified)return
  const problem=message=>{throw Object.assign(new Error(message),{status:422,witnessRequired:true,witnessSummary:summary})}
  if(!credentials)problem('A second user must sign off with their own username and password.')
  let witness;try{witness=verifyWitnessCredentials(identityDb,credentials,context.user,req.socket.remoteAddress)}catch(error){throw Object.assign(error,{witnessRequired:true,witnessSummary:summary})}
  try{const witnessContext=accessContext(db,'service-admin',witness);authorize(witnessContext,'medications.witness');for(const item of items.values()){authorizeMedication(witnessContext,drugForItem(db,item),'view');authorizeMedication(witnessContext,drugForItem(db,item),'witness')}if(typeof body.definitionId==='string'){const drug=db.prepare('SELECT * FROM drug_definitions WHERE id=?').get(body.definitionId);if(drug){authorizeMedication(witnessContext,drug,'view');authorizeMedication(witnessContext,drug,'witness')}}}catch{problem('This user is not permitted to witness the selected medication(s).')}
  const signoff={id:randomUUID(),userId:witness.id,username:witness.username,name:witness.name,serviceId:context.user.serviceId,signedAt:new Date().toISOString(),method:'password'}
  db.prepare('INSERT INTO witness_signoffs VALUES(?,?,?,?,?,?,?,?,?)').run(signoff.id,context.user.id,witness.id,witness.username,witness.name,context.user.serviceId,path,createHash('sha256').update(JSON.stringify(body)).digest('hex'),signoff.signedAt)
  body.witnessSignoff=signoff;body.witness=witness.name+' (@'+witness.username+')';verified=true
 })
}
