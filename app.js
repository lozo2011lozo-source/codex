const API = {
  stationSearch: "https://www.mvg.de/api/fib/v2/location",
  departures: "https://www.mvg.de/api/fib/v2/departure"
};

const FILTERS = [
  { key: "SUBWAY", label: "U-Bahn", aliases: ["ubahn", "subway", "u"] },
  { key: "TRAM", label: "Tram", aliases: ["tram"] },
  { key: "SBAHN", label: "S-Bahn", aliases: ["sbahn", "s-bahn", "s"] },
  { key: "BUS", label: "Bus", aliases: ["bus"] },
  { key: "REGIONAL_BUS", label: "Regional", aliases: ["regional", "rb"] }
];

const state = {
  station: null,
  departures: [],
  activeFilters: new Set(FILTERS.map((f) => f.key)),
  autoRefresh: true,
  refreshTimer: null,
  favorites: JSON.parse(localStorage.getItem("mtp:favorites") || "[]")
};

const el = {
  stationInput: document.getElementById("stationInput"),
  stationSuggestions: document.getElementById("stationSuggestions"),
  loadDepartures: document.getElementById("loadDepartures"),
  filterGroup: document.getElementById("filterGroup"),
  departures: document.getElementById("departures"),
  statusText: document.getElementById("statusText"),
  autoRefresh: document.getElementById("autoRefresh"),
  lastUpdated: document.getElementById("lastUpdated"),
  saveFavorite: document.getElementById("saveFavorite"),
  favorites: document.getElementById("favorites"),
  themeToggle: document.getElementById("themeToggle"),
  cardTemplate: document.getElementById("departureCardTemplate")
};

function init() {
  renderFilters();
  renderFavorites();
  bindEvents();
  loadTheme();
}

function bindEvents() {
  let stationDebounce;
  el.stationInput.addEventListener("input", () => {
    clearTimeout(stationDebounce);
    stationDebounce = setTimeout(searchStations, 250);
  });

  el.loadDepartures.addEventListener("click", async () => {
    const match = [...el.stationSuggestions.options].find((opt) => opt.value === el.stationInput.value);
    if (!match?.dataset.globalId) {
      setStatus("Please choose a station from suggestions.");
      return;
    }
    state.station = { name: match.value, globalId: match.dataset.globalId };
    await loadDepartures();
  });

  el.autoRefresh.addEventListener("change", () => {
    state.autoRefresh = el.autoRefresh.checked;
    setupRefreshTimer();
  });

  el.saveFavorite.addEventListener("click", () => {
    if (!state.station) return setStatus("Load a station first to save it.");
    if (!state.favorites.find((f) => f.globalId === state.station.globalId)) {
      state.favorites.push(state.station);
      localStorage.setItem("mtp:favorites", JSON.stringify(state.favorites));
      renderFavorites();
      setStatus(`Saved ${state.station.name} to favorites.`);
    }
  });

  el.favorites.addEventListener("change", async () => {
    const picked = state.favorites.find((f) => f.globalId === el.favorites.value);
    if (!picked) return;
    state.station = picked;
    el.stationInput.value = picked.name;
    await loadDepartures();
  });

  el.themeToggle.addEventListener("click", () => {
    document.body.classList.toggle("dark");
    const dark = document.body.classList.contains("dark");
    localStorage.setItem("mtp:dark", String(dark));
    el.themeToggle.textContent = dark ? "☀️" : "🌙";
  });
}

function loadTheme() {
  const dark = localStorage.getItem("mtp:dark") === "true";
  document.body.classList.toggle("dark", dark);
  el.themeToggle.textContent = dark ? "☀️" : "🌙";
}

function renderFavorites() {
  const options = ['<option value="">Favorites</option>'];
  for (const favorite of state.favorites) {
    options.push(`<option value="${favorite.globalId}">${favorite.name}</option>`);
  }
  el.favorites.innerHTML = options.join("");
}

function renderFilters() {
  el.filterGroup.innerHTML = "";
  FILTERS.forEach((filter) => {
    const chip = document.createElement("button");
    chip.className = "chip active";
    chip.type = "button";
    chip.textContent = filter.label;
    chip.dataset.key = filter.key;
    chip.addEventListener("click", () => {
      if (state.activeFilters.has(filter.key)) {
        state.activeFilters.delete(filter.key);
        chip.classList.remove("active");
      } else {
        state.activeFilters.add(filter.key);
        chip.classList.add("active");
      }
      renderDepartures();
    });
    el.filterGroup.appendChild(chip);
  });
}

