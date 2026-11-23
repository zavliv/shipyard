#!/usr/bin/python3 -I
import datetime
import json
import os
import re
import shutil
import subprocess
import sys

VERSION = "1.3.2"
APPS_ROOT = "/srv/apps"
APPS_USER = "apps"
PM2_HOME = "/home/apps/.pm2"
NODE_BIN = "/opt/node/current/bin"
PM2 = "/opt/node/current/bin/pm2"
RUNUSER = "/usr/sbin/runuser"
NGINX = "/usr/sbin/nginx"
TAIL = "/usr/bin/tail"
AUDIT_LOG = "/var/log/vpsctl.log"
NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
MAX_LOG_LINES = 2000
LEGACY_NODE_BIN = "/root/.nvm/versions/node/v24.14.1/bin"
LEGACY_PM2 = LEGACY_NODE_BIN + "/pm2"
LEGACY_UNITS = ("shipyard",)
NGINX_ENABLED = "/etc/nginx/sites-enabled"
LE_LIVE = "/etc/letsencrypt/live"
OPENSSL = "/usr/bin/openssl"
SS = "/usr/bin/ss"
SYSTEMCTL = "/usr/bin/systemctl"
JOURNALCTL = "/usr/bin/journalctl"


class Refused(Exception):
    pass


def audit(args, result):
    entry = {
        "time": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "caller": os.environ.get("SUDO_USER", "root"),
        "args": args,
        "result": result,
    }
    with open(AUDIT_LOG, "a") as f:
        f.write(json.dumps(entry) + "\n")


def check_name(value, label):
    if not NAME.match(value or ""):
        raise Refused(f"invalid {label}: {value!r}")
    return value


def project_dir(project):
    path = os.path.realpath(os.path.join(APPS_ROOT, check_name(project, "project")))
    if os.path.dirname(path) != APPS_ROOT:
        raise Refused("project path escapes /srv/apps")
    return path


def run_as_apps(cmd, timeout=60):
    env = {
        "PATH": f"{NODE_BIN}:/usr/bin:/bin",
        "PM2_HOME": PM2_HOME,
        "HOME": "/home/apps",
    }
    return subprocess.run(
        [RUNUSER, "-u", APPS_USER, "--", *cmd],
        env=env, capture_output=True, text=True, timeout=timeout,
    )


def pm2_list():
    out = run_as_apps([PM2, "jlist"])
    if out.returncode != 0:
        raise Refused(f"pm2 jlist failed: {out.stderr.strip()}")
    procs = []
    for p in json.loads(out.stdout or "[]"):
        env = p.get("pm2_env", {})
        procs.append({
            "name": p.get("name"),
            "status": env.get("status"),
            "pid": p.get("pid"),
            "restarts": env.get("restart_time"),
            "uptime_since": env.get("pm_uptime"),
            "cpu": p.get("monit", {}).get("cpu"),
            "memory": p.get("monit", {}).get("memory"),
            "cwd": env.get("pm_cwd"),
        })
    return procs


def process_name(project, app):
    base = f"{check_name(project, 'project')}-{check_name(app, 'app')}"
    running = {p["name"] for p in pm2_list()}
    for name in (f"{base}-blue", f"{base}-green", base):
        if name in running:
            return name
    raise Refused(f"no managed process for {base}")


def cmd_version(_):
    return {"version": VERSION}


def cmd_status(_):
    du = shutil.disk_usage("/")
    with open("/proc/meminfo") as f:
        mem = {k: int(v.split()[0]) * 1024 for k, v in (l.split(":", 1) for l in f)}
    with open("/proc/loadavg") as f:
        load = [float(x) for x in f.read().split()[:3]]
    system = ""
    try:
        with open("/etc/os-release") as f:
            system = next((l.split("=", 1)[1].strip().strip('"') for l in f if l.startswith("PRETTY_NAME=")), "")
    except OSError:
        pass
    return {
        "system": system,
        "cpus": os.cpu_count() or 0,
        "disk": {"total": du.total, "used": du.used, "free": du.free},
        "memory": {"total": mem["MemTotal"], "available": mem["MemAvailable"]},
        "load": load,
        "processes": pm2_list(),
    }


def cmd_list(_):
    return {"processes": pm2_list()}


def lifecycle(action):
    def handler(args):
        if len(args) != 2:
            raise Refused(f"usage: {action} <project> <app>")
        name = process_name(*args)
        out = run_as_apps([PM2, action, name])
        if out.returncode != 0:
            raise Refused(f"pm2 {action} failed: {out.stderr.strip()[-500:]}")
        return {"process": name, "action": action, "ok": True}
    return handler


def cmd_logs(args):
    if len(args) not in (2, 3):
        raise Refused("usage: logs <project> <app> [lines]")
    project, app = args[0], check_name(args[1], "app")
    lines = int(args[2]) if len(args) == 3 else 200
    lines = max(1, min(lines, MAX_LOG_LINES))
    logs_dir = os.path.join(project_dir(project), "logs")
    result = {}
    for stream in ("out", "err"):
        path = os.path.realpath(os.path.join(logs_dir, f"{app}.{stream}.log"))
        if os.path.dirname(path) != logs_dir or not os.path.isfile(path):
            result[stream] = ""
            continue
        out = subprocess.run([TAIL, "-n", str(lines), path], capture_output=True, text=True)
        result[stream] = out.stdout
    return result


def cmd_nginx_test(_):
    out = subprocess.run([NGINX, "-t"], capture_output=True, text=True)
    return {"ok": out.returncode == 0, "output": out.stderr.strip()}


def ancestors(pid):
    chain = []
    while pid and pid > 1 and len(chain) < 12:
        chain.append(pid)
        try:
            with open(f"/proc/{pid}/stat") as f:
                pid = int(f.read().rsplit(")", 1)[1].split()[1])
        except (OSError, ValueError, IndexError):
            break
    return chain


def proc_info(pid):
    info = {"pid": pid, "user": None, "cwd": None}
    try:
        import pwd
        info["user"] = pwd.getpwuid(os.stat(f"/proc/{pid}").st_uid).pw_name
        info["cwd"] = os.readlink(f"/proc/{pid}/cwd")
    except (OSError, KeyError):
        pass
    return info


def listeners():
    out = subprocess.run([SS, "-ltnpH"], capture_output=True, text=True)
    seen = {}
    for line in out.stdout.splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        local = parts[3]
        port = int(local.rsplit(":", 1)[1])
        host = local.rsplit(":", 1)[0].strip("[]")
        m = re.search(r"pid=(\d+)", line)
        if port in seen or not m:
            continue
        pid = int(m.group(1))
        entry = proc_info(pid)
        entry.update({"port": port, "host": host, "ancestors": ancestors(pid)})
        seen[port] = entry
    return sorted(seen.values(), key=lambda x: x["port"])


def nginx_sites():
    sites = []
    for name in sorted(os.listdir(NGINX_ENABLED)):
        path = os.path.join(NGINX_ENABLED, name)
        try:
            with open(path) as f:
                text = f.read()
        except OSError:
            continue
        text = re.sub(r"#[^\n]*", "", text)
        names = []
        for m in re.finditer(r"server_name\s+([^;]+);", text):
            for n in m.group(1).split():
                if n not in names:
                    names.append(n)
        ports = {int(p) for p in re.findall(r"proxy_pass\s+https?://(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)", text)}
        upstreams = sorted(set(re.findall(r"proxy_pass\s+https?://(shipyard_[a-z0-9_]+)", text)))
        resolved = upstream_ports()
        for u in upstreams:
            if u in resolved:
                ports.add(resolved[u])
        ports = sorted(ports)
        roots = sorted(set(re.findall(r"^\s*root\s+([^;]+);", text, re.M)))
        sites.append({
            "file": name,
            "target": os.path.realpath(path),
            "server_names": names,
            "upstream_ports": ports,
            "upstreams": upstreams,
            "roots": roots,
        })
    return sites


def certificates():
    certs = []
    if not os.path.isdir(LE_LIVE):
        return certs
    for name in sorted(os.listdir(LE_LIVE)):
        pem = os.path.join(LE_LIVE, name, "cert.pem")
        if not os.path.isfile(pem):
            continue
        out = subprocess.run([OPENSSL, "x509", "-in", pem, "-noout", "-enddate", "-ext", "subjectAltName"],
                             capture_output=True, text=True)
        end = re.search(r"notAfter=(.+)", out.stdout)
        expires = None
        if end:
            expires = datetime.datetime.strptime(end.group(1).strip(), "%b %d %H:%M:%S %Y %Z") \
                .replace(tzinfo=datetime.timezone.utc).isoformat()
        certs.append({"name": name, "domains": re.findall(r"DNS:([^,\s]+)", out.stdout), "expires": expires})
    return certs


def legacy_pm2():
    if not os.path.isfile(LEGACY_PM2):
        return []
    env = {"PATH": f"{LEGACY_NODE_BIN}:/usr/bin:/bin", "HOME": "/root", "PM2_HOME": "/root/.pm2"}
    try:
        out = subprocess.run([LEGACY_PM2, "jlist"], env=env, capture_output=True, text=True, timeout=30)
    except OSError:
        return []
    procs = []
    try:
        raw = json.loads(out.stdout or "[]")
    except ValueError:
        return []
    for p in raw:
        env_ = p.get("pm2_env", {})
        procs.append({
            "id": p.get("pm_id"),
            "name": p.get("name"),
            "status": env_.get("status"),
            "pid": p.get("pid"),
            "restarts": env_.get("restart_time"),
            "uptime_since": env_.get("pm_uptime"),
            "cpu": p.get("monit", {}).get("cpu"),
            "memory": p.get("monit", {}).get("memory"),
            "cwd": env_.get("pm_cwd"),
            "out_log": env_.get("pm_out_log_path"),
            "err_log": env_.get("pm_err_log_path"),
        })
    return procs


def legacy_units():
    units = []
    for unit in LEGACY_UNITS:
        out = subprocess.run([SYSTEMCTL, "show", unit, "-p", "ActiveState,MainPID,WorkingDirectory,ActiveEnterTimestamp"],
                             capture_output=True, text=True)
        props = dict(l.split("=", 1) for l in out.stdout.splitlines() if "=" in l)
        units.append({
            "unit": unit,
            "active": props.get("ActiveState"),
            "pid": int(props.get("MainPID") or 0),
            "cwd": props.get("WorkingDirectory"),
            "since": props.get("ActiveEnterTimestamp"),
        })
    return units


def managed_projects():
    projects = []
    for name in sorted(os.listdir(APPS_ROOT)):
        if not NAME.match(name):
            continue
        path = os.path.join(APPS_ROOT, name, "project.json")
        try:
            with open(path) as f:
                projects.append(json.load(f))
        except (OSError, ValueError):
            projects.append({"project": name, "error": "project.json missing or invalid"})
    return projects


