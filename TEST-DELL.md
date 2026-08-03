# Test synchronizacji HP → DELL

Ten plik powstał na **HP** i został wypchnięty na GitHuba, żeby sprawdzić,
czy DELL poprawnie pobiera zmiany.

- Utworzony: **2026-08-03, 21:10** (laptop HP)
- Gałąź: `test-dell` — **celowo osobna**, nie `main` ani `dev`

## Dlaczego to jest bezpieczne

Produkcja (estelio.com.pl) korzysta z gałęzi `main`. Ta gałąź nie ma z nią
żadnego kontaktu — nawet gdyby ten plik zawierał bzdury, nic się nie stanie.
Po teście usuwamy gałąź i ślad znika.

## Co zrobić na DELL

1. W terminalu VS Code:
   ```
   git fetch origin
   git checkout test-dell
   ```
2. Jeśli widzisz ten plik — **synchronizacja działa w obie strony**.
3. Wróć na gałąź roboczą:
   ```
   git checkout dev
   ```

## Test w drugą stronę (opcjonalnie)

Dopisz coś poniżej na DELL, zrób commit i `git push`. Na HP zobaczę to przez
`git fetch && git checkout test-dell`. Wtedy mamy pewność, że obie maszyny
nadają i odbierają.

--- miejsce na wpis z DELL ---
