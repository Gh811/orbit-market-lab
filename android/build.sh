#!/usr/bin/env bash
# SDK platforms;android-35 and build-tools;35.0.0, JDK 17 required.
set -euo pipefail
cd "$(dirname "$0")"
: "${ANDROID_HOME:?Set ANDROID_HOME}"
: "${ORBIT_KEYSTORE:?Set private release keystore path}"
: "${ORBIT_KEY_PASSWORD_FILE:?Set private password file path}"
SDK="$ANDROID_HOME";TOOLS="$SDK/build-tools/35.0.0";PLATFORM="$SDK/platforms/android-35/android.jar"
rm -rf build
mkdir -p build/classes build/dex build/local-assets
python3 - <<'BUNDLE'
from pathlib import Path
import hashlib,json,shutil,re
root=Path('..');target=Path('build/local-assets');manifest={}
for src in (root/'assets').rglob('*'):
 if not src.is_file() or src.name=='.DS_Store':continue
 name=src.relative_to(root).as_posix();dest=target/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dest);manifest['/'+name]=hashlib.sha256(src.read_bytes()).hexdigest()[:16]
aliases={}
for src in list((root/'assets').glob('*.js'))+list((root/'assets').glob('*.css'))+list(root.glob('*.html')):
 for token in re.findall(r'[?&]v=([A-Za-z0-9_-]+)',src.read_text()):aliases[token]=True
manifest['_versionAliases']=aliases
(target/'asset-manifest.json').write_text(json.dumps(manifest))
BUNDLE
"$TOOLS/aapt2" compile --dir res -o build/resources.zip
"$TOOLS/aapt2" link -I "$PLATFORM" --manifest AndroidManifest.xml -o build/base.apk build/resources.zip
javac -encoding UTF-8 --release 8 -classpath "$PLATFORM" -d build/classes src/com/orbit/market/*.java
mapfile -t CLASSES < <(find build/classes -name '*.class' -type f)
"$TOOLS/d8" --min-api 26 --lib "$PLATFORM" --output build/dex "${CLASSES[@]}"
python3 - <<'PY'
import zipfile
from pathlib import Path
with zipfile.ZipFile('build/base.apk','a',zipfile.ZIP_DEFLATED) as out:
 for p in Path('build/dex').glob('*.dex'):out.write(p,p.name)
 for p in Path('build/local-assets').rglob('*'):
  if p.is_file():out.write(p,'assets/'+p.relative_to('build/local-assets').as_posix())
PY
"$TOOLS/zipalign" -f -p 4 build/base.apk build/aligned.apk
"$TOOLS/apksigner" sign --ks "$ORBIT_KEYSTORE" --ks-key-alias orbit --ks-pass "file:$ORBIT_KEY_PASSWORD_FILE" --out build/orbit.apk build/aligned.apk
"$TOOLS/apksigner" verify --verbose --print-certs build/orbit.apk
"$TOOLS/aapt2" dump badging build/orbit.apk | sed -n '1,5p'
