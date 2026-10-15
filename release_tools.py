"""Content versions and isolated, reproducible application snapshots."""
import html
import hashlib
import json
import re
import shutil
import subprocess
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit


@lru_cache(maxsize=512)
def _revision(path, modified, size):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()[:16]


def resource_revision(path):
    path = Path(path)
    stat = path.stat()
    return _revision(str(path.resolve()), stat.st_mtime_ns, stat.st_size)


def version_html(body, root, page_path):
    """Version local scripts/styles by actual content, not hand-maintained labels."""
    root = Path(root).resolve()
    def replace(match):
        value = match.group(3)
        parsed = urlsplit(value)
        if parsed.scheme or parsed.netloc:
            return match.group(0)
        target = (root / urljoin(page_path, parsed.path).lstrip('/')).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            return match.group(0)
        params = [(key, val) for key, val in parse_qsl(parsed.query) if key != 'v']
        params.append(('v', resource_revision(target)))
        revised = urlunsplit(('', '', parsed.path, urlencode(params), parsed.fragment))
        return match.group(1) + match.group(2) + revised + match.group(2)
    text = body.decode('utf-8') if isinstance(body, bytes) else body
    identity=html.escape(release_identity(root).get('releaseId') or 'development',quote=True)
    text=re.sub(r'(<head(?:\s[^>]*)?>)',lambda m:m[0]+'<meta name="orbit-release" content="'+identity+'">',text,count=1,flags=re.I)
    pattern = r"((?:src|href)\s*=\s*)([\"'])([^\"']+\.(?:js|css)(?:\?[^\"']*)?)\2"
    return re.sub(pattern, replace, text).encode('utf-8')


def release_identity(root):
    path = Path(root) / 'release.json'
    if path.is_file():
        data = json.loads(path.read_text())
        return {key: data[key] for key in ('releaseId', 'sourceHash', 'gitCommit', 'gitDirty') if key in data}
    return {'releaseId': 'development', 'sourceHash': None, 'gitCommit': None}


def source_files(root):
    """Explicit source allowlist excludes accounts, caches, backups and credentials."""
    root = Path(root)
    files = [p for p in root.iterdir() if p.is_file() and (
        p.suffix in ('.py', '.html', '.md', '.txt') or p.name == '.gitignore')]
    for name in ('assets', 'backtest', 'data', 'docs', 'tests', 'scripts', 'tools'):
        for p in (root / name).rglob('*'):
            if p.is_file() and not p.is_symlink() and '__pycache__' not in p.parts and p.name != '.DS_Store':
                if p.suffix not in ('.pyc', '.log', '.sqlite3') and 'results' not in p.parts:
                    files.append(p)
    return sorted(set(files))


def build_snapshot(root):
    root = Path(root).resolve()
    files = source_files(root)
    contents = [(p.relative_to(root), p.read_bytes()) for p in files]
    digest = hashlib.sha256()
    manifest = {}
    for relative, data in contents:
        name = relative.as_posix()
        sha = hashlib.sha256(data).hexdigest()
        manifest[name] = sha
        digest.update(name.encode() + b'\0' + sha.encode() + b'\n')
    source_hash = digest.hexdigest()
    release_id = 'orbit-' + datetime.now().strftime('%Y%m%d') + '-' + source_hash[:12]
    destination = root / '.releases' / release_id
    if destination.exists():
        existing = json.loads((destination / 'release.json').read_text())
        if existing['sourceHash'] != source_hash:
            raise ValueError('release identity collision')
        return destination
    try:
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True, stderr=subprocess.DEVNULL).strip()
        dirty=bool(subprocess.check_output(['git','status','--porcelain'],cwd=root,text=True,stderr=subprocess.DEVNULL).strip())
    except subprocess.CalledProcessError:
        commit = None;dirty=True
    temporary = destination.with_name(destination.name + '.preparing')
    temporary.mkdir(parents=True)
    try:
        for relative, data in contents:
            target = temporary / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        # Detect edits by another session during preparation; never publish mixed code.
        if any(p.read_bytes() != data for p, (_, data) in zip(files, contents)):
            raise ValueError('source changed while preparing release; retry after saving edits')
        info = {'releaseId': release_id, 'sourceHash': source_hash, 'gitCommit': commit, 'gitDirty': dirty, 'files': manifest}
        (temporary / 'release.json').write_text(json.dumps(info, ensure_ascii=False, indent=2))
        temporary.rename(destination)
    except Exception:
        shutil.rmtree(temporary)
        raise
    return destination
