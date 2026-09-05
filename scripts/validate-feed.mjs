#!/usr/bin/env node
// Validátor BOIT risk feedu. Bez externích npm závislostí.
//
// Validátor pouze čte a hlásí. Nikdy nic nepřepisuje, needituje ani "neopravuje" —
// chybná URL se nesmí sama změnit na hostname, chybný řádek se nesmí zahodit.
// Při jakékoli chybě vrací nenulový exit code a čitelnou příčinu s číslem řádku.
//
// Použití:
//   node scripts/validate-feed.mjs                # ověří blacklist.txt
//   node scripts/validate-feed.mjs cesta/k/feed.txt [další.txt ...]

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

/** Povinný identifikátor formátu na prvním řádku. */
export const FEED_HEADER = '# BOIT risk feed v1';

/** Nejvýše 5 000 domén v jednom feedu. */
export const MAX_DOMAINS = 5000;

/** Nejvýše 2 MiB na celý soubor. */
export const MAX_FEED_BYTES = 2 * 1024 * 1024;

/** Limity DNS. */
export const MAX_HOSTNAME_LENGTH = 253;
export const MAX_LABEL_LENGTH = 63;

const BOM = '\uFEFF';

// Jeden DNS label: lowercase alfanumerika a pomlčky, nikoli na začátku ani na konci.
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// Poslední label: buď písmena, nebo punycode forma (xn--…).
const TLD_RE = /^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/;

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Ověří obsah feedu.
 *
 * @param {Buffer|Uint8Array|string} input Obsah souboru tak, jak byl načten.
 * @returns {{ok: boolean, domains: string[], errors: {line: number|null, message: string}[], byteLength: number}}
 */
export function validateFeed(input) {
  const errors = [];
  const domains = [];

  const byteLength =
    typeof input === 'string' ? Buffer.byteLength(input, 'utf8') : input.byteLength;

  if (byteLength > MAX_FEED_BYTES) {
    errors.push({
      line: null,
      message: `feed má ${byteLength} B, limit je ${MAX_FEED_BYTES} B (2 MiB); rozděl nebo zkrať seznam ručně`,
    });
  }

  let text = typeof input === 'string' ? input : Buffer.from(input).toString('utf8');

  // UTF-8 BOM se při čtení zahazuje, v souboru samotném ale zůstává.
  if (text.startsWith(BOM)) text = text.slice(BOM.length);

  if (text.length === 0) {
    errors.push({ line: null, message: 'prázdný soubor; platný feed musí obsahovat alespoň hlavičku' });
    return { ok: false, domains, errors, byteLength };
  }

  // Podporujeme LF i CRLF.
  const lines = text.split(/\r?\n/);

  if (lines[0] !== FEED_HEADER) {
    errors.push({
      line: 1,
      message: `chybí povinná hlavička; první řádek musí být přesně "${FEED_HEADER}", nalezeno ${JSON.stringify(lines[0])}`,
    });
    // Bez hlavičky nejde o BOIT feed. Zbytek už neparsujeme, ať nevzniká dojem
    // částečně použitelných dat.
    return { ok: false, domains, errors, byteLength };
  }

  /** @type {Map<string, number>} kanonická doména -> číslo řádku prvního výskytu */
  const seen = new Map();

  for (let i = 1; i < lines.length; i += 1) {
    const raw = lines[i];
    const lineNo = i + 1;

    if (raw.trim() === '') continue; // prázdný řádek
    if (raw.startsWith('#')) continue; // samostatný komentář

    const problem = describeDomainProblem(raw);
    if (problem) {
      errors.push({ line: lineNo, message: `${JSON.stringify(raw)}: ${problem}` });
      continue;
    }

    const previous = seen.get(raw);
    if (previous !== undefined) {
      errors.push({
        line: lineNo,
        message: `${JSON.stringify(raw)}: duplicitní doména, poprvé na řádku ${previous}`,
      });
      continue;
    }

    seen.set(raw, lineNo);
    domains.push(raw);
  }

  if (domains.length > MAX_DOMAINS) {
    errors.push({
      line: null,
      message: `feed obsahuje ${domains.length} domén, limit je ${MAX_DOMAINS}; zkrať seznam ručně`,
    });
  }

  return { ok: errors.length === 0, domains, errors, byteLength };
}

/**
 * Vrátí popis první nalezené závady, nebo null pro platnou doménu.
 * Pořadí kontrol je zvolené tak, aby člověk dostal konkrétní důvod, ne obecné
 * "neplatný hostname".
 *
 * @param {string} value Řádek přesně tak, jak stojí v souboru.
 * @returns {string|null}
 */
