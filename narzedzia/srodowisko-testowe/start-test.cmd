@echo off
rem ============================================================================
rem  Estelio — START IZOLOWANEGO SRODOWISKA TESTOWEGO (laptop, bez produkcji)
rem  Uruchamia: lokalna MariaDB 11.8.9 (port 3307) + serwer Estelio na porcie 3999
rem  Baza: estelio_test (fikcyjny salon demo-test). Wspolna baza produkcji NIE jest dotykana.
rem  Konfiguracja serwera: plik .env.test w katalogu repozytorium (ignorowany przez git).
rem  Katalog z baza (poza repozytorium): %ESTELIO_TEST_DIR% albo domyslnie C:\Users\aaell\estelio-srodowisko-testowe
rem ============================================================================
setlocal
if "%ESTELIO_TEST_DIR%"=="" set "ESTELIO_TEST_DIR=C:\Users\aaell\estelio-srodowisko-testowe"
set "REPO=%~dp0..\.."
set "MDB=%ESTELIO_TEST_DIR%\mariadb"

if not exist "%MDB%\mariadb-11.8.9-winx64\bin\mariadbd.exe" (
  echo [BLAD] Nie znaleziono MariaDB w %MDB%. Ustaw ESTELIO_TEST_DIR albo skopiuj katalog mariadb.
  pause & exit /b 1
)
if not exist "%REPO%\.env.test" (
  echo [BLAD] Brak pliku .env.test w repozytorium ^(%REPO%^). Bez niego serwer NIE wystartuje na bazie testowej.
  pause & exit /b 1
)

echo [1/3] Start MariaDB na 127.0.0.1:3307 ...
start "Estelio TEST - MariaDB 3307 (nie zamykaj)" /min "%MDB%\mariadb-11.8.9-winx64\bin\mariadbd.exe" --defaults-file="%MDB%\data\my.ini" --datadir="%MDB%\data" --port=3307 --bind-address=127.0.0.1 --console --skip-name-resolve --innodb-buffer-pool-size=64M --max-connections=40 --performance-schema=OFF

set /a N=0
:czekaj
set /a N+=1
netstat -an | find ":3307" | find "LISTENING" >nul 2>&1
if errorlevel 1 (
  if %N% GEQ 40 ( echo [BLAD] MariaDB nie odpowiada po 20 s. & pause & exit /b 1 )
  timeout /t 1 /nobreak >nul
  goto czekaj
)
echo       MariaDB gotowa.

echo [2/3] Start serwera Estelio TEST na http://localhost:3999 ...
cd /d "%REPO%"
start "Estelio TEST - serwer 3999 (nie zamykaj)" cmd /k "node -r dotenv/config server.js dotenv_config_path=.env.test"
timeout /t 6 /nobreak >nul

echo [3/3] Otwieram przegladarke.
start "" "http://localhost:3999/zaloguj"
echo.
echo  SRODOWISKO TESTOWE DZIALA. Rozpoznasz je po: adres localhost:3999, salon demo-test, hash wersji na stronie logowania.
echo  Login salonu: demo-test   Haslo: plik %ESTELIO_TEST_DIR%\haslo-salonu-demo-test.txt   PIN: Ola 1111 (manager), Anna 2222
echo  Zatrzymanie: narzedzia\srodowisko-testowe\stop-test.cmd
echo.
pause
endlocal
