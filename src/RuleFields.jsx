import { ClearInput } from './FormControls.jsx'
import { accessTags } from '../shared/access-rules.js'
export default function RuleFields({rule={anyTags:[],allTags:[]},onChange,disabled=false}){
 return <div className="rule-fields">{[['anyTags','Allow any of these tags'],['allTags','Also require all of these tags']].map(([key,label])=><details key={key}><summary>{label} ({rule[key]?.length||0})</summary><div className="tag-picker">{accessTags.map(tag=><label className="settings-check" key={tag.id}><ClearInput type="checkbox" disabled={disabled} checked={rule[key]?.includes(tag.id)||false} onChange={()=>onChange({...rule,[key]:rule[key]?.includes(tag.id)?rule[key].filter(id=>id!==tag.id):[...(rule[key]||[]),tag.id]})}/><span>{tag.label}<small>{tag.kind}</small></span></label>)}</div></details>)}</div>
}
