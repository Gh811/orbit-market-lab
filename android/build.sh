#!/usr/bin/env bash
# SDK platforms;android-35 and build-tools;35.0.0, JDK 17 required.
set -euo pipefail
cd "$(dirname "$0")"
: "${ANDROID_HOME:?Set ANDROID_HOME}"
: "${ORBIT_KEYSTORE:?Set private release keystore path}"
: "${ORBIT_KEY_PASSWORD_FILE:?Set private password file path}"
SDK="$ANDROID_HOME";TOOLS="$SDK/build-tools/35.0.0";PLATFORM="$SDK/platforms/android-35/android.jar"
rm -rf build
mkdir -p build/classes build/dex
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
PY
"$TOOLS/zipalign" -f -p 4 build/base.apk build/aligned.apk
"$TOOLS/apksigner" sign --ks "$ORBIT_KEYSTORE" --ks-key-alias orbit --ks-pass "file:$ORBIT_KEY_PASSWORD_FILE" --out build/orbit.apk build/aligned.apk
"$TOOLS/apksigner" verify --verbose --print-certs build/orbit.apk
"$TOOLS/aapt2" dump badging build/orbit.apk | sed -n '1,5p'
