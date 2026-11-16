import {isSeacoast} from '../shared/matrix-rules.js'
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})}
export async function companyLifecycle(db,user,path,body,hooks){
 if(!isSeacoast(user)||user.tags.includes('Read Only'))fail(403,'Only Seacoast Admin can deactivate, reactivate, or delete companies')
 const company=typeof body.id==='string'?db.prepare('SELECT * FROM services WHERE id=? AND internal=0').get(body.id):null
 if(!company)fail(404,'Company not found')
 const audit=(action,details,serviceId=company.id)=>db.prepare('INSERT INTO identity_audit(service_id,actor_id,actor,action,details,created_at) VALUES(?,?,?,?,?,?)').run(serviceId,user.id,user.actor,action,JSON.stringify(details),new Date().toISOString())
 if(path.endsWith('/status')){
  if(typeof body.active!=='boolean')fail(400,'Choose company active status')
  db.prepare('UPDATE services SET active=? WHERE id=?').run(Number(body.active),company.id)
  db.prepare('DELETE FROM user_sessions WHERE service_id=?').run(company.id)
  audit(body.active?'Company reactivated':'Company deactivated',{companyId:company.id,name:company.name});return
 }
 if(body.confirmCompanyName!==company.name||body.acknowledgePermanentDeletion!==true)fail(400,'Confirm the exact company name and permanent deletion')
 if(!hooks.purgeCompany)fail(500,'Company deletion is unavailable')
 // Deny further use before touching operational data. Failed purges remain deactivated for controlled retry.
 db.prepare('UPDATE services SET active=0 WHERE id=?').run(company.id)
 db.prepare('DELETE FROM user_sessions WHERE service_id=?').run(company.id)
 await hooks.purgeCompany(company.id)
 db.exec('BEGIN IMMEDIATE');try{
  db.prepare('DELETE FROM service_memberships WHERE service_id=?').run(company.id)
  db.prepare('DELETE FROM services WHERE id=?').run(company.id)
  db.prepare('INSERT INTO company_tombstones VALUES(?,?,?,?)').run(company.id,company.name,new Date().toISOString(),user.id)
  audit('Company permanently deleted',{companyId:company.id,name:company.name},'platform')
  db.exec('COMMIT')
 }catch(e){db.exec('ROLLBACK');throw e}
}

