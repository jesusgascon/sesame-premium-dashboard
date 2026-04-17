#!/usr/bin/env python3
"""
server.py — Servidor proxy local para Calendario Vacaciones Sesame HR
Uso: python3 server.py

- Sirve la web en http://localhost:8765
- Proxy de /sesame-api/* → https://back-eu1.sesametime.com/* (evita CORS)
- Endpoint /config para guardar/leer credenciales guardadas
"""
import http.server
import urllib.request
import urllib.error
import urllib.parse
import json
import os
import threading
import webbrowser
import sys
import hashlib
import datetime

# --- CONFIGURACIÓN ---
PORT = 8765 # Puerto donde correrá la web
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, 'config.json') # Almacén persistente de credenciales


def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE) as f:
                data = json.load(f)
                # Migración de formato antiguo si existe
                if 'token' in data and 'companies' not in data:
                    company = {
                        "id": data.get("companyId", "empresa-1"),
                        "name": "Empresa Actual",
                        "token": data.get("token"),
                        "companyId": data.get("companyId"),
                        "backendUrl": data.get("backendUrl", "https://back-eu1.sesametime.com")
                    }
                    data = {"companies": [company], "activeId": company["id"]}
                    save_config(data)
                return data
        except Exception as e:
            print(f"Error loading config: {e}")
    return {"companies": [], "activeId": ""}


def save_config(data):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(data, f, indent=2)


