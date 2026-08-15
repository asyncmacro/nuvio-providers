# AGENT.md - Nuvio Providers

## Project Overview
Nuvio Providers is a collection of JavaScript streaming providers for the Nuvio app. Providers run in Hermes/React Native. `async/await` must be transpiled.

Repo structure:
```
src/               # Multi-file source providers
  _template/       # Starter template
providers/         # Built/distribution files, read by app
manifest.json      # Provider registry
build.js           # Bundler + transpiler using esbuild
server.js          # Local dev server
```

## Key Files
- `README.md` – Quick start and dev guide
- `DOCUMENTATION.md` – Comprehensive developer guide
- `manifest.json` – Array of provider metadata, used by Nuvio
- `build.js` – `node build.js <provider>` builds src -> providers, transpiles async/await to ES2016

## Adding a New Provider

### Recommended Multi-file workflow
1. Create source folder
```bash
mkdir -p src/myprovider
cp -r src/_template/* src/myprovider/
```
Edit `src/myprovider/index.js`, `extractor.js`, `http.js`.

2. Build
```bash
node build.js myprovider
```
Minified: `node build.js --minify myprovider`
All: `node build.js`

3. Register in `manifest.json`
Add an object with `id`, `name`, `filename: "providers/myprovider.js"`, `supportedTypes`, etc.

4. Test
Local: `node test.js` requiring `providers/myprovider.js`
In-app: `npm start` then Plugin Tester with local manifest URL.

### Single-file workflow
Create `providers/myprovider.js` with `module.exports = { getStreams }`.
If using async/await:
```bash
node build.js --transpile myprovider.js
```
Then add manifest entry.

## Build Commands
- `node build.js` – build all src providers
- `node build.js vixsrc uhdmovies` – build specific
- `node build.js --minify <name>` – minified build
- `node build.js --transpile` – transpile async/await in providers/
- `npm run build:watch` – watch mode

## Provider API
Must export:
```javascript
async function getStreams(tmdbId, mediaType, season, episode) {
  return []; // array of stream objects
}
module.exports = { getStreams };
```

Stream object:
```javascript
{
  name: "Provider Name",
  title: "1080p Stream",
  url: "https://...",
  quality: "1080p",
  size?: "2.5 GB",
  headers?: { "Referer": "..." }
}
```

Available modules: `cheerio-without-node-native`, `crypto-js`, `axios`, native `fetch`, `console`.

## Development Notes
- Do NOT edit built files in `providers/` manually if they come from `src/`.
- Hermes limitation: no native async/await in dynamically loaded code. Build script handles transpilation.
- Test in Nuvio debug build Plugin Tester, not only Node.js.
- Keep source in `src/`, built artifacts in `providers/`.
- Update `manifest.json` for every new provider.

## Common Tasks
- List providers: `ls src` and `ls providers`
- Scaffold from template: `cp -r src/_template src/newname`
- Validate manifest: `node -e "console.log(JSON.parse(require('fs').readFileSync('manifest.json')))"`

## Publishing
1. Build provider
2. Update manifest.json
3. git add/commit/push
Users load via raw manifest URL in Nuvio.
