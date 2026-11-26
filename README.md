# CounterS

A local web app for exploring CS2 trade-up contracts using your inventory's exact floats and Steam's lowest advertised prices. It requires Node.js 24.5 or newer and uses no third-party runtime dependencies or API keys.

```sh
npm start
# Development auto-restart: npm run dev
# Calculation tests: npm test
```

Run from the repository root and open `http://127.0.0.1:3000/`. The startup message prints the checkout path. Use `npm run dev` to restart automatically when Node source files change, and refresh the page after front-end edits. `PORT` overrides the default. `/api/health` checks the server and loaded catalog. The server listens on loopback and is intended for a single local workspace.

## Standalone visualization

Run `npm run build` to generate `public/index.html` and `dist/CounterS.html`. These self-contained HTML files include styles, scripts, skin catalog, exporter, and the same import validation and ROI calculations as the server. They support JSON import/export, CSFloat capture files, and contract analysis without loading additional files or calling a backend. Use one of these files in an HTML visualization panel; the server template by itself is not a standalone document.

Steam sign-in, direct capture handoff, public inventory requests, and live pricing require the running server. Standalone mode supports capture files and imported prices. Visualization hosts may restrict downloads, clipboard access, bookmarks, or browser storage. Bookmark setup includes a manual copy fallback.

Edit `public/index.template.html`, `public/style.css`, and `public/app.js`, then rebuild. The server serves the template with its external assets and API. Do not edit generated `public/index.html` or `dist/CounterS.html` directly.

## Import your inventory

### Sign in with Steam

Click **Sign in with Steam** in the running app. Steam verifies your identity on its own site and redirects back to the local app. CounterS uses the verified SteamID to load your public CS2 inventory. As each page arrives, it keeps supported weapon skins and matches exact wear to those assets. Cases, stickers, agents, and other items outside the weapon catalog are discarded. The sign-in flow keeps your Steam password and cookies on Steam. Use **Reload Steam inventory** to refresh in the same tab, or **Load public inventory by SteamID** if you already know the ID.

Successful imports replace the current workspace and clear its prices. CounterS reports unsupported skins and missing or invalid floats. Use **Refresh Steam prices** after import. Steam sign-in verifies identity. Inventory visibility still controls what CounterS can fetch, so use the Steam-tab capture for private inventory or missing exact wear.

### Send inventory from the Steam tab

Open **Capture private inventory or missing floats** and save the **Capture for CounterS** bookmark. Replace any old CounterS capture bookmark to get the direct handoff. Open your Steam CS2 inventory, click the bookmark, and browse the pages you want to include. Click **Send to CounterS**, then review the capture and confirm **Replace current inventory** in the new CounterS tab. **Download CounterS inventory** and **Import inventory file** are also available for backups and the standalone app.

The capture reads Steam's wear property ID 2 and the exact `itemInfo.floatvalue` values exposed in the page by CSFloat Market Checker when it is already enabled. It sends the captured item data directly to the local CounterS tab without reading cookies or extension storage. The tab clears the temporary URL fragment before reviewing the import. Rounded on-screen wear values are excluded from calculation inputs.

Only **weapon skins from loaded primary-inventory pages** are captured. Keep the panel open and visit all inventory pages before downloading. Trade-protected context 16 is excluded. Imports report how many entries were imported, outside the weapon catalog, or missing a valid float. A capture with no usable skins is rejected without replacing the workspace. Up to 500 supported skins can be imported. Export again after inventory changes to capture the latest assets.

This integration targets the page structures inspected in [CSFloat Market Checker 5.19.1](https://github.com/csfloat/extension). Steam or extension page changes may require updating the capture. **Show bookmark address** provides the complete URL if bookmark dragging is unavailable.

### Existing JSON files

Use **Import inventory file** to load a CounterS workspace or a Steam capture. `prices` is optional. Click **Refresh Steam prices** to fetch current lowest USD listings for inputs and possible outputs and recalculate gross ROI. Imports replace the browser workspace, which is retained in localStorage. Export before clearing browser storage. Floats must be numbers within the skin's supported range, and IDs must identify distinct physical assets. At most 500 items and 2 MB per import are supported.

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

CounterS checks evaluated contract inputs and outputs first, then checks the other weapon skins. Uncached Market requests start four seconds apart and slow down after a rate limit. The server deduplicates requests and caches quotes and unavailable listings for five minutes. If Steam rate-limits the refresh, CounterS stops and reports how long to wait. It honors Steam's `Retry-After` with a one-minute minimum, and waits two minutes when Steam gives no usable retry time. A later **Refresh Steam prices** reuses Steam quotes fetched within the last hour, even after reloading the page, and checks the remaining names. Rankings appear after the refresh finishes and every inventory and evaluated output price is available. Quotes retain their original timestamps. Imported or expired quotes are cleared when a live refresh starts.

Pricing progress shows separate counts for inventory skin quotes and trade-up output quotes. A Steam listing is checked once for each unique market name, so duplicate skins in the same wear tier share a quote. A possible output already in the inventory also shares that quote.

The server exposes public weapon inventory retrieval (`/api/inventory?steamId=...`), a trade-up workspace response (`format=workspace`), and lowest listings for names in the weapon catalog (`/api/price?name=...`). Inventory page requests are spaced two seconds apart, simultaneous imports of the same inventory are deduplicated, and an inventory-specific cooldown applies after a `429`. Missing exact floats are skipped in the workspace response. Steam OpenID verification, inventory fetches, and Market requests need outbound HTTPS access to `steamcommunity.com`.

Imported quotes support `steam-last-sale` for a user-supplied last-sale assertion and `steam-history` for aggregated sale history. Imported quotes are not independently verified. Quotes older than 24 hours are marked stale in details; staleness is not an automatic exclusion. All quotes are USD; no exchange conversion is performed. ROI ignores sticker premiums, float premiums, market depth, and execution slippage.

## Search scope and float rules

The analyzer ranks physical 10-item combinations within eligible rarity/StatTrak groups by gross expected ROI and returns the top ten. It checks up to 1,000,000 combinations. When the search exceeds that budget, it checks smaller groups in full when they fit their share and samples combinations throughout larger groups. Partial searches can miss higher-ROI contracts.

Normalized mode averages `(input float − input skin min) / (input skin max − input skin min)` then calculates `output min + average × (output max − output min)`. Legacy mode uses the raw average input float instead. The UI exposes the choice; confirm current CS2 mechanics against the live game before trading. Standard contracts only: five-Covert knife/glove contracts are not implemented. This is an analysis tool and does not execute trades or contracts.

## Catalog attribution

The bundled 1,455-entry single-collection weapon-finish catalog derives from [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API), retrieved October 21, 2026. Its MIT license is in `data/CATALOG-LICENSE`. Item images are served by Steam; network-blocked images do not affect calculations. This app is not affiliated with Valve. Project license: GPL-3.0, see `LICENSE`.
