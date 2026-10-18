@echo off
rem  Estelio — ODSWIEZENIE fikcyjnego salonu demo-test w bazie testowej (kasuje i zaklada od nowa jego dane; produkcji nie dotyka).
rem  Wymaga uruchomionej MariaDB 3307 (start-test.cmd). Nowe haslo salonu trafia do pliku poza repozytorium.
setlocal
if "%ESTELIO_TEST_DIR%"=="" set "ESTELIO_TEST_DIR=C:\Users\aaell\estelio-srodowisko-testowe"
cd /d "%~dp0..\.."
node narzedzia\testy-integracyjne\dane-demo.js --haslo-do "%ESTELIO_TEST_DIR%\haslo-salonu-demo-test.txt"
echo.
echo Haslo salonu demo-test zapisane w: %ESTELIO_TEST_DIR%\haslo-salonu-demo-test.txt
pause
endlocal
