// content.js v8 - choice inline + sendBtn corrigido + msg id
var processed = new Set();
var processedChoices = new Set();
var processedMsgs = new Set();
var lastLen = 0, stableSince = 0, busy = false, autoSend = false;
var lastAutoSend = 0;
var AUTO_DELAY = 3000;
var QUOTA_MAX = 30;
var MAX_SCRIPTS_PER_MSG = 3;
var quotaUsado = 0;
var MIN_INTERVAL = 8000;

function hash(s){var h=0;for(var i=0;i<s.length;i++)h=((h<<5)-h+s.charCodeAt(i))|0;return h;}
function bg(msg){ return browser.runtime.sendMessage(msg); }
function getState(){ return bg({type:"getState"}); }
function setAuto(v){ autoSend = v; return bg({type:"setAutoSend", value:v}); }
function q(sel){ return document.querySelector(sel); }

function textarea(){
  return q('textarea[placeholder*="Mensagem"], textarea._27c9245, textarea');
}

function sendBtn(){
  // procura botao circular de enviar (arrow up) no composer
  var cands = document.querySelectorAll('[role="button"][class*="ds-button--filled"]');
  for (var i=cands.length-1; i>=0; i--){
    var c = cands[i];
    var cls = c.className || "";
    // send: circle + filled ; exclui paperclip/upload que sao capsule sem circle
    if (cls.indexOf("circle") >= 0) return c;
  }
  // fallback: qualquer ds-button--primary filled
  var p = document.querySelector('[role="button"][class*="ds-button--primary"][class*="ds-button--filled"]');
  if (p) return p;
  // ultimo fallback: botao perto do textarea
  var ta = textarea();
  if (ta){
    var par = ta.closest('div');
    while (par){
      var btns = par.querySelectorAll('[role="button"]');
      for (var j=btns.length-1; j>=0; j--){
        if ((btns[j].className||"").indexOf("ds-button")>=0) return btns[j];
      }
      par = par.parentElement;
    }
  }
  return null;
}

function lastAssistantEl(){
  var all = document.querySelectorAll('.ds-assistant-message-main-content');
  return all[all.length-1] || null;
}


// Le innerText de um elemento VIVO escondendo temporariamente as caixas da bridge
function getTextPreservingLines(el){
  var meus = el.querySelectorAll('[data-bridge-box]');
  var saved = [];
  for (var i=0;i<meus.length;i++){
    saved.push([meus[i], meus[i].style.display]);
    meus[i].style.display = 'none';
  }
  var BLOCK = /^(P|DIV|H[1-6]|LI|PRE|BLOCKQUOTE|UL|OL|BR|HR|TABLE|TR|SECTION|ARTICLE|HEADER|FOOTER|ASIDE|NAV|FIGURE|FIGCAPTION)$/;
  var out = [];
  var NL = String.fromCharCode(10);
  function pushNl(){
    if (!out.length) return;
    var last = out[out.length-1];
    if (last && last.charAt(last.length-1) === NL) return;
    out.push(NL);
  }
  function walk(node){
    if (node.nodeType === 3){ out.push(node.nodeValue); return; }
    if (node.nodeType !== 1) return;
    var tag = node.tagName;
    var cls = (node.className || "") + "";
    // pula botoes, svgs, cabecalhos de code block
    if (tag === "BUTTON" || tag === "SVG" || tag === "PATH" || tag === "INPUT") return;
    if (cls.indexOf("md-code-block-banner") >= 0) return;
    if (cls.indexOf("code-info-button-text") >= 0) return;
    if (cls.indexOf("d813de27") >= 0) return;
    if (cls.indexOf("efa13877") >= 0) return;
    if (cls.indexOf("_121d384") >= 0) return;
    if (cls.indexOf("ds-button") >= 0) return;
    var isBlock = BLOCK.test(tag);
    if (tag === "BR"){ out.push(NL); return; }
    if (isBlock) pushNl();
    for (var i=0;i<node.childNodes.length;i++) walk(node.childNodes[i]);
    if (isBlock) pushNl();
  }
  walk(el);
  var text = out.join('');
  while (text.indexOf(NL+NL+NL) >= 0) text = text.replace(NL+NL+NL, NL+NL);
  var tlines = text.split(NL);
  for (var k=0;k<tlines.length;k++) tlines[k] = tlines[k].replace(/[ ]+$/, '');
  text = tlines.join(NL).trim();
  for (var j=0;j<saved.length;j++) saved[j][0].style.display = saved[j][1] || '';
  return text;
}

