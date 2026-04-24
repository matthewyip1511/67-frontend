# Grab Route Starter

A clean standalone starter app for visualising a route between a start point and an end point. It is intentionally small and dependency-light, and it keeps routing/geocoding calls on the local server so API keys are not exposed to the browser.

## Run

```bash
cd grab-route-starter
npm install
npm run dev
```

Then open:

```text
http://localhost:4173
```

## Deploy to Vercel

This project is ready for Vercel. Static files are served from `public/`, while `api/[...path].js`
uses the same server-side proxy handlers as local development so `GRAB_API_KEY` is never sent to
the browser.

1. Push the repo to GitHub, GitLab, or Bitbucket.
2. Import the project in Vercel.
3. Leave the framework preset as `Other`.
4. Add the environment variables from `.env.example` in Vercel Project Settings -> Environment
   Variables. At minimum, set `GRAB_API_KEY`.
5. Deploy.

For CLI deployment:

```bash
npm i -g vercel
vercel
vercel env add GRAB_API_KEY
vercel --prod
```

Do not prefix the private key with `NEXT_PUBLIC_`, `VITE_`, or any other browser-exposed naming
convention. The app reads `GRAB_API_KEY` only inside the Vercel serverless function.

## Environment

Create a local `.env` file when you are ready to customise the app:

```bash
cp .env.example .env
```

The app reads Grab settings server-side. It only exposes whether a server key exists, not the key itself.

```dotenv
GRAB_API_KEY=bm_your_api_key_here
GRAB_MAPS_API_BASE_URL=https://maps.grab.com
GRAB_MAPS_LIBRARY_URL=https://maps.grab.com/developer/assets/js/grabmaps.es.js
GRAB_MAPS_BROWSER_API_KEY=
GRAB_MAP_THEME=basic
GRAB_DIRECTIONS_PATH=/api/v1/maps/eta/v1/direction
GRAB_ROUTE_PROFILE=driving
GRAB_ROUTE_OVERVIEW=full
GRAB_ROUTE_GEOMETRIES=polyline6
GRAB_PLACES_COUNTRY=SGP
GRAB_PLACES_BIAS_LAT=1.3521
GRAB_PLACES_BIAS_LNG=103.8198
GRAB_67_SAMPLE_POINTS=7
GRAB_67_SEARCH_LIMIT=8
GRAB_67_MAX_STOPS=4
```

The app is Grab-only by default: map styling, place-name search, and routing all use Grab endpoints. If `GRAB_API_KEY` is missing or does not have the needed permissions, the app shows an error instead of falling back to public map or routing providers.

The Grab integration calls `/api/v1/maps/eta/v1/direction` with repeated `coordinates`, `profile`, `overview=full`, and an `Authorization: Bearer ...` header. The returned polyline6 geometry is decoded server-side before the browser draws it.

Place-name search uses Grab Places keyword search at `/api/v1/maps/poi/v1/search` when a key is present. The server also exposes starter endpoints for `/api/nearby` and `/api/reverse-geocode`, mapped to Grab nearby search and reverse-geo for future pin/POI features.

Map styling uses Grab's hosted builder library when `GRAB_MAPS_BROWSER_API_KEY` is set to a browser-safe key. Otherwise it uses Grab's `/api/style.json?theme=basic` through a local proxy and renders with MapLibre. The app no longer renders public OSM tiles as a fallback.

The optional `67 stops` control searches along the generated route using Grab Places keyword search for addresses whose name or formatted address starts with `67`. It filters candidates to the selected inflation radius, then requests a multi-stop Grab route through the selected matches. If Grab Places or Routing is temporarily unavailable, the UI keeps the base route available and shows a clear upstream message.
