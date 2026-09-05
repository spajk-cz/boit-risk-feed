# boit-risk-feed

Datový repozitář jednoho pevného seznamu rizikových domén, který používá doplněk
**BOIT Rizikové E-shopy** vedle veřejných zdrojů ČOI a SOI.

Repozitář obsahuje pouze data a pomocné soubory. Žádné tokeny, žádné přihlašovací
údaje, žádný vykonatelný kód pro klienta.

| | |
|---|---|
| Produkční seznam | [`blacklist.txt`](blacklist.txt) |
| Plánovaná veřejná URL | `https://spajk-cz.github.io/boit-risk-feed/blacklist.txt` |
| Validátor | `node scripts/validate-feed.mjs` |
| Testy | `node --test tests/*.test.mjs` |

Skutečnou veřejnou URL potvrzuje až GitHub po zapnutí Pages. Doplněk má tuto
jedinou adresu napevno v `host_permissions` a v CSP `connect-src`; změna hostu
proto vyžaduje nové vydání doplňku.

## Formát

První řádek je povinný identifikátor formátu a musí znít přesně:

```text
# BOIT risk feed v1
```

Samotná hlavička bez dalších řádků znamená **platný, záměrně prázdný seznam**.
Díky tomu jde korektně vyřadit i poslední doménu. Naopak nulový soubor, HTML
chybová stránka nebo text bez hlavičky jsou **chybný feed** a klient v takovém
případě dál používá poslední funkční data.

Za hlavičkou platí:

- Jedna doména na řádek, ASCII, lowercase. Mezinárodní domény jako platný punycode (`xn--…`).
- Prázdné řádky a samostatné komentáře začínající `#` jsou povolené.
- Komentář za doménou na stejném řádku povolený **není**.
- Bez `https://`, cest, query, portů, e-mailů, wildcardů, IP adres a Markdown odkazů.
- Bez úvodního `www.` — doplněk tuto předponu normalizuje, zápis s ní se odmítá.
- Alespoň dva labely oddělené tečkou, bez úvodní a koncové tečky a bez mezer uvnitř.
- Nejvýše 253 znaků na hostname a 63 na label; label nesmí začínat ani končit pomlčkou.
- Nejvýše 5 000 domén a nejvýše 2 MiB na celý soubor.
- LF i CRLF jsou podporované, UTF-8 BOM se při čtení odstraní.

Položka platí **i pro všechny své subdomény**. Proto se do seznamu nezařazují
veřejné suffixy ani společné hostingové domény — například celý `github.io`,
`myshopify.com` nebo `weebly.com`. U sdílené služby uváděj vždy jen konkrétní
rizikový hostname, jinak zablokuješ tisíce nesouvisejících webů.

Platný zápis sám o sobě neprokazuje podvodnost. Význam každého záznamu posuzuje
člověk. Seznam oficiálních prodejců je allowlist; to, že v něm někdo není,
neznamená podvod a není důvod pro zařazení do blacklistu.

Důvod zařazení, odkaz na důkaz a datum ověření patří do PR nebo issue, **ne** do
feedu jako další parsovatelné řádky. AI má později navrhovat PR ke kontrole
člověkem; feed sám zůstává jen seznamem hostnames.

## Validace

Validátor běží na čistém Node.js, bez npm závislostí a bez instalace.

```bash
node scripts/validate-feed.mjs                       # ověří blacklist.txt
node scripts/validate-feed.mjs tests/fixtures/valid-list.txt
node --test tests/*.test.mjs                    # testy validátoru
```

Validátor pouze čte a hlásí. Nikdy nic nepřepisuje ani „neopravuje“: chybná URL
se sama nezmění na hostname, velká písmena se nepřevedou na malá a překročený
limit se netiskne jako důvod k tichému oříznutí seznamu. Při chybě vrací nenulový
exit code a u každé závady číslo řádku:

```text
✗ blacklist.txt: 2 chyby
  řádek 4: "www.podvod.example": zapiš doménu bez úvodního "www."; doplněk tuto předponu normalizuje
  řádek 7: "podvod.example": duplicitní doména, poprvé na řádku 2
```

Testovací domény patří **výhradně** do `tests/fixtures/`, nikdy do produkčního
`blacklist.txt`.

## Přidání domény

1. Ověř případ a schovej si důkaz (screenshot, odkaz, datum).
2. Přidej jeden řádek do `blacklist.txt`. Hlavičku nech beze změny.
3. Spusť `node scripts/validate-feed.mjs`.
4. Prohlédni diff — hlavně překlepy, příliš široké domény a nečekaně velké změny.
5. Důvod a důkaz zapiš do PR nebo issue, ne do feedu.
6. Commitni a slučuj do `main`.
7. Počkej na dokončení GitHub Pages deploymentu, otevři veřejnou URL a zkontroluj,
   že se vrátil text feedu. V testovacím doplňku dej **Aktualizovat seznam**.

## Odebrání domény a návrat chyby

- **Falešný poplach:** odeber konkrétní řádek, znovu validuj, commitni a publikuj.
- **Chybná dávková změna:** vrať ji novým revert commitem. Historii nepřepisuj.
- **Poslední doména:** smaž řádek tak, aby zůstala hlavička. Feed **neruš** a
  neměň na 404 — klienti by pak správně dál používali poslední funkční seznam.
- Odstranění z BOIT feedu **nevymaže** záznam, který nadále uvádí ČOI nebo SOI.
  Uživatel může mezitím použít whitelist v doplňku; tato výjimka je jen lokální.
- Chybu v samotném doplňku lze v gitu revertovat, ale návrat vydané funkčnosti
  v obchodech vyžaduje opravný balíček s vyšším číslem verze, nikoli pouhý push.

Aktualizace u uživatelů není okamžitá ani zaručeně do šesti hodin od commitu:
nejdřív se musí publikovat Pages a pak proběhnout klientský refresh (interval je
šest hodin při běžícím prohlížeči). U vypnutého prohlížeče až po jeho spuštění.
Ruční tlačítko čekání zkracuje.

## Publikování

`.nojekyll` vypíná zpracování Jekyllem, takže se soubory publikují tak, jak jsou.

Nastavení: **Settings → Pages → Deploy from a branch**, větev `main`, složka
`/(root)`, vyžadovaný HTTPS.

> **Pozor:** GitHub Actions check nad `push` **nezastaví** publikaci GitHub Pages
> z větve. Pages nasazují obsah větve nezávisle na výsledku workflow. Aby
> validace skutečně chránila produkční feed, musí se příspěvky posílat přes
> **pull request** a v ochraně větve `main` musí být vyžadován úspěšný check
> před mergem. Ochranu větve nastavuje majitel repozitáře.

## Obsah repozitáře

```text
blacklist.txt                  produkční seznam
.nojekyll                      publikování bez Jekyllu
scripts/validate-feed.mjs      validátor formátu, bez závislostí
tests/validate-feed.test.mjs   testy validátoru
tests/fixtures/                testovací feedy, včetně chybných
.github/workflows/validate.yml CI: validátor + testy
```
