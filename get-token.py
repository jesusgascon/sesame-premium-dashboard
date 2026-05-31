#!/usr/bin/env python3
"""
get-token.py — Extractor automático de credenciales de Sesame HR
Uso: python3 get-token.py

Inicia un receptor local, te muestra un snippet JS para pegarlo en la consola
del navegador mientras estás en app.sesametime.com, y guarda las credenciales
en config.json automáticamente.
"""
import http.server
import json
import os
import threading
import sys
import time

PORT = 8766
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, 'config.json')
SECRETS_FILE = os.path.join(BASE_DIR, 'config.secrets.json')

received = {}
event = threading.Event()

# ── Snippet JS que el usuario pega en la barra de direcciones ─────────────
JS_SNIPPET = r"""
javascript:(function(){let token=null,csid=null;const div=document.createElement('div');div.id='sesame-extractor-ui';div.style.cssText='position:fixed;top:50px;right:50px;background:#1e293b;color:#fff;padding:24px;border-radius:12px;z-index:999999;box-shadow:0 10px 25px rgba(0,0,0,0.5);border:1px solid #334155;font-family:sans-serif;width:350px;';div.innerHTML='<h3 style="margin:0 0 16px 0;color:#FBBF24;font-size:18px;">⏳ Esperando acción...</h3><p style="margin:0 0 16px 0;font-size:13px;color:#cbd5e1;line-height:1.4;">Cargando... Si no ocurre nada pronto, <b>haz clic en cualquier empleado</b> del calendario o <b>cambia de mes</b> para forzar la captura.</p><button onclick="this.parentElement.remove()" style="width:100%;background:#ef4444;color:white;border:none;padding:8px;border-radius:6px;cursor:pointer;font-weight:bold;">Cancelar</button>';document.body.appendChild(div);const origSetHeader=window.XMLHttpRequest.prototype.setRequestHeader;window.XMLHttpRequest.prototype.setRequestHeader=function(header,value){if(!token&&header.toLowerCase()==='authorization'&&value.startsWith('Bearer ')){token=value.replace('Bearer ','');}if(!csid&&header.toLowerCase()==='csid'){csid=value;}if(token&&csid){window.XMLHttpRequest.prototype.setRequestHeader=origSetHeader;onSuccess(token,csid);}return origSetHeader.apply(this,arguments);};const origFetch=window.fetch;window.fetch=async function(url,opts={}){const h=opts.headers||{};const auth=(typeof h.get==='function'?h.get('Authorization'):h['Authorization'])||'';if(auth.startsWith('Bearer ')&&!token){token=auth.replace('Bearer ','');csid=csid||(typeof h.get==='function'?h.get('csid'):h['csid']);if(token&&csid){window.fetch=origFetch;onSuccess(token,csid);}}return origFetch.apply(this,arguments);};function onSuccess(t,c){fetch('http://localhost:8766/receive',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:t,csid:c}),mode:'no-cors'}).catch(e=>{});const ui=document.getElementById('sesame-extractor-ui');if(ui){ui.innerHTML='<h3 style="margin:0 0 16px 0;color:#4ADE80;font-size:18px;">✅ ¡Conseguido!</h3><p style="margin:0 0 8px 0;font-size:13px;color:#94a3b8;">Vuelve a la terminal negra, ya se ha guardado el token mágicamente.</p><label style="font-size:11px;font-weight:bold;color:#cbd5e1;">TOKEN (USID)</label><input type="text" value="'+t+'" onfocus="this.select()" style="width:100%;margin-bottom:12px;padding:8px;border-radius:6px;border:1px solid #475569;background:#0f172a;color:#fff;font-family:monospace;font-size:12px;box-sizing:border-box;"><label style="font-size:11px;font-weight:bold;color:#cbd5e1;">COMPANY ID</label><input type="text" value="'+c+'" onfocus="this.select()" style="width:100%;margin-bottom:16px;padding:8px;border-radius:6px;border:1px solid #475569;background:#0f172a;color:#fff;font-family:monospace;font-size:12px;box-sizing:border-box;"><button onclick="this.parentElement.remove()" style="width:100%;background:#ef4444;color:white;border:none;padding:8px;border-radius:6px;cursor:pointer;font-weight:bold;">Cerrar</button>';}}setTimeout(()=>{if(!token){origFetch('/api/v3/security/me').catch(e=>{});}},1500);})();
"""



