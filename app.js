(function() {
  'use strict';

  // ==================== CONFIG ====================
  var CONFIG = {
    appName: 'Weather',
    storageKey: 'mdg_weather',
    api: {
      forecastUrl: 'https://api.open-meteo.com/v1/forecast',
      cacheDuration: 10 * 60 * 1000, // 10 min
    },
  };

  // Preset cities (Open-Meteo needs lat/lon, no key required)
  var CITIES = [
    { name: 'New York',    region: 'US', lat: 40.7128, lon: -74.0060 },
    { name: 'San Francisco', region: 'US', lat: 37.7749, lon: -122.4194 },
    { name: 'London',      region: 'UK', lat: 51.5074, lon: -0.1278 },
    { name: 'Paris',       region: 'FR', lat: 48.8566, lon: 2.3522 },
    { name: 'Tokyo',       region: 'JP', lat: 35.6762, lon: 139.6503 },
    { name: 'Sydney',      region: 'AU', lat: -33.8688, lon: 151.2093 },
    { name: 'Mumbai',      region: 'IN', lat: 19.0760, lon: 72.8777 },
  ];

  // WMO weather code -> icon + label
  var WMO = {
    0:  ['☀️', 'Clear'],
    1:  ['🌤️', 'Mostly Clear'],
    2:  ['⛅', 'Partly Cloudy'],
    3:  ['☁️', 'Overcast'],
    45: ['🌫️', 'Fog'],
    48: ['🌫️', 'Rime Fog'],
    51: ['🌦️', 'Light Drizzle'],
    53: ['🌦️', 'Drizzle'],
    55: ['🌧️', 'Heavy Drizzle'],
    56: ['🌧️', 'Freezing Drizzle'],
    57: ['🌧️', 'Freezing Drizzle'],
    61: ['🌦️', 'Light Rain'],
    63: ['🌧️', 'Rain'],
    65: ['🌧️', 'Heavy Rain'],
    66: ['🌧️', 'Freezing Rain'],
    67: ['🌧️', 'Freezing Rain'],
    71: ['🌨️', 'Light Snow'],
    73: ['🌨️', 'Snow'],
    75: ['❄️', 'Heavy Snow'],
    77: ['🌨️', 'Snow Grains'],
    80: ['🌦️', 'Light Showers'],
    81: ['🌧️', 'Showers'],
    82: ['⛈️', 'Heavy Showers'],
    85: ['🌨️', 'Snow Showers'],
    86: ['❄️', 'Snow Showers'],
    95: ['⛈️', 'Thunderstorm'],
    96: ['⛈️', 'Thunderstorm'],
    99: ['⛈️', 'Severe Storm'],
  };

  function wmo(code) { return WMO[code] || ['☁️', 'Unknown']; }

  // Temperature / wind unit systems. Celsius is the default.
  var UNITS = {
    c: { temp: 'celsius',    wind: 'kmh', windLabel: 'km/h', letter: 'C' },
    f: { temp: 'fahrenheit', wind: 'mph', windLabel: 'mph',  letter: 'F' },
  };
  function activeUnit() { return UNITS[state.data.unit] || UNITS.c; }

  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // ==================== STATE ====================
  var state = {
    currentScreen: 'home',
    data: {
      location: CITIES[0], // { name, region, lat, lon }
      unit: 'c',           // 'c' (default) or 'f'
    },
    forecast: null,   // parsed { current, days: [...] }
    selectedDay: 0,
    cache: {},
  };

  // ==================== DOM REFS ====================
  var screens = {};

  function collectScreens() {
    document.querySelectorAll('.screen').forEach(function(s) {
      if (s.id) screens[s.id] = s;
    });
  }

  // ==================== NAVIGATION ====================
  // Meta delivers the back gesture as an Escape keydown, and its documented
  // pattern is history.back(). So screen changes are driven through the browser
  // History API: navigating forward pushes a history entry, the back gesture
  // pops it (via popstate), and at the root (home) back exhausts history so the
  // OS closes the app — exactly the native behavior.
  function showScreen(screenId) {
    if (!screens[screenId]) return;
    Object.values(screens).forEach(function(s) { s.classList.add('hidden'); });
    screens[screenId].classList.remove('hidden');
    state.currentScreen = screenId;
    onScreenEnter(screenId);
    focusFirst(screens[screenId]);
  }

  function navigateTo(screenId) {
    if (screenId === state.currentScreen) return;
    showScreen(screenId);
    history.pushState({ screen: screenId }, '');
  }

  function navigateBack() {
    history.back(); // fires popstate -> showScreen(previous); closes app at root
  }

  // ==================== FOCUS MANAGEMENT ====================
  function focusFirst(container) {
    var el = container.querySelector('.focusable:not([disabled]):not(.hidden)');
    if (el) el.focus();
  }

  function moveFocus(direction) {
    var container = screens[state.currentScreen];
    if (!container) return;

    var focusables = Array.from(
      container.querySelectorAll('.focusable:not([disabled]):not(.hidden)')
    );
    if (focusables.length === 0) return;

    var current = document.activeElement;
    var idx = focusables.indexOf(current);
    if (idx === -1) { focusFirst(container); return; }

    var nextIdx;
    if (direction === 'up' || direction === 'left') {
      nextIdx = idx > 0 ? idx - 1 : focusables.length - 1;
    } else {
      nextIdx = idx < focusables.length - 1 ? idx + 1 : 0;
    }
    focusables[nextIdx].focus();

    var scrollParent = focusables[nextIdx].closest('.content, .list-container');
    if (scrollParent) {
      focusables[nextIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // ==================== API LAYER ====================
  function apiGet(url, options) {
    options = options || {};
    var cacheKey = options.cacheKey || url;
    var cacheDuration = options.cacheDuration || CONFIG.api.cacheDuration;

    if (!options.noCache && state.cache[cacheKey]) {
      var cached = state.cache[cacheKey];
      if (Date.now() - cached.timestamp < cacheDuration) {
        return Promise.resolve(cached.data);
      }
    }

    return fetch(url)
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        state.cache[cacheKey] = { data: data, timestamp: Date.now() };
        return data;
      });
  }

  function loadForecast(force) {
    var loc = state.data.location;
    var u = activeUnit();
    var url = CONFIG.api.forecastUrl +
      '?latitude=' + loc.lat +
      '&longitude=' + loc.lon +
      '&current_weather=true' +
      '&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max' +
      '&temperature_unit=' + u.temp +
      '&wind_speed_unit=' + u.wind +
      '&timezone=auto' +
      '&forecast_days=5';

    setHomeState('loading');
    return apiGet(url, {
      cacheKey: 'wx_' + loc.lat + '_' + loc.lon + '_' + state.data.unit,
      noCache: !!force,
    })
      .then(function(data) {
        state.forecast = parseForecast(data);
        renderHome();
        renderForecastList();
        setHomeState('ready');
        return state.forecast;
      })
      .catch(function(err) {
        console.error('[Weather] load error:', err);
        setHomeState('error');
        showToast('Could not load weather', 'error');
      });
  }

  function parseForecast(data) {
    var d = data.daily;
    var days = [];
    for (var i = 0; i < d.time.length; i++) {
      var dt = new Date(d.time[i] + 'T00:00:00');
      days.push({
        date: d.time[i],
        label: i === 0 ? 'Today' : DAYS[dt.getDay()],
        code: d.weathercode[i],
        high: Math.round(d.temperature_2m_max[i]),
        low: Math.round(d.temperature_2m_min[i]),
        precip: d.precipitation_probability_max ? (d.precipitation_probability_max[i] || 0) : 0,
        wind: Math.round(d.wind_speed_10m_max[i]),
      });
    }
    return {
      current: {
        temp: Math.round(data.current_weather.temperature),
        code: data.current_weather.weathercode,
        wind: Math.round(data.current_weather.windspeed),
      },
      days: days,
    };
  }

  // ==================== RENDERING ====================
  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setHomeState(mode) {
    var loading = document.getElementById('home-loading');
    var error = document.getElementById('home-error');
    var current = document.getElementById('home-current');
    var status = document.getElementById('status-indicator');
    loading.classList.toggle('hidden', mode !== 'loading');
    error.classList.toggle('hidden', mode !== 'error');
    current.classList.toggle('hidden', mode !== 'ready');
    if (status) {
      status.textContent = mode === 'loading' ? 'Loading…' :
        mode === 'error' ? 'Offline' : 'Updated';
    }
  }

  function renderHome() {
    var loc = state.data.location;
    setText('home-location', loc.name);
    renderUnitToggle();
    if (!state.forecast) return;
    var u = activeUnit();
    var cur = state.forecast.current;
    var today = state.forecast.days[0];
    var info = wmo(cur.code);
    setText('cur-icon', info[0]);
    setText('cur-temp', cur.temp + '°' + u.letter);
    setText('cur-cond', info[1]);
    setText('cur-hilo', 'H ' + today.high + '°   L ' + today.low + '°');
    setText('cur-wind', '🌬️ ' + cur.wind + ' ' + u.windLabel);
  }

  function renderUnitToggle() {
    var unit = state.data.unit;
    var toggle = document.querySelector('.unit-toggle');
    if (!toggle) return;
    toggle.setAttribute('aria-checked', unit === 'f' ? 'true' : 'false');
    toggle.querySelectorAll('.unit-seg').forEach(function(seg) {
      seg.classList.toggle('active', seg.getAttribute('data-unit') === unit);
    });
  }

  function renderForecastList() {
    var container = document.getElementById('forecast-list');
    if (!container || !state.forecast) return;
    container.innerHTML = '';
    state.forecast.days.forEach(function(day, i) {
      var info = wmo(day.code);
      var btn = document.createElement('button');
      btn.className = 'day-row focusable';
      btn.setAttribute('data-action', 'open-day');
      btn.setAttribute('data-index', i);
      btn.innerHTML =
        '<span class="day-row-name">' + day.label + '</span>' +
        '<span class="day-row-icon">' + info[0] + '</span>' +
        '<span class="day-row-precip">' + (day.precip > 0 ? '💧 ' + day.precip + '%' : '') + '</span>' +
        '<span class="day-row-temps">' + day.high + '°<span class="lo">' + day.low + '°</span></span>';
      container.appendChild(btn);
    });
  }

  function renderDayDetail(index) {
    if (!state.forecast) return;
    var day = state.forecast.days[index];
    if (!day) return;
    var info = wmo(day.code);
    setText('detail-day', day.label);
    setText('detail-icon', info[0]);
    setText('detail-cond', info[1]);
    setText('detail-high', day.high + '°');
    setText('detail-low', day.low + '°');
    setText('detail-precip', day.precip + '%');
    setText('detail-wind', day.wind + ' ' + activeUnit().windLabel);
  }

  function renderCityList() {
    var container = document.getElementById('city-list');
    if (!container) return;
    container.innerHTML = '';
    CITIES.forEach(function(city, i) {
      var active = city.name === state.data.location.name;
      var btn = document.createElement('button');
      btn.className = 'list-item focusable' + (active ? ' active' : '');
      btn.setAttribute('data-action', 'pick-city');
      btn.setAttribute('data-index', i);
      btn.innerHTML =
        '<span class="list-item-icon">' + (active ? '✅' : '🌍') + '</span>' +
        '<span class="list-item-content">' +
          '<span class="list-item-title">' + city.name + '</span>' +
          '<span class="list-item-meta">' + city.region + '</span>' +
        '</span>';
      container.appendChild(btn);
    });
  }

  // ==================== UI HELPERS ====================
  function showToast(message, type) {
    var toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = 'toast' + (type ? ' ' + type : '');
    toast.offsetHeight;
    toast.classList.add('visible');
    setTimeout(function() { toast.classList.remove('visible'); }, 2500);
  }

  // ==================== GEOLOCATION ====================
  function useGps() {
    if (!navigator.geolocation) {
      showToast('GPS not available', 'error');
      return;
    }
    showToast('Locating…');
    navigator.geolocation.getCurrentPosition(
      function(pos) {
        state.data.location = {
          name: 'My Location',
          region: 'GPS',
          lat: +pos.coords.latitude.toFixed(4),
          lon: +pos.coords.longitude.toFixed(4),
        };
        saveData();
        renderCityList();
        navigateBack();     // location -> home
        loadForecast(true);
      },
      function() { showToast('Could not get location', 'error'); },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
    );
  }

  // ==================== DATA PERSISTENCE ====================
  function loadData() {
    try {
      var saved = localStorage.getItem(CONFIG.storageKey);
      if (saved) Object.assign(state.data, JSON.parse(saved));
    } catch (e) { console.error('[Storage] load:', e); }
  }

  function saveData() {
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(state.data));
    } catch (e) { console.error('[Storage] save:', e); }
  }

  // ==================== ACTION HANDLING ====================
  function handleAction(action, element) {
    switch (action) {
      case 'back':
        navigateBack();
        break;
      case 'refresh':
        loadForecast(true);
        break;
      case 'open-forecast':
        navigateTo('forecast');
        break;
      case 'open-location':
        navigateTo('location');
        break;
      case 'open-day':
        state.selectedDay = parseInt(element.getAttribute('data-index'), 10) || 0;
        renderDayDetail(state.selectedDay);
        navigateTo('detail');
        break;
      case 'pick-city':
        var ci = parseInt(element.getAttribute('data-index'), 10) || 0;
        state.data.location = CITIES[ci];
        saveData();
        renderCityList();
        navigateBack();     // location -> home
        loadForecast(true); // refresh for the newly selected city
        break;
      case 'toggle-unit':
        state.data.unit = state.data.unit === 'c' ? 'f' : 'c';
        saveData();
        renderUnitToggle();
        // per-unit cache; refetches first switch, instant thereafter.
        // Re-focus the toggle afterward so focus doesn't jump when the
        // card is briefly hidden during the reload.
        loadForecast().then(function() {
          var t = document.querySelector('.unit-toggle');
          if (t) t.focus();
        });
        break;
      case 'use-gps':
        useGps();
        break;
      default:
        console.log('[Action]', action);
    }
  }

  // ==================== SCREEN ENTER ====================
  function onScreenEnter(screenId) {
    if (screenId === 'home') {
      renderHome();
      if (!state.forecast) loadForecast();
    } else if (screenId === 'forecast') {
      renderForecastList();
    } else if (screenId === 'location') {
      renderCityList();
    }
  }

  // ==================== EVENT LISTENERS ====================
  function setupEvents() {
    document.addEventListener('click', function(e) {
      var actionEl = e.target.closest('[data-action]');
      if (actionEl) handleAction(actionEl.dataset.action, actionEl);
    });

    // Back gesture (Escape) calls history.back(), which fires popstate.
    // Render whichever screen we land on.
    window.addEventListener('popstate', function(e) {
      var target = (e.state && e.state.screen) || 'home';
      showScreen(target);
    });

    document.addEventListener('keydown', function(e) {
      switch (e.key) {
        case 'ArrowUp':    moveFocus('up');    e.preventDefault(); break;
        case 'ArrowDown':  moveFocus('down');  e.preventDefault(); break;
        case 'ArrowLeft':  moveFocus('left');  e.preventDefault(); break;
        case 'ArrowRight': moveFocus('right'); e.preventDefault(); break;
        case 'Enter':
          if (document.activeElement && document.activeElement.classList.contains('focusable')) {
            document.activeElement.click();
          }
          e.preventDefault();
          break;
        case 'Escape':
          navigateBack();
          e.preventDefault();
          break;
      }
    });
  }

  // ==================== INITIALIZATION ====================
  function init() {
    collectScreens();
    setupEvents();
    loadData();
    renderCityList();
    // Seed the root history entry so back at home exits the app (Meta pattern).
    history.replaceState({ screen: 'home' }, '');
    showScreen('home');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
