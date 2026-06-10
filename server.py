#!/usr/bin/env python3
"""
server.py — Servidor proxy local para Sesame Premium Dashboard
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
import ssl
import subprocess
import socket
import ipaddress
import secrets
import time

# Cifrado de tokens en reposo
try:
    from cryptography.fernet import Fernet, InvalidToken
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False
    print("⚠  cryptography no instalada. Tokens sin cifrar. Ejecuta: pip install cryptography")

# --- CONFIGURACIÓN ---
PORT      = 8765
HOST      = os.environ.get('SESAME_HOST', '127.0.0.1')
LAN_MODE  = HOST in ('0.0.0.0', '::') or os.environ.get('SESAME_LAN') == '1'
BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE   = os.path.join(BASE_DIR, 'config.json')
SECRETS_FILE  = os.path.join(BASE_DIR, 'config.secrets.json')
SCHEDULES_FILE = os.path.join(BASE_DIR, 'config.schedules.json')  # Overrides locales de jornada
KEY_FILE      = os.path.join(BASE_DIR, 'key.bin')       # Clave AES local (gitignored)
CERT_FILE     = os.path.join(BASE_DIR, 'cert.pem')      # Certificado TLS (gitignored)
PRIVKEY_FILE  = os.path.join(BASE_DIR, 'privkey.pem')   # Clave TLS privada (gitignored)
PUBLIC_FILES  = {'/index.html', '/styles.css', '/app.js', '/favicon.png'}
SENSITIVE_PATHS = {
    '/config.json',
    '/config.secrets.json',
    '/config.schedules.json',
    '/key.bin',
    '/cert.pem',
    '/privkey.pem',
}
SESSION_COOKIE = 'ssm_session'
SESSION_TTL_SECONDS = 8 * 60 * 60
SERVER_SESSIONS = {}

# Contraseñas maestras ya no están hardcodeadas, se leen desde config.secrets.json
# --- CIFRADO DE TOKENS (Fernet / AES-128-CBC + HMAC) ---
def _get_fernet():
    """Carga o genera la clave de cifrado local (key.bin)."""
    if not CRYPTO_AVAILABLE:
        return None
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, 'rb') as f:
            return Fernet(f.read().strip())
    key = Fernet.generate_key()
    with open(KEY_FILE, 'wb') as f:
        f.write(key)
    try:
        os.chmod(KEY_FILE, 0o600)
    except Exception:
        pass
    print("🔑  Clave AES generada → key.bin  (NO compartas este archivo)")
    return Fernet(key)

_FERNET = _get_fernet()


def get_lan_ip():
    """Devuelve la IP LAN más probable sin enviar tráfico real."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(('8.8.8.8', 80))
            return sock.getsockname()[0]
    except Exception:
        return '127.0.0.1'


def is_allowed_local_origin(origin):
    """Permite CORS solo para localhost o IPs privadas cuando LAN_MODE está activo."""
    if not origin:
        return False

    parsed = urllib.parse.urlparse(origin)
    if parsed.scheme not in ('http', 'https') or parsed.port != PORT:
        return False

    host = parsed.hostname or ''
    if host in ('localhost', '127.0.0.1', '::1'):
        return True

    if not LAN_MODE:
        return False

    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private or ip.is_loopback
    except ValueError:
        return False


def has_master_passwords():
    if not os.path.exists(SECRETS_FILE):
        return False
    try:
        with open(SECRETS_FILE) as f:
            passwords = json.load(f).get("passwords", {})
        return any(passwords.values())
    except Exception:
        return False

def encrypt_token(token: str) -> str:
    """Cifra un token si Fernet está disponible."""
    if not token or not _FERNET:
        return token
    try:
        return _FERNET.encrypt(token.encode()).decode()
    except Exception:
        return token

def decrypt_token(enc: str) -> str:
    """Descifra un token. Si es texto plano lo devuelve tal cual (compatibilidad)."""
    if not enc or not _FERNET:
        return enc
    try:
        if enc.startswith('gA'):   # Los tokens Fernet siempre empiezan por 'gA'
            return _FERNET.decrypt(enc.encode()).decode()
        return enc   # Texto plano legacy
    except Exception:
        return enc   # Clave incorrecta o token corrupto → devolver tal cual


