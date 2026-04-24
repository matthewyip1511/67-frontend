const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const rootDir = __dirname;
const publicDir = path.join(rootDir, "public");
const envPath = path.join(rootDir, ".env");

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((env, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return env;
      }

      const equalsAt = trimmed.indexOf("=");
      if (equalsAt === -1) {
        return env;
      }

      const key = trimmed.slice(0, equalsAt).trim();
      let value = trimmed.slice(equalsAt + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      env[key] = value;
      return env;
    }, {});
}

function getEnv() {
  return {
    ...parseEnvFile(envPath),
    ...process.env
  };
}

function numberFromEnv(env, key, fallback) {
  const value = Number(env[key]);
  return Number.isFinite(value) ? value : fallback;
}

function getClientConfig() {
  const env = getEnv();

  return {
    grab: {
      hasApiKey: Boolean(env.GRAB_API_KEY),
      apiBaseUrl: env.GRAB_MAPS_API_BASE_URL || "https://maps.grab.com",
      browserApiKey: env.GRAB_MAPS_BROWSER_API_KEY || "",
      libraryUrl:
        env.GRAB_MAPS_LIBRARY_URL ||
        "https://maps.grab.com/developer/assets/js/grabmaps.es.js"
    },
    map: {
      defaultZoom: numberFromEnv(env, "DEFAULT_MAP_ZOOM", 13)
    },
    routing: {
      provider: "grab",
      providerLabel: "Grab Routing API"
    },
    geocoding: {
      provider: "grab",
      providerLabel: "Grab Places API"
    },
    defaults: {
      start: {
        label: env.DEFAULT_START_LABEL || "Marina Bay Sands",
        lat: numberFromEnv(env, "DEFAULT_START_LAT", 1.2836),
        lng: numberFromEnv(env, "DEFAULT_START_LNG", 103.8602)
      },
      end: {
        label: env.DEFAULT_END_LABEL || "Orchard Road",
        lat: numberFromEnv(env, "DEFAULT_END_LAT", 1.3048),
        lng: numberFromEnv(env, "DEFAULT_END_LNG", 103.8318)
      }
    }
  };
}

function parseCoordinates(value) {
  const match = value.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }

  const first = Number(match[1]);
  const second = Number(match[2]);
  const looksLikeLatLng = Math.abs(first) <= 90 && Math.abs(second) <= 180;
  const looksLikeLngLat = Math.abs(first) <= 180 && Math.abs(second) <= 90;
  const lat = looksLikeLatLng ? first : second;
  const lng = looksLikeLatLng ? second : first;

  if (!looksLikeLatLng && !looksLikeLngLat) {
    return null;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.text();
  let payload = null;

  if (body) {
    try {
      payload = JSON.parse(body);
    } catch {
      payload = { message: body };
    }
  }

  if (!response.ok) {
    const detail = payload && (payload.Message || payload.message || payload.Code || payload.code);
    if (detail && /no healthy upstream/i.test(detail)) {
      throw new Error("Grab upstream is temporarily unavailable. Please retry in a minute.");
    }

    throw new Error(detail || `Request failed with status ${response.status}`);
  }

  return payload;
}

function sendJson(response, statusCode, payload) {
  send(response, statusCode, JSON.stringify(payload), "application/json; charset=utf-8");
}

