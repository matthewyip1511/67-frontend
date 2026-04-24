const config = window.APP_CONFIG;

const elements = {
  map: document.querySelector("#map"),
  mapStage: document.querySelector(".map-stage"),
  grabMap: document.querySelector("#grabMap"),
  routeLayer: document.querySelector("#routeLayer"),
  markerLayer: document.querySelector("#markerLayer"),
  mapRouteCard: document.querySelector("#mapRouteCard"),
  mapRouteTitle: document.querySelector("#mapRouteTitle"),
  mapRouteMeta: document.querySelector("#mapRouteMeta"),
  form: document.querySelector("#routeForm"),
  startInput: document.querySelector("#startInput"),
  startSuggestions: document.querySelector("#startSuggestions"),
  endInput: document.querySelector("#endInput"),
  endSuggestions: document.querySelector("#endSuggestions"),
  include67Toggle: document.querySelector("#include67Toggle"),
  radius67Input: document.querySelector("#radius67Input"),
  status67: document.querySelector("#status67"),
  list67: document.querySelector("#list67"),
  swapButton: document.querySelector("#swapButton"),
  routeButton: document.querySelector("#routeButton"),
  profileSelect: document.querySelector("#profileSelect"),
  connectionStatus: document.querySelector("#connectionStatus"),
  statusLine: document.querySelector("#statusLine"),
  distanceValue: document.querySelector("#distanceValue"),
  durationValue: document.querySelector("#durationValue"),
  startValue: document.querySelector("#startValue"),
  startAddressValue: document.querySelector("#startAddressValue"),
  endValue: document.querySelector("#endValue"),
  endAddressValue: document.querySelector("#endAddressValue"),
  routeStopsList: document.querySelector("#routeStopsList")
};

const state = {
  start: config.defaults.start,
  end: config.defaults.end,
  baseRoute: null,
  route: null,
  stops67: [],
  include67: false,
  radius67Km: 0.8,
  profile: "driving",
  zoom: config.map.defaultZoom,
  grabMapsClient: null,
  maplibre: null,
  maplibreReady: false,
  mapMarkers: [],
  previewRequestId: 0,
  enrichmentRequestId: 0,
  suggestionRequestId: {
    start: 0,
    end: 0
  }
};

const suggestionTimers = {
  start: null,
  end: null
};

elements.startInput.value = pointToInput(config.defaults.start);
elements.endInput.value = pointToInput(config.defaults.end);
elements.connectionStatus.textContent = `${config.geocoding.providerLabel} + ${config.routing.providerLabel}`;
elements.radius67Input.value = state.radius67Km;
elements.profileSelect.value = state.profile;

function pointToInput(point) {
  return point.label || `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
}

const fallbackAddressByLabel = {
  "marina bay sands": "10 Bayfront Avenue, Marina Bay Sands, Singapore, 018956",
  "the shoppes at marina bay sands": "2A Bayfront Avenue, The Shoppes at Marina Bay Sands, Singapore, 018958",
  "290 orchard rd": "290 Orchard Road, Singapore, 238859",
  "290 orchard road": "290 Orchard Road, Singapore, 238859",
  paragon: "290 Orchard Road, Singapore, 238859"
};

function pointName(point) {
  return point && point.label ? point.label : "-";
}

function pointAddress(point) {
  if (!point) {
    return "";
  }

  return point.address || fallbackAddressByLabel[normalizeLocationInput(point.label || "")] || "";
}

function pointCoordinates(point) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return "";
  }

  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
}

function pointDetail(point) {
  return pointAddress(point) || pointCoordinates(point);
}

function setStatus(message, isError = false) {
  elements.statusLine.textContent = message;
  elements.statusLine.classList.toggle("error", isError);
}

function markerElement(type, point, options = {}) {
  const marker = document.createElement("div");
  const label =
    type === "start" ? "Start" : type === "end" ? "End" : options.badge ? `67-${options.badge}` : "67";
  marker.className = `map-pin ${type}`;
  marker.tabIndex = 0;
  marker.setAttribute("aria-label", `${label}${point ? ` ${pointName(point)}` : ""}`);
  marker.title = point
    ? `${label}: ${pointName(point)}${pointDetail(point) ? ` - ${pointDetail(point)}` : ""}`
    : label;

  const dot = document.createElement("span");
  dot.className = "map-pin-dot";
  dot.textContent = options.badge || "";

  const labelWrap = document.createElement("span");
  labelWrap.className = "map-pin-label";

  const typeLabel = document.createElement("strong");
  typeLabel.textContent = type === "stop67" && point ? pointName(point) : label;
  labelWrap.append(typeLabel);

  if (point) {
    const detail = document.createElement("small");
    detail.textContent = pointDetail(point) || pointName(point);
    labelWrap.append(detail);
  }

  marker.append(dot, labelWrap);
  return marker;
}

function lngLatFromGrabLocation(location) {
  if (!Array.isArray(location) || location.length < 2) {
    return null;
  }

  const first = Number(location[0]);
  const second = Number(location[1]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    return null;
  }

  const looksLatLng = Math.abs(first) <= 90 && Math.abs(second) <= 180;
  return looksLatLng ? [second, first] : [first, second];
}

function routeWaypointLngLat(index, fallbackPoint) {
  const waypoint = state.route && Array.isArray(state.route.waypoints) ? state.route.waypoints[index] : null;
  const snapped = waypoint ? lngLatFromGrabLocation(waypoint.location) : null;

  if (snapped) {
    return snapped;
  }

  return [fallbackPoint.lng, fallbackPoint.lat];
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) {
    return "-";
  }

  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) {
    return "-";
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours} hr ${remainder} min`;
}

