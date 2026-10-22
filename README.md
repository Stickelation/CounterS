# CounterS

A local web app for exploring CS2 trade-up contracts using your inventory's exact floats and Steam's lowest advertised prices. Requires Node.js 24.5 or newer; no third-party runtime dependencies or API keys are needed. Startup enables Node's environment-proxy support for cloud egress.

```sh
cd /workspace/CounterS
npm start
# Development auto-restart: npm run dev
# Calculation tests: npm test
```

Open port 3000 in your development environment. `PORT` overrides the default. `/api/health` checks the server and loaded catalog. There is no login or multi-user isolation; deploy behind authentication before exposing this workspace service publicly.

## Standalone visualization

Run `npm run build` to generate `public/index.html` and `dist/CounterS.html`. These self-contained HTML files include styles, scripts, skin catalog, exporter, and the same import validation and ROI calculations as the server. They support demos, JSON import/export, CSFloat capture files, and contract analysis without loading additional files or calling a backend. Use one of these files in an HTML visualization panel; the server template by itself is not a standalone document.

Live Steam inventory and price requests require the running app server. Those buttons are disabled and labeled accordingly in standalone mode; imported prices can still be used. No live quotes are invented for the preview. Visualization hosts may restrict downloads, clipboard access, bookmarks, or browser storage; bookmark setup includes a manual copy fallback. The standalone build is tested in an opaque-origin sandboxed frame, but the ChatGPT visualization host itself is not available to the test runner.

Edit `public/index.template.html`, `public/style.css`, and `public/app.js`, then rebuild. The server serves the template with its external assets and API. Do not edit generated `public/index.html` or `dist/CounterS.html` directly.

## Import your inventory

### Capture floats with CSFloat Market Checker

Open **1. Capture floats with CSFloat** in CounterS. Show Chrome/Edge's bookmarks bar with **Ctrl+Shift+B** (Windows/Linux) or **Cmd+Shift+B** (Mac), then drag the **Export to CounterS** link onto that bar to save a bookmark. Alternatively, use **Copy bookmark address**, create a bookmark named **Export to CounterS**, and paste the copied address into the bookmark's URL field. In your Steam CS2 inventory with CSFloat enabled, click the saved bookmark on that bar. A capture panel appears; browse your inventory pages while it remains open, then click **Download CounterS inventory**. Import that file using **Import inventory** in CounterS, then **Refresh Steam prices** in the running server app. No floats or skin IDs need to be typed.

The exporter runs locally in the Steam tab, reads full-precision `itemInfo.floatvalue` from CSFloat's inventory elements and wear property ID 2 from Steam asset properties, and saves a JSON file. It does not read cookies, access tokens, extension storage, or make network calls. The rounded on-screen float text and screenshot are never used as calculation inputs. The app itself cannot directly inspect another tab's DOM or invoke CSFloat from an unrelated origin; CSFloat limits its externally connectable origins to Steam and CSFloat sites.

Only **loaded primary-inventory items** are captured; this is not a guarantee of full-inventory coverage. Keep the panel open and visit all inventory pages before downloading. Trade-protected context 16 is excluded. Imports report how many entries were imported, unsupported, missing a float, or invalid, and exclude unsupported/missing items rather than inventing floats. A capture with no usable skins is rejected without replacing the workspace. Up to 500 supported skins can be imported. Export again after inventory changes; asset snapshots do not synchronize automatically.