class Handler(http.server.SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    # ── CORS preflight ───────────────────────────────────────────────────
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    # ── GET: Sirve archivos estáticos o la configuración ─────────────────
    def do_GET(self):
        # Normalizar path para ignorar query params en la decisión de routing básico
        parsed_path = urllib.parse.urlparse(self.path).path
        
        if self.path.startswith('/sesame-api/'):
            self._proxy('GET', None)
        elif parsed_path == '/config':
            self._serve_config()
        elif parsed_path.startswith('/feed.ics'):
            self._serve_ics_feed()
        elif parsed_path in ['/', '/index.html']:
            self.path = '/index.html'
            super().do_GET()
        else:
            super().do_GET() # Comportamiento estándar: busca el archivo en disco

    # ── POST ──────────────────────────────────────────────────────────────
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length else None

        if self.path.startswith('/sesame-api/'):
            self._proxy('POST', body)
        elif self.path == '/save-config':
            self._save_config(body)
        elif self.path == '/delete-config':
            self._delete_config(body)
        elif self.path == '/wipe-all-config':
            self._wipe_all_config()
        else:
            self.send_response(404)
            self.end_headers()

    # ── Config endpoints ──────────────────────────────────────────────────
    def _serve_config(self):
        cfg = load_config()
        data = json.dumps(cfg).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self._cors_headers()
        self.end_headers()
        self.wfile.write(data)

    def _save_config(self, body):
        try:
            new_company = json.loads(body)
            cfg = load_config()
            
            # Upsert company
            cid = new_company.get("companyId")
            found = False
            for i, c in enumerate(cfg["companies"]):
                if c["companyId"] == cid:
                    # MERGE: Keep existing metadata if new data is missing it
                    for key in ["name", "brandColor", "logoUrl"]:
                        if not new_company.get(key) and c.get(key):
                            new_company[key] = c[key]
                    cfg["companies"][i] = new_company
                    found = True
                    break
            
            if not found:
                cfg["companies"].append(new_company)
            
            # Sync top-level activeId and principal credentials
            cfg["activeId"] = cid
            cfg["token"] = new_company.get("token")
            cfg["companyId"] = cid
            
            save_config(cfg)
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._cors_headers()
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            print(f'  💾  Config guardado y sincronizado para empresa: {cid}')
        except Exception as e:
            self.send_response(400)
            self._cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def _delete_config(self, body):
        try:
            data = json.loads(body)
            cid = data.get("companyId")
            cfg = load_config()
            
            # Remove from list
            initial_count = len(cfg["companies"])
            cfg["companies"] = [c for c in cfg["companies"] if c["companyId"] != cid]
            
            if len(cfg["companies"]) < initial_count:
                # If we deleted the active one, pick another
                if cfg.get("activeId") == cid:
                    if len(cfg["companies"]) > 0:
                        new_active = cfg["companies"][0]
                        cfg["activeId"] = new_active["companyId"]
                        cfg["token"] = new_active.get("token")
                        cfg["companyId"] = new_active["companyId"]
                    else:
                        cfg["activeId"] = ""
                        cfg["token"] = ""
                        cfg["companyId"] = ""
                
                save_config(cfg)
                self.send_response(200)
                self._cors_headers()
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
                print(f'  🗑️  Empresa eliminada: {cid}')
            else:
                self.send_response(404)
                self._cors_headers()
                self.end_headers()
                self.wfile.write(b'{"error":"Company not found"}')
        except Exception as e:
            self.send_response(400)
            self._cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def _wipe_all_config(self):
        try:
            save_config({"companies": [], "activeId": "", "token": "", "companyId": ""})
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._cors_headers()
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            print('  🧹  Configuración completa eliminada por petición del usuario')
        except Exception as e:
            self.send_response(500)
            self._cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def _serve_ics_feed(self):
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        token_input = params.get('token', [''])[0]
        
        cfg = load_config()
        active_cid = cfg.get("activeId")
        if not active_cid or not cfg.get("companies"):
            self._send_error(404, "No hay configuración activa.")
            return

        company_cfg = next((c for c in cfg["companies"] if c["companyId"] == active_cid), None)
        if not company_cfg:
            self._send_error(404, "Empresa no encontrada.")
            return

        # Simple verification
        secret = "sesame-vacation-secret-9182"
        expected = hashlib.sha256(f"{active_cid}{secret}".encode()).hexdigest()[:16]
        
        if token_input != expected:
            self._send_error(403, "Token de suscripción inválido.")
            return

        try:
            ics_content = self._generate_ics_from_sesame(company_cfg)
            self.send_response(200)
            self.send_header('Content-Type', 'text/calendar; charset=utf-8')
            self.send_header('Content-Disposition', 'attachment; filename="vacations.ics"')
            self._cors_headers()
            self.end_headers()
            self.wfile.write(ics_content.encode('utf-8'))
        except Exception as e:
            self._send_error(500, f"Error generando ICS: {str(e)}")

    def _generate_ics_from_sesame(self, cfg):
        auth    = f"Bearer {cfg['token']}"
        cid     = cfg['companyId']
        backend = cfg.get('backendUrl', 'https://back-eu1.sesametime.com').rstrip('/')
        
        # 1. Fetch Types
        req_types = urllib.request.Request(f"{backend}/api/v3/companies/{cid}/absence-types", headers={"Authorization": auth, "csid": cid})
        with urllib.request.urlopen(req_types) as r:
            types_data = json.loads(r.read())["data"]
            type_names = {t["id"]: (t.get("name") or t.get("alias") or "Ausencia") for t in types_data}

        # 2. Fetch Grouped (next 3 months)
        now = datetime.datetime.now()
        start = now - datetime.timedelta(days=7)
        end   = now + datetime.timedelta(days=120)
        
        url_cal = f"{backend}/api/v3/companies/{cid}/calendars-grouped?from={start.strftime('%Y-%m-%d')}&to={end.strftime('%Y-%m-%d')}&view=employee"
        req_cal = urllib.request.Request(url_cal, headers={"Authorization": auth, "csid": cid})
        
        calendar = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Sesame Vacation//ES",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH",
            f"X-WR-CALNAME:Vacaciones {cfg.get('name', 'Equipo')}",
            "X-WR-TIMEZONE:Europe/Madrid",
            "REFRESH-INTERVAL;VALUE=DURATION:PT12H"
        ]

        with urllib.request.urlopen(req_cal) as r:
            days = json.loads(r.read())["data"]
            for day in days:
                date_str = day["date"].replace("-", "")
                for ct in day.get("calendar_types", []):
                    t_id = ct.get("calendar_type", {}).get("id")
                    t_name = type_names.get(t_id, "Ausencia")
                    for emp in ct.get("employees", []):
                        emp_name = f"{emp.get('firstName', '')} {emp.get('lastName', '')}".strip()
                        uid = f"{date_str}-{emp.get('id')}-{t_id}@sesame-vacation.local"
                        calendar += [
                            "BEGIN:VEVENT",
                            f"UID:{uid}",
                            f"DTSTAMP:{now.strftime('%Y%m%dT%H%M%SZ')}",
                            f"DTSTART;VALUE=DATE:{date_str}",
                            f"DTEND;VALUE=DATE:{date_str}",
                            f"SUMMARY:{t_name}: {emp_name}",
                            "DESCRIPTION:Sincronizado desde el Panel de Vacaciones Sesame.",
                            "STATUS:CONFIRMED",
                            "END:VEVENT"
                        ]

        calendar.append("END:VCALENDAR")
        return "\r\n".join(calendar)

    def _send_error(self, code, msg):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self._cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps({"error": msg, "code": code}).encode())

    # ── Proxy ─────────────────────────────────────────────────────────────
    def _proxy(self, method, body):
        api_path = self.path[len('/sesame-api'):]   # strip prefix
        backend = self.headers.get('X-Backend-Url', 'https://back-eu1.sesametime.com').rstrip('/')
        
        # 🛡️ Saneado y Allowlist de Upstream (Seguridad)
        ALLOWED_UPSTREAMS = [
            'https://back-eu1.sesametime.com',
            'https://api-eu1.sesametime.com',
            'https://bi-engine.sesametime.com'
        ]
        if backend not in ALLOWED_UPSTREAMS:
            print(f'  ⚠️  Upstream bloqueado o inválido: {backend}. Usando fallback.')
            backend = 'https://back-eu1.sesametime.com'

        target = backend + api_path

        hdrs = {}
        for h in self.headers:
            hl = h.lower()
            if hl in ['host', 'connection', 'content-length']:
                continue
            hl_allowed = hl in ['authorization', 'csid', 'content-type', 'accept', 'x-company-id', 'x-region', 'user-agent', 'origin', 'referer']
            hl_sec = hl.startswith('sec-') or (hl.startswith('accept-') and hl != 'accept-encoding')
            if hl_allowed or hl_sec:
                hdrs[h] = self.headers[h]
        
        # Log de contexto para depuración de 403/404
        has_auth = '✅' if 'Authorization' in hdrs else '❌'
        cid_val = hdrs.get('csid') or hdrs.get('x-company-id') or '?'
        print(f'  🌐 {method} {api_path.split("?")[0]} | Upstream: {backend} | Auth: {has_auth} | CSID: {cid_val}')

        # Ensure we always pass a realistic User-Agent if missing, otherwise WAF blocks us
        if 'User-Agent' not in hdrs:
            hdrs['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

        try:
            import time
            start = time.time()
            req = urllib.request.Request(target, data=body, headers=hdrs, method=method)
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = resp.read()
                elapsed = (time.time() - start) * 1000
                self.send_response(resp.status)
                self.send_header('Content-Type', resp.headers.get('Content-Type', 'application/json'))
                self._cors_headers()
                self.end_headers()
                self.wfile.write(data)
                print(f'  ⚡  API {method} {api_path.split("?")[0]} - {resp.status} ({elapsed:.1f}ms)')
        except urllib.error.HTTPError as e:
            data = e.read()
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self._cors_headers()
            self.end_headers()
            self.wfile.write(data)
            print(f'  ❌  API Error {e.code}: {api_path}')
            try:
                error_body = json.loads(data.decode())
                print(f'      Motivo: {error_body}')
            except:
                print(f'      Motivo: {data.decode()[:200]}')
        except Exception as ex:
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self._cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(ex)}).encode())

    # ── Helpers ───────────────────────────────────────────────────────────
    def _cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers',
                         'Authorization, csid, Content-Type, X-Backend-Url, Accept, x-company-id, X-Region')

    def log_message(self, fmt, *args):
        msg = fmt % args
        if '/sesame-api/' in msg:
            print(f'  → API: {args[0] if args else msg}')
        elif '/config' in msg or '/save-config' in msg:
            print(f'  ⚙  Config: {args[0] if args else msg}')
        elif not any(x in msg for x in ['.css', '.js', '.ico', '.png', '.woff']):
            print(f'  ← Web: {args[0] if args else msg}')