def load_config(include_secrets=True):
    """Carga config.json (metadatos) y config.secrets.json (tokens) y los fusiona.
    Si config.json fue borrado manualmente pero config.secrets.json existe,
    reconstruye una configuración mínima para no perder los tokens.
    """
    cfg = {"companies": [], "activeId": ""}

    # Cargar tokens primero (pueden usarse para reconstruir config si falta)
    secrets = {}
    if os.path.exists(SECRETS_FILE):
        try:
            with open(SECRETS_FILE) as f:
                secrets = json.load(f).get("tokens", {})
        except Exception as e:
            print(f"Error loading secrets: {e}")

    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE) as f:
                cfg = json.load(f)
            # Migración de formato antiguo (token en raíz)
            if 'token' in cfg and 'companies' not in cfg:
                company = {
                    "name": "Empresa Actual",
                    "companyId": cfg.get("companyId", "empresa-1"),
                    "backendUrl": cfg.get("backendUrl", "https://back-eu1.sesametime.com"),
                    "brandColor": None,
                    "logoUrl": None,
                }
                cfg = {"companies": [company], "activeId": company["companyId"]}
                save_config(cfg)
        except Exception as e:
            print(f"Error loading config: {e}")
    elif secrets:
        # config.json borrado pero secrets existe → reconstruir desde tokens
        print("⚠  config.json no encontrado. Reconstruyendo desde config.secrets.json...")
        companies = []
        for i, cid in enumerate(secrets.keys()):
            companies.append({
                "name": f"Empresa {i + 1}",
                "companyId": cid,
                "backendUrl": "https://back-eu1.sesametime.com",
                "brandColor": None,
                "logoUrl": None,
            })
        cfg = {"companies": companies, "activeId": list(secrets.keys())[0]}
        save_config(cfg)  # Regenerar config.json
        print(f"  → Regeneradas {len(companies)} empresa(s). Edita los nombres desde la UI.")

    if not include_secrets:
        public_passwords = {}
        public_tokens = set(secrets.keys())
        if os.path.exists(SECRETS_FILE):
            try:
                with open(SECRETS_FILE) as f:
                    public_passwords = json.load(f).get("passwords", {})
            except Exception:
                pass
        for company in cfg.get("companies", []):
            cid = company.get("companyId", "")
            company["hasToken"] = cid in public_tokens
            company["hasMasterPassword"] = cid in public_passwords
        return cfg

    # Inyectar token (descifrado) y flag de password en cada empresa
    for company in cfg.get("companies", []):
        cid = company.get("companyId", "")
        if cid in secrets:
            company["token"] = decrypt_token(secrets[cid])
        
        # Devolver la contraseña al frontend para que el usuario pueda verla y editarla
        passwords = {}
        if os.path.exists(SECRETS_FILE):
            try:
                with open(SECRETS_FILE) as f:
                    passwords = json.load(f).get("passwords", {})
            except Exception:
                pass
                
        if cid in passwords:
            company["masterPassword"] = decrypt_token(passwords[cid])

    return cfg


def save_config(data):
    """Guarda metadatos en config.json y tokens cifrados en config.secrets.json."""
    secrets_tokens = {}
    secrets_passwords = {}
    companies_clean = []
    
    for company in data.get("companies", []):
        token = company.pop("token", None)
        pwd = company.pop("masterPassword", None)
        cid = company.get("companyId")
        
        if cid:
            if token:
                secrets_tokens[cid] = encrypt_token(token)
            if pwd and pwd.strip() != "":
                secrets_passwords[cid] = encrypt_token(pwd.strip())
                    
        # Removemos masterPassword para que no se guarde en config.json (público)
        company.pop("masterPassword", None)
        companies_clean.append(company)

    public_data = {k: v for k, v in data.items() if k not in ("token", "companies")}
    public_data["companies"] = companies_clean
    with open(CONFIG_FILE, 'w') as f:
        json.dump(public_data, f, indent=2)

    existing_secrets = {}
    existing_passwords = {}
    if os.path.exists(SECRETS_FILE):
        try:
            with open(SECRETS_FILE) as f:
                sec_data = json.load(f)
                existing_secrets = sec_data.get("tokens", {})
                existing_passwords = sec_data.get("passwords", {})
        except Exception:
            pass
            
    valid_cids = {str(c.get("companyId")) for c in companies_clean if c.get("companyId")}
    existing_secrets = {cid: val for cid, val in existing_secrets.items() if cid in valid_cids}
    existing_passwords = {cid: val for cid, val in existing_passwords.items() if cid in valid_cids}
    existing_secrets.update(secrets_tokens)
    
    for cid, pwd in secrets_passwords.items():
        if pwd is None:
            existing_passwords.pop(cid, None)
        else:
            existing_passwords[cid] = pwd

    with open(SECRETS_FILE, 'w') as f:
        json.dump({"tokens": existing_secrets, "passwords": existing_passwords}, f, indent=2)
    try:
        os.chmod(SECRETS_FILE, 0o600)
    except Exception:
        pass


