export const amountUnits = ['mcg', 'mg', 'g', 'units', 'mEq', 'mmol']
export const concentrationBases = ['mL', 'vial', 'ampule', 'syringe', 'bag', 'tablet', 'pack']
export const medicationForms = ['Vial', 'Ampule', 'Prefilled syringe', 'Premixed bag', 'Tablet', 'ODT', 'Pack']
export const witnessOptions = [
  { id: 'entire', label: 'Require witness for entire medication given' },
  { id: 'partial', label: 'Require witness for partial medication given' },
  { id: 'replacement', label: 'Require witness for replacement' },
  { id: 'resealed', label: 'Require witness for resealed container' },
  { id: 'disposal', label: 'Require witness for disposal' },
  { id: 'opening', label: 'Require witness for opening medication' },
  { id: 'transfer', label: 'Require witness for transfer' },
  { id: 'seal_break', label: 'Require witness for breaking a container seal' },
]

export function definitionLabel(drug) {
  return `${drug.name} — ${drug.concentrationValue} ${drug.amountUnit}/${drug.concentrationBasis} · ${drug.maxAmount} ${drug.amountUnit} per ${drug.form.toLowerCase()}`
}
