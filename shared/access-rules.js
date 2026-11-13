export const accessTags = [
 ['EMT','Clinician'],['AEMT','Clinician'],['Paramedic','Clinician'],['User','Role'],['Service Admin','Role'],
 ['Can Check','Capability'],['Can Transfer','Capability'],['Can Waste','Capability'],['Can Witness','Capability'],['Can Administer','Capability'],['Can Create','Capability'],['Can Edit','Capability'],['Read Only','Role'],
].map(([id,kind])=>({id,label:id,kind}))
export const policyResources = [
 ['home.view','Home · View','User'],['inventory.view','Inventory · View','User'],['stock.view','Unassigned stock · View','User'],['stock.create','Stock · Batch create','Can Create'],['inventory.transfer','Stock · Transfer / assign','Can Transfer'],['records.view','Vial records · View','User'],
 ['checks.start','Checks · Start','Can Check'],['checks.verify','Checks · Verify items','Can Check'],['checks.save','Checks · Save draft','Can Check'],['checks.complete','Checks · Complete','Can Check'],['checks.reset','Checks · Reset','Can Check'],['checks.adhoc','Checks · Ad hoc','Can Check'],
 ['incidents.view','Incidents · View','User'],['incidents.create','Incidents · Create / draft','Can Create'],['incidents.edit','Incidents · Edit','Can Edit'],['incidents.reopen','Incidents · Reopen','Can Edit'],['medications.administer','Medication · Administer','Can Administer'],['medications.waste','Medication · Waste','Can Waste'],['medications.witness','Medication · Witness','Can Witness'],
 ['definitions.view','Drug definitions · View','Service Admin'],['definitions.create','Drug definitions · Add','Service Admin'],['definitions.edit','Drug definitions · Edit','Service Admin'],['tags.view','Medication tags · View','Service Admin'],['tags.edit','Medication tags · Add / edit','Service Admin'],['classes.view','Medication classes · View','Service Admin'],['classes.edit','Medication classes · Add / edit','Service Admin'],['containers.view','Storage designer · View','Service Admin'],['containers.edit','Storage designer · Add / edit','Service Admin'],['logs.view','Logs · View','Service Admin'],['policies.view','Policies · View','Service Admin'],['policies.edit','Policies · Add / edit','Service Admin'],
].map(([id,label,tag])=>({id,label,defaultRule:{anyTags:[tag,'Service Admin'],allTags:[]}}))
export const medicationActions = ['view','create','edit','administer','check','transfer','waste','witness']
export const defaultProfiles = [
 {id:'service-admin',name:'Service Admin — Paramedic',tags:accessTags.filter(tag=>tag.id!=='EMT'&&tag.id!=='AEMT'&&tag.id!=='Read Only').map(tag=>tag.id)},
 {id:'paramedic-user',name:'Paramedic — full clinical user',tags:['Paramedic','User','Can Check','Can Transfer','Can Waste','Can Witness','Can Administer','Can Create','Can Edit']},
 {id:'aemt-user',name:'AEMT — clinical / transfer',tags:['AEMT','User','Can Check','Can Transfer','Can Waste','Can Witness','Can Administer','Can Create']},
 {id:'emt-checker',name:'EMT — drug checks only',tags:['EMT','User','Can Check']},
 {id:'emt-readonly',name:'EMT — read only',tags:['EMT','User','Read Only']},
 {id:'paramedic-no-witness',name:'Paramedic — no witness capability',tags:['Paramedic','User','Can Create','Can Administer','Can Waste']},
]
export function matchesRule(tags,rule) {
 return (!rule?.anyTags?.length || rule.anyTags.some(tag=>tags.includes(tag))) && (!rule?.allTags?.length || rule.allTags.every(tag=>tags.includes(tag)))
}
export function permitted(profile,rules,resource) {
 if(!profile || !policyResources.some(item=>item.id===resource))return false
 if(profile.tags.includes('Read Only') && !resource.endsWith('.view'))return false
 return matchesRule(profile.tags,rules[resource]||policyResources.find(item=>item.id===resource).defaultRule)
}
export function medicationPermitted(profile,drug,action) {
 const rules=drug?.accessRules || (typeof drug?.access_rules==='string'?JSON.parse(drug.access_rules):{})
 return matchesRule(profile?.tags||[],rules?.[action])
}