class Receiver(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path != '/receive':
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        try:
            data = json.loads(body)
            received['token']  = data.get('token')
            received['csid']   = data.get('csid')
        except Exception:
            pass
        self.send_response(200)
        self._cors()
        self.end_headers()
        self.wfile.write(b'OK')
        event.set()

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def log_message(self, *args):
        pass  # silencio


def print_box(*lines, width=65):
    border = '═' * width
    print(f'╔{border}╗')
    for line in lines:
        padding = width - len(line)
        print(f'║  {line}{" " * max(0, padding - 2)}║')
    print(f'╚{border}╝')


def main():
    print()
    print_box(
        '🔑  NUEVO Extractor de Credenciales — Sesame HR',
        '',
        f'Receptor iniciado en http://localhost:{PORT}',
    )
    print()

    # Iniciar servidor receptor en hilo
    server = http.server.HTTPServer(('localhost', PORT), Receiver)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()

    print('┌─────────────────────────────────────────────────────────────┐')
    print('│  PASO 1: Copia TODO el código largo que hay debajo          │')
    print('│          (asegúrate de copiar desde "javascript:" hasta     │')
    print('│          el final).                                         │')
    print('│                                                             │')
    print('│  PASO 2: Abre Chrome y ve a tu página de Sesame             │')
    print('│                                                             │')
    print('│  PASO 3: Haz clic en la BARRA DE DIRECCIONES (donde pone    │')
    print('│          app.sesametime.com...), borra todo, y PEGA el      │')
    print('│          código que acabas de copiar.                       │')
    print('│                                                             │')
    print('│  ⚠️ IMPORTANTE: A veces Chrome borra automáticamente la      │')
    print('│     palabra "javascript:" al pegar por seguridad.           │')
    print('│     Asegúrate de que la línea empieza por javascript:       │')
    print('│     y pulsa ENTER.                                          │')
    print('└─────────────────────────────────────────────────────────────┘')
    print()
    print('━' * 65)
    print(JS_SNIPPET.strip())
    print('━' * 65)
    print()
    print('⏳  Esperando credenciales... (Ctrl+C para cancelar)')
    print()

    try:
        event.wait(timeout=120)
    except KeyboardInterrupt:
        print('\n⛔  Cancelado.')
        sys.exit(0)

    server.shutdown()

    if not received.get('token'):
        print('❌  No se recibieron credenciales en 2 minutos.')
        print('   Asegúrate de que el snippet se ejecutó en la consola correcta.')
        sys.exit(1)

    token  = received['token']
    csid   = received.get('csid') or ''

    print('✅  ¡Credenciales recibidas!')
    print()
    print('  Token     : recibido y guardado en almacén local de secretos')
    print(f'  Company ID: {csid}')
    print()

    # Guardar metadatos públicos en config.json sin borrar otras empresas existentes.
    config = {'companies': [], 'activeId': csid}
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE) as f:
                config = json.load(f)
        except Exception:
            config = {'companies': [], 'activeId': csid}

    companies = config.get('companies', [])
    company = next((c for c in companies if c.get('companyId') == csid), None)
    if company:
        company.setdefault('name', 'Empresa Actual')
        company.setdefault('backendUrl', 'https://back-eu1.sesametime.com')
        company.setdefault('brandColor', None)
        company.setdefault('logoUrl', None)
    else:
        companies.append({
            'name': 'Empresa Actual',
            'companyId': csid,
            'backendUrl': 'https://back-eu1.sesametime.com',
            'brandColor': None,
            'logoUrl': None,
        })

    config['companies'] = companies
    config['activeId'] = csid
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2)

    secrets = {'tokens': {}, 'passwords': {}}
    if os.path.exists(SECRETS_FILE):
        try:
            with open(SECRETS_FILE) as f:
                existing = json.load(f)
                secrets['tokens'] = existing.get('tokens', {})
                secrets['passwords'] = existing.get('passwords', {})
        except Exception:
            pass
    secrets['tokens'][csid] = token
    with open(SECRETS_FILE, 'w') as f:
        json.dump(secrets, f, indent=2)
    try:
        os.chmod(SECRETS_FILE, 0o600)
    except Exception:
        pass

    print(f'  💾  Metadatos guardados en: {CONFIG_FILE}')
    print(f'  🔐  Token guardado en: {SECRETS_FILE}')
    print()
    print('─' * 65)
    print('  Ahora inicia el servidor con:')
    print()
    print('      python3 server.py')
    print()
    print('  La app se abrirá automáticamente en http://localhost:8765')
    print('  con tus credenciales ya cargadas. 🎉')
    print('─' * 65)
    print()


if __name__ == '__main__':
    main()