function formatRadius(km) {
  if (!Number.isFinite(km)) {
    return "-";
  }

  return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(km * 1000)} m`;
}

function formatProfile(profile = state.profile) {
  return profile === "walking" ? "Walking" : "Driving";
}

function set67Status(message, isError = false) {
  elements.status67.textContent = message;
  elements.status67.classList.toggle("error", isError);
}

function suggestionElements(kind) {
  return kind === "start"
    ? { input: elements.startInput, list: elements.startSuggestions }
    : { input: elements.endInput, list: elements.endSuggestions };
}

function hideSuggestions(kind) {
  const { input, list } = suggestionElements(kind);
  list.hidden = true;
  list.replaceChildren();
  input.setAttribute("aria-expanded", "false");
}

function showSuggestionMessage(kind, message) {
  const { input, list } = suggestionElements(kind);
  const item = document.createElement("div");
  item.className = "suggestion-message";
  item.textContent = message;
  list.replaceChildren(item);
  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function resetRouteAfterLocationEdit() {
  state.baseRoute = null;
  state.route = null;
  state.stops67 = [];
  state.enrichmentRequestId += 1;
  updateSummary();
  renderMap();
}

function applySuggestion(kind, point) {
  const { input } = suggestionElements(kind);
  if (kind === "start") {
    state.start = point;
  } else {
    state.end = point;
  }

  input.value = pointToInput(point);
  hideSuggestions(kind);
  resetRouteAfterLocationEdit();
}

function renderSuggestions(kind, places) {
  const { input, list } = suggestionElements(kind);

  if (!places.length) {
    showSuggestionMessage(kind, "No Grab Places suggestions found.");
    return;
  }

  list.replaceChildren(
    ...places.slice(0, 5).map((place, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "suggestion-item";
      item.setAttribute("role", "option");
      item.id = `${kind}Suggestion${index}`;

      const name = document.createElement("strong");
      name.textContent = pointName(place);

      const address = document.createElement("small");
      address.textContent = pointDetail(place);

      item.append(name, address);
      item.addEventListener("pointerdown", (event) => {
        event.preventDefault();
      });
      item.addEventListener("click", () => applySuggestion(kind, place));
      return item;
    })
  );

  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

async function fetchSuggestions(query) {
  const url = new URL("/api/suggest", window.location.origin);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "5");

  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Suggestions failed with status ${response.status}`);
  }

  return payload.places || [];
}

function queueSuggestions(kind) {
  const { input } = suggestionElements(kind);
  const query = input.value.trim();
  const requestId = (state.suggestionRequestId[kind] += 1);

  window.clearTimeout(suggestionTimers[kind]);

  if (query.length < 2 || parseCoordinates(query)) {
    hideSuggestions(kind);
    return;
  }

  suggestionTimers[kind] = window.setTimeout(async () => {
    showSuggestionMessage(kind, "Searching Grab Places...");

    try {
      const places = await fetchSuggestions(query);
      if (requestId !== state.suggestionRequestId[kind]) {
        return;
      }

      renderSuggestions(kind, places);
    } catch (error) {
      if (requestId !== state.suggestionRequestId[kind]) {
        return;
      }

      showSuggestionMessage(kind, error.message || "Suggestions unavailable.");
    }
  }, 220);
}

