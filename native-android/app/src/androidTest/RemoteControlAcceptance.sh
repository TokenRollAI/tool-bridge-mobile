#!/usr/bin/env bash
# Run from any directory. Requires JDK 17 and an SDK with the API 36 default system image.
set -euo pipefail
project=$(cd "$(dirname "$0")/../../.." && pwd)
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
: "${sdk:?Set ANDROID_HOME to the Android SDK}"
export ANDROID_HOME="$sdk"
adb="$sdk/platform-tools/adb"
emulator="$sdk/emulator/emulator"
case "$(uname -m)" in
    arm64|aarch64) abi=arm64-v8a; cpu=arm64 ;;
    x86_64|amd64)  abi=x86_64; cpu=x86_64 ;;
    *) echo "Unsupported emulator host architecture" >&2; exit 1 ;;
esac
sysimage="system-images/android-36/default/$abi/"
[[ -f "$sdk/${sysimage}system.img" ]] || {
    echo "Missing SDK package: system-images;android-36;default;$abi" >&2; exit 1
}

"$project/gradlew" -p "$project" :app:assembleDevelopmentDebug :app:assembleDevelopmentDebugAndroidTest
app="$project/app/build/outputs/apk/development/debug/app-development-debug.apk"
testapk="$project/app/build/outputs/apk/androidTest/development/debug/app-development-debug-androidTest.apk"
[[ -s "$app" && -s "$testapk" ]]

# Generate a new AVD with its own empty data directory. Never select an attached device.
work=$(mktemp -d "${TMPDIR:-/tmp}/tb-remote.XXXXXXXX")
export ANDROID_AVD_HOME="$work/avd"
name="tb_remote_${work##*.}"
port=5578
serial="emulator-$port"
emu_pid=
run_pid=
cleanup() {
    if [[ -n "$run_pid" ]]; then kill "$run_pid" 2>/dev/null || true; fi
    if [[ -n "$emu_pid" ]]; then
        kill "$emu_pid" 2>/dev/null || true
        wait "$emu_pid" 2>/dev/null || true
    fi
    rm -rf -- "$work"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"$adb" start-server
inventory=$("$adb" devices)
if awk '{print $1}' <<<"$inventory" | grep -Fxq "$serial"; then
    echo "$serial is already in use" >&2; exit 1
fi
mkdir -p "$ANDROID_AVD_HOME/$name.avd"
cat > "$ANDROID_AVD_HOME/$name.ini" <<INI
avd.ini.encoding=UTF-8
path=$ANDROID_AVD_HOME/$name.avd
target=android-36
INI
cat > "$ANDROID_AVD_HOME/$name.avd/config.ini" <<INI
AvdId=$name
avd.ini.displayname=$name
image.sysdir.1=$sysimage
tag.id=default
abi.type=$abi
hw.cpu.arch=$cpu
hw.lcd.width=1080
hw.lcd.height=1920
hw.lcd.density=420
hw.ramSize=2048
disk.dataPartition.size=2G
ShowDeviceFrame=no
INI
"$emulator" -avd "$name" -port "$port" -no-window -no-audio -no-snapshot -no-boot-anim \
    -gpu swiftshader_indirect > "$work/emulator.log" 2>&1 &
emu_pid=$!
device() { "$adb" -s "$serial" "$@"; }
our_avd() {
    kill -0 "$emu_pid" 2>/dev/null &&
        [[ "$(device emu avd name 2>/dev/null | tr -d '\r' | head -1)" == "$name" ]]
}
deadline=$((SECONDS + 240))
until our_avd && [[ "$(device shell getprop sys.boot_completed | tr -d '\r')" == 1 ]]; do
    if ! kill -0 "$emu_pid" 2>/dev/null || (( SECONDS >= deadline )); then
        tail -25 "$work/emulator.log" >&2; exit 1
    fi
    sleep 1
done
[[ "$(device shell getprop ro.boot.qemu | tr -d '\r')" == 1 ]]
pkg=ai.tokenroll.toolbridgemobile.dev
classes=ai.tokenroll.toolbridge.mobile
device install -t "$app"
device install -t "$testapk"
device shell pm grant "$pkg" android.permission.POST_NOTIFICATIONS
device shell input keyevent KEYCODE_WAKEUP
device shell wm dismiss-keyguard
device shell am instrument -w -r -e isolatedAvd yes "$pkg.test/$classes.RemoteControlInstrumentation" \
    > "$work/result" 2>&1 &
run_pid=$!
deadline=$((SECONDS + 40))
until grep -q '^INSTRUMENTATION_STATUS: remoteControl=ready' "$work/result"; do
    if ! kill -0 "$run_pid" 2>/dev/null || (( SECONDS >= deadline )); then cat "$work/result"; exit 1; fi
    sleep 1
done
our_avd
device shell settings put secure enabled_accessibility_services "$pkg/$classes.PhoneControlService"
device shell settings put secure accessibility_enabled 1
echo "Checking timed expiry and an unlimited session over two real five-minute intervals."
deadline=$((SECONDS + 800))
woke_after_lock=false
while kill -0 "$run_pid" 2>/dev/null; do
    if (( SECONDS >= deadline )); then cat "$work/result"; exit 1; fi
    if [[ "$woke_after_lock" == false ]] && grep -q '^INSTRUMENTATION_STATUS: remoteControl=wake_isolated_avd[[:space:]]*$' "$work/result"; then
        our_avd
        device shell input keyevent KEYCODE_WAKEUP
        device shell wm dismiss-keyguard
        woke_after_lock=true
    fi
    sleep 1
done
rc=0
wait "$run_pid" || rc=$?
run_pid=
cat "$work/result"
(( rc == 0 ))
grep -Eq '^INSTRUMENTATION_RESULT: remoteControl=PASS[[:space:]]*$' "$work/result"