def cmd_inventory(_):
    with open("/proc/uptime") as f:
        uptime = float(f.read().split()[0])
    return {
        "server": {**cmd_status(None), "uptime_seconds": uptime, "hostname": os.uname().nodename},
        "nginx": nginx_sites(),
        "certificates": certificates(),
        "listeners": listeners(),
        "legacy_pm2": legacy_pm2(),
        "legacy_units": legacy_units(),
        "projects": managed_projects(),
    }


def tail_file(path, lines):
    if not path or not os.path.isfile(path):
        return ""
    out = subprocess.run([TAIL, "-n", str(lines), path], capture_output=True, text=True)
    return out.stdout


def cmd_legacy_logs(args):
    if len(args) not in (2, 3):
        raise Refused("usage: legacy-logs pm2|unit <id-or-unit> [lines]")
    kind, ref = args[0], args[1]
    lines = max(1, min(int(args[2]) if len(args) == 3 else 200, MAX_LOG_LINES))
    if kind == "pm2":
        if not ref.isdigit():
            raise Refused("pm2 id must be a number")
        match = [p for p in legacy_pm2() if p["id"] == int(ref)]
        if not match:
            raise Refused(f"no legacy pm2 process with id {ref}")
        return {"out": tail_file(match[0]["out_log"], lines), "err": tail_file(match[0]["err_log"], lines)}
    if kind == "unit":
        if ref not in LEGACY_UNITS:
            raise Refused(f"unit not allowed: {ref}")
        out = subprocess.run([JOURNALCTL, "-u", ref, "-n", str(lines), "--no-pager", "-o", "short-iso"],
                             capture_output=True, text=True)
        return {"out": out.stdout, "err": ""}
    raise Refused("kind must be pm2 or unit")