function update67Panel() {
  if (!elements.list67) {
    return;
  }

  elements.list67.replaceChildren(
    ...state.stops67.map((stop, index) => {
      const item = document.createElement("li");
      const distance = Number.isFinite(stop.distanceFromRouteMeters)
        ? ` (${Math.round(stop.distanceFromRouteMeters)} m from route)`
        : "";

      const badge = document.createElement("span");
      badge.className = "stop-index";
      badge.textContent = `67-${index + 1}`;

      const copy = document.createElement("span");
      copy.className = "stop-copy";

      const name = document.createElement("strong");
      name.textContent = pointName(stop);

      const address = document.createElement("small");
      address.textContent = `${pointDetail(stop) || pointName(stop)}${distance}`;

      copy.append(name, address);
      item.append(badge, copy);
      return item;
    })
  );

  if (!state.include67) {
    set67Status("Off");
    return;
  }

  if (state.stops67.length) {
    set67Status(
      `${state.stops67.length} matching 67 stop${state.stops67.length === 1 ? "" : "s"} inside ${formatRadius(
        state.radius67Km
      )}`
    );
    return;
  }

  set67Status(`On. No 67 stops selected yet inside ${formatRadius(state.radius67Km)}.`);
}

function updateRouteStopsList() {
  if (!elements.routeStopsList) {
    return;
  }

  const stops = [
    { type: "Start", point: state.start },
    ...state.stops67.map((stop, index) => ({ type: `67 stop ${index + 1}`, point: stop })),
    { type: "End", point: state.end }
  ];

  elements.routeStopsList.replaceChildren(
    ...stops.map(({ type, point }) => {
      const item = document.createElement("li");

      const badge = document.createElement("span");
      badge.className = "route-stop-badge";
      badge.textContent = type;

      const copy = document.createElement("span");
      copy.className = "route-stop-copy";

      const name = document.createElement("strong");
      name.textContent = pointName(point);

      const address = document.createElement("small");
      address.textContent = pointDetail(point) || "Address pending from Grab Places";

      copy.append(name, address);
      item.append(badge, copy);
      return item;
    })
  );
}

function updateMapRouteCard() {
  if (!elements.mapRouteCard) {
    return;
  }

  const hasPoints = state.start && state.end;
  elements.mapRouteCard.hidden = !hasPoints;

  if (!hasPoints) {
    return;
  }

  elements.mapRouteTitle.textContent = `${state.start.label} to ${state.end.label}`;
  const stopCopy = state.stops67.length
    ? ` | ${state.stops67.length} x 67 stop${state.stops67.length === 1 ? "" : "s"}`
    : "";
  elements.mapRouteMeta.textContent = state.route
    ? `${formatProfile(state.route.profile)} | ${formatDistance(state.route.distance)} | ${formatDuration(
        state.route.duration
      )}${stopCopy}`
    : "Pins ready. Press Route to calculate the full path.";
}

function revealMapOnSmallScreens() {
  if (!window.matchMedia("(max-width: 820px)").matches || !elements.mapStage) {
    return;
  }

  elements.mapStage.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
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

function normalizeLocationInput(value) {
  return value.trim().toLowerCase();
}

function knownPointForInput(value) {
  const normalized = normalizeLocationInput(value);
  const knownPoints = [state.start, state.end, config.defaults.start, config.defaults.end];

  return knownPoints.find((point) => {
    if (!point) {
      return false;
    }

    return [point.label, point.address, pointToInput(point)]
      .filter(Boolean)
      .some((candidate) => normalizeLocationInput(candidate) === normalized);
  });
}

async function geocode(value) {
  const coordinatePoint = parseCoordinates(value);
  if (coordinatePoint) {
    return coordinatePoint;
  }

  const knownPoint = knownPointForInput(value);
  const url = new URL("/api/geocode", window.location.origin);
  url.searchParams.set("q", value);

  const response = await fetch(url);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (knownPoint) {
      return knownPoint;
    }

    throw new Error(payload.error || `Geocoding failed with status ${response.status}`);
  }

  const resolvedPoint = await response.json();
  return {
    ...(knownPoint || {}),
    ...resolvedPoint,
    label: resolvedPoint.label || (knownPoint && knownPoint.label) || value,
    address: resolvedPoint.address || (knownPoint && knownPoint.address) || ""
  };
}