function msgId(el){
  var m = el.closest('[data-virtual-list-item-key]');
  if (m) return m.getAttribute('data-virtual-list-item-key');
  return "h:" + hash((el.innerText||"").slice(0, 200));
}

var SCRIPT_RE   = /^\[SCRIPT\][ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\[\/SCRIPT\][ \t]*$/gm;
var MEMORY_RE   = /^\[MEMORY\][ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\[\/MEMORY\][ \t]*$/gm;
var MEM_APP_RE  = /^\[MEMORY_APPEND\][ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\[\/MEMORY_APPEND\][ \t]*$/gm;
var TODO_ADD_RE = /^\[TODO_ADD(?:\s+id=([\w\-]+))?\][ \t]*([^\n]*?)[ \t]*\[\/TODO_ADD\][ \t]*$/gm;
var TODO_ST_RE  = /^\[TODO_(START|PAUSE|DONE)\s+id=([\w\-]+)\][ \t]*$/gm;
var CHOICE_INLINE_RE = /\[CHOICE\]([^\[\]]*?)\[\/CHOICE\]/g;

function extractBlocks(el){
  var scripts=[], mems=[], memApps=[], adds=[], states=[], choices=[];
  var seen = new Set();
  var pres = el.querySelectorAll('pre');
  for (var i=0;i<pres.length;i++){
    var t = (pres[i].textContent || "").replace(/\u00a0/g, " ");
    var m, k;
    // varre CHOICE dentro de pre (alguns modelos colocam aqui)
    CHOICE_RE.lastIndex=0;
    while ((m=CHOICE_RE.exec(t))!==null){ k=hash('ch'+m[1]); if(!seen.has(k)){seen.add(k);choices.push(m[1].trim());} }
    SCRIPT_RE.lastIndex=0;
    while ((m=SCRIPT_RE.exec(t))!==null){ k=hash("s"+m[1]); if(!seen.has(k)){seen.add(k);scripts.push(m[1]);} }
    MEMORY_RE.lastIndex=0;
    while ((m=MEMORY_RE.exec(t))!==null){ k=hash("m"+m[1]); if(!seen.has(k)){seen.add(k);mems.push(m[1]);} }
    MEM_APP_RE.lastIndex=0;
    while ((m=MEM_APP_RE.exec(t))!==null){ k=hash("a"+m[1]); if(!seen.has(k)){seen.add(k);memApps.push(m[1]);} }
    TODO_ADD_RE.lastIndex=0;
    while ((m=TODO_ADD_RE.exec(t))!==null){ k=hash("t"+m[0]); if(!seen.has(k)){seen.add(k);adds.push({id:m[1]||null, text:m[2]});} }
    TODO_ST_RE.lastIndex=0;
    while ((m=TODO_ST_RE.exec(t))!==null){ k=hash("st"+m[0]); if(!seen.has(k)){seen.add(k);states.push({action:m[1], id:m[2]});} }
  }
  // CHOICE em qualquer texto
  var clone2 = el.cloneNode(true);
  var meus = clone2.querySelectorAll('[data-bridge-box]');
  for (var j=0;j<meus.length;j++) meus[j].remove();
  var plain = (clone2.innerText || "").replace(/\u00a0/g, " ");
  CHOICE_INLINE_RE.lastIndex=0;
  var m2;
  while ((m2=CHOICE_INLINE_RE.exec(plain))!==null){
    var txt = m2[1].trim();
    if (!txt) continue;
    var kk = hash("ch"+txt);
    if (seen.has(kk)) continue;
    seen.add(kk); choices.push(txt);
  }
  return { scripts:scripts, mems:mems, memApps:memApps, adds:adds, states:states, choices:choices };
}

// substitui [CHOICE]texto[/CHOICE] por botao inline no proprio texto
function inlineChoices(el){
  var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  var toReplace = [];
  var n;
  while ((n = walker.nextNode())){
    if (n.parentElement && n.parentElement.hasAttribute && n.parentElement.hasAttribute('data-bridge-box')) continue;
    var val = n.nodeValue || "";
    if (val.indexOf("[CHOICE]") >= 0) toReplace.push(n);
  }
  for (var i=0;i<toReplace.length;i++){
    var node = toReplace[i];
    var text = node.nodeValue;
    var re = /\[CHOICE\]([^\[\]]*?)\[\/CHOICE\]/g;
    var parts = [], last = 0, m;
    while ((m = re.exec(text)) !== null){
      if (m.index > last) parts.push({type:"text", value: text.slice(last, m.index)});
      parts.push({type:"choice", value: m[1]});
      last = m.index + m[0].length;
    }
    if (!parts.length) continue;
    if (last < text.length) parts.push({type:"text", value: text.slice(last)});
    var frag = document.createDocumentFragment();
    for (var p=0;p<parts.length;p++){
      var pt = parts[p];
      if (pt.type === "text"){
        frag.appendChild(document.createTextNode(pt.value));
      } else {
        var btn = document.createElement("button");
        btn.setAttribute("data-bridge-box","1");
        btn.textContent = pt.value;
        btn.style.cssText = "background:#21262d;color:#e6edf3;border:1px solid #58a6ff;border-radius:6px;padding:6px 12px;font:13px system-ui;cursor:pointer;margin:2px 4px;display:inline-block;";
        btn.onmouseenter = function(){ this.style.background = "#30363d"; };
        btn.onmouseleave = function(){ this.style.background = "#21262d"; };
        (function(txt){
          btn.addEventListener("click", function(ev){
            ev.preventDefault(); ev.stopPropagation();
            sendText(txt);
          }, true);
        })(pt.value);
        frag.appendChild(btn);
      }
    }
    try { node.parentNode.replaceChild(frag, node); } catch(e){}
  }
}

async function processBlocks(el){
  var b = extractBlocks(el);
  function uniq(arr, prefix){
    return arr.filter(function(x){
      var k = hash(prefix + (typeof x === "string" ? x : JSON.stringify(x)));
      if (processed.has(k)) return false;
      processed.add(k); return true;
    });
  }
  var scripts = uniq(b.scripts, "s:");
  var mems    = uniq(b.mems, "m:");
  var memApps = uniq(b.memApps, "a:");
  var adds    = uniq(b.adds, "t:");
  var states  = uniq(b.states, "st:");

  var R = { memory:null, memApp:0, todosAdded:[], todoStates:[], scripts:[] };

  if (mems.length){ await bg({type:"memory", text:mems[mems.length-1]}); R.memory="memoria substituida"; }
  for (var i=0;i<memApps.length;i++){ await bg({type:"memoryAppend", text:memApps[i]}); R.memApp++; }
  for (var j=0;j<adds.length;j++){ var r = await bg({type:"todoAdd", id:adds[j].id, text:adds[j].text}); R.todosAdded.push(adds[j].text + (r && r.id ? " -> "+r.id : "")); }
  var map = {START:"doing", PAUSE:"paused", DONE:"done"};
  for (var s=0;s<states.length;s++){ await bg({type:"todoState", id:states[s].id, state:map[states[s].action]}); R.todoStates.push(states[s].id+" -> "+states[s].action); }
  for (var c=0;c<scripts.length;c++){
    try { var out = await bg({type:"run", code:scripts[c]}); R.scripts.push(out.output); }
    catch(e){ R.scripts.push("(erro) " + e.message); }
  }
  return R;
}

async function tick(){
  if (busy) return;
  var el = lastAssistantEl(); if (!el) return;

  var id = msgId(el);
  var clone = el.cloneNode(true);
  var meus = clone.querySelectorAll('[data-bridge-box]');
  for (var i=0;i<meus.length;i++) meus[i].remove();
  var text = clone.innerText || "";

  if (!/\[(SCRIPT|MEMORY|TODO_|CHOICE)\]/.test(text)){
    // sem marcadores - talvez seja resposta pro CLI. Espera estabilizar e empurra.
    if (text.length !== lastLen){ lastLen = text.length; stableSince = Date.now(); return; }
    if (Date.now() - stableSince < 1500) return;
    cliPushReply(text);
    return;
  }

  if (processedMsgs.has(id)) return;

  if (text.length !== lastLen){ lastLen = text.length; stableSince = Date.now(); return; }
  if (Date.now() - stableSince < 1800) return;

  // === choices primeiro, sempre (mesmo se msg ja vista) ===
  try { inlineChoices(el); } catch(e){ console.warn("[bridge] inlineChoices:", e); }

  // se msg ja processada pra scripts/mem/todo, para aqui
  if (processedMsgs.has(id)) return;

  var b = extractBlocks(el);
  function temNovo(arr, prefix){
    return arr.some(function(x){
      var k = hash(prefix + (typeof x === "string" ? x : JSON.stringify(x)));
      return !processed.has(k);
    });
  }
  var novo = temNovo(b.scripts,"s:") || temNovo(b.mems,"m:") || temNovo(b.memApps,"a:")
          || temNovo(b.adds,"t:") || temNovo(b.states,"st:");

  if (!novo){
    processedMsgs.add(id);
    return;
  }

  busy = true;
  var __st = await getState();
  autoSend = !!__st.autoSend;
  var box = document.createElement("pre");
  box.setAttribute("data-bridge-box","1");
  box.style.cssText = "background:#0d1117;color:#c9d1d9;padding:10px 12px;border-radius:6px;margin:8px 0;font:12px/1.45 ui-monospace,Consolas,monospace;overflow:auto;max-height:340px;white-space:pre-wrap;border-left:3px solid #d29922;position:relative;";
  box.textContent = "processando...";
  el.appendChild(box);
  // botao enviar manual
  var sendBar = document.createElement("div");
  sendBar.setAttribute("data-bridge-box","1");
  sendBar.style.cssText = "margin:-4px 0 8px 0;";
  var sendBtnEl = document.createElement("button");
  sendBtnEl.textContent = "▶ enviar";
  sendBtnEl.style.cssText = "background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:5px 12px;font:12px monospace;cursor:pointer;margin-right:6px;";
  sendBtnEl.disabled = true;
  sendBtnEl.style.opacity = "0.5";
  var copyBtn = document.createElement("button");
  copyBtn.textContent = "copiar";
  copyBtn.style.cssText = "background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:5px 12px;font:12px monospace;cursor:pointer;";
  copyBtn.disabled = true;
  copyBtn.style.opacity = "0.5";
  sendBar.appendChild(sendBtnEl);
  sendBar.appendChild(copyBtn);
  el.appendChild(sendBar);
  sendBtnEl.addEventListener("click", async function(ev){
    ev.preventDefault(); ev.stopPropagation();
    var txt = box.textContent;
    if (txt && txt.length > 20){
      await sendText("[RESULTADO]\n```\n" + txt.replace(/^> (EXECUTADO|NAO ENVIADO[^\n]*)\n/, "") + "\n```");
    }
  }, true);
  copyBtn.addEventListener("click", function(ev){
    ev.preventDefault(); ev.stopPropagation();
    navigator.clipboard.writeText(box.textContent).then(function(){
      copyBtn.textContent = "copiado!";
      setTimeout(function(){ copyBtn.textContent = "copiar"; }, 1500);
    });
  }, true);

  try {
    var r = await processBlocks(el);
    var L = [];
    if (r.memory) L.push("[memoria] " + r.memory);
    if (r.memApp) L.push("[memoria] +" + r.memApp);
    if (r.todosAdded.length) L.push("[todo] " + r.todosAdded.join(", "));
    if (r.todoStates.length) L.push("[todo] " + r.todoStates.join(", "));
    if (r.scripts.length){ L.push("--- " + r.scripts.length + " script(s) ---"); L.push.apply(L, r.scripts); }
    box.textContent = (autoSend ? "> EXECUTADO\n" : "> NAO ENVIADO (bridge OFF)\n") + (L.join("\n") || "(nada)");
    box.style.borderLeftColor = autoSend ? "#3fb950" : "#d29922";
    try { sendBtnEl.disabled = false; sendBtnEl.style.opacity = "1"; copyBtn.disabled = false; copyBtn.style.opacity = "1"; } catch(e){}

          if (autoSend && r.scripts.length){
      if (quotaUsado >= QUOTA_MAX){
        console.warn("[bridge] cota esgotada, aguardando reset");
        var aviso = document.createElement("div");
        aviso.setAttribute("data-bridge-box","1");
        aviso.style.cssText = "background:#3d1a1a;color:#ffb3b3;padding:8px 12px;border-radius:6px;margin:8px 0;font:12px monospace;";
        aviso.textContent = "COTA ESGOTADA (" + quotaUsado + "/" + QUOTA_MAX + "). Clique em bridge: ON/OFF no painel pra resetar.";
        el.appendChild(aviso);
      } else {
        var since = Date.now() - lastAutoSend;
        var wait = Math.max(AUTO_DELAY, MIN_INTERVAL - since);
        var scriptsEnviar = r.scripts.slice(0, MAX_SCRIPTS_PER_MSG);
        if (r.scripts.length > MAX_SCRIPTS_PER_MSG){
          console.warn("[bridge] " + r.scripts.length + " scripts, enviando so " + MAX_SCRIPTS_PER_MSG);
        }
        console.log("[bridge] auto-send em " + Math.round(wait/1000) + "s (cota " + (quotaUsado+1) + "/" + QUOTA_MAX + ")");
        await new Promise(function(x){setTimeout(x, wait);});
        var payload = "[RESULTADO]\n```\n" + scriptsEnviar.join("\n---\n").slice(0, 12000) + "\n```";
        var ok = await sendText(payload);
        if (ok){
          lastAutoSend = Date.now();
          quotaUsado++;
          updateQuotaBadge();
        }
      }
    }
  } finally {
    busy = false;
    processedMsgs.add(id);
  }
}

async function sendText(text){
  var ta = textarea();
  if (!ta){ alert("Textarea nao encontrada"); return false; }
  var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(ta, text);
  ta.dispatchEvent(new Event("input", {bubbles:true}));
  ta.focus();
  await new Promise(function(r){setTimeout(r, 250);});
  // tenta Enter primeiro (mais confiavel)
  var ev = new KeyboardEvent("keydown", {
    key: "Enter", code: "Enter", keyCode: 13, which: 13,
    bubbles: true, cancelable: true
  });
  ta.dispatchEvent(ev);
  await new Promise(function(r){setTimeout(r, 200);});
  // se ainda tem texto, tenta o botao como fallback
  if (ta.value && ta.value.length > 0){
    var btn = sendBtn();
    if (btn) { btn.click(); return true; }
    return false;
  }
  return true;
}

async function sendBriefing(){
  var r = await bg({type:"briefing"});
  if (!r || !r.ok) return alert("Servidor offline: " + (r && r.error));
  await sendText(r.context);
}

async function showTodos(){
  var r = await bg({type:"briefing"});
  if (!r || !r.ok) return alert("Servidor offline");
  var m = r.context.match(/## Tarefas[\s\S]*?(?=\n---)/);
  alert(m ? m[0] : "(sem tarefas)");
}

function updateQuotaBadge(){
  var b = document.getElementById("__bridge_state");
  if (!b) return;
  var st = b.textContent.indexOf("ON") >= 0;
  b.textContent = "bridge: " + (st ? "ON" : "OFF") + " (" + quotaUsado + "/" + QUOTA_MAX + ")";
}

function makePanel(){
  if (document.getElementById("__bridge_panel")) return;
  var p = document.createElement("div");
  p.id = "__bridge_panel";
  p.style.cssText = "position:fixed!important;right:16px!important;bottom:16px!important;z-index:2147483647!important;pointer-events:auto!important;display:flex;gap:6px;font:12px monospace;";

  function mk(label, fn, id){
    var b = document.createElement("div");
    b.style.cssText = "background:#111;color:#ddd;border:2px solid #444;border-radius:8px;padding:8px 12px;cursor:pointer;user-select:none;box-shadow:0 4px 16px rgba(0,0,0,.6);";
    b.textContent = label;
    if (id) b.id = id;
    b.addEventListener("click", function(ev){ev.preventDefault();ev.stopPropagation();fn(b);}, true);
    return b;
  }

  var briefBtn = mk("briefing", sendBriefing);
  var todoBtn  = mk("todos", showTodos);
  var stateBtn = mk("bridge: OFF", async function(b){
    var st = await getState();
    var next = !st.autoSend;
    await setAuto(next);
    if (next) quotaUsado = 0;
    b.textContent = "bridge: " + (next ? "ON" : "OFF") + " (" + quotaUsado + "/" + QUOTA_MAX + ")";
    b.style.background = next ? "#0a3d0a" : "#111";
    b.style.borderColor = next ? "#3fb950" : "#444";
  }, "__bridge_state");

  p.appendChild(briefBtn);
  p.appendChild(todoBtn);
  p.appendChild(stateBtn);
  document.documentElement.appendChild(p);

  getState().then(function(st){
    autoSend = st.autoSend;
    stateBtn.textContent = "bridge: " + (st.autoSend ? "ON" : "OFF") + " (0/" + QUOTA_MAX + ")";
    stateBtn.style.background = st.autoSend ? "#0a3d0a" : "#111";
    stateBtn.style.borderColor = st.autoSend ? "#3fb950" : "#444";
  });
}

window.addEventListener("keydown", function(ev){
  if (ev.ctrlKey && ev.shiftKey){
    if (ev.key === "B" || ev.key === "b"){
      ev.preventDefault();
      var b = document.getElementById("__bridge_state");
      if (b) b.dispatchEvent(new MouseEvent("click", {bubbles:true}));
    }
    if (ev.key === "M" || ev.key === "m"){
      ev.preventDefault();
      sendBriefing();
    }
  }
}, true);


// ================= CLI BRIDGE =================
var cliLastMsgHash = "";
var cliAtivo = 0;
var cliLastReplySent = "";

async function cliPollInbox(){
  try {
    var r = await bg({type:"cliInbox"});
    if (!r || !r.messages || !r.messages.length) return;
    for (var i=0;i<r.messages.length;i++){
      var msg = r.messages[i];
      if (msg.id === cliLastMsgHash) continue;
      cliLastMsgHash = msg.id;
      console.log("[bridge] CLI ->", (msg.text||"").slice(0,60));
      await sendText(msg.text);
      cliAtivo = Date.now();
      cliStreamText = "";
      cliStreamDone = false;
      cliStreamPrevEl = msgId(lastAssistantEl());
      try { await bg({type:"cliAck", id: msg.id}); } catch(e){}
      await new Promise(function(r){setTimeout(r, 1500);});
    }
  } catch(e){ /* server off, ignora */ }
}

async function cliPushReply(text){
  if (!cliAtivo) return;
  if (Date.now() - cliAtivo > 5*60*1000) return;
  var h = hash(text);
  if (cliLastReplySent === h) return;
  cliLastReplySent = h;
  try {
    await bg({type:"cliReply", text: text});
    console.log("[bridge] -> CLI", text.slice(0,60));
  } catch(e){}
}

setInterval(cliPollInbox, 2500);
// ================= CLI STREAM =================
var cliStreamText = "";
var cliStreamDone = false;
var cliStreamLastPush = 0;
var cliStreamPrevEl = null;

async function cliStreamTick(){
  if (!cliAtivo) return;
  if (Date.now() - cliAtivo > 5*60*1000) return;
  var el = lastAssistantEl();
  if (!el) return;
  var id = msgId(el);
  if (id === cliStreamPrevEl) return;

  var text = getTextPreservingLines(el);

  if (text === cliStreamText && cliStreamDone) return;

  var now = Date.now();
  var mudou = text !== cliStreamText;
  if (mudou && (now - cliStreamLastPush) < 250) return;

  cliStreamText = text;
  cliStreamLastPush = now;
  cliStreamDone = !mudou;

  try {
    await bg({type:"cliStream", text: text, done: cliStreamDone});
  } catch(e){}
}

setInterval(cliStreamTick, 400);
console.log("[bridge] CLI stream ativo");
// ===============================================

console.log("[bridge] CLI bridge ativo (poll 2.5s)");
// ==============================================

setInterval(tick, 2000);
setInterval(makePanel, 2000);
// ================= AUTO-BRIEFING =================
var autoBriefDone = false;
var lastUrl = location.href;

async function sendBriefingSilent(){
  try {
    var r = await bg({type:'briefing'});
    if (!r || !r.ok) { console.warn('[bridge] briefing falhou'); return; }
    console.log('[bridge] enviando briefing automatico...');
    await sendText(r.context);
  } catch(e){ console.warn('[bridge] erro briefing auto:', e); }
}

function chatTemMensagem(){
  var msgs = document.querySelectorAll('.ds-assistant-message-main-content, .fbb737a4');
  return msgs.length > 0;
}

async function maybeAutoBrief(){
  if (autoBriefDone) return;
  if (chatTemMensagem()){
    autoBriefDone = true;
    console.log('[bridge] chat com historico, sem auto-brief');
    return;
  }
  await new Promise(function(r){setTimeout(r, 1500);});
  if (chatTemMensagem()){ autoBriefDone = true; return; }
  autoBriefDone = true;
  console.log('[bridge] chat vazio -> auto-briefing');
  await sendBriefingSilent();
}

setTimeout(maybeAutoBrief, 4000);

setInterval(function(){
  if (location.href !== lastUrl){
    lastUrl = location.href;
    autoBriefDone = false;
    console.log('[bridge] URL mudou, reset auto-brief');
    setTimeout(maybeAutoBrief, 3000);
  }
}, 1000);
console.log('[bridge] auto-briefing ativo');
// ==============================================

console.log("[DeepSeek Bridge] v8 carregado");
