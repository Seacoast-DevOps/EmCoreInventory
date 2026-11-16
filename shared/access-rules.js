import {matrixAllowed,medicationMatrixAllowed} from './matrix-rules.js'
export const accessTags = [
 ['Driver','Clinician'],['Supervisor','Role'],['Company Admin','Role'],['Seacoast Admin','Platform'],['EMT','Clinician'],['AEMT','Clinician'],['Paramedic','Clinician'],['User','Role'],['Service Admin','Legacy'],
 ['Can Check','Capability'],['Can Transfer','Capability'],['Can Waste','Capability'],['Can Witness','Capability'],['Can Administer','Capability'],['Can Create','Capability'],['Can Edit','Capability'],['Read Only','Role'],
].map(([id,kind])=>({id,label:id,kind}))
export const policyResources = [
 ['home.view','Home · View','User'],['inventory.view','Inventory · View','User'],['stock.view','Unassigned stock · View','User'],['stock.create','Stock · Batch create','Can Create'],['inventory.transfer','Stock · Transfer / assign','Can Transfer'],['records.view','Vial records · View','User'],
 ['checks.start','Checks · Start','Can Check'],['checks.verify','Checks · Verify items','Can Check'],['checks.save','Checks · Save draft','Can Check'],['checks.complete','Checks · Complete','Can Check'],['checks.reset','Checks · Reset','Can Check'],['checks.adhoc','Checks · Ad hoc','Can Check'],
 ['incidents.view','Incidents · View','User'],['incidents.create','Incidents · Create / draft','Can Create'],['incidents.edit','Incidents · Edit','Can Edit'],['incidents.reopen','Incidents · Reopen','Can Edit'],['medications.administer','Medication · Administer','Can Administer'],['medications.waste','Medication · Waste','Can Waste'],['medications.witness','Medication · Witness','Can Witness'],
 ['definitions.view','Drug definitions · View','Service Admin'],['definitions.create','Drug definitions · Add','Service Admin'],['definitions.edit','Drug definitions · Edit','Service Admin'],['tags.view','Medication tags · View','Service Admin'],['tags.edit','Medication tags · Add / edit','Service Admin'],['classes.view','Medication classes · View','Service Admin'],['classes.edit','Medication classes · Add / edit','Service Admin'],['containers.view','Storage designer · View','Service Admin'],['containers.edit','Storage designer · Add / edit','Service Admin'],['logs.view','Logs · View','Service Admin'],['policies.view','Policies · View','Service Admin'],['policies.edit','Policies · Add / edit','Service Admin'],
['companies.create','Companies · Create','Seacoast Admin'],['companies.edit','Company contacts · Edit','Company Admin'],['companies.contacts','Company admin contacts · Manage','Company Admin'],['companies.activate','Companies · Activate / deactivate','Seacoast Admin'],['companies.delete','Companies · Hard delete','Seacoast Admin'],['discrepancies.view','Discrepancies · View','User'],['discrepancies.report','Discrepancies · Report','User'],['discrepancies.approve','Discrepancies · Approve','Supervisor'],['seals.break','Seals · Break','User'],['seals.reseal','Seals · Reseal','User']
].map(([id,label,tag])=>({id,label,defaultRule:{anyTags:[tag==='Service Admin'?'Company Admin':tag,...(['definitions.view','classes.view'].includes(id)?['User']:[]),...(['definitions.create','definitions.edit','containers.view','containers.edit','tags.view','tags.edit','classes.edit','logs.view'].includes(id)?['Supervisor']:[]),'Company Admin','Seacoast Admin'],allTags:[]}}))
export const medicationActions = ['view','create','edit','administer','check','transfer','waste','witness']
export const defaultProfiles = [
 {id:'driver',name:'Driver',tags:['Driver','User','Can Check','Can Witness']},
 {id:'supervisor',name:'Supervisor — Paramedic',tags:['Paramedic','Supervisor','User','Can Check','Can Transfer','Can Waste','Can Witness','Can Administer','Can Create','Can Edit']},
 {id:'service-admin',name:'Company Admin — Paramedic',tags:['Paramedic','User','Company Admin','Can Check','Can Transfer','Can Waste','Can Witness','Can Administer','Can Create','Can Edit']},
 {id:'paramedic-user',name:'Paramedic — full clinical user',tags:['Paramedic','User','Can Check','Can Transfer','Can Waste','Can Witness','Can Administer','Can Create','Can Edit']},
 {id:'aemt-user',name:'AEMT — clinical / transfer',tags:['AEMT','User','Can Check','Can Transfer','Can Waste','Can Witness','Can Administer','Can Create']},
 {id:'emt-checker',name:'EMT — drug checks only',tags:['EMT','User','Can Check']},
 {id:'emt-readonly',name:'EMT — read only',tags:['EMT','User','Read Only']},
 {id:'paramedic-no-witness',name:'Paramedic — no witness capability',tags:['Paramedic','User','Can Create','Can Administer','Can Waste']},
]
export function matchesRule(tags,rule) {
 tags=tags.map(t=>t==='Service Admin'?'Company Admin':t)
 rule=rule?{anyTags:rule.anyTags?.map(t=>t==='Service Admin'?'Company Admin':t),allTags:rule.allTags?.map(t=>t==='Service Admin'?'Company Admin':t)}:rule
 return (!rule?.anyTags?.length || rule.anyTags.some(tag=>tags.includes(tag))) && (!rule?.allTags?.length || rule.allTags.every(tag=>tags.includes(tag)))
}
export function permitted(profile,rules,resource) {
 if(!matrixAllowed(profile,resource))return false
 if(!profile || !policyResources.some(item=>item.id===resource))return false
 if(profile.tags.includes('Read Only') && !resource.endsWith('.view'))return false
 return matchesRule(profile.tags,rules[resource]||policyResources.find(item=>item.id===resource).defaultRule)
}
export function medicationPermitted(profile,drug,action) {
 const rules=drug?.accessRules || (typeof drug?.access_rules==='string'?JSON.parse(drug.access_rules):{})
 return medicationMatrixAllowed(profile,drug,action)&&matchesRule(profile?.tags||[],rules?.[action])
}
