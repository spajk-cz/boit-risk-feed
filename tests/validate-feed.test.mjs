// Testy validátoru BOIT feedu. Standardní Node test runner, bez závislostí.
//   node --test tests/*.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  validateFeed,
  validateFeedFile,
  FEED_HEADER,
  MAX_DOMAINS,
  MAX_FEED_BYTES,
} from '../scripts/validate-feed.mjs';

const testsDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const fixture = (name) => `${testsDir}fixtures/${name}`;

/** Sestaví feed s hlavičkou a danými řádky, zakončený novým řádkem. */
const feed = (...lines) => [FEED_HEADER, ...lines].join('\n') + '\n';

/** Zkratka: vrátí zprávy chyb jako jeden řetězec. */
const messages = (result) => result.errors.map((e) => e.message).join(' | ');

function assertValid(input, expectedDomains) {
  const result = validateFeed(input);
  assert.equal(result.ok, true, `očekáván platný feed, chyby: ${messages(result)}`);
  if (expectedDomains !== undefined) {
    assert.deepEqual(result.domains, expectedDomains);
  }
  return result;
}

function assertInvalid(input, expectedFragment) {
  const result = validateFeed(input);
  assert.equal(result.ok, false, 'očekáván neplatný feed, validátor jej přijal');
  if (expectedFragment !== undefined) {
    assert.match(messages(result), expectedFragment);
  }
  return result;
}

test('platný feed', async (t) => {
  await t.test('samotná hlavička je platný, záměrně prázdný seznam', () => {
    assertValid(feed(), []);
  });

  await t.test('hlavička bez koncového nového řádku', () => {
    assertValid(FEED_HEADER, []);
  });

  await t.test('domény, komentáře a prázdné řádky', () => {
    assertValid(
      feed('podvod.example', '', '# komentář', 'druhy.example'),
      ['podvod.example', 'druhy.example'],
    );
  });

  await t.test('subdoména i rodičovská doména vedle sebe', () => {
    assertValid(feed('podvod.example', 'shop.podvod.example'), [
      'podvod.example',
      'shop.podvod.example',
    ]);
  });

  await t.test('punycode, číslice a pomlčky uvnitř labelu', () => {
    assertValid(feed('xn--pklad-9ta5m.example', 'e-shop24.example.com'), [
      'xn--pklad-9ta5m.example',
      'e-shop24.example.com',
    ]);
  });

  await t.test('CRLF', () => {
    assertValid([FEED_HEADER, 'podvod.example', ''].join('\r\n'), ['podvod.example']);
  });

  await t.test('UTF-8 BOM se při čtení odstraní', () => {
    assertValid('﻿' + feed('podvod.example'), ['podvod.example']);
  });

  await t.test('hostname přesně 253 znaků a label přesně 63 znaků', () => {
    const host = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(61)].join('.');
    assert.equal(host.length, 253);
    assertValid(feed(host), [host]);
  });

  await t.test(`přesně ${MAX_DOMAINS} domén`, () => {
    const domains = Array.from({ length: MAX_DOMAINS }, (_, i) => `d${i}.example`);
    const result = assertValid(feed(...domains));
    assert.equal(result.domains.length, MAX_DOMAINS);
  });
});

test('chybějící nebo špatná hlavička', async (t) => {
  await t.test('prázdný soubor', () => {
    assertInvalid('', /prázdný soubor/);
  });

  await t.test('nulový buffer', () => {
    assertInvalid(Buffer.alloc(0), /prázdný soubor/);
  });

  await t.test('holý seznam domén bez hlavičky', () => {
    assertInvalid('podvod.example\ndalsi.example\n', /chybí povinná hlavička/);
  });

  await t.test('HTML chybová stránka', () => {
    assertInvalid(readFileSync(fixture('invalid-html.txt')), /chybí povinná hlavička/);
  });

  await t.test('jiná verze hlavičky', () => {
    assertInvalid('# BOIT risk feed v2\n', /chybí povinná hlavička/);
  });

  await t.test('hlavička s koncovou mezerou', () => {
    assertInvalid(`${FEED_HEADER} \n`, /chybí povinná hlavička/);
  });

  await t.test('bez hlavičky se nevrací žádné domény', () => {
    const result = validateFeed('podvod.example\n');
    assert.deepEqual(result.domains, []);
  });
});