This integration targets the page structures inspected in [CSFloat Market Checker 5.19.1](https://github.com/csfloat/extension). Browser tests exercise matching Steam/CSFloat fixtures; an authenticated real inventory with the installed extension has not been tested in this cloud environment. Extension or Steam page changes may require updating the exporter. If bookmark dragging is unavailable, **Show bookmark code** provides the complete bookmark URL for creating a bookmark manually.

### Existing JSON files

Use **Load demo**, then **Export data** for a complete example. Replace the demo inventory with your own verified data, then import the JSON. `prices` is optional: click **Refresh Steam prices** to fetch current lowest USD listings for inputs and possible outputs, then automatically recalculate gross ROI. Imports replace the browser workspace, which is retained in localStorage. Export before clearing browser storage. Floats must be numbers within the skin's supported range; IDs must identify distinct physical assets. At most 500 items and 2 MB per import are supported.

```json
{
  "inventory": [
    {"assetId": "unique-steam-asset-id", "skinId": "ID from /api/catalog", "float": 0.04, "stattrak": false, "souvenir": false}
  ],
  "prices": {
    "Weapon | Finish (Factory New)": {
      "price": 12.34,
      "currency": "USD",
      "source": "steam-last-sale",
      "timestamp": "2026-10-21T12:00:00Z"
    }
  }
}
```

`/api/catalog` lists supported skin IDs, collections, float limits, and rarities. Souvenirs and Covert skins do not enter standard 10-item contracts. A contract needs prices for every input market name and every possible output market name. Export after analysis to obtain `requiredPriceNames` for missing quotes. Unknown or unsupported items must be removed from manually prepared workspace files; the CSFloat capture importer filters and reports them automatically.

## Pricing and ROI

Gross ROI = `(Σ(output probability × output price) − Σ(input price)) / Σ(input price)`. No selling fees are deducted. Inputs are valued at current quoted market value, including owned skins. Each collection gets probability equal to its fraction of inputs; its eligible next-tier finishes split that probability equally. StatTrak states and rarities cannot be mixed.

**Refresh Steam prices** uses Steam's public `market/priceoverview` endpoint's `lowest_price`, with app ID 730, currency 1 (USD), US country, and English language. Quotes have source `steam-lowest-listing` and the time they were fetched. No Steam login or API key is required. The displayed price is the lowest advertised buyer price including buyer fees, not the last sale or what a seller receives. Both inputs and outputs use this same gross pricing basis; no selling fees are deducted from ROI. These are market-name/wear-band prices, not exact-float listings.

Quotes are cached server-side for five minutes, requests are deduplicated, and uncached requests are spaced at least 1.5 seconds apart. HTTP 429 starts a one-minute cooldown; there are no automatic retry loops. Progress is shown and refreshes can be stopped. Refreshing replaces the previous quote set so failed requests cannot silently retain demo or imported prices. Unavailable listings exclude affected contracts; a network failure or rate limit stops the refresh and preserves only its successful quotes. A partial search only refreshes names discovered within its evaluated combinations. Cached quote timestamps remain their original fetch times.

The server exposes public inventory retrieval (`/api/inventory?steamId=...`) and lowest listings (`/api/price?name=...`). The legacy public inventory endpoint used here does not provide reliable float coverage; use the Steam-tab exporter to capture floats available to the page and CSFloat. No session cookie is used. Steam endpoints need access to `steamcommunity.com` and can return rate limits or deny access. The cloud proxy currently blocks that hostname; the environment draft includes an allowlist addition. A draft save does not apply network settings, so a live price fetch remains unverified until the setting is applied.

Imported quotes are still supported: `steam-last-sale` is a user-supplied last-sale assertion, `steam-history` is aggregated sale history, and `demo` is synthetic. Imported quotes are not independently verified. Quotes older than 24 hours are marked stale in details; staleness is not an automatic exclusion. All quotes are USD; no exchange conversion is performed. ROI ignores sticker premiums, float premiums, market depth, and execution slippage.

## Search scope and float rules

The analyzer enumerates physical 10-item combinations within eligible rarity/StatTrak groups, ranks by gross expected ROI, and returns the top ten. It checks at most 100,000 combinations per request, labels partial searches, and never claims a global optimum when truncated or when prices are missing. A bounded search is not a large-inventory optimizer.

Normalized mode averages `(input float − input skin min) / (input skin max − input skin min)` then calculates `output min + average × (output max − output min)`. Legacy mode uses the raw average input float instead. The UI exposes the choice; confirm current CS2 mechanics against the live game before trading. Standard contracts only: five-Covert knife/glove contracts are not implemented. This is an analysis tool and does not execute trades or contracts.

## Catalog attribution

The bundled 1,455-entry single-collection weapon-finish catalog derives from [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API), retrieved October 21, 2026. Its MIT license is in `data/CATALOG-LICENSE`. Item images are served by Steam; network-blocked images do not affect calculations. This app is not affiliated with Valve. Project license: GPL-3.0, see `LICENSE`.
