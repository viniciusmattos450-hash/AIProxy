# server.py - DeepSeek Bridge + Memoria + CLI (v7 - threading)
import sys, os, io, re, json, time, shutil, traceback, contextlib
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from datetime import datetime

PROJECT_DIR = Path(os.environ.get("BRIDGE_PROJECT", os.getcwd())).resolve()
BRIDGE_DATA = PROJECT_DIR / ".bridge"
MEMORY_FILE = BRIDGE_DATA / "memory.md"
TODO_FILE   = BRIDGE_DATA / "todo.json"
LOG_FILE    = BRIDGE_DATA / "log.jsonl"
BACKUP_DIR  = BRIDGE_DATA / "backups"
for d in (BRIDGE_DATA, BACKUP_DIR): d.mkdir(parents=True, exist_ok=True)

CLI_OUTBOX  = []
CLI_REPLIES = []
CLI_STREAM  = {"version": 0, "text": "", "done": True}

def _new_id():
    import uuid
    return str(uuid.uuid4())[:8]

MAX_OUTPUT_BYTES = 200_000
TIMEOUT_SEC = 120

_orig_open = open
def _inside(p):
    try: Path(p).resolve().relative_to(PROJECT_DIR); return True
    except: return False

def safe_open(path, mode="r", *a, **kw):
    p = Path(path) if isinstance(path, str) else Path(str(path))
    if not p.is_absolute(): p = PROJECT_DIR / p
    if "w" in mode and p.exists() and _inside(p):
        try:
            bak = BACKUP_DIR / (str(int(time.time())) + "_" + p.name)
            shutil.copy2(p, bak)
        except: pass
    return _orig_open(p, mode, *a, **kw)

_UNICODE_SPACES = re.compile("[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000\ufeff]")

def run_script(code):
    code = _UNICODE_SPACES.sub(" ", code).replace("\r\n","\n").replace("\r","\n")
    buf = io.StringIO()
    old = os.getcwd()
    os.chdir(PROJECT_DIR)
    try:
        g = {"__name__":"__main__", "open": safe_open, "PROJECT": str(PROJECT_DIR),
             "sh": lambda c: __import__("subprocess").run(c, shell=True,
                    capture_output=True, text=True, timeout=TIMEOUT_SEC).stdout}
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            try: exec(compile(code, "<bridge>", "exec"), g, g)
            except SystemExit: pass
            except Exception: traceback.print_exc(file=buf)
    finally: os.chdir(old)
    out = buf.getvalue()
    if len(out) > MAX_OUTPUT_BYTES:
        out = out[:MAX_OUTPUT_BYTES] + "\n[... truncado]\n"
    return out.strip() or "(sem saida)"

def read_memory():
    return MEMORY_FILE.read_text(encoding="utf-8") if MEMORY_FILE.exists() else ""
def write_memory(t):
    MEMORY_FILE.write_text(t, encoding="utf-8")
def read_todos():
    if TODO_FILE.exists():
        try: return json.loads(TODO_FILE.read_text(encoding="utf-8"))
        except: return []
    return []
def write_todos(items):
    TODO_FILE.write_text(json.dumps(items, indent=2, ensure_ascii=False), encoding="utf-8")
def log_append(kind, **kw):
    try:
        with _orig_open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps({"ts": datetime.now().isoformat(timespec="seconds"),
                                "kind": kind, **kw}, ensure_ascii=False) + "\n")
    except: pass

def system_prompt():
    return _SP_BODY