SHIPYARD_STATIC = "/var/www/shipyard"
NGINX_AVAILABLE = "/etc/nginx/sites-available"
CERTBOT = "/usr/bin/certbot"
GIT = "/usr/bin/git"
BASH = "/bin/bash"
CURL = "/usr/bin/curl"
DOMAIN = re.compile(r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
GH_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
BRANCH = re.compile(r"^(?!.*\.\.)[A-Za-z0-9._/-]{1,100}$")
SUBDIR = re.compile(r"^(?!.*\.\.)(?!/)[A-Za-z0-9._/-]{0,120}$")
TYPES = ("nextjs", "node", "static", "python")
APP_PATH = f"{NODE_BIN}:/usr/local/bin:/usr/bin:/bin"


def read_stdin(limit=256 * 1024):
    data = sys.stdin.read(limit + 1)
    if len(data) > limit:
        raise Refused("input too large")
    return data


def read_json_stdin():
    try:
        value = json.loads(read_stdin() or "{}")
    except ValueError:
        raise Refused("stdin must be JSON")
    if not isinstance(value, dict):
        raise Refused("stdin must be a JSON object")
    return value


def check_command(value, label):
    if value is None or value == "":
        return ""
    if not isinstance(value, str) or len(value) > 500 or "\n" in value or "\0" in value:
        raise Refused(f"invalid {label} command")
    return value


def check_subdir(value):
    value = (value or "").strip().strip("/")
    if not SUBDIR.match(value):
        raise Refused("invalid sub-folder")
    return value


def check_domains(values):
    if not isinstance(values, list) or not values or len(values) > 10:
        raise Refused("give 1 to 10 domains")
    out = []
    for d in values:
        d = str(d).strip().lower()
        if not DOMAIN.match(d):
            raise Refused(f"invalid domain: {d}")
        if d not in out:
            out.append(d)
    return out


class ProjectLock:
    def __init__(self, project):
        self.path = f"/run/vpsctl-{check_name(project, 'project')}.lock"

    def __enter__(self):
        import fcntl
        self.f = open(self.path, "w")
        try:
            fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise Refused("another job is already running for this project")
        return self

    def __exit__(self, *exc):
        self.f.close()


def record_path(project):
    return os.path.join(project_dir(project), "project.json")


def load_record(project):
    try:
        with open(record_path(project)) as f:
            return json.load(f)
    except (OSError, ValueError):
        raise Refused(f"project {project} has no valid record")


def save_record(project, record):
    path = record_path(project)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(record, f, indent=2)
    os.chown(tmp, 0, apps_gid())
    os.chmod(tmp, 0o640)
    os.replace(tmp, path)


def shipyard_record(project):
    rec = load_record(project)
    if rec.get("created_by") != "shipyard":
        raise Refused("this project was not created by Shipyard")
    return rec


def find_app(rec, app):
    for a in rec.get("apps", []):
        if a.get("name") == app:
            return a
    raise Refused(f"app {app} not found in project")


def apps_uid():
    import pwd
    return pwd.getpwnam(APPS_USER).pw_uid


def apps_gid():
    import grp
    return grp.getgrnam(APPS_USER).gr_gid


def log(msg):
    sys.stderr.write(msg.rstrip("\n") + "\n")
    sys.stderr.flush()


def stream(cmd, cwd=None, env=None, timeout=1200, as_apps=True):
    full = [RUNUSER, "-u", APPS_USER, "--", *cmd] if as_apps else cmd
    proc = subprocess.Popen(full, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            stdin=subprocess.DEVNULL, text=True, errors="replace")
    import time
    deadline = time.time() + timeout
    tail = []
    for line in proc.stdout:
        log(line)
        tail.append(line.rstrip("\n"))
        tail = tail[-40:]
        if time.time() > deadline:
            proc.kill()
            raise Refused("step timed out")
    code = proc.wait()
    return code, "\n".join(tail)


def parse_env(text):
    out = {}
    for line in text.splitlines():
        m = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$", line)
        if not m:
            continue
        v = m.group(2)
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        out[m.group(1)] = v
    return out


def app_env(project, app, extra=None):
    env = {"PATH": APP_PATH, "HOME": "/home/apps", "LANG": "C.UTF-8", "ONNXRUNTIME_NODE_INSTALL_CUDA": "skip"}
    env_file = os.path.join(project_dir(project), "env", f"{app}.env")
    if os.path.isfile(env_file):
        with open(env_file) as f:
            env.update(parse_env(f.read()))
    env.update(extra or {})
    return env


def git_auth_env(token):
    import base64
    if not re.match(r"^[A-Za-z0-9_.-]{20,2048}$", token or ""):
        raise Refused("invalid GitHub token")
    basic = base64.b64encode(f"x-access-token:{token}".encode()).decode()
    return {
        "PATH": APP_PATH,
        "HOME": "/home/apps",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_CONFIG_COUNT": "1",
        "GIT_CONFIG_KEY_0": "http.https://github.com/.extraheader",
        "GIT_CONFIG_VALUE_0": f"AUTHORIZATION: basic {basic}",
    }


def git_head(path):
    out = subprocess.run([RUNUSER, "-u", APPS_USER, "--", GIT, "-C", path, "log", "-1", "--format=%H%x00%s"],
                         capture_output=True, text=True)
    sha, _, msg = out.stdout.strip().partition("\0")
    return {"commit": sha, "message": msg[:200]}


def used_ports():
    ports = {l["port"] for l in listeners()}
    for site in nginx_sites():
        ports.update(site["upstream_ports"])
    for rec in managed_projects():
        for a in rec.get("apps", []) or []:
            if isinstance(a, dict) and a.get("port"):
                ports.add(int(a["port"]))
                ports.add(int(a["port"]) + SLOT_OFFSET)
    for p in list(ports):
        if p < SLOT_OFFSET:
            ports.add(p + SLOT_OFFSET)
    return ports


def enabled_server_names():
    names = {}
    for site in nginx_sites():
        for n in site["server_names"]:
            names[n] = site["file"]
    return names


def cmd_ports(_):
    return {"used": sorted(used_ports())}


def cmd_site_init(args):
    if len(args) != 1:
        raise Refused("usage: site-init <project>")
    project = args[0]
    path = project_dir(project)
    if os.path.exists(path):
        raise Refused(f"project {project} already exists")
    with ProjectLock(project):
        os.mkdir(path, 0o750)
        os.chown(path, 0, apps_gid())
        for sub, owner, mode in (("env", 0, 0o750), ("pm2", 0, 0o750), ("logs", None, 0o750)):
            p = os.path.join(path, sub)
            os.mkdir(p, mode)
            os.chown(p, apps_uid() if owner is None else 0, apps_gid())
        save_record(project, {
            "project": project,
            "created": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "created_by": "shipyard",
            "status": "creating",
            "apps": [],
            "domains": [],
            "nginx": [],
            "certificates": [],
            "static": [],
            "logs": [os.path.join(path, "logs")],
            "cron": [],
            "backups": f"/srv/backups/{project}",
        })
    return {"project": project, "path": path}


def cmd_site_clone(args):
    if len(args) != 5:
        raise Refused("usage: site-clone <project> <app> <owner> <repo> <branch>  (token on stdin)")
    project, app, owner, repo, branch = args
    check_name(app, "app")
    if not GH_NAME.match(owner) or not GH_NAME.match(repo):
        raise Refused("invalid repository name")
    if not BRANCH.match(branch):
        raise Refused("invalid branch")
    auth = git_auth_env(read_stdin(4096).strip())
    with ProjectLock(project):
        rec = shipyard_record(project)
        if any(a.get("name") == app for a in rec["apps"]):
            raise Refused(f"app {app} already exists")
        if app in RESERVED_APP_NAMES:
            raise Refused(f"{app} is a reserved name; pick another app name")
        path = os.path.join(project_dir(project), app)
        if os.path.lexists(path):
            raise Refused(f"a folder named {app} already exists in this site")
        os.mkdir(path, 0o750)
        os.chown(path, apps_uid(), apps_gid())
        rec["apps"].append({
            "name": app,
            "process": f"{project}-{app}",
            "repo": f"{owner}/{repo}",
            "branch": branch,
            "path": path,
        })
        save_record(project, rec)
        log(f"Cloning github.com/{owner}/{repo} (branch {branch})")
        code, tail = stream([GIT, "clone", "--depth", "1", "--branch", branch,
                             f"https://github.com/{owner}/{repo}.git", path],
                            env=auth, timeout=600)
        if code != 0:
            raise Refused(f"git clone failed: {tail[-300:]}")
        head = git_head(path)
        log(f"Checked out {head['commit'][:7]} {head['message']}")
        find_app(rec, app).update(head)
        save_record(project, rec)
    return head


def cmd_site_pull(args):
    if len(args) != 2:
        raise Refused("usage: site-pull <project> <app>  (token on stdin)")
    project, app = args
    token = read_stdin(4096).strip()
    with ProjectLock(project):
        rec = shipyard_record(project)
        a = find_app(rec, app)
        env = git_auth_env(token)
        log(f"Fetching {a['repo']} (branch {a['branch']})")
        code, tail = stream([GIT, "-C", a["path"], "fetch", "--depth", "1", "origin", a["branch"]], env=env, timeout=600)
        if code != 0:
            raise Refused(f"git fetch failed: {tail[-300:]}")
        code, tail = stream([GIT, "-C", a["path"], "reset", "--hard", "FETCH_HEAD"], env=env, timeout=120)
        if code != 0:
            raise Refused(f"git reset failed: {tail[-300:]}")
        head = git_head(a["path"])
        log(f"Now at {head['commit'][:7]} {head['message']}")
        a.update(head)
        save_record(project, rec)
    return head


def cmd_site_env(args):
    if len(args) != 2:
        raise Refused("usage: site-env <project> <app>  (env file on stdin)")
    project, app = args
    content = read_stdin(64 * 1024)
    with ProjectLock(project):
        rec = shipyard_record(project)
        a = find_app(rec, app)
        env_file = os.path.join(project_dir(project), "env", f"{app}.env")
        tmp = env_file + ".tmp"
        with open(tmp, "w") as f:
            f.write(content if content.endswith("\n") or not content else content + "\n")
        os.chown(tmp, 0, apps_gid())
        os.chmod(tmp, 0o640)
        os.replace(tmp, env_file)
        a["env_file"] = env_file
        save_record(project, rec)
    return {"env_file": env_file, "keys": sorted(parse_env(content).keys())}


def app_workdir(a, subdir):
    base = a["path"]
    wd = os.path.realpath(os.path.join(base, subdir)) if subdir else base
    if wd != base and not wd.startswith(base + "/"):
        raise Refused("sub-folder escapes the app folder")
    if not os.path.isdir(wd):
        raise Refused(f"folder not found in repository: {subdir}")
    return wd


def link_env(a, wd):
    env_file = a.get("env_file")
    if not env_file:
        return
    target = os.path.join(wd, ".env")
    if os.path.islink(target) or os.path.isfile(target):
        os.remove(target)
    os.symlink(env_file, target)
    os.lchown(target, apps_uid(), apps_gid())


def cmd_site_build(args):
    if len(args) != 2:
        raise Refused("usage: site-build <project> <app>  (JSON on stdin)")
    project, app = args
    spec = read_json_stdin()
    app_type = spec.get("type")
    if app_type not in TYPES:
        raise Refused("invalid app type")
    subdir = check_subdir(spec.get("subdir"))
    install = check_command(spec.get("install"), "install")
    build = check_command(spec.get("build"), "build")
    output = check_subdir(spec.get("output"))
    with ProjectLock(project):
        rec = shipyard_record(project)
        a = find_app(rec, app)
        wd = app_workdir(a, subdir)
        link_env(a, wd)
        env = app_env(project, app)
        env.pop("NODE_ENV", None)
        for label, command in (("Installing", install), ("Building", build)):
            if not command:
                continue
            log(f"{label}: {command}")
            code, tail = stream([BASH, "-c", command], cwd=wd, env=env, timeout=1500)
            if code != 0:
                raise Refused(f"{label.lower()} failed (exit {code})")
        a.update({"type": app_type, "subdir": subdir, "install": install, "build": build})
        if app_type == "static":
            src = os.path.realpath(os.path.join(wd, output)) if output else wd
            if src != wd and not src.startswith(wd + "/"):
                raise Refused("output folder escapes the app folder")
            if not os.path.isdir(src):
                raise Refused(f"output folder not found: {output or '.'}")
            dest = os.path.join(SHIPYARD_STATIC, project, app)
            os.makedirs(os.path.join(SHIPYARD_STATIC, project), mode=0o755, exist_ok=True)
            if os.path.exists(dest):
                shutil.rmtree(dest)
            shutil.copytree(src, dest, symlinks=False, ignore=shutil.ignore_patterns(".git", ".env", "node_modules"))
            for root, dirs, files in os.walk(dest):
                os.chown(root, 0, 0)
                os.chmod(root, 0o755)
                for name in files:
                    p = os.path.join(root, name)
                    os.chown(p, 0, 0)
                    os.chmod(p, 0o644)
            a["output"] = output
            a["static_dir"] = dest
            if os.path.join(SHIPYARD_STATIC, project) not in rec["static"]:
                rec["static"].append(os.path.join(SHIPYARD_STATIC, project))
            log(f"Published {output or '.'} to {dest}")
        save_record(project, rec)
    return {"ok": True}


PM2_TEMPLATE = """const fs = require("fs");
function loadEnv(p) {
  const out = {};
  try {
    for (const line of fs.readFileSync(p, "utf8").split(/\\r?\\n/)) {
      const m = line.match(/^\\s*(?:export\\s+)?([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(.*?)\\s*$/);
      if (!m) continue;
      let v = m[2];
      if (v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === '"' || v[0] === "'")) v = v.slice(1, -1);
      out[m[1]] = v;
    }
  } catch {}
  return out;
}
module.exports = {
  apps: [{
    name: %(name)s,
    cwd: %(cwd)s,
    script: "/bin/bash",
    args: ["-c", %(start)s],
    interpreter: "none",
    env: Object.assign(loadEnv(%(env_file)s), {
      NODE_ENV: "production",
      PORT: %(port)s,
      HOST: "127.0.0.1",
      PATH: %(path)s,
    }),
    out_file: %(out)s,
    error_file: %(err)s,
    merge_logs: true,
    time: true,
    max_restarts: 10,
    restart_delay: 3000,
    kill_timeout: 8000,
  }],
};
"""


def http_status(url, host=None):
    cmd = [CURL, "-s", "-o", "/dev/null", "-w", "%{http_code}", "-m", "5"]
    if host:
        cmd += ["--resolve", f"{host}:443:127.0.0.1"]
    out = subprocess.run(cmd + [url], capture_output=True, text=True)
    try:
        return int(out.stdout.strip() or 0)
    except ValueError:
        return 0


def cmd_site_start(args):
    if len(args) != 2:
        raise Refused("usage: site-start <project> <app>  (JSON on stdin)")
    project, app = args
    spec = read_json_stdin()
    import time
    with ProjectLock(project):
        rec = shipyard_record(project)
        a = find_app(rec, app)
        if a.get("type") == "static":
            return {"ok": True, "static": True}
        subdir = check_subdir(spec.get("subdir", a.get("subdir")))
        start = check_command(spec.get("start"), "start")
        if not start:
            raise Refused("start command is required")
        port = int(spec.get("port") or a.get("port") or 0)
        if not 3000 <= port <= 4999:
            raise Refused("port must be between 3000 and 4999")
        name = a["process"]
        mine = {p["name"]: p for p in pm2_list()}
        if port != a.get("port") and port in used_ports():
            raise Refused(f"port {port} is already in use")
        wd = app_workdir(a, subdir)
        link_env(a, wd)
        logs_dir = os.path.join(project_dir(project), "logs")
        config = os.path.join(project_dir(project), "pm2", f"{app}.config.js")
        with open(config + ".tmp", "w") as f:
            f.write(PM2_TEMPLATE % {
                "name": json.dumps(name),
                "cwd": json.dumps(wd),
                "start": json.dumps(f"exec {start}"),
                "env_file": json.dumps(os.path.join(project_dir(project), "env", f"{app}.env")),
                "port": json.dumps(str(port)),
                "path": json.dumps(f"{os.path.join(wd, '.venv', 'bin')}:{os.path.join(wd, 'node_modules', '.bin')}:{APP_PATH}"),
                "out": json.dumps(os.path.join(logs_dir, f"{app}.out.log")),
                "err": json.dumps(os.path.join(logs_dir, f"{app}.err.log")),
            })
        os.chown(config + ".tmp", 0, apps_gid())
        os.chmod(config + ".tmp", 0o640)
        os.replace(config + ".tmp", config)
        a.update({"port": port, "start": start, "subdir": subdir, "pm2_config": config})
        save_record(project, rec)
        action = "reload" if name in mine else "start"
        log(f"{'Restarting' if action == 'reload' else 'Starting'} {name} on port {port}")
        out = run_as_apps([PM2, "startOrReload", config, "--update-env"], timeout=120)
        if out.returncode != 0:
            raise Refused(f"pm2 failed: {(out.stderr or out.stdout).strip()[-300:]}")
        run_as_apps([PM2, "save", "--force"])
        deadline = time.time() + 90
        status = 0
        while time.time() < deadline:
            status = http_status(f"http://127.0.0.1:{port}/")
            if 0 < status < 500:
                break
            procs = {p["name"]: p for p in pm2_list()}
            if procs.get(name, {}).get("status") == "errored":
                break
            time.sleep(2)
        if not 0 < status < 500:
            err_log = os.path.join(logs_dir, f"{app}.err.log")
            if os.path.isfile(err_log):
                log("--- last error output ---")
                log(tail_file(err_log, 30))
            raise Refused(f"app did not answer on port {port} (last status {status})")
        log(f"App answers on port {port} with HTTP {status}")
    return {"ok": True, "port": port, "status": status}


NGINX_PROXY = """server {
    listen 80;
    listen [::]:80;
    server_name %(names)s;
    client_max_body_size 50m;

    location / {
        proxy_pass http://%(upstream)s;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
    }
}
"""

NGINX_STATIC = """server {
    listen 80;
    listen [::]:80;
    server_name %(names)s;
    root %(root)s;
    index index.html;

    location / {
        try_files $uri $uri/ $uri.html /index.html;
    }
}
"""


def nginx_reload():
    test = subprocess.run([NGINX, "-t"], capture_output=True, text=True)
    if test.returncode != 0:
        return False, test.stderr.strip()[-400:]
    subprocess.run([SYSTEMCTL, "reload", "nginx"], check=True)
    return True, ""


def cmd_nginx_add(args):
    if len(args) != 1:
        raise Refused("usage: nginx-add <project>  (JSON on stdin)")
    project = args[0]
    spec = read_json_stdin()
    domains = check_domains(spec.get("domains"))
    app = check_name(spec.get("app") or "", "app")
    with ProjectLock(project):
        rec = shipyard_record(project)
        a = find_app(rec, app)
        taken = enabled_server_names()
        clash = [d for d in domains if d in taken]
        if clash:
            raise Refused(f"already used by another site: {', '.join(clash)}")
        avail = os.path.join(NGINX_AVAILABLE, f"{domains[0]}.conf")
        enabled = os.path.join(NGINX_ENABLED, f"{domains[0]}.conf")
        if os.path.exists(avail) or os.path.exists(enabled):
            raise Refused(f"nginx file already exists for {domains[0]}")
        if a.get("type") == "static":
            text = NGINX_STATIC % {"names": " ".join(domains), "root": a["static_dir"]}
        else:
            if not os.path.isfile(upstream_file(project, app)):
                write_upstream(project, app, slot_port(a, a.get("slot") or "blue"))
            text = NGINX_PROXY % {"names": " ".join(domains), "upstream": upstream_name(project, app)}
        with open(avail, "w") as f:
            f.write(text)
        os.symlink(avail, enabled)
        rec["nginx"] += [avail, enabled]
        rec["domains"] += [d for d in domains if d not in rec["domains"]]
        a["domains"] = domains
        if spec.get("own"):
            a["own_domain"] = True
            a["nginx_files"] = [avail, enabled]
        save_record(project, rec)
        ok, err = nginx_reload()
        if not ok:
            os.remove(enabled)
            os.remove(avail)
            rec["nginx"] = [p for p in rec["nginx"] if p not in (avail, enabled)]
            save_record(project, rec)
            raise Refused(f"nginx rejected the config: {err}")
        log(f"nginx now serves {', '.join(domains)}")
    return {"file": avail, "domains": domains}


def cmd_ssl_issue(args):
    if len(args) != 1:
        raise Refused("usage: ssl-issue <project>  (JSON on stdin)")
    project = args[0]
    spec = read_json_stdin()
    domains = check_domains(spec.get("domains"))
    with ProjectLock(project):
        rec = shipyard_record(project)
        missing = [d for d in domains if d not in rec["domains"]]
        if missing:
            raise Refused(f"domains not owned by this project: {', '.join(missing)}")
        name = domains[0]
        cmd = [CERTBOT, "--nginx", "--non-interactive", "--agree-tos", "--redirect", "--cert-name", name]
        for d in domains:
            cmd += ["-d", d]
        log(f"Requesting SSL certificate for {', '.join(domains)}")
        code, tail = stream(cmd, timeout=300, as_apps=False)
        if code != 0:
            raise Refused(f"certbot failed: {tail[-400:]}")
        if name not in rec["certificates"]:
            rec["certificates"].append(name)
        save_record(project, rec)
        status = http_status(f"https://{name}/", host=name)
        log(f"https://{name} answers with HTTP {status}")
    return {"certificate": name, "https_status": status}


def cmd_site_finish(args):
    if len(args) != 1:
        raise Refused("usage: site-finish <project>")
    project = args[0]
    with ProjectLock(project):
        rec = shipyard_record(project)
        rec["status"] = "active"
        rec["updated"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        save_record(project, rec)
    return {"project": project, "status": "active"}


def remove_project(project, rec):
    path = project_dir(project)
    removed = []
    running = {p["name"] for p in pm2_list()}
    for a in rec.get("apps", []):
        for name in (a.get("process"), f"{a.get('process')}-blue", f"{a.get('process')}-green"):
            if name in running:
                run_as_apps([PM2, "delete", name])
                removed.append(f"process {name}")
        uf = upstream_file(project, a["name"])
        if os.path.isfile(uf):
            os.remove(uf)
            removed.append(uf)
    run_as_apps([PM2, "save", "--force"])
    for cert in rec.get("certificates", []):
        if DOMAIN.match(cert):
            subprocess.run([CERTBOT, "delete", "--non-interactive", "--cert-name", cert], capture_output=True)
            removed.append(f"certificate {cert}")
    for f in rec.get("nginx", []):
        if os.path.dirname(f) in (NGINX_AVAILABLE, NGINX_ENABLED) and (os.path.islink(f) or os.path.isfile(f)):
            os.remove(f)
            removed.append(f)
    ok, err = nginx_reload()
    if not ok:
        log(f"warning: nginx test failed after removal: {err}")
    for d in rec.get("static", []):
        real = os.path.realpath(d)
        if os.path.dirname(real) == SHIPYARD_STATIC and os.path.isdir(real):
            shutil.rmtree(real)
            removed.append(real)
    cron = subprocess.run(["crontab", "-u", APPS_USER, "-l"], capture_output=True, text=True)
    if cron.returncode == 0 and f"/srv/apps/{project}/" in cron.stdout:
        kept = [l for l in cron.stdout.splitlines() if f"/srv/apps/{project}/" not in l]
        subprocess.run(["crontab", "-u", APPS_USER, "-"], input="\n".join(kept) + "\n", text=True)
        removed.append("scheduled jobs")
    shutil.rmtree(path)
    removed.append(path)
    for item in removed:
        log(f"removed {item}")
    return removed


def cmd_site_remove(args):
    if len(args) != 1:
        raise Refused("usage: site-remove <project>")
    project = args[0]
    with ProjectLock(project):
        rec = shipyard_record(project)
        if rec.get("status") != "creating":
            raise Refused("only a site that is still being created can be rolled back; deleting live sites needs the confirmed delete flow")
        removed = remove_project(project, rec)
    return {"removed": removed}


SLOT_OFFSET = 10000
UPSTREAM_DIR = "/etc/nginx/conf.d"
KEEP_RELEASES = 5
BUILD_LOCK = "/run/vpsctl-build.lock"
SLOTS = ("blue", "green")


def upstream_name(project, app):
    return f"shipyard_{project.replace('-', '_')}_{app.replace('-', '_')}"


def upstream_file(project, app):
    return os.path.join(UPSTREAM_DIR, f"shipyard-{project}-{app}.conf")


def upstream_ports():
    out = {}
    if not os.path.isdir(UPSTREAM_DIR):
        return out
    for name in os.listdir(UPSTREAM_DIR):
        if not (name.startswith("shipyard-") and name.endswith(".conf")):
            continue
        try:
            text = open(os.path.join(UPSTREAM_DIR, name)).read()
        except OSError:
            continue
        m = re.search(r"upstream\s+(shipyard_[a-z0-9_]+)\s*\{[^}]*server\s+127\.0\.0\.1:(\d+)", text)
        if m:
            out[m.group(1)] = int(m.group(2))
    return out


def write_upstream(project, app, port):
    path = upstream_file(project, app)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        f.write(f"upstream {upstream_name(project, app)} {{\n    server 127.0.0.1:{port};\n}}\n")
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


class GlobalBuildLock:
    def __enter__(self):
        import fcntl
        import time
        self.f = open(BUILD_LOCK, "w")
        waited = 0
        while True:
            try:
                fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except OSError:
                if waited == 0:
                    log("Waiting for another build on this server to finish")
                time.sleep(3)
                waited += 3
                if waited > 3600:
                    raise Refused("waited too long for another build")

    def __exit__(self, *exc):
        self.f.close()


def ensure_nginx_drain():
    conf = "/etc/nginx/nginx.conf"
    text = open(conf).read()
    if "worker_shutdown_timeout" in text:
        return
    text = re.sub(r"(^\s*worker_processes[^\n]*\n)", r"\1worker_shutdown_timeout 30s;\n", text, count=1, flags=re.M)
    with open(conf, "w") as f:
        f.write(text)


def source_of(a):
    return os.path.basename(a["path"].rstrip("/"))


def source_apps(rec, source):
    apps = [a for a in rec.get("apps", []) if source_of(a) == source]
    if not apps:
        raise Refused(f"no apps use source {source}")
    return apps


def releases_dir(project, source):
    return os.path.join(project_dir(project), "releases", check_name(source, "source"))


def release_path(project, source, rid):
    if not re.match(r"^[0-9]{8}-[0-9]{6}-[a-z0-9]{1,12}$", rid or ""):
        raise Refused("invalid release id")
    path = os.path.join(releases_dir(project, source), rid)
    if not os.path.isdir(path):
        raise Refused(f"release {rid} not found")
    return path


def shared_dir(project, app):
    return os.path.join(project_dir(project), "shared", app)


def default_switch(a):
    return "overlap" if a.get("type") in ("nextjs", "static") else "restart"


def mkdir_apps(path, mode=0o750):
    os.makedirs(path, exist_ok=True)
    os.chown(path, apps_uid(), apps_gid())
    os.chmod(path, mode)


def link_shared(project, a, wd):
    for rel in a.get("shared", []) or []:
        rel = check_subdir(rel)
        if not rel:
            continue
        target = os.path.join(shared_dir(project, a["name"]), rel)
        link = os.path.join(wd, rel)
        mkdir_apps(os.path.join(project_dir(project), "shared"))
        mkdir_apps(shared_dir(project, a["name"]))
        if not os.path.lexists(target) and os.path.lexists(link) and not os.path.islink(link):
            os.makedirs(os.path.dirname(target), exist_ok=True)
            shutil.move(link, target)
            log(f"{a['name']}: moved {rel} to shared storage")
        if not os.path.lexists(target):
            continue
        if os.path.lexists(link):
            if os.path.isdir(link) and not os.path.islink(link):
                shutil.rmtree(link)
            else:
                os.remove(link)
        os.makedirs(os.path.dirname(link), exist_ok=True)
        os.symlink(target, link)
        os.lchown(link, apps_uid(), apps_gid())
    env_file = a.get("env_file") or os.path.join(project_dir(project), "env", f"{a['name']}.env")
    if os.path.isfile(env_file):
        link = os.path.join(wd, ".env")
        if os.path.lexists(link):
            os.remove(link)
        os.symlink(env_file, link)
        os.lchown(link, apps_uid(), apps_gid())


def cmd_release_prepare(args):
    if len(args) != 2:
        raise Refused("usage: release-prepare <project> <source>  (JSON on stdin: {mode, token})")
    project, source = args
    spec = read_json_stdin()
    mode = spec.get("mode", "fetch")
    if mode not in ("fetch", "snapshot", "clean"):
        raise Refused("mode must be fetch, snapshot or clean")
    import time
    with ProjectLock(project):
        rec = shipyard_record(project)
        apps = source_apps(rec, source)
        src = apps[0]["path"]
        if mode == "fetch":
            env = git_auth_env(spec.get("token", ""))
            branch = apps[0].get("branch")
            if not apps[0].get("repo") or not branch:
                raise Refused("this source is not linked to a GitHub repository")
            log(f"Fetching {apps[0]['repo']} ({branch})")
            code, tail = stream([GIT, "-C", src, "fetch", "--depth", "1", "origin", branch], env=env, timeout=600)
            if code:
                raise Refused(f"git fetch failed: {tail[-300:]}")
            code, tail = stream([GIT, "-C", src, "reset", "--hard", "FETCH_HEAD"], env=env, timeout=120)
            if code:
                raise Refused("git reset failed")
        head = git_head(src) if os.path.isdir(os.path.join(src, ".git")) else {"commit": "", "message": "files on server"}
        rid = time.strftime("%Y%m%d-%H%M%S") + "-" + ((head["commit"] or "local")[:7])
        rdir = releases_dir(project, source)
        mkdir_apps(os.path.join(project_dir(project), "releases"))
        mkdir_apps(rdir)
        dest = os.path.join(rdir, rid)
        excludes = ["--exclude=/.git", "--exclude=.env"]
        if mode != "snapshot":
            excludes += ["--exclude=node_modules", "--exclude=.next", "--exclude=.venv"]
        else:
            excludes += ["--exclude=.next/cache", "--exclude=.venv"]
        log(f"Creating release {rid}")
        out = subprocess.run(["rsync", "-a", *excludes, src.rstrip("/") + "/", dest + "/"], capture_output=True, text=True)
        if out.returncode:
            raise Refused(f"copy failed: {out.stderr[-300:]}")
        for root, dirs, files in os.walk(dest):
            os.lchown(root, apps_uid(), apps_gid())
            for n in dirs + files:
                os.lchown(os.path.join(root, n), apps_uid(), apps_gid())
        os.chmod(dest, 0o750)
        for a in apps:
            wd = app_workdir({"path": dest}, a.get("subdir", ""))
            link_shared(project, a, wd)
        rec.setdefault("releases", [])
        rec["releases"].append({
            "id": rid, "source": source, "commit": head["commit"], "message": head["message"],
            "created": datetime.datetime.now(datetime.timezone.utc).isoformat(), "status": "prepared", "mode": mode,
        })
        rec["releases"] = rec["releases"][-30:]
        save_record(project, rec)
    return {"release": rid, **head}


def cmd_release_build(args):
    if len(args) != 3:
        raise Refused("usage: release-build <project> <source> <release>  (JSON on stdin: {install: bool, build: bool})")
    project, source, rid = args
    spec = read_json_stdin()
    with ProjectLock(project), GlobalBuildLock():
        rec = shipyard_record(project)
        apps = source_apps(rec, source)
        rpath = release_path(project, source, rid)
        locks = ("package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml")
        monorepo = any(a.get("subdir") for a in apps) and any(os.path.isfile(os.path.join(rpath, f)) for f in locks)
        done_install = set()
        for a in apps:
            wd = app_workdir({"path": rpath}, a.get("subdir", ""))
            env = app_env(project, a["name"])
            env.pop("NODE_ENV", None)
            if a.get("type") == "python":
                if os.path.isfile(os.path.join(wd, "uv.lock")) or os.path.isfile(os.path.join(wd, "pyproject.toml")):
                    cmd = "uv sync --no-dev"
                else:
                    cmd = a.get("install") or "python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
                log(f"Python environment: {cmd}")
                code, _ = stream([BASH, "-c", cmd], cwd=wd, env=env, timeout=1500)
                if code:
                    raise Refused(f"python install failed for {a['name']}")
                continue
            install = a.get("install")
            where = rpath if monorepo else wd
            if spec.get("install", True) and install and where not in done_install:
                log(f"Installing: {install}")
                code, _ = stream([BASH, "-c", install], cwd=where, env=env, timeout=1500)
                if code:
                    raise Refused(f"install failed (exit {code})")
                done_install.add(where)
            build = a.get("build")
            if spec.get("build", True) and build and (a.get("type") != "node" or spec.get("build_node", True)):
                log(f"Building {a['name']}: {build}")
                code, _ = stream([BASH, "-c", build], cwd=wd, env=env, timeout=1800)
                if code:
                    raise Refused(f"build failed for {a['name']} (exit {code})")
            if a.get("type") == "static":
                out_dir = check_subdir(a.get("output"))
                src = os.path.realpath(os.path.join(wd, out_dir)) if out_dir else wd
                if not os.path.isdir(src):
                    raise Refused(f"output folder not found: {out_dir or '.'}")
        for r in rec.get("releases", []):
            if r["id"] == rid:
                r["status"] = "built"
        save_record(project, rec)
    return {"release": rid, "built": True}


def slot_port(a, slot):
    return int(a["port"]) + (SLOT_OFFSET if slot == "green" else 0)


def write_slot_config(project, a, slot, wd):
    pdir = project_dir(project)
    name = f"{a['process']}-{slot}"
    config = os.path.join(pdir, "pm2", f"{a['name']}-{slot}.config.js")
    with open(config + ".tmp", "w") as f:
        f.write(PM2_TEMPLATE % {
            "name": json.dumps(name),
            "cwd": json.dumps(wd),
            "start": json.dumps(f"exec {a['start']}"),
            "env_file": json.dumps(os.path.join(pdir, "env", f"{a['name']}.env")),
            "port": json.dumps(str(slot_port(a, slot))),
            "path": json.dumps(f"{os.path.join(wd, '.venv', 'bin')}:{os.path.join(wd, 'node_modules', '.bin')}:{APP_PATH}"),
            "out": json.dumps(os.path.join(pdir, "logs", f"{a['name']}.out.log")),
            "err": json.dumps(os.path.join(pdir, "logs", f"{a['name']}.err.log")),
        })
    os.chown(config + ".tmp", 0, apps_gid())
    os.chmod(config + ".tmp", 0o640)
    os.replace(config + ".tmp", config)
    return name, config


def wait_port_free(port, seconds=20):
    import time
    for _ in range(seconds * 2):
        if not subprocess.run([SS, "-ltnH", f"sport = :{port}"], capture_output=True, text=True).stdout.strip():
            return True
        time.sleep(0.5)
    return False


def wait_healthy(port, name, seconds=120):
    import time
    deadline = time.time() + seconds
    status = 0
    while time.time() < deadline:
        status = http_status(f"http://127.0.0.1:{port}/")
        if 0 < status < 500:
            return status
        if {p["name"]: p for p in pm2_list()}.get(name, {}).get("status") == "errored":
            break
        time.sleep(1)
    return status


def nginx_check(rec):
    domains = [d for d in rec.get("domains", []) if not d.startswith("www.")]
    if not domains:
        return 200
    d = domains[0]
    return http_status(f"https://{d}/", host=d)


def activate_app(project, rec, a, rpath):
    import time
    wd = app_workdir({"path": rpath}, a.get("subdir", ""))
    running = {p["name"] for p in pm2_list()}
    legacy = a["process"] if a["process"] in running else None
    active = a.get("slot")
    if active not in SLOTS:
        active = "blue" if legacy else None
    target = "green" if active == "blue" else "blue"
    old_name = legacy or (f"{a['process']}-{active}" if active else None)
    old_port = slot_port(a, active) if active else None
    new_port = slot_port(a, target)
    mode = a.get("switch") or default_switch(a)
    name, config = write_slot_config(project, a, target, wd)

    if name in running:
        run_as_apps([PM2, "delete", name])
    if not wait_port_free(new_port):
        raise Refused(f"slot port {new_port} is busy")

    if mode == "restart" and old_name:
        log(f"{a['name']}: stopping {old_name} (this app must not run twice)")
        run_as_apps([PM2, "stop", old_name])
        wait_port_free(old_port)
        sdir = shared_dir(project, a["name"])
        for rel in a.get("shared", []) or []:
            src = os.path.join(a["path"], a.get("subdir", ""), rel)
            if legacy and os.path.isfile(src) and not os.path.islink(src):
                shutil.copy2(src, os.path.join(sdir, rel))

    log(f"{a['name']}: starting {name} on port {new_port}")
    out = run_as_apps([PM2, "start", config, "--update-env"], timeout=120)
    status = wait_healthy(new_port, name) if out.returncode == 0 else 0
    if not 0 < status < 500:
        err = os.path.join(project_dir(project), "logs", f"{a['name']}.err.log")
        log("--- last error output ---")
        log(tail_file(err, 25))
        run_as_apps([PM2, "delete", name])
        if mode == "restart" and old_name:
            run_as_apps([PM2, "start", old_name])
        raise Refused(f"{a['name']} did not answer on port {new_port} (status {status}); the live version keeps running")
    log(f"{a['name']}: healthy (HTTP {status})")

    previous = upstream_ports().get(upstream_name(project, a["name"]))
    write_upstream(project, a["name"], new_port)
    ok, err = nginx_reload()
    if not ok:
        if previous:
            write_upstream(project, a["name"], previous)
        run_as_apps([PM2, "delete", name])
        if mode == "restart" and old_name:
            run_as_apps([PM2, "start", old_name])
        raise Refused(f"nginx rejected the switch: {err}")
    time.sleep(1)
    if a.get("type") == "nextjs":
        check = nginx_check(rec)
        if not 0 < check < 500:
            log(f"{a['name']}: site check through nginx failed (HTTP {check}); switching back")
            if previous:
                write_upstream(project, a["name"], previous)
                nginx_reload()
            run_as_apps([PM2, "delete", name])
            if mode == "restart" and old_name:
                run_as_apps([PM2, "start", old_name])
            raise Refused(f"the site did not work through nginx after the switch (HTTP {check}); switched back")
        log(f"{a['name']}: live through nginx (HTTP {check})")

    if old_name:
        if mode == "overlap":
            log(f"{a['name']}: letting {old_name} finish open requests")
            time.sleep(10)
        run_as_apps([PM2, "delete", old_name])
    run_as_apps([PM2, "save", "--force"])
    a["slot"] = target
    return target


def publish_static(project, rec, a, rpath):
    wd = app_workdir({"path": rpath}, a.get("subdir", ""))
    out_dir = check_subdir(a.get("output"))
    src = os.path.realpath(os.path.join(wd, out_dir)) if out_dir else wd
    if not os.path.isdir(src):
        raise Refused(f"output folder not found: {out_dir or '.'}")
    base = os.path.join(SHIPYARD_STATIC, project)
    os.makedirs(base, mode=0o755, exist_ok=True)
    dest = os.path.join(base, a["name"])
    tmp = dest + ".new"
    if os.path.exists(tmp):
        shutil.rmtree(tmp)
    shutil.copytree(src, tmp, symlinks=False, ignore=shutil.ignore_patterns(".git", ".env", "node_modules"))
    for root, dirs, files in os.walk(tmp):
        os.chown(root, 0, 0)
        os.chmod(root, 0o755)
        for name in files:
            os.chown(os.path.join(root, name), 0, 0)
            os.chmod(os.path.join(root, name), 0o644)
    old = dest + ".old"
    if os.path.exists(old):
        shutil.rmtree(old)
    if os.path.exists(dest):
        os.rename(dest, old)
    os.rename(tmp, dest)
    if os.path.exists(old):
        shutil.rmtree(old)
    a["static_dir"] = dest
    if base not in rec.setdefault("static", []):
        rec["static"].append(base)
    log(f"{a['name']}: published static files")


def cmd_app_config(args):
    if len(args) != 2:
        raise Refused("usage: app-config <project> <app>  (JSON on stdin)")
    project, app = args
    spec = read_json_stdin()
    with ProjectLock(project):
        rec = shipyard_record(project)
        a = find_app(rec, app)
        if "type" in spec:
            if spec["type"] not in TYPES:
                raise Refused("invalid app type")
            a["type"] = spec["type"]
        if "subdir" in spec:
            a["subdir"] = check_subdir(spec["subdir"])
        if "output" in spec:
            a["output"] = check_subdir(spec["output"])
        for k in ("install", "build", "start"):
            if k in spec:
                a[k] = check_command(spec[k], k)
        if "port" in spec:
            port = int(spec["port"])
            if not 3000 <= port <= 4999:
                raise Refused("port must be between 3000 and 4999")
            if port != a.get("port") and port in used_ports():
                raise Refused(f"port {port} is already in use")
            a["port"] = port
        if "switch" in spec:
            if spec["switch"] not in ("overlap", "restart"):
                raise Refused("switch must be overlap or restart")
            a["switch"] = spec["switch"]
        if "auto_deploy" in spec:
            a["auto_deploy"] = bool(spec["auto_deploy"])
        if "shared" in spec:
            if not isinstance(spec["shared"], list) or len(spec["shared"]) > 20:
                raise Refused("shared must be a list")
            a["shared"] = [check_subdir(x) for x in spec["shared"] if check_subdir(x)]
        save_record(project, rec)
    return {"app": app, "config": {k: a.get(k) for k in ("type", "subdir", "install", "build", "start", "port", "switch", "shared", "output", "auto_deploy")}}


def nginx_files_of(rec):
    files = []
    for f in rec.get("nginx", []) or []:
        real = os.path.realpath(f)
        if os.path.dirname(real) == NGINX_AVAILABLE and os.path.isfile(real) and real not in files:
            files.append(real)
    return files


def point_nginx_to_upstream(project, rec, a):
    pattern = re.compile(r"http://(?:127\.0\.0\.1|localhost):%d(?![0-9])" % int(a["port"]))
    changed = []
    for f in nginx_files_of(rec):
        text = open(f).read()
        new = pattern.sub(f"http://{upstream_name(project, a['name'])}", text)
        if new != text:
            backup = os.path.join("/srv/backups", f"nginx-{os.path.basename(f)}.before-upstream")
            if not os.path.exists(backup):
                shutil.copy2(f, backup)
            with open(f, "w") as fh:
                fh.write(new)
            changed.append(f)
    if changed:
        ok, err = nginx_reload()
        if not ok:
            for f in changed:
                shutil.copy2(os.path.join("/srv/backups", f"nginx-{os.path.basename(f)}.before-upstream"), f)
            nginx_reload()
            raise Refused(f"nginx rejected the upstream change: {err}")
        log(f"{a['name']}: nginx now routes through {upstream_name(project, a['name'])}")
    return changed


def direct_port_refs(rec, port):
    pattern = re.compile(r"proxy_pass\s+http://(?:127\.0\.0\.1|localhost):%d(?![0-9])" % int(port))
    return [f for f in nginx_files_of(rec) if pattern.search(open(f).read())]


def cmd_release_activate(args):
    if len(args) != 3:
        raise Refused("usage: release-activate <project> <source> <release>")
    project, source, rid = args
    with ProjectLock(project):
        ensure_nginx_drain()
        rec = shipyard_record(project)
        apps = source_apps(rec, source)
        rpath = release_path(project, source, rid)
        for a in apps:
            if a.get("type") == "static":
                publish_static(project, rec, a, rpath)
                a["release"] = rid
                continue
            if not os.path.isfile(upstream_file(project, a["name"])) and a["process"] in {p["name"] for p in pm2_list()}:
                write_upstream(project, a["name"], int(a["port"]))
                nginx_reload()
            if os.path.isfile(upstream_file(project, a["name"])):
                point_nginx_to_upstream(project, rec, a)
                still = direct_port_refs(rec, a["port"])
                if still:
                    raise Refused(f"{a['name']}: nginx still points at port {a['port']} directly in {', '.join(still)}; not switching")
            target = activate_app(project, rec, a, rpath)
            a["release"] = rid
            save_record(project, rec)
            log(f"{a['name']}: now serving release {rid} from slot {target}")
        current = os.path.join(releases_dir(project, source), "current")
        tmp = current + ".tmp"
        if os.path.lexists(tmp):
            os.remove(tmp)
        os.symlink(rpath, tmp)
        os.lchown(tmp, apps_uid(), apps_gid())
        os.replace(tmp, current)
        for r in rec.get("releases", []):
            if r["source"] != source:
                continue
            if r["id"] == rid:
                r["status"] = "active"
                r["activated"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            elif r.get("status") == "active":
                r["status"] = "previous"
        save_record(project, rec)
        pruned = prune_releases(project, rec, source)
        save_record(project, rec)
    return {"release": rid, "pruned": pruned}


def prune_releases(project, rec, source):
    keep, removed = [], []
    rels = [r for r in rec.get("releases", []) if r["source"] == source]
    active = {a.get("release") for a in source_apps(rec, source)}
    good = [r for r in rels if r.get("status") in ("active", "previous")]
    keep_ids = {r["id"] for r in good[-KEEP_RELEASES:]} | active
    for r in rels:
        if r["id"] in keep_ids:
            continue
        path = os.path.join(releases_dir(project, source), r["id"])
        if os.path.isdir(path):
            shutil.rmtree(path)
            removed.append(r["id"])
        r["status"] = "pruned"
    rec["releases"] = [r for r in rec["releases"] if r.get("status") != "pruned" or r["source"] != source][-40:]
    for r in removed:
        log(f"Removed old release {r}")
    return removed


def cmd_release_discard(args):
    if len(args) != 3:
        raise Refused("usage: release-discard <project> <source> <release>")
    project, source, rid = args
    with ProjectLock(project):
        rec = shipyard_record(project)
        if any(a.get("release") == rid for a in source_apps(rec, source)):
            raise Refused("cannot discard the live release")
        path = os.path.join(releases_dir(project, source), rid)
        if os.path.isdir(path):
            shutil.rmtree(path)
        for r in rec.get("releases", []):
            if r["id"] == rid:
                r["status"] = "failed"
        save_record(project, rec)
    return {"discarded": rid}


def cmd_release_list(args):
    if len(args) != 1:
        raise Refused("usage: release-list <project>")
    rec = load_record(args[0])
    return {"releases": rec.get("releases", []), "apps": [
        {"name": a["name"], "source": source_of(a), "release": a.get("release"), "slot": a.get("slot")} for a in rec.get("apps", [])
    ]}


def cmd_recover(args):
    if len(args) != 1:
        raise Refused("usage: recover <project>")
    project = args[0]
    with ProjectLock(project):
        rec = load_record(project)
        running = {p["name"] for p in pm2_list()}
        actual = upstream_ports()
        fixed = []
        for a in rec.get("apps", []):
            port = actual.get(upstream_name(project, a["name"]))
            if not port:
                continue
            live_slot = "green" if port >= SLOT_OFFSET else "blue"
            idle = f"{a['process']}-{'blue' if live_slot == 'green' else 'green'}"
            if idle in running:
                run_as_apps([PM2, "delete", idle])
                fixed.append(f"stopped idle {idle}")
            if a.get("slot") != live_slot:
                a["slot"] = live_slot
                fixed.append(f"{a['name']} slot -> {live_slot}")
        if fixed:
            run_as_apps([PM2, "save", "--force"])
            save_record(project, rec)
    for f in fixed:
        log(f)
    return {"fixed": fixed}


def cmd_env_get(args):
    if len(args) != 2:
        raise Refused("usage: env-get <project> <app>")
    project, app = args
    rec = shipyard_record(project)
    find_app(rec, app)
    env_file = os.path.join(project_dir(project), "env", f"{check_name(app, 'app')}.env")
    content = open(env_file).read() if os.path.isfile(env_file) else ""
    return {"app": app, "content": content}


def cert_domains(name):
    for c in certificates():
        if c["name"] == name:
            return c["domains"]
    return []


def own_domain_files(rec):
    files = set()
    for a in rec.get("apps", []):
        if a.get("own_domain"):
            files.update(os.path.realpath(f) for f in a.get("nginx_files", []) or [])
    return files


def site_files(rec):
    own = own_domain_files(rec)
    return [f for f in nginx_files_of(rec) if f not in own]


def edit_server_names(rec, fn):
    changed = {}
    for f in site_files(rec):
        text = open(f).read()

        def repl(m):
            names = fn(m.group(1).split())
            return f"server_name {' '.join(names)};"

        new = re.sub(r"server_name\s+([^;]+);", repl, text)
        if new != text:
            changed[f] = text
            with open(f, "w") as fh:
                fh.write(new)
    return changed


def restore_files(changed):
    for f, text in changed.items():
        with open(f, "w") as fh:
            fh.write(text)
    nginx_reload()


def cmd_domain_add(args):
    if len(args) != 1:
        raise Refused("usage: domain-add <project>  (JSON on stdin: {domain})")
    project = args[0]
    spec = read_json_stdin()
    domain = check_domains([spec.get("domain")])[0]
    with ProjectLock(project):
        rec = shipyard_record(project)
        if domain in rec.get("domains", []):
            raise Refused(f"{domain} is already on this site")
        taken = enabled_server_names()
        if domain in taken:
            raise Refused(f"{domain} is already used by {taken[domain]}")
        if not nginx_files_of(rec):
            raise Refused("this site has no nginx config to extend")
        changed = edit_server_names(rec, lambda names: names + [domain] if "_" not in names else names)
        ok, err = nginx_reload()
        if not ok:
            restore_files(changed)
            raise Refused(f"nginx rejected the change: {err}")
        log(f"nginx now answers for {domain}")
        cert = (rec.get("certificates") or [rec["domains"][0]])[0]
        names = [d for d in cert_domains(cert) if d != domain] or [cert]
        cmd = [CERTBOT, "--nginx", "--non-interactive", "--agree-tos", "--redirect", "--expand", "--cert-name", cert]
        for d in names + [domain]:
            cmd += ["-d", d]
        log(f"Extending SSL certificate {cert} with {domain}")
        code, tail = stream(cmd, timeout=300, as_apps=False)
        if code:
            restore_files(changed)
            raise Refused(f"certbot failed, the domain was not added: {tail[-300:]}")
        rec.setdefault("domains", []).append(domain)
        if cert not in rec.setdefault("certificates", []):
            rec["certificates"].append(cert)
        save_record(project, rec)
        status = http_status(f"https://{domain}/", host=domain)
        log(f"https://{domain} answers with HTTP {status}")
    return {"domain": domain, "https_status": status}


def cmd_domain_remove(args):
    if len(args) != 1:
        raise Refused("usage: domain-remove <project>  (JSON on stdin: {domain})")
    project = args[0]
    spec = read_json_stdin()
    domain = check_domains([spec.get("domain")])[0]
    with ProjectLock(project):
        rec = shipyard_record(project)
        domains = rec.get("domains", [])
        if domain not in domains:
            raise Refused(f"{domain} is not on this site")
        if len(domains) == 1:
            raise Refused("a site needs at least one domain; delete the site instead")
        cert = (rec.get("certificates") or [domains[0]])[0]
        if domain == cert:
            raise Refused(f"{domain} is the site's main domain (its SSL certificate is named after it) and cannot be removed")
        changed = edit_server_names(rec, lambda names: [n for n in names if n != domain] or names)
        for f in nginx_files_of(rec):
            text = open(f).read()
            new = re.sub(r"\n\s*if \(\$host = %s\) \{[^}]*\}[^\n]*" % re.escape(domain), "", text)
            if new != text:
                changed.setdefault(f, text)
                with open(f, "w") as fh:
                    fh.write(new)
        ok, err = nginx_reload()
        if not ok:
            restore_files(changed)
            raise Refused(f"nginx rejected the change: {err}")
        log(f"nginx no longer answers for {domain}")
        remaining = [d for d in cert_domains(cert) if d != domain]
        if remaining:
            cmd = [CERTBOT, "certonly", "--nginx", "--non-interactive", "--agree-tos", "--cert-name", cert]
            for d in remaining:
                cmd += ["-d", d]
            log(f"Re-issuing SSL certificate {cert} without {domain}")
            code, tail = stream(cmd, timeout=300, as_apps=False)
            if code:
                log(f"warning: certificate still lists {domain} (harmless): {tail[-200:]}")
            else:
                nginx_reload()
        rec["domains"] = [d for d in domains if d != domain]
        save_record(project, rec)
    return {"removed": domain}


RESERVED_APP_NAMES = {"env", "pm2", "logs", "releases", "shared", "project", "backups"}
ROUTE = re.compile(r"^/[a-z0-9][a-z0-9_-]{0,30}(?:/[a-z0-9][a-z0-9_-]{0,30}){0,3}$")
ROUTE_BLOCK = """    # shipyard-route %(app)s begin
    location ^~ %(path)s/ {
        proxy_pass http://%(upstream)s;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
    }
    location = %(path)s {
        proxy_pass http://%(upstream)s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    # shipyard-route %(app)s end
"""


def strip_route(text, app):
    return re.sub(r"[ \t]*# shipyard-route %s begin\n.*?# shipyard-route %s end\n" % (re.escape(app), re.escape(app)), "", text, flags=re.S)


def cmd_route_add(args):
    if len(args) != 2:
        raise Refused("usage: route-add <project> <app>  (JSON on stdin: {path})")
    project, app = args
    path = (read_json_stdin().get("path") or "").rstrip("/")
    if not ROUTE.match(path):
        raise Refused("path must look like /api (lowercase letters, numbers, - and _)")
    with ProjectLock(project):
        rec = shipyard_record(project)
        a = find_app(rec, app)
        if a.get("type") == "static":
            raise Refused("a static app can't be served on a path")
        if not os.path.isfile(upstream_file(project, app)):
            raise Refused(f"{app} isn't running yet")
        for other in rec.get("apps", []):
            if other is not a and other.get("route") == path:
                raise Refused(f"{path} already goes to {other['name']}")
        files = [f for f in site_files(rec) if re.search(r"^\s*location\s+/\s*\{", open(f).read(), re.M)]
        if not files:
            raise Refused("this site's nginx config has no main location to add a route next to")
        block = ROUTE_BLOCK % {"app": app, "path": path, "upstream": upstream_name(project, app)}
        before = {f: open(f).read() for f in files}
        for f, text in before.items():
            if re.search(r"location\s+(?:\^~\s+|=\s+)?%s/?\s*\{" % re.escape(path), strip_route(text, app)):
                raise Refused(f"{os.path.basename(f)} already has a location for {path}")
        for f, text in before.items():
            new = re.sub(r"^([ \t]*)location\s+/\s*\{", lambda m: block + m.group(0), strip_route(text, app), flags=re.M)
            with open(f, "w") as fh:
                fh.write(new)
        ok, err = nginx_reload()
        if not ok:
            restore_files(before)
            raise Refused(f"nginx rejected the route: {err}")
        a["route"] = path
        save_record(project, rec)
        import time
        time.sleep(1)
        domain = next((d for d in rec.get("domains", []) if not d.startswith("www.")), None)
        status = http_status(f"https://{domain}{path}/", host=domain) if domain else 0
        log(f"{path} now goes to {app}" + (f" (https://{domain}{path}/ answers with HTTP {status})" if domain else ""))
    return {"path": path, "files": [os.path.basename(f) for f in files], "status": status}


def cmd_app_remove(args):
    if len(args) != 2:
        raise Refused("usage: app-remove <project> <app>  (JSON on stdin: {backup})")
    project, app = args
    spec = read_json_stdin()
    with ProjectLock(project):
        rec = shipyard_record(project)
        apps = rec.get("apps", [])
        idx = next((i for i, x in enumerate(apps) if x.get("name") == app), None)
        if idx is None:
            raise Refused(f"no app named {app}")
        if idx == 0 or len(apps) < 2:
            raise Refused("the site's main app can't be removed here; delete the whole site instead")
        a = apps[idx]
        pdir = project_dir(project)
        if spec.get("backup"):
            folder = os.path.join(PROJECT_BACKUPS, project)
            os.makedirs(folder, mode=0o700, exist_ok=True)
            archive, size = write_archive(project, rec, folder)
            log(f"Backup saved: {archive} ({size // 1024} KB)")
        removed = []
        running = {p["name"] for p in pm2_list()}
        proc = a.get("process") or f"{project}-{app}"
        for name in (proc, f"{proc}-blue", f"{proc}-green"):
            if name in running:
                run_as_apps([PM2, "delete", name])
                removed.append(f"process {name}")
        run_as_apps([PM2, "save", "--force"])
        before = {}
        for f in site_files(rec):
            text = open(f).read()
            new = strip_route(text, app)
            if new != text:
                before[f] = text
                with open(f, "w") as fh:
                    fh.write(new)
                removed.append(f"route in {os.path.basename(f)}")
        own = [f for f in a.get("nginx_files", []) or []] if a.get("own_domain") else []
        for f in own:
            if os.path.dirname(f) in (NGINX_AVAILABLE, NGINX_ENABLED) and (os.path.islink(f) or os.path.isfile(f)):
                os.remove(f)
                removed.append(f)
        uf = upstream_file(project, app)
        if os.path.isfile(uf):
            os.remove(uf)
            removed.append(uf)
        ok, err = nginx_reload()
        if not ok:
            restore_files(before)
            raise Refused(f"nginx rejected the change, nothing more was removed: {err}")
        if a.get("own_domain") and a.get("domains"):
            cert = a["domains"][0]
            if cert in rec.get("certificates", []) and DOMAIN.match(cert):
                subprocess.run([CERTBOT, "delete", "--non-interactive", "--cert-name", cert], capture_output=True)
                rec["certificates"] = [c for c in rec["certificates"] if c != cert]
                removed.append(f"certificate {cert}")
            rec["domains"] = [d for d in rec.get("domains", []) if d not in a["domains"]]
        rec["nginx"] = [f for f in rec.get("nginx", []) if f not in own]
        source = source_of(a) if a.get("path") else app
        shared_source = any(source_of(x) == source for i, x in enumerate(apps) if i != idx and x.get("path"))
        paths = [os.path.join(pdir, "env", f"{app}.env"), os.path.join(pdir, "pm2", f"{app}.config.js"),
                 os.path.join(pdir, "pm2", f"{app}-blue.config.js"), os.path.join(pdir, "pm2", f"{app}-green.config.js"),
                 os.path.join(pdir, "logs", f"{app}.out.log"), os.path.join(pdir, "logs", f"{app}.err.log"),
                 shared_dir(project, app)]
        if not shared_source:
            paths += [releases_dir(project, source), os.path.join(pdir, source)]
        for p in paths:
            real = os.path.realpath(p)
            if not real.startswith(pdir + "/"):
                continue
            if os.path.isdir(real) and not os.path.islink(p):
                shutil.rmtree(real)
                removed.append(real)
            elif os.path.lexists(p):
                os.remove(p)
                removed.append(p)
        if not shared_source:
            rec["releases"] = [r for r in rec.get("releases", []) if r.get("source") != source]
        del apps[idx]
        save_record(project, rec)
        for item in removed:
            log(f"removed {item}")
    return {"removed": removed}


def cmd_site_delete(args):
    if len(args) != 1:
        raise Refused("usage: site-delete <project>  (JSON on stdin: {confirm: <project>})")
    project = args[0]
    spec = read_json_stdin()
    if spec.get("confirm") != project:
        raise Refused("confirmation does not match the project name")
    with ProjectLock(project):
        rec = shipyard_record(project)
        log(f"Backing up {project}")
        archive, size = write_archive(project, rec, DELETED_BACKUPS)
        log(f"Backup verified ({size // 1024} KB) at {archive}")
        removed = remove_project(project, rec)
    return {"backup": archive, "backup_size": size, "removed": removed}


PROJECT_BACKUPS = "/srv/backups/projects"
DELETED_BACKUPS = "/srv/backups/deleted"
KEEP_BACKUP_DAYS = 14
KEEP_DELETED_DAYS = 30


def project_archive_items(project, rec):
    items = [project_dir(project)]
    items += [f for f in rec.get("nginx", []) if os.path.lexists(f)]
    items += [upstream_file(project, a["name"]) for a in rec.get("apps", []) if os.path.isfile(upstream_file(project, a["name"]))]
    for cert in rec.get("certificates", []):
        for base in ("/etc/letsencrypt/live", "/etc/letsencrypt/archive"):
            if os.path.isdir(os.path.join(base, cert)):
                items.append(os.path.join(base, cert))
        renewal = f"/etc/letsencrypt/renewal/{cert}.conf"
        if os.path.isfile(renewal):
            items.append(renewal)
    return items


def write_archive(project, rec, folder):
    import time
    os.makedirs(folder, mode=0o700, exist_ok=True)
    archive = os.path.join(folder, f"{project}-{time.strftime('%Y%m%d-%H%M%S')}.tar.gz")
    cron = subprocess.run(["crontab", "-u", APPS_USER, "-l"], capture_output=True, text=True).stdout
    lines = [l for l in cron.splitlines() if f"/srv/apps/{project}/" in l]
    cron_file = os.path.join(project_dir(project), "cron.backup")
    with open(cron_file, "w") as f:
        f.write("\n".join(lines) + ("\n" if lines else ""))
    out = subprocess.run(
        ["tar", "--warning=no-file-changed", "-czf", archive,
         "--exclude=node_modules", "--exclude=.next", "--exclude=.venv",
         f"--exclude={project_dir(project)}/releases", *project_archive_items(project, rec)],
        capture_output=True, text=True,
    )
    os.remove(cron_file)
    if out.returncode not in (0, 1) or not os.path.isfile(archive):
        raise Refused(f"backup failed: {out.stderr[-300:]}")
    os.chmod(archive, 0o600)
    check = subprocess.run(["tar", "-tzf", archive], capture_output=True, text=True)
    if check.returncode != 0 or "project.json" not in check.stdout:
        os.remove(archive)
        raise Refused("backup could not be verified")
    return archive, os.path.getsize(archive)


def prune_backups(folder, days, project=None):
    import time
    removed = []
    if not os.path.isdir(folder):
        return removed
    for name in os.listdir(folder):
        path = os.path.join(folder, name)
        if project and not name.startswith(f"{project}-"):
            continue
        if name.endswith(".tar.gz") and time.time() - os.path.getmtime(path) > days * 86400:
            os.remove(path)
            removed.append(name)
    return removed


def cmd_backup_create(args):
    if len(args) != 1:
        raise Refused("usage: backup-create <project>")
    project = args[0]
    with ProjectLock(project):
        rec = shipyard_record(project)
        folder = os.path.join(PROJECT_BACKUPS, project)
        log(f"Backing up {project}")
        archive, size = write_archive(project, rec, folder)
        pruned = prune_backups(folder, KEEP_BACKUP_DAYS)
        log(f"Saved {archive} ({size // 1024} KB); removed {len(pruned)} older than {KEEP_BACKUP_DAYS} days")
    return {"backup": archive, "size": size, "pruned": pruned}


def backup_entries(folder, kind):
    out = []
    if not os.path.isdir(folder):
        return out
    for root, _, files in os.walk(folder):
        for name in files:
            if not name.endswith(".tar.gz"):
                continue
            path = os.path.join(root, name)
            m = re.match(r"^([a-z0-9][a-z0-9-]{0,40})-(\d{8}-\d{6})\.tar\.gz$", name)
            if not m:
                continue
            st = os.stat(path)
            out.append({"kind": kind, "project": m.group(1), "file": name, "path": path, "size": st.st_size,
                        "created": datetime.datetime.fromtimestamp(st.st_mtime, datetime.timezone.utc).isoformat()})
    return out


def cmd_backup_list(_):
    prune_backups(DELETED_BACKUPS, KEEP_DELETED_DAYS)
    items = backup_entries(PROJECT_BACKUPS, "scheduled") + backup_entries(DELETED_BACKUPS, "deleted")
    items.sort(key=lambda x: x["created"], reverse=True)
    live = {r.get("project") for r in managed_projects()}
    for i in items:
        i["live"] = i["project"] in live
    return {"backups": items}


def cmd_backup_restore(args):
    if len(args) != 1:
        raise Refused("usage: backup-restore <file>  (a file name from backup-list)")
    name = args[0]
    m = re.match(r"^([a-z0-9][a-z0-9-]{0,40})-(\d{8}-\d{6})\.tar\.gz$", name)
    if not m:
        raise Refused("invalid backup name")
    project = m.group(1)
    candidates = [os.path.join(DELETED_BACKUPS, name), os.path.join(PROJECT_BACKUPS, project, name)]
    archive = next((c for c in candidates if os.path.isfile(c)), None)
    if not archive:
        raise Refused("backup not found")
    if os.path.exists(project_dir(project)):
        raise Refused(f"{project} exists right now; restoring over a live site is not allowed")
    listing = subprocess.run(["tar", "-tzf", archive], capture_output=True, text=True).stdout.splitlines()
    allowed = (f"srv/apps/{project}/", "etc/nginx/sites-available/", "etc/nginx/sites-enabled/", "etc/nginx/conf.d/shipyard-",
               "etc/letsencrypt/live/", "etc/letsencrypt/archive/", "etc/letsencrypt/renewal/")
    bad = [p for p in listing if not p.startswith(allowed) or ".." in p.split("/")]
    if bad:
        raise Refused(f"backup contains unexpected paths: {bad[:3]}")
    names_in_backup = []
    with ProjectLock(project):
        log(f"Restoring {project} from {name}")
        tmp_rec = subprocess.run(["tar", "-xzf", archive, "-O", f"srv/apps/{project}/project.json"], capture_output=True, text=True)
        try:
            rec = json.loads(tmp_rec.stdout)
        except ValueError:
            raise Refused("backup has no readable project.json")
        taken = enabled_server_names()
        clash = [d for d in rec.get("domains", []) if d in taken]
        if clash:
            raise Refused(f"domains now used by another site: {', '.join(clash)}")
        out = subprocess.run(["tar", "-xzf", archive, "-C", "/"], capture_output=True, text=True)
        if out.returncode:
            raise Refused(f"extract failed: {out.stderr[-300:]}")
        for a in rec.get("apps", []):
            a.pop("release", None)
            a.pop("slot", None)
        rec["status"] = "restoring"
        rec["releases"] = []
        save_record(project, rec)
        cron_file = os.path.join(project_dir(project), "cron.backup")
        if os.path.isfile(cron_file):
            lines = [l for l in open(cron_file).read().splitlines() if l.strip()]
            if lines:
                current = subprocess.run(["crontab", "-u", APPS_USER, "-l"], capture_output=True, text=True).stdout.splitlines()
                subprocess.run(["crontab", "-u", APPS_USER, "-"], input="\n".join(current + [l for l in lines if l not in current]) + "\n", text=True)
            os.remove(cron_file)
        ok, err = nginx_reload()
        if not ok:
            log(f"warning: nginx test failed after restore: {err}")
        names_in_backup = sorted({source_of(a) for a in rec.get("apps", [])})
        log(f"Files restored. Sources to rebuild: {', '.join(names_in_backup)}")
    return {"project": project, "sources": names_in_backup}


def cmd_backup_delete(args):
    if len(args) != 2 or args[0] not in ("scheduled", "deleted"):
        raise Refused("usage: backup-delete <scheduled|deleted> <file>")
    kind, name = args
    m = re.match(r"^([a-z0-9][a-z0-9-]{0,40})-(\d{8}-\d{6})\.tar\.gz$", name)
    if not m:
        raise Refused("invalid backup name")
    folder = DELETED_BACKUPS if kind == "deleted" else os.path.join(PROJECT_BACKUPS, m.group(1))
    archive = os.path.join(folder, name)
    if os.path.islink(archive) or not os.path.isfile(archive):
        raise Refused("backup not found")
    if os.path.dirname(os.path.realpath(archive)) != os.path.realpath(folder):
        raise Refused("backup is outside the backup folder")
    size = os.path.getsize(archive)
    os.remove(archive)
    log(f"Deleted backup {archive} ({size // 1024} KB)")
    return {"deleted": name, "kind": kind, "size": size}


def cmd_backup_info(args):
    if len(args) != 1:
        raise Refused("usage: backup-info <file>")
    name = args[0]
    m = re.match(r"^([a-z0-9][a-z0-9-]{0,40})-(\d{8}-\d{6})\.tar\.gz$", name)
    if not m:
        raise Refused("invalid backup name")
    project = m.group(1)
    archive = next((c for c in (os.path.join(DELETED_BACKUPS, name), os.path.join(PROJECT_BACKUPS, project, name)) if os.path.isfile(c)), None)
    if not archive:
        raise Refused("backup not found")
    out = subprocess.run(["tar", "-xzf", archive, "-O", f"srv/apps/{project}/project.json"], capture_output=True, text=True)
    try:
        rec = json.loads(out.stdout)
    except ValueError:
        raise Refused("backup has no readable project.json")
    return {
        "project": project,
        "domains": rec.get("domains", []),
        "apps": [{"name": a.get("name"), "type": a.get("type"), "repo": a.get("repo")} for a in rec.get("apps", [])],
        "sources": sorted({source_of(a) for a in rec.get("apps", []) if a.get("path")}),
        "exists": os.path.exists(project_dir(project)),
    }


def cmd_shipyard_restart(args):
    targets = {"web": ["shipyard"], "all": ["shipyard", "shipyard-worker"], "worker": ["shipyard-worker"]}
    which = args[0] if args else "web"
    if which not in targets:
        raise Refused("usage: shipyard-restart [web|worker|all]")
    for unit in targets[which]:
        subprocess.run([SYSTEMCTL, "restart", "--no-block", unit], check=True)
    return {"restarted": targets[which]}


COMMANDS = {
    "backup-create": cmd_backup_create,
    "backup-list": cmd_backup_list,
    "backup-restore": cmd_backup_restore,
    "backup-info": cmd_backup_info,
    "backup-delete": cmd_backup_delete,
    "route-add": cmd_route_add,
    "app-remove": cmd_app_remove,
    "shipyard-restart": cmd_shipyard_restart,
    "env-get": cmd_env_get,
    "domain-add": cmd_domain_add,
    "domain-remove": cmd_domain_remove,
    "site-delete": cmd_site_delete,
    "release-prepare": cmd_release_prepare,
    "release-build": cmd_release_build,
    "release-activate": cmd_release_activate,
    "release-discard": cmd_release_discard,
    "release-list": cmd_release_list,
    "app-config": cmd_app_config,
    "recover": cmd_recover,
    "ports": cmd_ports,
    "site-init": cmd_site_init,
    "site-clone": cmd_site_clone,
    "site-pull": cmd_site_pull,
    "site-env": cmd_site_env,
    "site-build": cmd_site_build,
    "site-start": cmd_site_start,
    "nginx-add": cmd_nginx_add,
    "ssl-issue": cmd_ssl_issue,
    "site-finish": cmd_site_finish,
    "site-remove": cmd_site_remove,
    "inventory": cmd_inventory,
    "legacy-logs": cmd_legacy_logs,
    "version": cmd_version,
    "status": cmd_status,
    "list": cmd_list,
    "start": lifecycle("start"),
    "stop": lifecycle("stop"),
    "restart": lifecycle("restart"),
    "logs": cmd_logs,
    "nginx-test": cmd_nginx_test,
}


def main(argv):
    if os.geteuid() != 0:
        print(json.dumps({"ok": False, "error": "vpsctl must run as root (via sudo)"}))
        return 2
    if not argv or argv[0] not in COMMANDS:
        print(json.dumps({"ok": False, "error": "unknown command", "commands": sorted(COMMANDS)}))
        return 2
    try:
        data = COMMANDS[argv[0]](argv[1:])
        if argv[0] not in ("status", "list", "logs", "version", "inventory", "legacy-logs", "nginx-test", "ports", "release-list", "env-get", "backup-list", "backup-info"):
            audit(argv, "ok")
        print(json.dumps({"ok": True, "data": data}))
        return 0
    except (Refused, ValueError, subprocess.TimeoutExpired) as e:
        audit(argv, f"refused: {e}")
        print(json.dumps({"ok": False, "error": str(e)}))
        return 1
    except Exception as e:
        audit(argv, f"error: {type(e).__name__}: {e}")
        print(json.dumps({"ok": False, "error": f"internal error: {type(e).__name__}"}))
        return 3


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
