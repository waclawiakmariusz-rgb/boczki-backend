# Zgłoszenie #12a — kolory kafelków według zabiegu

Gosia (recepcja), 20.10.2026: *„Kolory z podziałem na usługi są ułatwieniem. Wizyty się nie zlewają
ze sobą. Chodzi o to, aby każda usługa miała swój kolor."*

## Dlaczego kafelki się zlewały

Kolor **istniał** — ale przypisany do **typu zabiegu**, nie do kategorii. W prawdziwym cenniku Boczków:

```
ciało               #3b82f6   202 usługi w 21 kategoriach
twarz               #ec4899   187 usług  w 27 kategoriach
medycyna estetyczna #ef4444    80 usług
masaże              #84cc16    14 usług
```

Czyli **cztery kolory na 483 usługi**. Endermologia, kriolipoliza, Arosha i wszystko inne z „ciała"
miało identyczny niebieski — stąd wrażenie jednej masy.

## Co zmieniono

Kategoria dostaje własny odcień **wewnątrz rodziny koloru swojego typu**. „Ciało" zostaje chłodne,
„twarz" różowa, ale poszczególne zabiegi różnią się na pierwszy rzut oka. Odcienie rozkładane są
równomiernie, ze znajomością całego cennika — nie losowane z nazwy, bo hash potrafił dać dwóm
kategoriom identyczny kolor (przy cenniku Boczków zdarzało się to 8 razy).

Dodatkowo pod siatką dnia pojawia się **legenda kategorii widocznych tego dnia** — bez niej kolor
jest ładny, ale nic nie znaczy.

Zero konfiguracji i zero zapisu w bazie: kolor liczy się z nazwy kategorii i koloru typu, więc
ten sam zabieg ma zawsze ten sam odcień. Ręczne ustawienie koloru typu nadal działa i nadal rządzi
rodziną barw.

## Pomiar na prawdziwym cenniku Boczków (57 par kategoria/typ, 43 kategorie)

```
kolorow PRZED zmiana (kolor typu):  5
kolorow PO zmianie:                43     (tyle, ile kategorii — żadna nie dubluje innej)
najblizsza para w jednej rodzinie:  26     (RGB; przed strojeniem bywało 0 = identyczne)
stalosc: ten sam kolor przy powtornym wyliczeniu: true

przyklady (typ „ciało" #3b82f6):
   Adipologie                     → #3cf5dd
   Arosha                         → #0ce8ec
   Endermologia Infinity          → #0ca5ec
   Endermologia Infinity PREMIUM  → #5db7f2
```

| Plik | Co widać |
|---|---|
| `kolory-i-legenda.png` | sześć kategorii w jednym dniu, każda w innym kolorze + legenda pod siatką |
| `kolory-i-legenda-ciemny.png` | to samo w trybie ciemnym — Gosia pracuje na ciemnym |