function parseGrabPlaceLocation(location) {
  if (Array.isArray(location) && location.length >= 2) {
    return { lat: Number(location[0]), lng: Number(location[1]) };
  }

  if (typeof location === "string") {
    const parsed = parseCoordinates(location);
    return parsed ? { lat: parsed.lat, lng: parsed.lng } : null;
  }

  if (location && typeof location === "object") {
    const lat = Number(location.latitude ?? location.lat);
    const lng = Number(location.longitude ?? location.lng ?? location.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  return null;
}

function getGrabUrl(env, pathKey, fallbackPath) {
  return new URL(
    pathKey ? env[pathKey] || fallbackPath : fallbackPath,
    env.GRAB_MAPS_API_BASE_URL || "https://maps.grab.com"
  );
}

function toGrabResourceProxy(resourceUrl, requestOrigin) {
  const encodedUrl = encodeURIComponent(resourceUrl)
    .replace(/%7B/gi, "{")
    .replace(/%7D/gi, "}");

  return new URL(`/api/grab-resource?url=${encodedUrl}`, requestOrigin).toString();
}

function rewriteGrabStyleUrls(value, env, requestOrigin) {
  const baseUrl = env.GRAB_MAPS_API_BASE_URL || "https://maps.grab.com";
  const baseHost = new URL(baseUrl).host;

  if (Array.isArray(value)) {
    return value.map((item) => rewriteGrabStyleUrls(item, env, requestOrigin));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewriteGrabStyleUrls(item, env, requestOrigin)])
    );
  }

  if (typeof value !== "string") {
    return value;
  }

  if (value.startsWith("/")) {
    return toGrabResourceProxy(new URL(value, baseUrl).toString(), requestOrigin);
  }

  try {
    const parsed = new URL(value);
    return parsed.host === baseHost ? toGrabResourceProxy(value, requestOrigin) : value;
  } catch {
    return value;
  }
}

function createFallbackGrabStyle(env, requestOrigin) {
  const baseUrl = env.GRAB_MAPS_API_BASE_URL || "https://maps.grab.com";
  const tileUrl = toGrabResourceProxy(
    new URL("/api/maps/tiles/v2/vector/karta-v3/{z}/{x}/{y}.pbf", baseUrl).toString(),
    requestOrigin
  );
  const glyphUrl = toGrabResourceProxy(
    new URL("/api/maps/tiles/v2/fonts/{fontstack}/{range}.pbf", baseUrl).toString(),
    requestOrigin
  );

  return {
    version: 8,
    name: "grab-local-fallback",
    center: [103.8198, 1.3521],
    zoom: 11,
    glyphs: glyphUrl,
    sources: {
      grabmaptiles: {
        type: "vector",
        tiles: [tileUrl],
        maxzoom: 14,
        attribution:
          '<a href="https://www.grab.com/terms-policies/transport-delivery-logistics" target="_blank">Grab Terms of Service</a>'
      }
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#f3f7f4" }
      },
      {
        id: "fallback-landuse",
        type: "fill",
        source: "grabmaptiles",
        "source-layer": "landuse",
        paint: {
          "fill-color": "#edf4f1",
          "fill-opacity": 0.44
        }
      },
      {
        id: "fallback-park",
        type: "fill",
        source: "grabmaptiles",
        "source-layer": "park",
        paint: {
          "fill-color": "#d6ead9",
          "fill-opacity": 0.62
        }
      },
      {
        id: "fallback-landcover",
        type: "fill",
        source: "grabmaptiles",
        "source-layer": "landcover",
        filter: ["match", ["get", "class"], ["wood", "grass", "wetland"], true, false],
        paint: {
          "fill-color": "#dceee0",
          "fill-opacity": 0.48
        }
      },
      {
        id: "fallback-water",
        type: "fill",
        source: "grabmaptiles",
        "source-layer": "water",
        paint: {
          "fill-color": "#a8dbf2",
          "fill-opacity": 0.94
        }
      },
      {
        id: "fallback-waterway",
        type: "line",
        source: "grabmaptiles",
        "source-layer": "waterway",
        layout: {
          "line-cap": "round",
          "line-join": "round"
        },
        paint: {
          "line-color": "#a8dbf2",
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.7, 15, 3.2],
          "line-opacity": 0.82
        }
      },
      {
        id: "fallback-road-casing",
        type: "line",
        source: "grabmaptiles",
        "source-layer": "transportation",
        filter: ["==", ["geometry-type"], "LineString"],
        layout: {
          "line-cap": "round",
          "line-join": "round"
        },
        paint: {
          "line-color": "#ffffff",
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.3, 13, 3, 16, 8],
          "line-opacity": 0.9
        }
      },
      {
        id: "fallback-road",
        type: "line",
        source: "grabmaptiles",
        "source-layer": "transportation",
        filter: ["==", ["geometry-type"], "LineString"],
        layout: {
          "line-cap": "round",
          "line-join": "round"
        },
        paint: {
          "line-color": [
            "match",
            ["get", "class"],
            ["motorway", "trunk", "primary", "motorway_link", "trunk_link", "primary_link"],
            "#8d9d96",
            ["secondary", "tertiary", "secondary_link", "tertiary_link"],
            "#a7b5ae",
            "#c0cac5"
          ],
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.65, 13, 1.6, 16, 5],
          "line-opacity": 0.82
        }
      },
      {
        id: "fallback-building",
        type: "fill",
        source: "grabmaptiles",
        "source-layer": "building",
        minzoom: 14,
        paint: {
          "fill-color": "#e1e7e4",
          "fill-outline-color": "#c8d1cc",
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.12, 16, 0.58]
        }
      },
      {
        id: "fallback-road-label",
        type: "symbol",
        source: "grabmaptiles",
        "source-layer": "transportation_name",
        minzoom: 13,
        layout: {
          "symbol-placement": "line",
          "text-field": ["to-string", ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 13, 9, 16, 12]
        },
        paint: {
          "text-color": "#6b7772",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1
        }
      },
      {
        id: "fallback-place-label",
        type: "symbol",
        source: "grabmaptiles",
        "source-layer": "place",
        layout: {
          "text-field": ["to-string", ["get", "name"]],
          "text-font": ["Noto Sans Medium"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 8, 10, 14, 14],
          "text-transform": "uppercase"
        },
        paint: {
          "text-color": "#4f5b56",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.4
        }
      }
    ]
  };
}

