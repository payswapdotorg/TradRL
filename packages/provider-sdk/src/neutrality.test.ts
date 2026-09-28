/**
 * @tradrl/provider-sdk — the provider-neutrality trip-wire.
 *
 * L2 substrate neutrality / L13 (vendor specifics stay in adapters) /
 * L14 (external substrates are replaceable): NO provider name may appear
 * in ANY package source — types, guards, fixtures, doc comments — because
 * a provider name in the SDK is a neutrality leak (a concrete adapter's
 * vendor knowledge leaking into the provider-neutral foundation).
 *
 * This test walks every .ts file under src/ EXCEPT its own file (which
 * necessarily contains the vocabulary it greps for) and fails on any
 * case-insensitive, word-bounded hit of a well-known provider name across
 * the market-data, execution, model and human families (spec/ADAPTERS.md).
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The provider vocabulary (crypto venues, equities/index data, news/social, macro, brokers/OMS). */
const PROVIDER_TOKENS: readonly string[] = [
  // crypto exchanges
  'binance', 'coinbase', 'kraken', 'okx', 'bybit', 'bitfinex', 'bitstamp', 'gemini',
  'huobi', 'kucoin', 'hitbtc', 'poloniex', 'cryptocom', 'ftx', 'cexio', 'lmax',
  // market/reference data
  'polygon', 'alpaca', 'iex', 'tradier', 'nasdaq', 'nyse', 'euronext', 'xignite',
  'quandl', 'tiingo', 'coinmarketcap', 'coingecko', 'kaiko', 'coinapi', 'cryptowatch',
  'morningstar', 'bloomberg', 'reuters', 'refinitiv', 'lseg', 'factset', 'spglobal',
  'dowjones', 'dtcc',
  // news / social / alt
  'benzinga', 'ravenpack', 'newsapi', 'gnews', 'twitter', 'reddit', 'stocktwits',
  // macro / statistics
  'fred',
  // brokers / OMS / EMS
  'ibkr', 'interactivebrokers', 'saxobank', 'oanda', 'fxcm', 'iggroup', 'cityindex',
  'pepperstone', 'currenex', 'fxall', 'charlesriver', 'frontarena',
];

/** This file's own name (the vocabulary's home). */
const TRIP_WIRE_FILE = 'neutrality.test.ts';

function collectSourceFiles(directory: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(entryPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && entry.name !== TRIP_WIRE_FILE) {
      files.push(entryPath);
    }
  }
  return files;
}

describe('provider-neutrality trip-wire', () => {
  it('no provider name appears in any SDK source (types, guards, fixtures, docs)', () => {
    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    const sourceFiles = collectSourceFiles(testDirectory);
    expect(sourceFiles.length).toBeGreaterThan(20); // the walk must actually cover the package

    const violations: { file: string; token: string }[] = [];
    for (const file of sourceFiles) {
      const contents = fs.readFileSync(file, 'utf8');
      for (const token of PROVIDER_TOKENS) {
        const pattern = new RegExp(`\\b${token}\\b`, 'i');
        if (pattern.test(contents)) {
          violations.push({ file: path.relative(testDirectory, file), token });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('the trip-wire vocabulary itself is substantial (the grep is not vacuous)', () => {
    expect(PROVIDER_TOKENS.length).toBeGreaterThanOrEqual(50);
    expect(PROVIDER_TOKENS).toContain('binance');
    expect(PROVIDER_TOKENS).toContain('coinbase');
  });
});