test('neplatné řádky', async (t) => {
  const cases = [
    ['velká písmena', 'Podvod.example', /lowercase/],
    ['úvodní www.', 'www.podvod.example', /bez úvodního "www\."/],
    ['schéma a cesta', 'https://podvod.example/objednavka', /URL/],
    ['samotná cesta', 'podvod.example/objednavka', /cestu nebo lomítko/],
    ['query', 'podvod.example?id=1', /query/],
    ['port', 'podvod.example:8080', /port/],
    ['e-mail', 'info@podvod.example', /e-mail/],
    ['wildcard', '*.podvod.example', /[Ww]ildcard/],
    ['IPv4', '203.0.113.10', /IP adres/],
    ['Markdown odkaz', '[podvod](https://podvod.example)', /Markdown|URL/],
    ['komentář za doménou', 'podvod.example # důvod', /[Kk]omentář za doménou/],
    ['odsazená doména', '  podvod.example', /mezery/],
    ['koncová mezera', 'podvod.example ', /mezery/],
    ['mezera uvnitř', 'pod vod.example', /mezeru nebo řídicí znak/],
    ['mimo ASCII', 'příklad.example', /punycode/],
    ['úvodní tečka', '.podvod.example', /úvodní tečka/],
    ['koncová tečka', 'podvod.example.', /koncová tečka/],
    ['dvě tečky', 'podvod..example', /prázdný label/],
    ['jeden label', 'localhost', /alespoň dva labely/],
    ['podtržítko', 'pod_vod.example', /neplatný label/],
    ['pomlčka na začátku labelu', '-podvod.example', /neplatný label/],
    ['pomlčka na konci labelu', 'podvod-.example', /neplatný label/],
    ['číselná koncovka', 'podvod.123', /neplatná koncovka/],
    ['jednopísmenná koncovka', 'podvod.e', /neplatná koncovka/],
  ];

  for (const [name, line, fragment] of cases) {
    await t.test(name, () => {
      const result = assertInvalid(feed(line), fragment);
      assert.deepEqual(result.domains, [], 'neplatný řádek se nesmí dostat mezi domény');
      assert.equal(result.errors[0].line, 2, 'chyba musí nést číslo řádku');
    });
  }

  await t.test('label 64 znaků', () => {
    assertInvalid(feed(`${'a'.repeat(64)}.example`), /limit je 63/);
  });

  await t.test('hostname 254 znaků', () => {
    const host = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(62)].join('.');
    assert.equal(host.length, 254);
    assertInvalid(feed(host), /limit je 253/);
  });
});

test('duplicity', async (t) => {
  await t.test('duplicitní doména se odmítne a odkáže na první výskyt', () => {
    const result = assertInvalid(
      feed('podvod.example', 'jiny.example', 'podvod.example'),
      /duplicitní doména, poprvé na řádku 2/,
    );
    assert.equal(result.errors[0].line, 4);
  });

  await t.test('duplicita přes www. se hlásí jako zakázané www., ne jako shoda', () => {
    assertInvalid(feed('podvod.example', 'www.podvod.example'), /bez úvodního "www\."/);
  });
});

test('limity feedu', async (t) => {
  await t.test(`${MAX_DOMAINS + 1} domén je chyba, nikoli tiché oříznutí`, () => {
    const domains = Array.from({ length: MAX_DOMAINS + 1 }, (_, i) => `d${i}.example`);
    const result = assertInvalid(feed(...domains), new RegExp(`limit je ${MAX_DOMAINS}`));
    assert.equal(result.domains.length, MAX_DOMAINS + 1, 'validátor seznam sám nezkracuje');
  });

  await t.test('feed nad 2 MiB je chyba', () => {
    const filler = `#${'a'.repeat(99)}\n`;
    const body = filler.repeat(Math.ceil(MAX_FEED_BYTES / filler.length) + 10);
    const input = `${FEED_HEADER}\n${body}`;
    assert.ok(Buffer.byteLength(input) > MAX_FEED_BYTES);
    assertInvalid(input, /limit je \d+ B \(2 MiB\)/);
  });
});