class Handler(http.server.SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def _request_is_same_origin(self):
        origin = self.headers.get('Origin')
        if not origin:
            return True
        return is_allowed_local_origin(origin)

    def _session_token(self):
        cookie = self.headers.get('Cookie', '')
        for part in cookie.split(';'):
            name, _, value = part.strip().partition('=')
            if name == SESSION_COOKIE:
                return value
        return ''

    def _is_authenticated(self):
        token = self._session_token()
        if not token:
            return False
        expires = SERVER_SESSIONS.get(token)
        if not expires or expires < time.time():
            SERVER_SESSIONS.pop(token, None)
            return False
        SERVER_SESSIONS[token] = time.time() + SESSION_TTL_SECONDS
        return True

    def _set_session_cookie(self):
        token = secrets.token_urlsafe(32)
        SERVER_SESSIONS[token] = time.time() + SESSION_TTL_SECONDS
        attrs = [
            f'{SESSION_COOKIE}={token}',
            'Path=/',
            'HttpOnly',
            'SameSite=Strict',
            f'Max-Age={SESSION_TTL_SECONDS}',
        ]
        if isinstance(self.request, ssl.SSLSocket):
            attrs.append('Secure')
        self.send_header('Set-Cookie', '; '.join(attrs))

    def _require_session(self):
        if not self._request_is_same_origin():
            self._send_error(403, "Origen no permitido.")
            return False
        if not self._is_authenticated():
            self._send_error(401, "Sesión local bloqueada. Desbloquea el panel con la contraseña maestra.")
            return False
        return True

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
        elif parsed_path == '/schedules':
            self._serve_schedules()
        elif parsed_path.startswith('/feed.ics'):
            self._serve_ics_feed()
        elif parsed_path in ['/', '/index.html']:
            self.path = '/index.html'
            super().do_GET()
        elif parsed_path in PUBLIC_FILES:
            self.path = parsed_path
            super().do_GET()
        elif parsed_path in SENSITIVE_PATHS or parsed_path.startswith(('/.git', '/.codex', '/.agents', '/scratch', '/_scratch')):
            self._send_error(403, "Ruta local protegida.")
        else:
            self._send_error(404, "Archivo no publicado.")

    # ── POST ──────────────────────────────────────────────────────────────
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length else None

        if self.path.startswith('/sesame-api/'):
            self._proxy('POST', body)
        elif self.path == '/save-config':
            if has_master_passwords() and not self._require_session():
                return
            self._save_config(body)
        elif self.path == '/delete-config':
            if not self._require_session():
                return
            self._delete_config(body)
        elif self.path == '/wipe-all-config':
            if not self._require_session():
                return
            self._wipe_all_config()
        elif self.path == '/validate-password':
            self._validate_password(body)
        elif self.path == '/save-schedules':
            if has_master_passwords() and not self._require_session():
                return
            self._save_schedules(body)
        elif self.path == '/save-custom-template':
            if has_master_passwords() and not self._require_session():
                return
            self._save_custom_template(body)
        elif self.path == '/delete-custom-template':
            if has_master_passwords() and not self._require_session():
                return
            self._delete_custom_template(body)
        else:
            self.send_response(404)
            self.end_headers()

    # ── Schedules endpoints (plantillas locales + overrides por empleado/día) ──
    def _load_schedules_file(self):
        """Lee config.schedules.json y migra el formato si es necesario.
        Formato nuevo:
          { "<companyId>": {
              "customTemplates": [ { id, name, mondayMinutes,... sundayMinutes, isLocal:true } ],
              "overrides": { "<employeeId>": { "<YYYY-MM-DD>": "<templateId>" } }
          }}
        Formato antiguo (retrocompatible):
          { "<companyId>": { "<employeeId>": { "<YYYY-MM-DD>": "<templateId>" } } }
        """
        if not os.path.exists(SCHEDULES_FILE):
            return {}
        try:
            with open(SCHEDULES_FILE) as f:
                raw = json.load(f) or {}
        except Exception as e:
            print(f"Error loading schedules: {e}")
            return {}
        # Migración silenciosa al formato nuevo
        migrated = {}
        for company_id, block in (raw or {}).items():
            if not isinstance(block, dict):
                continue
            if 'overrides' in block or 'customTemplates' in block:
                migrated[company_id] = {
                    'customTemplates': block.get('customTemplates') or [],
                    'overrides': block.get('overrides') or {}
                }
            else:
                # Formato antiguo: todo el bloque eran overrides por empleado
                migrated[company_id] = {
                    'customTemplates': [],
                    'overrides': block
                }
        return migrated

    def _write_schedules_file(self, data):
        with open(SCHEDULES_FILE, 'w') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        try:
            os.chmod(SCHEDULES_FILE, 0o600)
        except Exception:
            pass

    def _serve_schedules(self):
        """Devuelve plantillas locales y overrides. NO toca Sesame."""
        data = self._load_schedules_file()
        payload = json.dumps(data).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self._cors_headers()
        self.end_headers()
        self.wfile.write(payload)

    def _save_schedules(self, body):
        """Guarda overrides locales. Body esperado:
            { "companyId": str, "employeeId": str, "overrides": { "<date>": "<templateId>" | null } }
        Si `templateId` es null/empty, ese día se elimina del override (restaurar default).
        Si llega `replaceAll: true`, sustituye el bloque entero del empleado en esa empresa.
        """
        try:
            payload = json.loads(body or b'{}')
            company_id = str(payload.get('companyId') or '').strip()
            employee_id = str(payload.get('employeeId') or '').strip()
            overrides = payload.get('overrides') or {}
            replace_all = bool(payload.get('replaceAll'))
            if not company_id or not employee_id:
                self._send_error(400, 'companyId y employeeId son obligatorios')
                return
            if not isinstance(overrides, dict):
                self._send_error(400, 'overrides debe ser un objeto fecha→templateId')
                return

            existing = self._load_schedules_file()
            company_block = existing.get(company_id) or {'customTemplates': [], 'overrides': {}}
            employee_block = {} if replace_all else (company_block.get('overrides', {}).get(employee_id) or {})

            for date_str, template_id in overrides.items():
                date_clean = str(date_str or '').strip()
                if not date_clean:
                    continue
                if template_id is None or template_id == '':
                    employee_block.pop(date_clean, None)
                else:
                    employee_block[date_clean] = str(template_id)

            ov = company_block.get('overrides') or {}
            if employee_block:
                ov[employee_id] = employee_block
            else:
                ov.pop(employee_id, None)
            company_block['overrides'] = ov

            # No removemos la empresa si solo tiene customTemplates
            if not company_block.get('overrides') and not company_block.get('customTemplates'):
                existing.pop(company_id, None)
            else:
                existing[company_id] = company_block

            self._write_schedules_file(existing)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({
                'ok': True,
                'companyId': company_id,
                'employeeId': employee_id,
                'count': len(employee_block)
            }).encode())
        except Exception as e:
            self._send_error(400, f'Error guardando schedules: {str(e)}')

    def _save_custom_template(self, body):
        """Crea o actualiza una plantilla LOCAL custom para la empresa.
        Body: { companyId, template: { id?, name, mondayMinutes,... sundayMinutes } }
        Si no se pasa id, se genera uno nuevo. Devuelve la plantilla guardada.
        """
        try:
            payload = json.loads(body or b'{}')
            company_id = str(payload.get('companyId') or '').strip()
            tmpl = payload.get('template') or {}
            if not company_id:
                self._send_error(400, 'companyId es obligatorio')
                return
            name = str(tmpl.get('name') or '').strip()
            if not name:
                self._send_error(400, 'name es obligatorio')
                return

            def _mins(key):
                try:
                    v = int(tmpl.get(key) or 0)
                except Exception:
                    v = 0
                return max(0, min(24 * 60, v))

            normalized = {
                'id': str(tmpl.get('id') or '').strip() or f'local-{secrets.token_urlsafe(8)}',
                'name': name,
                'mondayMinutes':    _mins('mondayMinutes'),
                'tuesdayMinutes':   _mins('tuesdayMinutes'),
                'wednesdayMinutes': _mins('wednesdayMinutes'),
                'thursdayMinutes':  _mins('thursdayMinutes'),
                'fridayMinutes':    _mins('fridayMinutes'),
                'saturdayMinutes':  _mins('saturdayMinutes'),
                'sundayMinutes':    _mins('sundayMinutes'),
                'isLocal': True
            }

            existing = self._load_schedules_file()
            company_block = existing.get(company_id) or {'customTemplates': [], 'overrides': {}}
            templates = list(company_block.get('customTemplates') or [])
            replaced = False
            # Si el cliente pasó id explícito, reemplazar por id
            if tmpl.get('id'):
                for i, t in enumerate(templates):
                    if str(t.get('id')) == normalized['id']:
                        templates[i] = normalized
                        replaced = True
                        break
            # Prevenir duplicados: si NO se está editando una existente y ya hay una
            # con el mismo nombre (case-insensitive), actualizar la existente en vez
            # de crear otra entrada.
            if not replaced:
                target_name = normalized['name'].strip().lower()
                for i, t in enumerate(templates):
                    if str(t.get('name', '')).strip().lower() == target_name:
                        normalized['id'] = str(t.get('id'))  # conservar id antiguo
                        templates[i] = normalized
                        replaced = True
                        break
            if not replaced:
                templates.append(normalized)
            company_block['customTemplates'] = templates
            existing[company_id] = company_block
            self._write_schedules_file(existing)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({'ok': True, 'template': normalized}).encode())
        except Exception as e:
            self._send_error(400, f'Error guardando plantilla custom: {str(e)}')

    def _delete_custom_template(self, body):
        """Borra una plantilla LOCAL custom. Body: { companyId, templateId }
        Si la plantilla está siendo usada en overrides, también se eliminan esos overrides.
        """
        try:
            payload = json.loads(body or b'{}')
            company_id = str(payload.get('companyId') or '').strip()
            template_id = str(payload.get('templateId') or '').strip()
            if not company_id or not template_id:
                self._send_error(400, 'companyId y templateId son obligatorios')
                return

            existing = self._load_schedules_file()
            company_block = existing.get(company_id)
            if not company_block:
                self.send_response(200)
                self._cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({'ok': True, 'removed': 0}).encode())
                return

            templates = [t for t in (company_block.get('customTemplates') or [])
                         if str(t.get('id')) != template_id]
            company_block['customTemplates'] = templates

            removed_refs = 0
            overrides = company_block.get('overrides') or {}
            for emp_id in list(overrides.keys()):
                emp_block = overrides[emp_id]
                for date_key in list(emp_block.keys()):
                    if str(emp_block[date_key]) == template_id:
                        del emp_block[date_key]
                        removed_refs += 1
                if not emp_block:
                    del overrides[emp_id]
            company_block['overrides'] = overrides

            if not company_block.get('customTemplates') and not company_block.get('overrides'):
                existing.pop(company_id, None)
            else:
                existing[company_id] = company_block
            self._write_schedules_file(existing)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({
                'ok': True, 'templateId': template_id, 'removedOverrides': removed_refs
            }).encode())
        except Exception as e:
            self._send_error(400, f'Error borrando plantilla: {str(e)}')

    # ── Config endpoints ──────────────────────────────────────────────────
    def _serve_config(self):
        cfg = load_config(include_secrets=False)
        data = json.dumps(cfg).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self._cors_headers()
        self.end_headers()
        self.wfile.write(data)

    def _validate_password(self, body):
        """Valida la contraseña maestra en servidor desencriptando los secretos locales."""
        try:
            data = json.loads(body or b'{}')
            pwd  = data.get('password', '').strip()
            
            passwords = {}
            if os.path.exists(SECRETS_FILE):
                try:
                    with open(SECRETS_FILE) as f:
                        passwords = json.load(f).get("passwords", {})
                except Exception:
                    pass
            
            ok = False
            for enc_pwd in passwords.values():
                if decrypt_token(enc_pwd) == pwd:
                    ok = True
                    break
                
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._cors_headers()
            if ok:
                self._set_session_cookie()
            self.end_headers()
            self.wfile.write(json.dumps({'ok': ok}).encode())
        except Exception as e:
            self.send_response(400)
            self._cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def _save_config(self, body):
        try:
            first_setup = not has_master_passwords()
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
            
            # Config guardado silenciosamente
            save_config(cfg)
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._cors_headers()
            if first_setup and new_company.get("masterPassword"):
                self._set_session_cookie()
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
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
                # Empresa eliminada silenciosamente
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
            # Configuración eliminada silenciosamente
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
        
        # Nota: NO pasar view=employee — provoca 403 en cuentas con permisos de equipo
        url_cal = f"{backend}/api/v3/companies/{cid}/calendars-grouped?from={start.strftime('%Y-%m-%d')}&to={end.strftime('%Y-%m-%d')}"
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
                end_date = (datetime.datetime.strptime(day["date"], "%Y-%m-%d") + datetime.timedelta(days=1)).strftime("%Y%m%d")
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
                            f"DTEND;VALUE=DATE:{end_date}",
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
            hl_allowed = hl in ['authorization', 'csid', 'content-type', 'accept', 'user-agent', 'origin', 'referer']
            hl_sec = hl.startswith('sec-') or (hl.startswith('accept-') and hl != 'accept-encoding')
            hl_x = hl.startswith('x-')
            if hl_allowed or hl_sec or hl_x:
                hdrs[h] = self.headers[h]

        if 'Authorization' not in hdrs:
            if has_master_passwords() and not self._require_session():
                return
            cfg = load_config(include_secrets=True)
            cid = hdrs.get('csid') or hdrs.get('x-company-id') or cfg.get('activeId')
            company = next((c for c in cfg.get('companies', []) if c.get('companyId') == cid), None)
            if company and company.get('token'):
                hdrs['Authorization'] = f"Bearer {company['token']}"
                hdrs['csid'] = company.get('companyId', cid)
        
        # Ensure we always pass a realistic User-Agent if missing, otherwise WAF blocks us
        if 'User-Agent' not in hdrs:
            hdrs['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        
        try:
            import time
            start = time.time()
            req = urllib.request.Request(target, data=body, headers=hdrs, method=method)
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self.send_header('Content-Type', resp.headers.get('Content-Type', 'application/json'))
                self._cors_headers()
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read()
            try:
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self._cors_headers()
                self.end_headers()
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
                pass # El cliente cortó la conexión antes de recibir el error
            print(f'  ❌  API Error {e.code}: {api_path}')
            try:
                error_body = json.loads(data.decode())
                print(f'      Motivo: {error_body}')
            except:
                print(f'      Motivo: {data.decode()[:200]}')
        except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
            # El navegador abortó la petición (ej. al darle a F5 o cerrar la pestaña)
            pass
        except Exception as ex:
            try:
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self._cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(ex)}).encode())
            except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
                pass

    # ── Helpers ───────────────────────────────────────────────────────────
    def _cors_headers(self):
        origin = self.headers.get('Origin', '')
        if is_allowed_local_origin(origin):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers',
                         'Authorization, csid, Content-Type, X-Backend-Url, Accept, x-company-id, X-Region, X-Sesame-Region')

    def log_message(self, fmt, *args):
        # Silenciar logs si el status code es < 400 (exitosos)
        try:
            status_code = int(args[1])
            if status_code < 400:
                return
        except (IndexError, ValueError):
            pass

        msg = fmt % args
        if '/sesame-api/' in msg:
            print(f'  → API: {args[0] if args else msg}')
        elif '/config' in msg or '/save-config' in msg:
            print(f'  ⚙  Config: {args[0] if args else msg}')
        elif not any(x in msg for x in ['.css', '.js', '.ico', '.png', '.woff']):
            print(f'  ← Web: {args[0] if args else msg}')