function isAllowedGrabResource(resourceUrl, env) {
  try {
    const parsed = new URL(resourceUrl);
    const base = new URL(env.GRAB_MAPS_API_BASE_URL || "https://maps.grab.com");
    return parsed.protocol === "https:" && parsed.host === base.host;
  } catch {
    return false;
  }
}

async function geocodeGrab(query, env) {
  if (!env.GRAB_API_KEY) {
    throw new Error("GRAB_API_KEY is required for Grab Places search.");
  }

  const url = getGrabUrl(env, "GRAB_PLACE_SEARCH_PATH", "/api/v1/maps/poi/v1/search");
  url.searchParams.set("keyword", query);
  url.searchParams.set("country", env.GRAB_PLACES_COUNTRY || "SGP");
  url.searchParams.set(
    "location",
    `${numberFromEnv(env, "GRAB_PLACES_BIAS_LAT", 1.3521)},${numberFromEnv(
      env,
      "GRAB_PLACES_BIAS_LNG",
      103.8198
    )}`
  );
  url.searchParams.set("limit", "1");

  const payload = await fetchJson(url, {
    headers: {
      Authorization: createGrabAuthorizationHeader(env.GRAB_API_KEY)
    }
  });
  const place = payload.places && payload.places[0];
  const location = place && parseGrabPlaceLocation(place.location);

  if (!place || !location) {
    throw new Error(`No Grab place found for "${query}"`);
  }

  return {
    label: place.name || place.formatted_address || query,
    address: place.formatted_address || "",
    lat: location.lat,
    lng: location.lng,
    provider: "Grab Places API"
  };
}

function createGrabAuthorizationHeader(apiKey) {
  return apiKey.toLowerCase().startsWith("bearer ") ? apiKey : `Bearer ${apiKey}`;
}