async function searchStations() {
  const query = el.stationInput.value.trim();
  if (query.length < 2) return;

  try {
    const res = await fetch(`${API.stationSearch}?query=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`station search failed (${res.status})`);
    const data = await res.json();
    const stations = Array.isArray(data) ? data.filter((item) => item.type === "STATION") : [];
    fillStationSuggestions(stations.slice(0, 12));
  } catch (error) {
    fillStationSuggestions(getFallbackStations(query));
    setStatus("Live station search unavailable. Using built-in Munich stations.");
  }
}

function fillStationSuggestions(stations) {
  el.stationSuggestions.innerHTML = "";
  stations.forEach((station) => {
    const option = document.createElement("option");
    option.value = station.name;
    option.dataset.globalId = station.globalId;
    el.stationSuggestions.appendChild(option);
  });
}

async function loadDepartures() {
  if (!state.station?.globalId) return;

  setStatus(`Loading departures for ${state.station.name}...`);
  try {
    const res = await fetch(`${API.departures}?globalId=${encodeURIComponent(state.station.globalId)}`);
    if (!res.ok) throw new Error(`departure fetch failed (${res.status})`);
    const data = await res.json();
    state.departures = Array.isArray(data) ? data : [];
    setStatus(`Showing ${state.departures.length} departures from ${state.station.name}.`);
  } catch (error) {
    state.departures = fallbackDepartures(state.station.name);
    setStatus(`Live departures unavailable; showing demo data for ${state.station.name}.`);
  }

  el.lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  renderDepartures();
  setupRefreshTimer();
}

function renderDepartures() {
  const filtered = state.departures
    .filter((dep) => state.activeFilters.has(normalizeTransportType(dep.transportType)))
    .sort((a, b) => etaMinutes(a) - etaMinutes(b));

  if (!filtered.length) {
    el.departures.classList.add("empty");
    el.departures.innerHTML = "<p>No departures match the selected filters.</p>";
    return;
  }

  el.departures.classList.remove("empty");
  el.departures.innerHTML = "";
  filtered.forEach((dep) => {
    const node = el.cardTemplate.content.cloneNode(true);
    const card = node.querySelector(".departure-card");
    const lineChip = node.querySelector(".line-chip");
    const title = node.querySelector("h3");
    const destination = node.querySelector(".destination");
    const platform = node.querySelector(".platform");
    const eta = node.querySelector(".eta");

    const transport = normalizeTransportType(dep.transportType);
    lineChip.textContent = dep.label || dep.line || "?";
    lineChip.style.backgroundColor = colorForType(transport);
    title.textContent = FILTERS.find((f) => f.key === transport)?.label || dep.transportType;
    destination.textContent = `→ ${dep.destination || "Unknown destination"}`;
    platform.textContent = dep.platform ? `Platform ${dep.platform}` : "Platform info unavailable";
    eta.textContent = formatEta(dep);
    card.title = `${title.textContent} to ${dep.destination}`;

    el.departures.appendChild(node);
  });
}

function formatEta(dep) {
  const eta = etaMinutes(dep);
  if (eta <= 0) return "Now";
  return `${eta} min`;
}

function etaMinutes(dep) {
  const when = dep.realtimeDepartureTime || dep.departureTime;
  return Math.round((new Date(when).getTime() - Date.now()) / 60000);
}

function normalizeTransportType(type = "") {
  const lower = type.toLowerCase();
  const hit = FILTERS.find((f) => f.aliases.some((alias) => lower.includes(alias)));
  return hit?.key || "BUS";
}

function colorForType(type) {
  return {
    SUBWAY: "#2766d8",
    TRAM: "#f04e36",
    SBAHN: "#0a8a49",
    BUS: "#8242d6",
    REGIONAL_BUS: "#c17f00"
  }[type] || "#444";
}

function setupRefreshTimer() {
  clearInterval(state.refreshTimer);
  if (!state.autoRefresh || !state.station) return;
  state.refreshTimer = setInterval(loadDepartures, 30000);
}

function setStatus(text) {
  el.statusText.textContent = text;
}

function getFallbackStations(query) {
  const stations = [
    { name: "Marienplatz", globalId: "de:09162:6" },
    { name: "Hauptbahnhof", globalId: "de:09162:70" },
    { name: "Münchner Freiheit", globalId: "de:09162:415" },
    { name: "Sendlinger Tor", globalId: "de:09162:573" },
    { name: "Ostbahnhof", globalId: "de:09162:460" }
  ];
  return stations.filter((station) => station.name.toLowerCase().includes(query.toLowerCase()));
}

function fallbackDepartures(stationName) {
  const now = Date.now();
  return [
    { line: "U3", label: "U3", destination: "Moosach", transportType: "SUBWAY", platform: "1", realtimeDepartureTime: new Date(now + 2 * 60000).toISOString() },
    { line: "S8", label: "S8", destination: "Flughafen", transportType: "SBAHN", platform: "2", realtimeDepartureTime: new Date(now + 5 * 60000).toISOString() },
    { line: "19", label: "19", destination: "Pasing", transportType: "TRAM", platform: "A", realtimeDepartureTime: new Date(now + 7 * 60000).toISOString() },
    { line: "58", label: "58", destination: "Silberhornstraße", transportType: "BUS", platform: "B", realtimeDepartureTime: new Date(now + 11 * 60000).toISOString() }
  ].map((dep) => ({ ...dep, destination: `${dep.destination} (${stationName})` }));
}

init();