async function fetchRoute(start, end, waypoints = []) {
  const url = new URL("/api/route", window.location.origin);
  url.searchParams.set("startLat", start.lat);
  url.searchParams.set("startLng", start.lng);
  url.searchParams.set("endLat", end.lat);
  url.searchParams.set("endLng", end.lng);
  url.searchParams.set("profile", state.profile);
  if (waypoints.length) {
    url.searchParams.set("waypoints", JSON.stringify(waypoints));
  }

  const response = await fetch(url);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Routing failed with status ${response.status}`);
  }

  return response.json();
}

async function fetch67Stops(route, radiusKm) {
  const response = await fetch("/api/search-67", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      route: route.geometry,
      radiusKm
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `67 search failed with status ${response.status}`);
  }

  return payload.places || [];
}

function loadGrabMapsLibrary() {
  if (window.GrabMaps) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const script = document.createElement("script");
    let settled = false;

    function finish(value) {
      if (settled) {
        return;
      }

      settled = true;
      resolve(value);
    }

    script.type = "module";
    script.src = "/grabmaps-loader.js";
    script.onload = () => window.setTimeout(() => finish(Boolean(window.GrabMaps)), 0);
    script.onerror = () => finish(false);
    document.head.appendChild(script);
    window.setTimeout(() => finish(Boolean(window.GrabMaps)), 4500);
  });
}

function getMapLibreFromGrabMapsMap(map) {
  if (!map) {
    return null;
  }

  if (typeof map.addSource === "function" && typeof map.addLayer === "function") {
    return map;
  }

  if (typeof map.getMap === "function") {
    return getMapLibreFromGrabMapsMap(map.getMap());
  }

  if (map.map) {
    return getMapLibreFromGrabMapsMap(map.map);
  }

  return null;
}

function setLayerVisibility(map, id, visibility = "visible") {
  if (map.getLayer(id)) {
    map.setLayoutProperty(id, "visibility", visibility);
  }
}

function setPaint(map, id, property, value) {
  if (map.getLayer(id)) {
    map.setPaintProperty(id, property, value);
  }
}

function firstSymbolLayerId(map) {
  const symbolLayer = map.getStyle().layers.find((layer) => layer.type === "symbol");
  return symbolLayer ? symbolLayer.id : undefined;
}

function addLayerIfMissing(map, layer, beforeId) {
  if (!map.getLayer(layer.id)) {
    map.addLayer(layer, beforeId);
  }
}

function addDirectGrabBaseLayers(map) {
  if (!map.getSource("grabmaptiles")) {
    return;
  }

  const beforeId = firstSymbolLayerId(map);

  addLayerIfMissing(
    map,
    {
      id: "grab-visible-landuse",
      type: "fill",
      source: "grabmaptiles",
      "source-layer": "landuse",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": "#edf4f1",
        "fill-opacity": 0.42
      }
    },
    beforeId
  );

  addLayerIfMissing(
    map,
    {
      id: "grab-visible-park",
      type: "fill",
      source: "grabmaptiles",
      "source-layer": "park",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": "#d6ead9",
        "fill-opacity": 0.58
      }
    },
    beforeId
  );

  addLayerIfMissing(
    map,
    {
      id: "grab-visible-water",
      type: "fill",
      source: "grabmaptiles",
      "source-layer": "water",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": "#a8dbf2",
        "fill-opacity": 0.92
      }
    },
    beforeId
  );

  addLayerIfMissing(
    map,
    {
      id: "grab-visible-road-casing",
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
        "line-opacity": 0.86,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.1, 13, 2.3, 16, 6.5]
      }
    },
    beforeId
  );

  addLayerIfMissing(
    map,
    {
      id: "grab-visible-road",
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
        "line-opacity": 0.78,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.55, 13, 1.35, 16, 4.6]
      }
    },
    beforeId
  );

  addLayerIfMissing(
    map,
    {
      id: "grab-visible-buildings",
      type: "fill",
      source: "grabmaptiles",
      "source-layer": "building",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": "#e2e9e5",
        "fill-outline-color": "#c8d1cc",
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.08, 16, 0.58]
      }
    },
    beforeId
  );
}

function tuneGrabBaseStyle(map) {
  addDirectGrabBaseLayers(map);
  setPaint(map, "background", "background-color", "#edf4f1");

  ["water", "water-depth"].forEach((id) => {
    setPaint(map, id, "fill-color", "#a8dbf2");
    setPaint(map, id, "fill-opacity", 0.95);
  });

  [
    "park",
    "landcover-wood",
    "landcover-wetland",
    "landcover-grass",
    "landcover-golf",
    "landcover-grass-park"
  ].forEach((id) => {
    setPaint(map, id, "fill-color", "#d6ead9");
    setPaint(map, id, "fill-opacity", 0.78);
  });

  ["landuse-residential", "landuse-commercial"].forEach((id) => {
    setLayerVisibility(map, id);
    setPaint(map, id, "fill-color", "#f0f5f2");
    setPaint(map, id, "fill-opacity", 0.46);
  });

  map.getStyle().layers
    .filter((layer) => layer.source === "grabmaptiles" && layer["source-layer"] === "transportation")
    .forEach((layer) => {
      if (layer.type !== "line") {
        return;
      }

      if (layer.id.includes("casing")) {
        setPaint(map, layer.id, "line-color", "#ffffff");
        setPaint(map, layer.id, "line-opacity", 0.82);
        return;
      }

      if (layer.id.includes("motorway") || layer.id.includes("trunk") || layer.id.includes("primary")) {
        setPaint(map, layer.id, "line-color", "#95a39c");
        setPaint(map, layer.id, "line-opacity", 0.84);
        return;
      }

      if (layer.id.includes("secondary") || layer.id.includes("tertiary") || layer.id.includes("minor")) {
        setPaint(map, layer.id, "line-color", "#b8c3bd");
        setPaint(map, layer.id, "line-opacity", 0.72);
      }
    });

  ["building", "building-top"].forEach((id) => {
    setPaint(map, id, "fill-color", id === "building-top" ? "#f8faf8" : "#e1e7e4");
    setPaint(map, id, "fill-opacity", 0.62);
  });
}

async function initializeGrabMapsLibraryMap() {
  if (!elements.grabMap || !config.grab.browserApiKey) {
    return false;
  }

  try {
    const loaded = await loadGrabMapsLibrary();
    const GrabMaps = window.GrabMaps;

    if (!loaded || !GrabMaps) {
      return false;
    }

    const GrabMapsBuilder = GrabMaps.GrabMapsBuilder || window.GrabMapsBuilder;
    const MapBuilder = GrabMaps.MapBuilder || window.MapBuilder;

    if (!GrabMapsBuilder || !MapBuilder) {
      return false;
    }

    state.grabMapsClient = new GrabMapsBuilder()
      .setBaseUrl(config.grab.apiBaseUrl)
      .setApiKey(config.grab.browserApiKey)
      .build();

    const grabMapsMap = new MapBuilder(state.grabMapsClient)
      .setContainer("grabMap")
      .setCenter([state.start.lng, state.start.lat])
      .setZoom(12)
      .enableNavigation()
      .enableLabels()
      .enableBuildings()
      .enableAttribution()
      .build();

    state.maplibre = getMapLibreFromGrabMapsMap(grabMapsMap);

    if (!state.maplibre) {
      if (grabMapsMap && typeof grabMapsMap.remove === "function") {
        grabMapsMap.remove();
      } else {
        elements.grabMap.replaceChildren();
      }

      state.grabMapsClient = null;
      setStatus("GrabMaps library loaded without route-layer access. Falling back to Grab style map.");
      return false;
    }

    if (typeof state.maplibre.once === "function") {
      await new Promise((resolve) => {
        if (state.maplibre.loaded && state.maplibre.loaded()) {
          resolve();
          return;
        }

        state.maplibre.once("load", resolve);
        window.setTimeout(resolve, 3500);
      });
    }

    state.maplibreReady = true;
    elements.map.classList.add("using-grab-style");
    tuneGrabBaseStyle(state.maplibre);
    setStatus("GrabMaps library ready");
    return true;
  } catch (error) {
    state.grabMapsClient = null;
    state.maplibre = null;
    state.maplibreReady = false;
    return false;
  }
}

async function initializeGrabStyleMap() {
  if (!config.grab.hasApiKey || !window.maplibregl || !elements.grabMap) {
    return false;
  }

  try {
    const response = await fetch("/api/map-style");
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Grab map style could not load");
    }

    const style = await response.json();
    if (state.maplibre && typeof state.maplibre.remove === "function") {
      state.maplibre.remove();
    }
    elements.grabMap.replaceChildren();

    state.maplibre = new window.maplibregl.Map({
      container: elements.grabMap,
      style,
      center: [state.start.lng, state.start.lat],
      zoom: 12,
      attributionControl: true
    });
    state.maplibre.addControl(new window.maplibregl.NavigationControl(), "top-right");
    state.maplibre.on("error", (event) => {
      const message = event && event.error && event.error.message;
      if (message) {
        console.warn("Map render warning:", message);
      }
    });

    await new Promise((resolve) => {
      if (state.maplibre.loaded && state.maplibre.loaded()) {
        resolve();
        return;
      }

      state.maplibre.once("load", resolve);
      window.setTimeout(resolve, 3500);
    });

    state.maplibreReady = true;
    elements.map.classList.add("using-grab-style");
    try {
      tuneGrabBaseStyle(state.maplibre);
    } catch (error) {
      console.warn("Grab style tuning skipped:", error.message || error);
    }
    setStatus("Grab map style ready via MapLibre");
    return true;
  } catch (error) {
    state.maplibre = null;
    state.maplibreReady = false;
    elements.map.classList.remove("using-grab-style");
    setStatus("Grab map style failed to load", true);
    return false;
  }
}

function renderMapLibre() {
  if (!state.maplibre || !state.maplibreReady) {
    return false;
  }

  state.maplibre.resize();

  const coordinates = state.route
    ? state.route.geometry.coordinates
    : [
        [state.start.lng, state.start.lat],
        [state.end.lng, state.end.lat]
      ];
  const data = {
    type: "FeatureCollection",
    features: state.route
      ? [
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates
            },
            properties: {}
          }
        ]
      : []
  };

  if (state.maplibre.getSource("route")) {
    state.maplibre.getSource("route").setData(data);
  } else {
    state.maplibre.addSource("route", { type: "geojson", data });
  }

  if (!state.maplibre.getLayer("route-line-casing")) {
    state.maplibre.addLayer({
      id: "route-line-casing",
      type: "line",
      source: "route",
      paint: {
        "line-color": "#ffffff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 9, 15, 16],
        "line-opacity": 0.92
      },
      layout: {
        "line-cap": "round",
        "line-join": "round"
      }
    });
  }

  if (!state.maplibre.getLayer("route-line")) {
    state.maplibre.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      paint: {
        "line-color": "#0b63ff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 5, 15, 10],
        "line-opacity": 0.98
      },
      layout: {
        "line-cap": "round",
        "line-join": "round"
      }
    });
  }

  const stopFeatures = state.stops67.map((stop, index) => ({
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: routeWaypointLngLat(index + 1, stop)
    },
    properties: {
      label: pointName(stop),
      number: String(index + 1)
    }
  }));
  ["route-stop-labels", "route-stop-numbers", "route-stop-dots"].forEach((layerId) => {
    if (state.maplibre.getLayer(layerId)) {
      state.maplibre.removeLayer(layerId);
    }
  });
  if (state.maplibre.getSource("route-stops")) {
    state.maplibre.removeSource("route-stops");
  }

  state.mapMarkers.forEach((marker) => marker.remove());
  const startLngLat = routeWaypointLngLat(0, state.start);
  const endLngLat = routeWaypointLngLat(state.stops67.length + 1, state.end);
  const stopMarkers = state.stops67.map((stop, index) =>
    new window.maplibregl.Marker({
      element: markerElement("stop67", stop, { badge: String(index + 1) }),
      anchor: "center"
    })
      .setLngLat(stopFeatures[index].geometry.coordinates)
      .addTo(state.maplibre)
  );

  state.mapMarkers = [
    new window.maplibregl.Marker({
      element: markerElement("start", state.start),
      anchor: "center"
    })
      .setLngLat(startLngLat)
      .addTo(state.maplibre),
    ...stopMarkers,
    new window.maplibregl.Marker({
      element: markerElement("end", state.end),
      anchor: "center"
    })
      .setLngLat(endLngLat)
      .addTo(state.maplibre)
  ];

  const bounds = new window.maplibregl.LngLatBounds();
  [
    ...coordinates,
    startLngLat,
    endLngLat,
    ...stopFeatures.map((feature) => feature.geometry.coordinates)
  ].forEach(
    (coordinate) => bounds.extend(coordinate)
  );
  state.maplibre.fitBounds(bounds, {
    padding: window.matchMedia("(max-width: 820px)").matches
      ? { top: 92, right: 42, bottom: 92, left: 42 }
      : { top: 92, right: 92, bottom: 92, left: 92 },
    duration: 450,
    maxZoom: state.route ? 15 : 13
  });

  return true;
}

function renderMap() {
  if (renderMapLibre()) {
    return;
  }

  elements.routeLayer.replaceChildren();
  elements.markerLayer.replaceChildren();
}

function updateSummary() {
  elements.distanceValue.textContent = state.route ? formatDistance(state.route.distance) : "-";
  elements.durationValue.textContent = state.route ? formatDuration(state.route.duration) : "-";
  elements.startValue.textContent = pointName(state.start);
  elements.startAddressValue.textContent = pointDetail(state.start) || "-";
  elements.endValue.textContent = pointName(state.end);
  elements.endAddressValue.textContent = pointDetail(state.end) || "-";
  updateMapRouteCard();
  update67Panel();
  updateRouteStopsList();
}

async function resolveInputLocations() {
  return Promise.all([
    geocode(elements.startInput.value),
    geocode(elements.endInput.value)
  ]);
}

function applyResolvedLocations(start, end) {
  state.start = start;
  state.end = end;
  elements.startInput.value = pointToInput(start);
  elements.endInput.value = pointToInput(end);
}

async function apply67Route(baseRoute, { keepMainStatus = false } = {}) {
  const requestId = (state.enrichmentRequestId += 1);

  if (!state.include67) {
    state.stops67 = [];
    state.route = baseRoute;
    updateSummary();
    renderMap();
    return true;
  }

  state.route = baseRoute;
  state.stops67 = [];
  updateSummary();
  renderMap();
  set67Status(`Searching for 67 addresses inside ${formatRadius(state.radius67Km)}`);

  try {
    const stops = await fetch67Stops(baseRoute, state.radius67Km);
    if (requestId !== state.enrichmentRequestId) {
      return false;
    }

    state.stops67 = stops;
    if (!stops.length) {
      state.route = baseRoute;
      updateSummary();
      renderMap();
      set67Status(`No 67 addresses found inside ${formatRadius(state.radius67Km)}.`);
      return true;
    }

    set67Status(`Routing through ${stops.length} matching 67 stop${stops.length === 1 ? "" : "s"}`);
    state.route = await fetchRoute(state.start, state.end, stops);
    if (requestId !== state.enrichmentRequestId) {
      return false;
    }

    updateSummary();
    renderMap();
    return true;
  } catch (error) {
    if (requestId !== state.enrichmentRequestId) {
      return false;
    }

    state.stops67 = [];
    state.route = baseRoute;
    updateSummary();
    renderMap();
    set67Status(`67 search unavailable: ${error.message}`, true);
    if (!keepMainStatus) {
      setStatus(`Route ready. 67 search unavailable: ${error.message}`, true);
    }

    return false;
  }
}

async function previewInputLocations({ revealMap = false, quiet = false } = {}) {
  if (!elements.startInput.value.trim() || !elements.endInput.value.trim()) {
    return false;
  }

  const requestId = (state.previewRequestId += 1);

  if (!quiet) {
    setStatus("Pinning locations on the map");
  }

  try {
    const [start, end] = await resolveInputLocations();
    if (requestId !== state.previewRequestId) {
      return false;
    }

    applyResolvedLocations(start, end);
    state.baseRoute = null;
    state.route = null;
    state.stops67 = [];
    updateSummary();
    renderMap();

    if (revealMap) {
      revealMapOnSmallScreens();
    }

    if (!quiet) {
      setStatus("Locations pinned. Press Route to calculate ETA and path.");
    }

    return true;
  } catch (error) {
    if (!quiet) {
      setStatus(error.message || "Could not pin those locations", true);
    }

    return false;
  }
}

async function calculateRoute({ revealMap = false } = {}) {
  elements.routeButton.disabled = true;
  state.previewRequestId += 1;
  state.enrichmentRequestId += 1;
  setStatus("Pinning locations on the map");

  try {
    const [start, end] = await resolveInputLocations();
    applyResolvedLocations(start, end);
    state.baseRoute = null;
    state.route = null;
    state.stops67 = [];
    updateSummary();
    renderMap();

    if (revealMap) {
      revealMapOnSmallScreens();
    }

    setStatus("Calculating route");
    const route = await fetchRoute(start, end);
    state.baseRoute = route;
    state.route = route;

    updateSummary();
    renderMap();

    if (state.include67) {
      await apply67Route(route, { keepMainStatus: true });
    }

    if (revealMap) {
      revealMapOnSmallScreens();
    }

    setStatus(
      state.stops67.length
        ? `${formatProfile(route.profile)} route ready via ${route.provider || config.routing.providerLabel} with ${
            state.stops67.length
          } 67 stop${state.stops67.length === 1 ? "" : "s"}`
        : `${formatProfile(route.profile)} route ready via ${route.provider || config.routing.providerLabel}`
    );
  } catch (error) {
    setStatus(error.message || "Could not calculate route", true);
  } finally {
    elements.routeButton.disabled = false;
  }
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  calculateRoute({ revealMap: true });
});

elements.swapButton.addEventListener("click", () => {
  const currentStart = elements.startInput.value;
  elements.startInput.value = elements.endInput.value;
  elements.endInput.value = currentStart;
  [state.start, state.end] = [state.end, state.start];
  hideSuggestions("start");
  hideSuggestions("end");
  state.baseRoute = null;
  state.route = null;
  state.stops67 = [];
  updateSummary();
  renderMap();
  revealMapOnSmallScreens();
});

elements.include67Toggle.addEventListener("change", async () => {
  state.include67 = elements.include67Toggle.checked;

  if (!state.include67) {
    state.enrichmentRequestId += 1;
    state.stops67 = [];
    state.route = state.baseRoute || state.route;
    updateSummary();
    renderMap();
    set67Status("Off");
    return;
  }

  if (!state.baseRoute) {
    updateSummary();
    set67Status("On. Generate a route to search for 67 addresses.");
    return;
  }

  const applied = await apply67Route(state.baseRoute);
  if (applied) {
    setStatus(`${formatProfile()} route ready via ${config.routing.providerLabel}`);
  }
});

elements.radius67Input.addEventListener("change", async () => {
  const radius = Number(elements.radius67Input.value);
  state.radius67Km = Number.isFinite(radius) ? Math.min(Math.max(radius, 0.1), 5) : 0.8;
  elements.radius67Input.value = state.radius67Km;

  if (!state.include67 || !state.baseRoute) {
    updateSummary();
    return;
  }

  await apply67Route(state.baseRoute);
});

elements.profileSelect.addEventListener("change", () => {
  state.profile = elements.profileSelect.value === "walking" ? "walking" : "driving";
  calculateRoute({ revealMap: false });
});

elements.startInput.addEventListener("change", () => {
  hideSuggestions("start");
  previewInputLocations({ quiet: true });
});

elements.endInput.addEventListener("change", () => {
  hideSuggestions("end");
  previewInputLocations({ quiet: true });
});

function setupSuggestionInput(kind) {
  const { input } = suggestionElements(kind);

  input.addEventListener("input", () => {
    queueSuggestions(kind);
  });

  input.addEventListener("focus", () => {
    queueSuggestions(kind);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideSuggestions(kind);
    }
  });

  input.addEventListener("blur", () => {
    window.setTimeout(() => hideSuggestions(kind), 140);
  });
}

setupSuggestionInput("start");
setupSuggestionInput("end");

window.addEventListener("resize", renderMap);

if ("ResizeObserver" in window) {
  new ResizeObserver(renderMap).observe(elements.map);
}

async function boot() {
  updateSummary();
  renderMap();
  const initializedWithLibrary = await initializeGrabMapsLibraryMap();
  if (!initializedWithLibrary) {
    await initializeGrabStyleMap();
  }
  renderMap();
  calculateRoute({ revealMap: true });
}

boot();
