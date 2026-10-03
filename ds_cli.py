# ds_cli.py v5 - fixes cosmeticos
import sys, os, re, json, time, urllib.request, urllib.error
from datetime import datetime

SERVER = "http://127.0.0.1:8765"
STREAM_POLL = 0.25
CLEAR_LINE = "\033[2K\r"

class C:
    R="\033[0m"; B="\033[1m"; D="\033[2m"
    RED="\033[31m"; GRN="\033[32m"; YEL="\033[33m"
    BLU="\033[34m"; MAG="\033[35m"; CYN="\033[36m"

def enable_ansi():
    if os.name == "nt": os.system("")

def width():
    try: return min(os.get_terminal_size().columns, 100)
    except: return 80

def GET(p, t=5):
    try:
        with urllib.request.urlopen(SERVER+p, timeout=t) as r: return json.loads(r.read())
    except urllib.error.HTTPError as e: return {"__http__": e.code}
    except Exception as e: return {"__err__": str(e)}

def POST(p, o, t=10):
    try:
        req = urllib.request.Request(SERVER+p, data=json.dumps(o).encode(),
            headers={"Content-Type":"application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=t) as r: return json.loads(r.read())
    except urllib.error.HTTPError as e: return {"__http__": e.code}
    except Exception as e: return {"__err__": str(e)}

def check_server(): return GET("/ping", t=2).get("ok") is True

def banner():
    w = width(); line = "\u2550" * (w-2)
    print(C.CYN + "\u2554" + line + "\u2557" + C.R)
    print(C.CYN + "\u2551" + C.B + " DeepSeek CLI  v5 ".center(w-2) + C.R + C.CYN + "\u2551" + C.R)
    print(C.CYN + "\u255A" + line + "\u255D" + C.R)
    print("  " + C.D + "server" + C.R + " " + SERVER)
    print("  " + C.D + "cwd   " + C.R + " " + os.getcwd())
    print()

def cmd_help():
    print(C.B + "Comandos:" + C.R)
    for c,d in [("/help","ajuda"),("/briefing","manda contexto"),("/todos","tarefas"),
                ("/run CMD","shell local"),("/file P","anexa"),("/files","lista"),
                ("/clearfiles","limpa"),("/cd P","muda cwd"),("/pwd","cwd"),
                ("/ls [P]","lista dir"),("/clear","limpa tela"),("/quit","sai")]:
        print("  " + C.YEL + c.ljust(13) + C.R + d)
    print()

def cmd_run(a):
    if not a: print(C.RED+"uso: /run CMD"+C.R); return
    print(C.D+"$ "+a+C.R)
    try:
        import subprocess
        p = subprocess.run(a, shell=True, capture_output=True, timeout=120)
        out = p.stdout.decode("utf-8", errors="replace") if p.stdout else ""
        err = p.stderr.decode("utf-8", errors="replace") if p.stderr else ""
        if not out:
            try: out = p.stdout.decode("cp850", errors="replace") if p.stdout else ""
            except: pass
        if not err:
            try: err = p.stderr.decode("cp850", errors="replace") if p.stderr else ""
            except: pass
        if out: print(out, end="")
        if err: print(C.RED+err+C.R, end="")
        if p.returncode: print(C.D+"(exit "+str(p.returncode)+")"+C.R)
    except Exception as e: print(C.RED+"erro: "+str(e)+C.R)

def cmd_cd(a):
    if not a: print(C.RED+"uso: /cd P"+C.R); return
    try: os.chdir(a); print(C.D+"cwd -> "+os.getcwd()+C.R)
    except Exception as e: print(C.RED+str(e)+C.R)

def cmd_ls(a):
    t = a if a else "."
    try:
        for it in sorted(os.listdir(t)):
            full = os.path.join(t, it)
            if os.path.isdir(full): print("  "+C.BLU+"[dir] "+C.R+it)
            else: print("  "+C.D+"[file]"+C.R+" "+it+"  "+C.D+"("+str(os.path.getsize(full))+"b)"+C.R)
    except Exception as e: print(C.RED+str(e)+C.R)

def cmd_file(a, att):
    if not a: print(C.RED+"uso: /file P"+C.R); return
    from pathlib import Path as P
    p = P(a)
    if not p.exists(): print(C.RED+"nao existe: "+a+C.R); return
    if p.stat().st_size > 500000: print(C.YEL+"grande, truncando"+C.R)
    txt = p.read_text(encoding="utf-8", errors="replace")[:100000]
    att.append({"path": str(p), "content": txt})
    print(C.GRN+"+ "+str(p)+" ("+str(len(txt))+" chars)"+C.R)

def get_briefing(): return GET("/context").get("context","(erro)")
def get_todos(): return GET("/todo").get("todos",[])

CHOICE_RE = re.compile(r'\[CHOICE\](.+?)\[/CHOICE\]', re.DOTALL)

def strip_choices(t):
    ch = []
    def repl(m): ch.append(m.group(1).strip()); return ""
    clean = CHOICE_RE.sub(repl, t)
    clean = re.sub(r'\n{3,}', '\n\n', clean).rstrip()
    # limpa lixo de botoes que possam ter escapado
    clean = clean.replace("\nCopiar\n", "\n")
    clean = clean.replace("\nBaixar\n", "\n")
    clean = re.sub(r'^(python|bash|text|json|javascript|js|html|css|rust|cmd|powershell)\n', '', clean, flags=re.MULTILINE)
    return clean, ch

def wrap_text(text, w):
    out = []
    for line in text.splitlines():
        if len(line) <= w-4: out.append(line); continue
        words = line.split(" "); cur = ""
        for word in words:
            if len(cur)+len(word)+1 <= w-4: cur = (cur+" "+word) if cur else word
            else: out.append(cur); cur = word
        if cur: out.append(cur)
    return "\n".join(out)

def print_response(text):
    w = width()
    clean, ch = strip_choices(text)
    clean = wrap_text(clean, w)
    print(clean)
    return ch

def print_menu(ch):
    if not ch: return
    w = width()
    print()
    print(C.D + "\u2500" * (w-4) + C.R)
    print(C.B + "Escolha:" + C.R)
    for i, c in enumerate(ch, 1):
        d = re.sub(r'^[A-Za-z]\)\s*', '', c)
        print("  " + C.YEL + C.B + "["+str(i)+"]" + C.R + " " + d)
    print("  " + C.D + "[0] limpar menu / texto livre" + C.R)
    print(C.D + "\u2500" * (w-4) + C.R)
    print()

def preview_line(tail, w):
    """Imprime preview numa linha, limpando antes."""
    # trunca cabendo
    if len(tail) > w-3:
        tail = "..." + tail[-(w-6):]
    # limpa linha inteira, escreve
    sys.stdout.write(CLEAR_LINE + C.D + "\u25b8 " + tail + C.R)
    sys.stdout.flush()

def stream_preview(last_version, t0, timeout=180):
    text = ""
    w = width()
    while time.time() - t0 < timeout:
        r = GET("/cli/stream?v="+str(last_version), t=3)
        if r.get("__err__"): time.sleep(STREAM_POLL); continue
        if r.get("same"): time.sleep(STREAM_POLL); continue
        last_version = r.get("version", last_version)
        text = r.get("text", "")
        done = r.get("done", False)
        tail = text.replace("\n", " ").replace("\r", " ").strip()
        preview_line(tail, w)
        if done and text.strip():
            sys.stdout.write(CLEAR_LINE)
            sys.stdout.flush()
            return text, last_version, True
        time.sleep(STREAM_POLL)
    sys.stdout.write(CLEAR_LINE)
    return text, last_version, False

def send_and_stream(text):
    r = POST("/cli/send", {"text": text})
    if r.get("__err__") or r.get("__http__"):
        print(C.RED+"erro: "+str(r)+C.R); return []
    sv = GET("/cli/stream?v=-1")
    version = sv.get("version", 0)
    print(C.D+"aguardando" + C.R)
    t0 = time.time()
    while time.time() - t0 < 30:
        time.sleep(0.3)
        sv = GET("/cli/stream?v="+str(version))
        if not sv.get("same"):
            version = sv.get("version", version)
            break
    ts = datetime.now().strftime("%H:%M:%S")
    print(C.MAG + "[" + ts + " DeepSeek]" + C.R)
    text_out, version, ok = stream_preview(version, t0, timeout=180)
    print()
    choices = print_response(text_out)
    print_menu(choices)
    return choices

def main():
    enable_ansi(); banner()
    if not check_server():
        print(C.RED+"Servidor offline."+C.R); sys.exit(1)
    print("  " + C.GRN + "\u25CF" + C.R + " conectado")
    print("  digite " + C.YEL + "/help" + C.R)
    print()

    attached = []
    last_choices = []

    while True:
        try:
            prompt = C.B + (C.YEL + "escolha> " if last_choices else C.GRN + "> ") + C.R
            line = input(prompt)
        except (EOFError, KeyboardInterrupt): print(); return

        if not line.strip(): continue

        if last_choices and line.strip().isdigit():
            n = int(line.strip())
            if n == 0:
                last_choices = []
                print(C.D+"(menu limpo)"+C.R); continue
            if 1 <= n <= len(last_choices):
                c = re.sub(r'^[A-Za-z]\)\s*', '', last_choices[n-1])
                last_choices = []
                print(C.D+"(enviando: "+c+")"+C.R)
                last_choices = send_and_stream(c)
                continue

        if line.startswith("/"):
            parts = line[1:].split(None, 1)
            cmd = parts[0].lower() if parts else ""
            args = parts[1] if len(parts) > 1 else ""
            if cmd in ("quit","exit","q"): return
            if cmd == "help": cmd_help(); continue
            if cmd == "clear": os.system("cls" if os.name=="nt" else "clear"); banner(); continue
            if cmd == "run": cmd_run(args); continue
            if cmd == "cd": cmd_cd(args); continue
            if cmd == "pwd": print(C.D+os.getcwd()+C.R); continue
            if cmd == "ls": cmd_ls(args); continue
            if cmd == "file": cmd_file(args, attached); continue
            if cmd == "files":
                if not attached: print(C.D+"(nenhum)"+C.R)
                else:
                    for a in attached: print("  "+C.GRN+"+"+C.R+" "+a["path"])
                continue
            if cmd == "clearfiles": attached = []; print(C.D+"(limpo)"+C.R); continue
            if cmd == "briefing":
                txt = get_briefing()
                POST("/cli/send", {"text": "[BRIEFING]\n"+txt+"\n[/BRIEFING]"})
                print(C.D+"(enviado)"+C.R); continue
            if cmd == "todos":
                for t in get_todos() or []:
                    st = t.get("state","?")
                    cor = {"doing":C.YEL,"done":C.GRN,"paused":C.D}.get(st,"")
                    print("  "+cor+"["+st+"]"+C.R+" "+t["id"]+" \u2014 "+t["text"])
                continue
            print(C.RED+"desconhecido: "+cmd+C.R); continue

        buf = line
        while buf.rstrip().endswith("\\"):
            buf = buf.rstrip()[:-1] + "\n"
            try: buf += input(C.D+"... "+C.R)
            except (EOFError, KeyboardInterrupt): break

        if attached:
            pre = ""
            for a in attached: pre += "[FILE "+a["path"]+"]\n```\n"+a["content"]+"\n```\n\n"
            buf = pre + buf
            attached = []

        last_choices = send_and_stream(buf)

if __name__ == "__main__":
    try: main()
    except KeyboardInterrupt: print()