_SP_BODY = "## INSTRUCOES PARA O ASSISTENTE (LEIA PRIMEIRO)\n\nVoce esta operando atraves de um proxy que executa codigo no PC do usuario.\nA extensao Firefox captura suas respostas e interpreta marcadores especiais.\nUma sessao anterior provavelmente ja comecou o trabalho. Continue de onde\nparamos SEM refazer nada.\n\n### Como executar codigo\nColoque [SCRIPT] SEMPRE dentro de bloco de codigo markdown:\n\n```\n[SCRIPT]\nprint('ola mundo')\n[/SCRIPT]\n```\n\n### Marcadores disponiveis\n- [SCRIPT]...[/SCRIPT]      executa Python no sandbox\n- [MEMORY]...[/MEMORY]      SUBSTITUI a memoria persistente\n- [MEMORY_APPEND]...[/MEMORY_APPEND]  adiciona a memoria\n- [TODO_ADD id=xxx]texto[/TODO_ADD]   cria tarefa\n- [TODO_START/PAUSE/DONE id=xxx]\n- texto    vira botao clicavel\n\n### REGRAS CRITICAS\n1. SEMPRE coloque [SCRIPT] dentro de bloco de codigo (tres crases).\n   Senao o chat colapsa a indentacao e Python falha com IndentationError.\n2. Marcadores em LINHA PROPRIA (sozinhos, sem texto em volta).\n3. O output do script volta pra voce como mensagem do usuario.\n4. Sandbox: so pode ler/escrever dentro de PROJECT_DIR.\n5. Use [MEMORY] quando fizer resumo importante.\n6. Use texto em TEXTO NORMAL (nao em bloco de codigo) pra opcoes clicaveis.\n7. NAO diga 'voce pode testar X' - VOCE testa. Manda [SCRIPT] e ve.\n8. NAO repita o que ja esta na memoria. Continue dali.\n\n### Ambiente\n- Windows 11, Python 3.12\n- safe_open(): interceptado, faz backup automatico\n- sh('cmd'): atalho subprocess (retorna stdout)\n\n---\n\n"

def make_briefing():
    mem = read_memory().strip()
    todos = read_todos()
    groups = {"doing":[], "paused":[], "todo":[], "pending":[], "done":[]}
    for t in todos: groups.setdefault(t.get("state","todo"), []).append(t)
    L = []
    L.append(system_prompt())
    L.append("# Briefing")
    L.append("**Projeto:** " + PROJECT_DIR.name)
    L.append("**Pasta:** " + str(PROJECT_DIR))
    L.append("**Atualizado:** " + datetime.now().strftime("%Y-%m-%d %H:%M"))
    L.append("")
    if mem:
        L.append("## Memoria"); L.append(""); L.append(mem); L.append("")
    L.append("## Tarefas"); L.append("")
    for st, lbl in [("doing","[EM ANDAMENTO]"), ("paused","[PAUSADAS]"),
                    ("todo","[PENDENTES]"), ("pending","[PENDENTES]")]:
        if groups[st]:
            L.append("### " + lbl)
            for t in groups[st]: L.append("- " + t["id"] + ": " + t["text"])
            L.append("")
    if groups["done"]:
        L.append("### [CONCLUIDAS - ultimas 5]")
        for t in groups["done"][-5:]: L.append("- " + t["id"] + ": " + t["text"])
        L.append("")
    L.append("---")
    L.append("Continue de onde paramos.")
    return "\n".join(L)

