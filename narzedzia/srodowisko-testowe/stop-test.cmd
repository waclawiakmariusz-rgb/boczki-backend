@echo off
rem  Estelio — STOP izolowanego srodowiska testowego (serwer 3999 + MariaDB 3307). Nie dotyka produkcji ani innych procesow node.
setlocal
if "%ESTELIO_TEST_DIR%"=="" set "ESTELIO_TEST_DIR=C:\Users\aaell\estelio-srodowisko-testowe"
set "MDB=%ESTELIO_TEST_DIR%\mariadb"

echo [1/2] Zatrzymuje serwer Estelio TEST (okno "Estelio TEST - serwer 3999") ...
taskkill /FI "WINDOWTITLE eq Estelio TEST - serwer 3999*" /T /F >nul 2>&1

echo [2/2] Zatrzymuje MariaDB 3307 ...
set /p ROOTPW=<"%MDB%\root.secret"
"%MDB%\mariadb-11.8.9-winx64\bin\mariadb.exe" -h 127.0.0.1 -P 3307 -u root -p%ROOTPW% -e "SHUTDOWN" >nul 2>&1
set "ROOTPW="
timeout /t 2 /nobreak >nul
taskkill /FI "WINDOWTITLE eq Estelio TEST - MariaDB 3307*" /T /F >nul 2>&1
echo Zatrzymane.
pause
endlocal