function decodePolyline(encoded, precision = 6) {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates = [];
  const factor = 10 ** precision;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte = null;

    do {
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;

    do {
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coordinates.push([lng / factor, lat / factor]);
  }

  return coordinates;
}

async function routeGrab(start, end, env, waypoints = []) {
  if (!env.GRAB_API_KEY) {
    throw new Error("GRAB_API_KEY is required for Grab routing.");
  }

  const coordinates = [start, ...waypoints, end];
  const url = new URL(
    env.GRAB_DIRECTIONS_PATH || "/api/v1/maps/eta/v1/direction",
    env.GRAB_MAPS_API_BASE_URL || "https://maps.grab.com"
  );
  coordinates.forEach((coordinate) => {
    url.searchParams.append("coordinates", `${coordinate.lng},${coordinate.lat}`);
  });
  url.searchParams.set("profile", env.GRAB_ROUTE_PROFILE || "driving");
  url.searchParams.set("overview", env.GRAB_ROUTE_OVERVIEW || "full");
  url.searchParams.set("geometries", env.GRAB_ROUTE_GEOMETRIES || "polyline6");

  if (env.GRAB_ROUTE_AVOID) {
    url.searchParams.set("avoid", env.GRAB_ROUTE_AVOID);
  }

  if (env.GRAB_ROUTE_ALTERNATIVES) {
    url.searchParams.set("alternatives", env.GRAB_ROUTE_ALTERNATIVES);
  }

  const payload = await fetchJson(url, {
    headers: {
      Authorization: createGrabAuthorizationHeader(env.GRAB_API_KEY)
    }
  });
  const route = payload.routes && payload.routes[0];

  if (!route) {
    throw new Error("No Grab route returned for those points");
  }

  const routeCoordinates = route.geometry ? decodePolyline(route.geometry, 6) : [
    [start.lng, start.lat],
    [end.lng, end.lat]
  ];

  return {
    provider: "Grab Routing API",
    distance: route.distance,
    duration: route.duration,
    geometry: {
      type: "LineString",
      coordinates: routeCoordinates
    },
    legs: route.legs || [],
    fee: route.fee || null,
    trafficLight: route.traffic_light || 0,
    waypoints: payload.waypoints || [],
    requestedWaypoints: waypoints
  };
}

function readPointFromQuery(requestUrl, prefix) {
  const lat = Number(requestUrl.searchParams.get(`${prefix}Lat`));
  const lng = Number(requestUrl.searchParams.get(`${prefix}Lng`));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error(`Missing or invalid ${prefix} point.`);
  }

  return { lat, lng };
}

function parsePointObject(value) {
  const lat = Number(value && value.lat);
  const lng = Number(value && value.lng);
  const label = value && typeof value.label === "string" ? value.label : "";

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng, label };
}

function readWaypointsFromQuery(requestUrl) {
  const rawWaypoints = requestUrl.searchParams.get("waypoints");
  if (!rawWaypoints) {
    return [];
  }

  let payload = null;
  try {
    payload = JSON.parse(rawWaypoints);
  } catch {
    throw new Error("Invalid waypoints JSON.");
  }

  if (!Array.isArray(payload)) {
    throw new Error("Waypoints must be an array.");
  }

  return payload
    .slice(0, 8)
    .map(parsePointObject)
    .filter(Boolean);
}

function haversineMeters(a, b) {
  const earthRadius = 6371000;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const deltaLat = ((b.lat - a.lat) * Math.PI) / 180;
  const deltaLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const value = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

  return 2 * earthRadius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function distancePointToSegmentMeters(point, start, end) {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos((point.lat * Math.PI) / 180);
  const ax = (start.lng - point.lng) * metersPerDegreeLng;
  const ay = (start.lat - point.lat) * metersPerDegreeLat;
  const bx = (end.lng - point.lng) * metersPerDegreeLng;
  const by = (end.lat - point.lat) * metersPerDegreeLat;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / lengthSquared));
  const x = ax + dx * t;
  const y = ay + dy * t;

  return Math.hypot(x, y);
}

function nearestRouteDistance(point, routeCoordinates) {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestIndex = 0;

  for (let index = 0; index < routeCoordinates.length - 1; index += 1) {
    const start = { lng: routeCoordinates[index][0], lat: routeCoordinates[index][1] };
    const end = { lng: routeCoordinates[index + 1][0], lat: routeCoordinates[index + 1][1] };
    const distance = distancePointToSegmentMeters(point, start, end);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return { distance: bestDistance, index: bestIndex };
}

function sampleRoute(routeCoordinates, sampleCount) {
  if (!routeCoordinates.length) {
    return [];
  }

  const lastIndex = routeCoordinates.length - 1;
  const samples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const routeIndex = Math.round((lastIndex * index) / Math.max(1, sampleCount - 1));
    const coordinate = routeCoordinates[routeIndex];
    samples.push({ lng: coordinate[0], lat: coordinate[1] });
  }

  return samples.filter((sample, index, allSamples) => {
    return allSamples.findIndex((other) => haversineMeters(sample, other) < 75) === index;
  });
}

function startsWith67(place) {
  const startsWith67Pattern = /^\s*67(?:\b|[-/])/i;
  if (place.address) {
    return startsWith67Pattern.test(place.address);
  }

  return startsWith67Pattern.test(place.label || "");
}