class H(BaseHTTPRequestHandler):
    def _cors(self):
        try:
            self.send_header("Access-Control-Allow-Origin","*")
            self.send_header("Access-Control-Allow-Methods","GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers","Content-Type")
        except: pass

    def _json(self, obj):
        try:
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type","application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            print("[server] erro _json:", e)

    def do_OPTIONS(self):
        try:
            self.send_response(200); self._cors(); self.end_headers()
        except: pass

    def do_GET(self):
        try:
            if self.path == "/context": return self._json({"context": make_briefing()})
            if self.path == "/memory":  return self._json({"memory": read_memory()})
            if self.path == "/todo":    return self._json({"todos": read_todos()})
            if self.path == "/ping":    return self._json({"ok": True, "ts": time.time()})
            if self.path == "/cli/inbox": return self._json({"messages": CLI_OUTBOX})
            if self.path.startswith("/cli/stream"):
                qs = self.path.split("?", 1)[1] if "?" in self.path else ""
                v = -1
                for pair in qs.split("&"):
                    if pair.startswith("v="):
                        try: v = int(pair[2:])
                        except: pass
                if v == CLI_STREAM["version"]:
                    return self._json({"same": True, "version": v})
                return self._json({"same": False, **CLI_STREAM})
            if self.path.startswith("/cli/poll"):
                qs = self.path.split("?", 1)[1] if "?" in self.path else ""
                since = 0.0
                for pair in qs.split("&"):
                    if pair.startswith("since="):
                        try: since = float(pair[6:])
                        except: pass
                reps = [r for r in CLI_REPLIES if r["ts"] > since]
                return self._json({"replies": reps, "now": time.time()})
            self.send_response(404); self.end_headers()
        except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            print("[server] erro do_GET:", e)

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n)) if n else {}
            p = self.path
            if p == "/run":
                code = body.get("code","")
                out = run_script(code)
                log_append("script", code=code[:500], output=out[:1500])
                return self._json({"output": out})
            if p == "/memory":
                write_memory(body.get("text",""))
                return self._json({"ok": True})
            if p == "/memory/append":
                cur = read_memory()
                write_memory(cur + ("\n\n" if cur else "") + body.get("text",""))
                return self._json({"ok": True})
            if p == "/todo/add":
                items = read_todos()
                tid = body.get("id") or ("t" + str(len(items)+1))
                for t in items:
                    if t["id"] == tid:
                        t["text"] = body.get("text","")
                        write_todos(items)
                        return self._json({"ok": True, "id": tid})
                items.append({"id": tid, "text": body.get("text",""), "state": "todo"})
                write_todos(items)
                return self._json({"ok": True, "id": tid})
            if p == "/todo/state":
                tid, new = body.get("id"), body.get("state")
                items = read_todos()
                for t in items:
                    if t["id"] == tid:
                        if new == "doing":
                            for o in items:
                                if o["state"] == "doing" and o["id"] != tid:
                                    o["state"] = "paused"
                        t["state"] = new
                write_todos(items)
                return self._json({"ok": True})
            if p == "/cli/send":
                text = body.get("text", "")
                if not text.strip():
                    return self._json({"ok": False, "error": "vazio"})
                mid = _new_id()
                CLI_OUTBOX.append({"id": mid, "text": text, "ts": time.time()})
                CLI_STREAM["text"] = ""
                CLI_STREAM["done"] = False
                CLI_STREAM["version"] += 1
                log_append("cli_send", id=mid, text=text[:200])
                return self._json({"ok": True, "id": mid})
            if p == "/cli/inbox/ack":
                mid = body.get("id")
                CLI_OUTBOX[:] = [m for m in CLI_OUTBOX if m["id"] != mid]
                return self._json({"ok": True})
            if p == "/cli/stream":
                CLI_STREAM["text"] = body.get("text", "")
                CLI_STREAM["done"] = bool(body.get("done", False))
                CLI_STREAM["version"] += 1
                return self._json({"ok": True, "version": CLI_STREAM["version"]})
            if p == "/cli/reply":
                text = body.get("text", "")
                if text.strip():
                    CLI_REPLIES.append({"ts": time.time(), "text": text})
                    if len(CLI_REPLIES) > 500:
                        del CLI_REPLIES[:-500]
                    log_append("cli_reply", size=len(text))
                return self._json({"ok": True})
            self.send_response(404); self.end_headers()
        except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            print("[server] erro do_POST:", e)

    def log_message(self, *a): pass

if __name__ == "__main__":
    print("bridge  http://127.0.0.1:8765  (threaded)")
    print("projeto " + str(PROJECT_DIR))
    print("dados   " + str(BRIDGE_DATA))
    print("Ctrl+C para parar.")
    ThreadingHTTPServer(("127.0.0.1", 8765), H).serve_forever()