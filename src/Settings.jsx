import { ClearInput, SearchSelect } from './FormControls.jsx'
import { useState } from 'react'
import { Pencil, Plus, Tags } from 'lucide-react'
import { request, useInventory } from './api.js'
import { amountUnits, concentrationBases, medicationForms, witnessOptions, definitionLabel } from '../shared/catalog-options.js'
import Modal from './Modal.jsx'
import RuleFields from './RuleFields.jsx'
import { useAccess } from './access-state.js'
import { medicationActions } from '../shared/access-rules.js'

function DefinitionEditor({ drug, data, onClose, onSaved,onData }) {
  const {can}=useAccess()
  const [classId,setClassId]=useState(drug?.medicationClassId||''),[newClass,setNewClass]=useState(''),[classBusy,setClassBusy]=useState(false),[accessRules,setAccessRules]=useState(drug?.accessRules||{})
  async function addClass(){setClassBusy(true);setError('');try{const result=await request('classes',{name:newClass,description:''});onData(result);setClassId(result.classes.find(item=>item.name.toLowerCase()===newClass.trim().toLowerCase()).id);setNewClass('')}catch(error){setError(error.message)}finally{setClassBusy(false)}}
  const [hours, setHours] = useState(drug?.checkIntervalHours ?? 24)
  const [name, setName] = useState(drug?.name || '')
  const [concentration, setConcentration] = useState(drug?.concentrationValue ?? '')
  const [unit, setUnit] = useState(drug?.amountUnit || 'mg')
  const [basis, setBasis] = useState(drug?.concentrationBasis || 'mL')
  const [maxAmount, setMaxAmount] = useState(drug?.maxAmount ?? '')
  const [form, setForm] = useState(drug?.form || 'Vial')
  const [tagIds, setTagIds] = useState(drug?.tagIds || [])
  const [targets, setTargets] = useState(Object.fromEntries(data.parLevels.filter(par => par.definitionId === drug?.id).map(par => [par.boxId, par.target])))
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await request('definitions', { ...(drug?.id ? { id: drug.id } : {}), name, concentrationValue: Number(concentration), amountUnit: unit, concentrationBasis: basis, maxAmount: Number(maxAmount), form, tagIds,medicationClassId:classId,accessRules, checkIntervalHours:Number(hours),
        parTargets: Object.entries(targets).filter(([, value]) => value !== '').map(([boxId, target]) => ({ boxId, target: Number(target) })) })
      onSaved(result); onClose()
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }
  return <Modal title={drug?.id ? 'Edit drug & par levels' : 'Add drug definition'} busy={busy} onClose={onClose}><form className="form-stack" onSubmit={save}>
    {drug?.hasStock && <p>Drug details are locked because this definition has stock. Tags and par quantities can still be edited.</p>}
    <label>Drug name<ClearInput clearLabel="Drug name" className="form-control" required maxLength={100} disabled={drug?.hasStock} value={name} onChange={event => setName(event.target.value)}/></label>
    <label>Medication class<SearchSelect clearLabel="Medication class" aria-label="Medication class" className="form-select" value={classId} onChange={event=>setClassId(event.target.value)}><option value="">No class</option>{data.classes.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</SearchSelect></label>
    {can('classes.edit')&&<div className="inline-class-create"><label>New class name<ClearInput clearLabel="New class name" aria-label="New class name" className="form-control" maxLength={100} value={newClass} onChange={event=>setNewClass(event.target.value)}/></label><button type="button" className="cancel-button" disabled={classBusy||!newClass.trim()} onClick={addClass}>Add class</button></div>}
    <fieldset className="settings-fieldset"><legend>Concentration</legend><div className="concentration-grid"><label>Amount<ClearInput clearLabel="Amount" aria-label="Concentration amount" className="form-control" type="number" step="any" min="0.000000001" max="1000000000" required disabled={drug?.hasStock} value={concentration} onChange={event => setConcentration(event.target.value)}/></label><label>Unit<SearchSelect clearLabel="Unit" aria-label="Concentration unit" className="form-select" disabled={drug?.hasStock} value={unit} onChange={event => setUnit(event.target.value)}>{amountUnits.map(unit => <option key={unit}>{unit}</option>)}</SearchSelect></label><label>Per<SearchSelect clearLabel="Per" aria-label="Concentration basis" className="form-select" disabled={drug?.hasStock} value={basis} onChange={event => setBasis(event.target.value)}>{concentrationBases.map(basis => <option key={basis}>{basis}</option>)}</SearchSelect></label></div></fieldset>
    <label>Maximum amount per vial / container ({unit})<ClearInput aria-label="Maximum amount per container" className="form-control" type="number" step="any" min="0.000000001" max="1000000000" required disabled={drug?.hasStock} value={maxAmount} onChange={event => setMaxAmount(event.target.value)}/></label>
    <p className="field-help">Total labelled medication content in one item.</p>
    <label>Presentation<SearchSelect clearLabel="Presentation" aria-label="Presentation" className="form-select" disabled={drug?.hasStock} value={form} onChange={event => setForm(event.target.value)}>{medicationForms.map(form => <option key={form}>{form}</option>)}</SearchSelect></label>
    <label>Check this drug type every (hours)<ClearInput clearLabel="Check this drug type every (hours)" className="form-control" type="number" min="0" max="8760" step="any" required value={hours} onChange={event=>setHours(event.target.value)}/></label><p className="field-help">0 = no drug-specific schedule. Container schedules still apply.</p>{drug?.sourceNote && <p className="field-help">{drug.sourceNote} <a href={drug.sourceUrl} target="_blank" rel="noreferrer">Maine EMS source</a></p>}
    <fieldset className="settings-fieldset"><legend>Medication tags</legend>{data.tags.map(tag => <label className="settings-check" key={tag.id}><ClearInput type="checkbox" checked={tagIds.includes(tag.id)} onChange={() => setTagIds(current => current.includes(tag.id) ? current.filter(id => id !== tag.id) : [...current, tag.id])}/><span>{tag.name}<small>{tag.requirements.length} witness rules</small></span></label>)}</fieldset>
    <fieldset className="settings-fieldset"><legend>Medication access policies</legend><p>Inherit page/action permissions when empty. Any-tag matches and all-tag requirements combine with the selected profile's clinician, role, and capability tags.</p>{medicationActions.map(action=><details className="med-policy-action" key={action}><summary>{action==='edit'?'Edit medication records':action[0].toUpperCase()+action.slice(1)}</summary><RuleFields rule={accessRules[action]||{anyTags:[],allTags:[]}} onChange={rule=>setAccessRules(current=>({...current,[action]:rule}))}/></details>)}</fieldset>
    <fieldset className="settings-fieldset"><legend>Par quantities</legend><p>Target number of individual items in each container. Leave blank for no target.</p>{data.boxes.filter(box=>box.id!=='unassigned').map(box => <label className="par-input" key={box.id}><span>{box.location}<small>{box.name}</small></span><ClearInput className="form-control" aria-label={'Par quantity for ' + box.location + ' ' + box.name} type="number" min="0" max="10000" step="1" value={targets[box.id] ?? ''} placeholder="—" onChange={event => setTargets(current => ({ ...current, [box.id]: event.target.value }))}/></label>)}</fieldset>
    {error && <p className="error-note" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="cancel-button" disabled={busy} onClick={onClose}>Cancel</button><button className="action-primary" disabled={busy}>{busy ? 'Saving…' : 'Save drug & par levels'}</button></div>
  </form></Modal>
}

function TagEditor({ tag, onClose, onSaved }) {
  const [name, setName] = useState(tag?.name || ''), [rules, setRules] = useState(tag?.requirements || [])
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { onSaved(await request('tags', { ...(tag ? { id: tag.id } : {}), name, requirements: rules })); onClose() }
    catch (error) { setError(error.message) } finally { setBusy(false) }
  }
  return <Modal title={tag ? 'Edit medication tag' : 'Add medication tag'} busy={busy} onClose={onClose}><form className="form-stack" onSubmit={save}>
    <label>Tag name<ClearInput clearLabel="Tag name" className="form-control" required maxLength={100} value={name} onChange={event => setName(event.target.value)}/></label>
    <fieldset className="settings-fieldset"><legend>Witness requirements</legend>{witnessOptions.map(option => <label className="settings-check" key={option.id}><ClearInput type="checkbox" checked={rules.includes(option.id)} onChange={() => setRules(current => current.includes(option.id) ? current.filter(id => id !== option.id) : [...current, option.id])}/><span>{option.label}</span></label>)}</fieldset>
    <p>Enabled rules require a second user to sign in as witness for medication use, waste, replacement, or container actions.</p>
    {error && <p className="error-note" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="cancel-button" disabled={busy} onClick={onClose}>Cancel</button><button className="action-primary" disabled={busy}>{busy ? 'Saving…' : 'Save tag'}</button></div>
  </form></Modal>
}

export default function Settings({ section }) {
  const {can}=useAccess()
  const { data, setData, error, reload } = useInventory()
  const [editing, setEditing] = useState(null), [notice, setNotice] = useState('')
  const isTags = section === 'tags'
  if (!data) return <section className="card"><p role="status">{error || 'Loading settings…'}</p>{error && <button className="action-primary" onClick={reload}>Retry</button>}</section>
  const legacy = [...new Map(data.items.filter(item => !item.definition_id).map(item => [item.medication, { name: item.medication }])).values()]
  function saved(result) { setData(result); setNotice(isTags ? 'Tag saved.' : 'Drug definition and par levels saved.') }
  return <section className="settings-page"><div className="settings-toolbar"><button className="action-primary" disabled={!can(isTags?'tags.edit':'definitions.create')} onClick={() => setEditing({})}><Plus size={18}/> {isTags ? 'Add tag' : 'Add drug'}</button></div>
    <p className="inventory-status" role="status">{notice}</p>
    {isTags ? <div className="settings-list">{data.tags.map(tag => <article className="settings-card" key={tag.id}><div className="settings-card-heading"><h2><Tags size={20}/>{tag.name}</h2><button className="icon-button" disabled={!can('tags.edit')} aria-label={'Edit tag ' + tag.name} onClick={() => setEditing(tag)}><Pencil size={18}/></button></div><ul className="rule-list">{tag.requirements.map(rule => <li key={rule}>{witnessOptions.find(option => option.id === rule)?.label}</li>)}</ul>{!tag.requirements.length && <p>No witness requirements.</p>}</article>)}</div> : <>
      {!data.definitions.length && <p className="empty-settings">Add the first standardized drug, then choose it when receiving stock.</p>}
      <div className="settings-list">{data.definitions.map(drug => {
        const pars = data.parLevels.filter(par => par.definitionId === drug.id)
        return <article className="settings-card" key={drug.id}><div className="settings-card-heading"><h2>{drug.name}</h2><button className="icon-button" disabled={!can('definitions.edit')} aria-label={'Edit drug ' + drug.name} onClick={() => setEditing(drug)}><Pencil size={18}/></button></div>{drug.medicationClassId&&<p className="med-class-label">{data.classes.find(item=>item.id===drug.medicationClassId)?.name}</p>}<p>{definitionLabel(drug).split(' — ').slice(1).join(' — ')}</p><div className="medication-tags">{drug.tagIds.map(id => <span key={id}>{data.tags.find(tag => tag.id === id)?.name}</span>)}</div>{pars.length ? <ul className="par-status-list">{pars.map(par => {
          const box = data.boxes.find(box => box.id === par.boxId), count = data.items.filter(item => item.definition_id === drug.id && item.box_id === par.boxId).length
          return <li key={par.boxId}><span>{box.location}<small>{box.name}</small></span><strong className={count < par.target ? 'below-par' : ''}>{count} / {par.target}</strong></li>
        })}</ul> : <p>No par targets set.</p>}</article>
      })}</div>
      {legacy.length > 0 && <details className="legacy-definitions"><summary>Existing drug names</summary><p>Use a name to start a definition. Enter the labelled concentration and amount. Existing item records stay unchanged.</p><div>{legacy.map(drug => <button className="cancel-button" disabled={!can('definitions.create')} key={drug.name} onClick={() => setEditing(drug)}>{drug.name}<Plus size={16}/></button>)}</div></details>}
    </>}
    {editing && (isTags ? <TagEditor tag={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={saved}/> : <DefinitionEditor onData={setData} drug={editing} data={data} onClose={() => setEditing(null)} onSaved={saved}/>)}
  </section>
}
