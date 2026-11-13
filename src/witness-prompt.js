let handler=null
export function setWitnessPrompt(next){handler=next;return()=>{if(handler===next)handler=null}}
export function askWitness(details){return handler?handler(details):Promise.resolve(null)}