test('validátor nic neopravuje', async (t) => {
  await t.test('URL se nepřevede na hostname', () => {
    const result = validateFeed(feed('https://podvod.example/objednavka?id=1'));
    assert.equal(result.ok, false);
    assert.deepEqual(result.domains, []);
    assert.ok(
      !result.domains.includes('podvod.example'),
      'z chybné URL se nesmí stát platná položka',
    );
  });

  await t.test('velká písmena se nepřevedou na lowercase', () => {
    const result = validateFeed(feed('Podvod.example'));
    assert.deepEqual(result.domains, []);
  });

  await t.test('vstupní řetězec zůstává beze změny', () => {
    const input = feed('  Podvod.example  ');
    const copy = String(input);
    validateFeed(input);
    assert.equal(input, copy);
  });

  await t.test('hlásí se všechny chyby, ne jen první', () => {
    const result = validateFeed(feed('Podvod.example', 'www.jiny.example', 'treti.example'));
    assert.equal(result.errors.length, 2);
    assert.deepEqual(result.domains, ['treti.example']);
  });
});

test('fixtures ze souborů', async (t) => {
  await t.test('valid-list.txt', async () => {
    const result = await validateFeedFile(fixture('valid-list.txt'));
    assert.equal(result.ok, true, messages(result));
    assert.deepEqual(result.domains, [
      'podvod.example',
      'sub.podvod.example',
      'eshop-test.example.com',
      'xn--pklad-9ta5m.example',
    ]);
  });

  await t.test('valid-empty.txt', async () => {
    const result = await validateFeedFile(fixture('valid-empty.txt'));
    assert.equal(result.ok, true, messages(result));
    assert.deepEqual(result.domains, []);
  });

  await t.test('valid-crlf-bom.txt', async () => {
    const result = await validateFeedFile(fixture('valid-crlf-bom.txt'));
    assert.equal(result.ok, true, messages(result));
    assert.deepEqual(result.domains, ['podvod-crlf.example', 'sub.podvod-crlf.example']);
  });

  await t.test('invalid-mixed.txt hlásí správná čísla řádků', async () => {
    const result = await validateFeedFile(fixture('invalid-mixed.txt'));
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.errors.map((e) => e.line),
      [3, 4, 5, 6, 7],
    );
    assert.deepEqual(result.domains, ['podvod.example']);
  });
});

test('produkční blacklist.txt', async (t) => {
  await t.test('je platný', async () => {
    const result = await validateFeedFile(`${repoRoot}blacklist.txt`);
    assert.equal(result.ok, true, messages(result));
  });

  await t.test('zatím neobsahuje žádné domény', async () => {
    const result = await validateFeedFile(`${repoRoot}blacklist.txt`);
    assert.deepEqual(result.domains, [], 'testovací domény patří jen do fixtures');
  });
});

test('CLI', async (t) => {
  const script = `${repoRoot}scripts/validate-feed.mjs`;
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

  await t.test('platný feed vrací exit code 0', () => {
    const run1 = run(fixture('valid-list.txt'));
    assert.equal(run1.status, 0, run1.stderr);
    assert.match(run1.stdout, /platný feed, 4 domény/);
  });

  await t.test('neplatný feed vrací nenulový exit code a čísla řádků', () => {
    const run1 = run(fixture('invalid-mixed.txt'));
    assert.equal(run1.status, 1);
    assert.match(run1.stderr, /řádek 3:/);
    assert.match(run1.stderr, /řádek 7:/);
  });

  await t.test('bez argumentu ověří blacklist.txt v kořeni repozitáře', () => {
    const run1 = spawnSync(process.execPath, [script], { encoding: 'utf8', cwd: repoRoot });
    assert.equal(run1.status, 0, run1.stderr);
    assert.match(run1.stdout, /blacklist\.txt: platný feed, 0 domén/);
  });

  await t.test('neexistující soubor je chyba, ne prázdný feed', () => {
    const run1 = run(fixture('neexistuje.txt'));
    assert.equal(run1.status, 1);
    assert.match(run1.stderr, /nelze načíst/);
  });
});