if __name__ == '__main__':
    cfg = load_config()
    
    # Check if we have at least one company or old-style credentials
    has_cfg = False
    if cfg.get('token') and cfg.get('companyId'):
        has_cfg = True
    elif cfg.get('companies') and len(cfg['companies']) > 0:
        has_cfg = True
    
    active_name = "Sesame"
    if has_cfg:
        if cfg.get('companies'):
            active_id = cfg.get('activeId')
            active = next((c for c in cfg['companies'] if c['companyId'] == active_id), cfg['companies'][0])
            active_name = active.get('name', 'Sesame')

    print('''
╔══════════════════════════════════════════════════╗
║   📅  Calendario Vacaciones · Servidor Local     ║
╠══════════════════════════════════════════════════╣''')
    print(f'║  ✅  Corriendo en http://localhost:{PORT}          ║')
    if has_cfg:
        print(f'║  🔑  Credenciales guardadas cargadas             ║')
    else:
        print(f'║  ⚠   Sin credenciales (ejecuta get-token.py)    ║')
    print('''║  🌐  Abriendo navegador...                       ║
║  ⛔   Ctrl+C para detener                        ║
╚══════════════════════════════════════════════════╝
''')

    httpd = http.server.ThreadingHTTPServer(('', PORT), Handler)
    threading.Timer(1.2, lambda: webbrowser.open(f'http://localhost:{PORT}')).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n⛔  Servidor detenido.')
