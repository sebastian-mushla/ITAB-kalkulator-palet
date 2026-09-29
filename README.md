# ITAB kalkulátor palet

Interní nástroj pro expedici: nahrajete zakázku (artikly a množství) a hned vidíte počet palet a balíků, váhu, LDM a doporučenou dopravu (sběrná služba, dodávka, plachťák, kamion), plus schéma nakládky.

## Spuštění lokálně
Bez instalace a bez buildu (čisté HTML + JS moduly):

```bash
python3 -m http.server 5173
```

Otevřete http://localhost:5173. Testy výpočtu: http://localhost:5173/tests/

## Deploy
Produkce: **https://itab-kalkulator-palet.vercel.app** (testy: `/tests/`).
Každý `git push` do `main` se na Vercelu nasadí sám.

Statický web: GitHub → Vercel (Framework preset: **Other**, build command prázdný, output directory `.`).

## Data
- `examples/catalog.csv`: šablona číselníku artiklů (nahrát na záložce „Číselník artiklů“).
- `examples/vehicles.csv`: šablona vozidel (záložka „Vozidla“).
- `examples/orders-sample.txt` / `orders-sample.csv`: ukázkové zakázky.

Číselník, vozidla a pravidla se zatím ukládají jen v prohlížeči (localStorage).

Kontext projektu pro vývoj: `CLAUDE.md`.
