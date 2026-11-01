 @echo off
cd /d "D:\EL 7lm\android"
call .\gradlew.bat assembleDebug --no-daemon > "D:\EL 7lm\apk-build.log" 2>&1
echo EXIT_CODE=%ERRORLEVEL% >> "D:\EL 7lm\apk-build.log"
