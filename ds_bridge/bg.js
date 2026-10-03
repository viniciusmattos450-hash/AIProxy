// bg.js v5 - bridge com memoria
let autoSend = false;

async function call(path, method, body){
  const opt = { method: method, headers: {"Content-Type":"application/json"} };
  if (body) opt.body = JSON.stringify(body);
  const r = await fetch("http://127.0.0.1:8765" + path, opt);
  return r.json();
}

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "getState")    return Promise.resolve({ autoSend: autoSend });
  if (msg.type === "setAutoSend"){
    autoSend = !!msg.value;
    return Promise.resolve({ autoSend: autoSend });
  }
  if (msg.type === "run")         return call("/run","POST",{code:msg.code})
                                     .then(j=>({ok:true,output:j.output}))
                                     .catch(e=>({ok:false,output:"(offline) "+e.message}));
  if (msg.type === "memory")      return call("/memory","POST",{text:msg.text}).catch(e=>({ok:false,error:e.message}));
  if (msg.type === "memoryAppend")return call("/memory/append","POST",{text:msg.text}).catch(e=>({ok:false,error:e.message}));
  if (msg.type === "todoAdd")     return call("/todo/add","POST",{id:msg.id,text:msg.text}).catch(e=>({ok:false,error:e.message}));
  if (msg.type === "todoState")   return call("/todo/state","POST",{id:msg.id,state:msg.state}).catch(e=>({ok:false,error:e.message}));
  if (msg.type === "briefing")    return call("/context","GET").then(j=>({ok:true,context:j.context})).catch(e=>({ok:false,error:e.message}));
  if (msg.type === "cliInbox")    return call("/cli/inbox","GET").catch(e=>({ok:false,error:e.message}));
  if (msg.type === "cliAck")      return call("/cli/inbox/ack","POST",{id:msg.id}).catch(e=>({ok:false}));
  if (msg.type === "cliReply")    return call("/cli/reply","POST",{text:msg.text}).catch(e=>({ok:false}));
  if (msg.type === "cliStream")   return call("/cli/stream","POST",{text:msg.text, done:msg.done}).catch(e=>({ok:false}));
  return true;
});

console.log("[bridge bg] v5 carregado");