if __name__ == '__main__':
    cfg = load_config()

    # Migrar tokens en texto plano a cifrado AES al arrancar
    if CRYPTO_AVAILABLE and _FERNET and os.path.exists(SECRETS_FILE):
        try:
            with open(SECRETS_FILE) as f:
                secret_doc = json.load(f)
            raw = secret_doc.get('tokens', {})
            raw_passwords = secret_doc.get('passwords', {})
            migrated = {cid: (t if t.startswith('gA') else encrypt_token(t)) for cid, t in raw.items()}
            migrated_passwords = {
                cid: (pwd if pwd.startswith('gA') else encrypt_token(pwd))
                for cid, pwd in raw_passwords.items()
            }
            plain_count = sum(1 for t in raw.values() if not t.startswith('gA'))
            plain_pwd_count = sum(1 for pwd in raw_passwords.values() if not pwd.startswith('gA'))
            if plain_count or plain_pwd_count:
                secret_doc['tokens'] = migrated
                secret_doc['passwords'] = migrated_passwords
                with open(SECRETS_FILE, 'w') as f:
                    json.dump(secret_doc, f, indent=2)
                try:
                    os.chmod(SECRETS_FILE, 0o600)
                except Exception:
                    pass
                print(f'🔒  {plain_count} token(s) y {plain_pwd_count} contraseña(s) migrado(s) a cifrado AES.')
        except Exception as e:
            print(f'⚠  Error migrando tokens: {e}')

    has_cfg = bool(cfg.get('companies'))
    active_name = 'Sesame'
    if has_cfg:
        active_id = cfg.get('activeId')
        active = next((c for c in cfg['companies'] if c['companyId'] == active_id), cfg['companies'][0])
        active_name = active.get('name', 'Sesame')

    # HTTPS: generar certificado autofirmado si no existe
    use_https = False
    if not (os.path.exists(CERT_FILE) and os.path.exists(PRIVKEY_FILE)):
        result = subprocess.run([
            'openssl', 'req', '-x509', '-newkey', 'rsa:2048',
            '-keyout', PRIVKEY_FILE, '-out', CERT_FILE,
            '-days', '365', '-nodes',
            '-subj', '/CN=localhost/O=SesamePremiumDashboard/C=ES',
            '-addext', f'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:{get_lan_ip()}'
        ], capture_output=True)
        if result.returncode == 0:
            try:
                os.chmod(PRIVKEY_FILE, 0o600)
            except Exception:
                pass
            use_https = True
    else:
        use_https = True

    protocol = 'https' if use_https else 'http'
    local_url = f'{protocol}://localhost:{PORT}'
    lan_ip = get_lan_ip()
    lan_url = f'{protocol}://{lan_ip}:{PORT}'
    shown_url = lan_url if LAN_MODE else local_url

    print('\nSesame Premium Dashboard - Servidor local')
    print('-----------------------------------------')
    print(f'Protocolo : {"HTTPS" if use_https else "HTTP"}')
    print(f'Local     : {local_url}')
    if LAN_MODE:
        print(f'LAN       : {lan_url}')
        print('Aviso     : accesible desde la red local')
    print(f'Secretos  : {"tokens cifrados AES" if CRYPTO_AVAILABLE else "tokens en texto plano"}')
    print(f'Empresa   : {active_name if has_cfg else "sin credenciales (get-token.py)"}')
    print('Navegador : abriendo automaticamente')
    print('Salir     : Ctrl+C\n')

    httpd = http.server.ThreadingHTTPServer((HOST, PORT), Handler)

    if use_https:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(CERT_FILE, PRIVKEY_FILE)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    threading.Timer(1.2, lambda: webbrowser.open(shown_url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nServidor detenido.')