function describeDomainProblem(value) {
  if (value !== value.trim()) {
    return 'úvodní nebo koncové mezery; zapiš doménu bez odsazení';
  }
  // Nejčastější omyl je komentář za doménou, proto se hlásí dřív než obecný
  // nález mezery na řádku.
  if (value.includes('#')) {
    return 'komentář za doménou na stejném řádku není povolený';
  }
  if (/[^\x21-\x7e]/.test(value)) {
    if (/[^\x00-\x7f]/.test(value)) {
      return 'mimo ASCII; mezinárodní doménu zapiš jako punycode (xn--…)';
    }
    return 'obsahuje mezeru nebo řídicí znak';
  }
  if (value.includes('://')) {
    return 'vypadá jako URL; uveď pouze hostname, bez schématu';
  }
  if (value.includes('/')) {
    return 'obsahuje cestu nebo lomítko; uveď pouze hostname';
  }
  if (value.includes('?') || value.includes('&')) {
    return 'obsahuje query; uveď pouze hostname';
  }
  if (value.includes('@')) {
    return 'vypadá jako e-mail; uveď pouze hostname';
  }
  if (value.includes(':')) {
    return 'obsahuje port nebo schéma; uveď pouze hostname';
  }
  if (value.includes('*')) {
    return 'wildcard není povolený; položka platí i pro subdomény sama o sobě';
  }
  if (/[[\]()<>]/.test(value)) {
    return 'vypadá jako Markdown odkaz nebo HTML; uveď pouze hostname';
  }
  if (/[A-Z]/.test(value)) {
    return 'musí být lowercase';
  }
  if (IPV4_RE.test(value)) {
    return 'IP adresy se do feedu nezařazují';
  }
  if (value.startsWith('.')) {
    return 'úvodní tečka';
  }
  if (value.endsWith('.')) {
    return 'koncová tečka';
  }
  if (value.length > MAX_HOSTNAME_LENGTH) {
    return `hostname má ${value.length} znaků, limit je ${MAX_HOSTNAME_LENGTH}`;
  }

  const labels = value.split('.');
  if (labels.length < 2) {
    return 'alespoň dva labely oddělené tečkou';
  }
  for (const label of labels) {
    if (label === '') {
      return 'prázdný label (dvě tečky za sebou)';
    }
    if (label.length > MAX_LABEL_LENGTH) {
      return `label "${label}" má ${label.length} znaků, limit je ${MAX_LABEL_LENGTH}`;
    }
    if (!LABEL_RE.test(label)) {
      return `neplatný label "${label}"; povolena jsou jen a-z, 0-9 a pomlčka uvnitř labelu`;
    }
  }
  if (!TLD_RE.test(labels[labels.length - 1])) {
    return `neplatná koncovka "${labels[labels.length - 1]}"`;
  }
  if (value.startsWith('www.')) {
    return 'zapiš doménu bez úvodního "www."; doplněk tuto předponu normalizuje';
  }

  return null;
}

/**
 * Načte a ověří jeden soubor. Pouze čte.
 *
 * @param {string} path
 * @returns {Promise<{ok: boolean, domains: string[], errors: {line: number|null, message: string}[], byteLength: number}>}
 */
export async function validateFeedFile(path) {
  const buffer = await readFile(path);
  return validateFeed(buffer);
}

const MAX_REPORTED_ERRORS = 50;

async function main(argv) {
  const paths = argv.length > 0 ? argv : ['blacklist.txt'];
  let failed = false;

  for (const path of paths) {
    let result;
    try {
      result = await validateFeedFile(path);
    } catch (error) {
      console.error(`✗ ${path}: soubor nelze načíst — ${error.message}`);
      failed = true;
      continue;
    }

    if (result.ok) {
      console.log(
        `✓ ${path}: platný feed, ${result.domains.length} ${pluralDomains(result.domains.length)}, ${result.byteLength} B`,
      );
      continue;
    }

    failed = true;
    console.error(`✗ ${path}: ${result.errors.length} ${pluralErrors(result.errors.length)}`);
    for (const error of result.errors.slice(0, MAX_REPORTED_ERRORS)) {
      const where = error.line === null ? 'soubor' : `řádek ${error.line}`;
      console.error(`  ${where}: ${error.message}`);
    }
    if (result.errors.length > MAX_REPORTED_ERRORS) {
      console.error(`  … a dalších ${result.errors.length - MAX_REPORTED_ERRORS}`);
    }
  }

  return failed ? 1 : 0;
}

function pluralDomains(n) {
  if (n === 1) return 'doména';
  if (n >= 2 && n <= 4) return 'domény';
  return 'domén';
}

function pluralErrors(n) {
  if (n === 1) return 'chyba';
  if (n >= 2 && n <= 4) return 'chyby';
  return 'chyb';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