function dedupePlaces(places) {
  const seen = new Set();
  return places.filter((place) => {
    const key = `${place.label}|${place.address}|${place.lat.toFixed(5)}|${place.lng.toFixed(5)}`.toLowerCase();
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function searchGrabPlaces(query, location, env, limit) {
  const url = getGrabUrl(env, "GRAB_PLACE_SEARCH_PATH", "/api/v1/maps/poi/v1/search");
  url.searchParams.set("keyword", query);
  url.searchParams.set("country", env.GRAB_PLACES_COUNTRY || "SGP");
  url.searchParams.set("location", `${location.lat},${location.lng}`);
  url.searchParams.set("limit", String(limit));

  const payload = await fetchJson(url, {
    headers: {
      Authorization: createGrabAuthorizationHeader(env.GRAB_API_KEY)
    }
  });

  return (payload.places || [])
    .map((place) => {
      const parsedLocation = parseGrabPlaceLocation(place.location);
      if (!parsedLocation) {
        return null;
      }

      return {
        label: place.name || place.formatted_address || query,
        address: place.formatted_address || "",
        lat: parsedLocation.lat,
        lng: parsedLocation.lng,
        provider: "Grab Places API"
      };
    })
    .filter(Boolean);
}

async function find67StopsAlongRoute(routeCoordinates, radiusKm, env) {
  if (!env.GRAB_API_KEY) {
    throw new Error("GRAB_API_KEY is required for 67 address search.");
  }

  const radiusMeters = radiusKm * 1000;
  const sampleCount = Math.min(Math.max(numberFromEnv(env, "GRAB_67_SAMPLE_POINTS", 7), 2), 14);
  const searchLimit = Math.min(Math.max(numberFromEnv(env, "GRAB_67_SEARCH_LIMIT", 8), 1), 20);
  const maxStops = Math.min(Math.max(numberFromEnv(env, "GRAB_67_MAX_STOPS", 4), 1), 8);
  const samples = sampleRoute(routeCoordinates, sampleCount);
  const results = [];

  for (const sample of samples) {
    const places = await searchGrabPlaces("67", sample, env, searchLimit);
    results.push(...places);
  }

  return dedupePlaces(results)
    .map((place) => {
      const nearest = nearestRouteDistance(place, routeCoordinates);
      return {
        ...place,
        distanceFromRouteMeters: nearest.distance,
        routeIndex: nearest.index
      };
    })
    .filter((place) => startsWith67(place) && place.distanceFromRouteMeters <= radiusMeters)
    .sort((a, b) => a.routeIndex - b.routeIndex || a.distanceFromRouteMeters - b.distanceFromRouteMeters)
    .slice(0, maxStops);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

async function handleNearby(requestUrl, response) {
  const env = getEnv();

  try {
    if (!env.GRAB_API_KEY) {
      throw new Error("GRAB_API_KEY is required for Grab nearby search.");
    }

    const lat = Number(requestUrl.searchParams.get("lat"));
    const lng = Number(requestUrl.searchParams.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      sendJson(response, 400, { error: "Missing or invalid lat/lng query parameters." });
      return;
    }

    const url = getGrabUrl(env, "GRAB_NEARBY_PATH", "/api/v1/maps/place/v2/nearby");
    url.searchParams.set("location", `${lat},${lng}`);
    url.searchParams.set("radius", requestUrl.searchParams.get("radius") || env.GRAB_NEARBY_RADIUS || "1");
    url.searchParams.set("limit", requestUrl.searchParams.get("limit") || env.GRAB_NEARBY_LIMIT || "10");
    url.searchParams.set("rankBy", requestUrl.searchParams.get("rankBy") || env.GRAB_NEARBY_RANK_BY || "distance");

    if (requestUrl.searchParams.get("language") || env.GRAB_PLACES_LANGUAGE) {
      url.searchParams.set("language", requestUrl.searchParams.get("language") || env.GRAB_PLACES_LANGUAGE);
    }

    const payload = await fetchJson(url, {
      headers: {
        Authorization: createGrabAuthorizationHeader(env.GRAB_API_KEY)
      }
    });

    sendJson(response, 200, payload);
  } catch (error) {
    sendJson(response, 502, { error: error.message || "Nearby search failed." });
  }
}

async function handleReverseGeocode(requestUrl, response) {
  const env = getEnv();

  try {
    if (!env.GRAB_API_KEY) {
      throw new Error("GRAB_API_KEY is required for Grab reverse geocoding.");
    }

    const lat = Number(requestUrl.searchParams.get("lat"));
    const lng = Number(requestUrl.searchParams.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      sendJson(response, 400, { error: "Missing or invalid lat/lng query parameters." });
      return;
    }

    const url = getGrabUrl(env, "GRAB_REVERSE_GEOCODE_PATH", "/api/v1/maps/poi/v1/reverse-geo");
    url.searchParams.set("location", `${lat},${lng}`);

    if (requestUrl.searchParams.get("type")) {
      url.searchParams.set("type", requestUrl.searchParams.get("type"));
    }

    const payload = await fetchJson(url, {
      headers: {
        Authorization: createGrabAuthorizationHeader(env.GRAB_API_KEY)
      }
    });

    sendJson(response, 200, payload);
  } catch (error) {
    sendJson(response, 502, { error: error.message || "Reverse geocoding failed." });
  }
}

async function handleMapStyle(requestUrl, response) {
  const env = getEnv();

  try {
    if (!env.GRAB_API_KEY) {
      throw new Error("GRAB_API_KEY is required for Grab map styles.");
    }

    const theme = requestUrl.searchParams.get("theme") || env.GRAB_MAP_THEME || "basic";
    const url = getGrabUrl(env, null, "/api/style.json");
    url.searchParams.set("theme", theme);

    try {
      const style = await fetchJson(url, {
        headers: {
          Authorization: createGrabAuthorizationHeader(env.GRAB_API_KEY)
        }
      });

      sendJson(response, 200, rewriteGrabStyleUrls(style, env, requestUrl.origin));
    } catch (error) {
      const fallbackStyle = createFallbackGrabStyle(env, requestUrl.origin);
      sendJson(response, 200, fallbackStyle);
    }
  } catch (error) {
    sendJson(response, 502, { error: error.message || "Map style request failed." });
  }
}

async function handleGrabResource(requestUrl, response) {
  const env = getEnv();
  const baseResourceUrl = requestUrl.searchParams.get("url");
  const suffix = requestUrl.pathname.slice("/api/grab-resource".length);
  const resourceUrl = baseResourceUrl ? `${baseResourceUrl}${suffix}` : "";

  try {
    if (!env.GRAB_API_KEY) {
      throw new Error("GRAB_API_KEY is required for Grab map resources.");
    }

    if (!resourceUrl || !isAllowedGrabResource(resourceUrl, env)) {
      sendJson(response, 400, { error: "Invalid Grab resource URL." });
      return;
    }

    const upstream = await fetch(resourceUrl, {
      headers: {
        Authorization: createGrabAuthorizationHeader(env.GRAB_API_KEY)
      }
    });
    const body = Buffer.from(await upstream.arrayBuffer());

    response.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": "public, max-age=300"
    });
    response.end(body);
  } catch (error) {
    sendJson(response, 502, { error: error.message || "Grab map resource request failed." });
  }
}

async function handleGeocode(requestUrl, response) {
  const env = getEnv();
  const query = requestUrl.searchParams.get("q");

  if (!query) {
    sendJson(response, 400, { error: "Missing q query parameter." });
    return;
  }

  try {
    const coordinates = parseCoordinates(query);
    if (coordinates) {
      sendJson(response, 200, { ...coordinates, provider: "Coordinates" });
      return;
    }

    const result = await geocodeGrab(query, env);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 502, { error: error.message || "Geocoding failed." });
  }
}

async function handleSearch67(request, response) {
  const env = getEnv();

  try {
    const body = await readJsonBody(request);
    const coordinates = body.route && Array.isArray(body.route.coordinates) ? body.route.coordinates : [];
    const radiusKm = Number(body.radiusKm);

    if (!coordinates.length || coordinates.length < 2) {
      sendJson(response, 400, { error: "A route geometry with at least two coordinates is required." });
      return;
    }

    if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
      sendJson(response, 400, { error: "A positive radiusKm is required." });
      return;
    }

    const routeCoordinates = coordinates
      .map((coordinate) => {
        if (!Array.isArray(coordinate) || coordinate.length < 2) {
          return null;
        }

        const lng = Number(coordinate[0]);
        const lat = Number(coordinate[1]);
        return Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : null;
      })
      .filter(Boolean);

    const places = await find67StopsAlongRoute(routeCoordinates, Math.min(radiusKm, 5), env);
    sendJson(response, 200, {
      provider: "Grab Places API",
      query: "67",
      radiusKm: Math.min(radiusKm, 5),
      places
    });
  } catch (error) {
    sendJson(response, 502, { error: error.message || "67 address search failed." });
  }
}

async function handleRoute(requestUrl, response) {
  const env = getEnv();

  try {
    const start = readPointFromQuery(requestUrl, "start");
    const end = readPointFromQuery(requestUrl, "end");
    const waypoints = readWaypointsFromQuery(requestUrl);
    const result = await routeGrab(start, end, env, waypoints);

    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 502, { error: error.message || "Routing failed." });
  }
}

function send(response, statusCode, body, contentType) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function serveStatic(requestUrl, response) {
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const requestedPath = path.normalize(path.join(publicDir, pathname));

  if (!requestedPath.startsWith(publicDir)) {
    send(response, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  fs.readFile(requestedPath, (error, data) => {
    if (error) {
      send(response, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }

    const contentType = mimeTypes[path.extname(requestedPath)] || "application/octet-stream";
    send(response, 200, data, contentType);
  });
}

function serveVendor(requestUrl, response) {
  const vendorFiles = {
    "/vendor/maplibre-gl.css": path.join(rootDir, "node_modules/maplibre-gl/dist/maplibre-gl.css"),
    "/vendor/maplibre-gl.js": path.join(rootDir, "node_modules/maplibre-gl/dist/maplibre-gl.js")
  };
  const requestedPath = vendorFiles[requestUrl.pathname];

  if (!requestedPath) {
    send(response, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }

  fs.readFile(requestedPath, (error, data) => {
    if (error) {
      send(response, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }

    const contentType = mimeTypes[path.extname(requestedPath)] || "application/octet-stream";
    send(response, 200, data, contentType);
  });
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (requestUrl.pathname.startsWith("/vendor/")) {
    serveVendor(requestUrl, response);
    return;
  }

  if (requestUrl.pathname === "/grabmaps-loader.js") {
    const libraryUrl = getClientConfig().grab.libraryUrl;
    const body = `import ${JSON.stringify(libraryUrl)};\n`;
    send(response, 200, body, "text/javascript; charset=utf-8");
    return;
  }

  if (requestUrl.pathname === "/config.js") {
    const body = `window.APP_CONFIG = ${JSON.stringify(getClientConfig(), null, 2)};\n`;
    send(response, 200, body, "text/javascript; charset=utf-8");
    return;
  }

  if (requestUrl.pathname === "/api/geocode") {
    handleGeocode(requestUrl, response);
    return;
  }

  if (requestUrl.pathname === "/api/route") {
    handleRoute(requestUrl, response);
    return;
  }

  if (requestUrl.pathname === "/api/search-67" && request.method === "POST") {
    handleSearch67(request, response);
    return;
  }

  if (requestUrl.pathname === "/api/nearby") {
    handleNearby(requestUrl, response);
    return;
  }

  if (requestUrl.pathname === "/api/reverse-geocode") {
    handleReverseGeocode(requestUrl, response);
    return;
  }

  if (requestUrl.pathname === "/api/map-style") {
    handleMapStyle(requestUrl, response);
    return;
  }

  if (requestUrl.pathname.startsWith("/api/grab-resource")) {
    handleGrabResource(requestUrl, response);
    return;
  }

  serveStatic(requestUrl, response);
});

const port = Number(process.env.PORT || parseEnvFile(envPath).PORT || 4173);
const host = process.env.HOST || parseEnvFile(envPath).HOST || "127.0.0.1";

server.listen(port, host, () => {
  console.log(`Grab Route Starter running at http://${host}:${port}`);
});
