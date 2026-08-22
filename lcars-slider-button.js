/** LCARS Slider Button v1.1.0 */
class LcarsEnvironmentCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("lcars-slider-button-editor");
  }

  static getStubConfig() {
    return {
      entity: "sensor.temperature",
      visual: "environment",
      mode: "display",
      min: 0,
      max: 100,
      step: 1,
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._history = [];
    this._historyKey = "";
    this._dragging = false;
    this._layoutWidth = 0;
  }

  connectedCallback() {
    if (!this._resizeObserver && typeof ResizeObserver !== "undefined") {
      this._resizeObserver = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect?.width || 0;
        if (this._config?.orientation === "horizontal" && width > 0 && Math.abs(width - this._layoutWidth) > 1) {
          this._layoutWidth = width;
          this._render();
        }
      });
    }
    this._resizeObserver?.observe(this);
  }

  disconnectedCallback() {
    this._resizeObserver?.disconnect();
  }

  setConfig(config) {
    if (!config?.entity) throw new Error("lcars-slider-button: entity is required");
    this._config = {
      title: "SENSOR",
      unit: "",
      min: 0,
      max: 100,
      step: 1,
      color: "theme",
      accent: "theme",
      trend_minutes: 60,
      decimals: 1,
      mode: "display",
      visual: "environment",
      orientation: "vertical",
      direction: "normal",
      width: null,
      height: null,
      panel: "#9b9b9b",
      ...config,
    };
    if (config.name && !config.title) this._config.title = config.name;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
    this._ensureHistory();
  }

  getCardSize() { return 5; }

  _state(entityId = this._config.entity) {
    return this._hass?.states?.[entityId];
  }

  _number(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  _cssColor(value, role = "primary") {
    if (value && String(value).trim().toLowerCase() !== "theme") return String(value).trim();
    const themed = {
      primary: "var(--primary-color, var(--lcars-crimson, #ff7a32))",
      accent: "var(--accent-color, var(--lcars-cornflower, #ffb08a))",
      success: "var(--success-color, var(--lcars-green, #33cc99))",
      warning: "var(--warning-color, var(--lcars-yellow, #ffcc66))",
      error: "var(--error-color, var(--lcars-red, #e7432a))",
    };
    return themed[role] || themed.primary;
  }

  _severity() {
    const configured = this._config.severity || {};
    const entries = [
      ["green", configured.green ?? this._config.severity_green],
      ["yellow", configured.yellow ?? this._config.severity_yellow],
      ["red", configured.red ?? this._config.severity_red],
    ].map(([name, value]) => [name, Number(value)])
      .filter(([, value]) => Number.isFinite(value))
      .sort((a, b) => a[1] - b[1]);
    return entries;
  }

  _severityBand(value) {
    const entries = this._severity();
    if (!entries.length) return null;
    let band = entries[0][0];
    for (const [name, threshold] of entries) {
      if (value >= threshold) band = name;
    }
    return band;
  }

  _showSeverityBands() {
    return this._severity().length > 0 &&
      (this._config.needle === true || this._config.severity_mode === "bands");
  }

  _currentValue() {
    const source = this._state(this._config.value_entity || this._config.current_entity || this._config.entity);
    if (!source) return null;
    const attribute = this._config.value_attribute || this._config.current_attribute;
    if (attribute) return this._number(source.attributes?.[attribute]);
    return this._number(source.state);
  }

  _entityValue(entityId, attribute) {
    const source = this._state(entityId);
    if (!source) return null;
    return attribute ? this._number(source.attributes?.[attribute]) : this._number(source.state);
  }

  _gaugeValue() {
    if (!this._config.gauge_entity) return this._currentValue();
    return this._entityValue(this._config.gauge_entity, this._config.gauge_attribute);
  }

  _pointerValue() {
    if (this._pendingTarget !== undefined) return this._pendingTarget;
    if (this._config.pointer_entity) {
      return this._entityValue(this._config.pointer_entity, this._config.pointer_attribute);
    }
    return this._targetValue() ?? this._gaugeValue();
  }

  _isInteractive() {
    return this._config.mode === "slider" && Boolean(this._config.control_entity);
  }

  _targetValue() {
    const source = this._state(this._config.target_entity || this._config.entity);
    if (!source || !this._config.target_attribute) return null;
    return this._number(source.attributes?.[this._config.target_attribute]);
  }

  _historyEntity() {
    return this._config.history_entity || this._config.current_entity || this._config.entity;
  }

  async _ensureHistory(force = false) {
    if (!this._hass || !this._config || this._historyLoading) return;
    const bucket = Math.floor(Date.now() / 60000);
    const key = `${this._historyEntity()}|${this._config.trend_minutes}|${bucket}`;
    if (!force && key === this._historyKey) return;
    this._historyKey = key;
    this._historyLoading = true;
    try {
      const end = new Date();
      const start = new Date(end.getTime() - this._config.trend_minutes * 60000);
      const path = `history/period/${encodeURIComponent(start.toISOString())}`
        + `?filter_entity_id=${encodeURIComponent(this._historyEntity())}`
        + `&end_time=${encodeURIComponent(end.toISOString())}&minimal_response&no_attributes`;
      const response = await this._hass.callApi("GET", path);
      const rows = Array.isArray(response?.[0]) ? response[0] : [];
      this._history = rows.map((row) => ({
        value: this._number(row.state),
        time: new Date(row.last_changed || row.last_updated).getTime(),
      })).filter((row) => row.value !== null && Number.isFinite(row.time));
    } catch (error) {
      console.warn("lcars-slider-button: history unavailable", error);
      this._history = [];
    } finally {
      this._historyLoading = false;
      this._render();
    }
  }

  _trend() {
    const current = this._currentValue();
    if (current === null || !this._history.length) return null;
    const baseline = this._history[0].value;
    return current - baseline;
  }

  _sparkline() {
    const rows = this._history;
    if (rows.length < 2) return "";
    const values = rows.map((row) => row.value);
    const low = Math.min(...values);
    const high = Math.max(...values);
    const span = high - low || 1;
    return rows.map((row, index) => {
      const x = (index / (rows.length - 1)) * 100;
      const y = 34 - ((row.value - low) / span) * 28;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");
  }

  _percent(value) {
    if (value === null) return 0;
    return Math.max(0, Math.min(1, (value - this._config.min) / (this._config.max - this._config.min)));
  }

  _format(value) {
    if (value === null) return "—";
    return value.toFixed(this._config.decimals).replace(".", ",");
  }

  _setTargetFromPointer(event) {
    if (!this._config.control_entity || !this._hass) return;
    const track = this.shadowRoot.querySelector(".track");
    const rect = track.getBoundingClientRect();
    const scaleInset = 10;
    const horizontal = this._config.orientation === "horizontal";
    const reverse = this._config.direction === "reverse";
    const scaleLength = Math.max(1, (horizontal ? rect.width : rect.height) - scaleInset * 2);
    let ratio;
    if (horizontal) {
      ratio = (event.clientX - rect.left - scaleInset) / scaleLength;
      if (reverse) ratio = 1 - ratio;
    } else {
      ratio = (rect.bottom - scaleInset - event.clientY) / scaleLength;
      if (reverse) ratio = 1 - ratio;
    }
    ratio = Math.max(0, Math.min(1, ratio));
    const raw = this._config.min + ratio * (this._config.max - this._config.min);
    const value = Math.round(raw / this._config.step) * this._config.step;
    this._pendingTarget = value;
    this._render();
  }

  async _commitTarget() {
    if (this._pendingTarget === undefined) return;
    const temperature = this._pendingTarget;
    const domain = this._config.control_domain || this._config.control_entity.split(".")[0];
    const defaults = {
      climate: { service: "set_temperature", field: "temperature" },
      number: { service: "set_value", field: "value" },
      input_number: { service: "set_value", field: "value" },
    };
    const inferred = defaults[domain];
    const service = this._config.control_service || inferred?.service;
    const field = this._config.control_value_field || inferred?.field;
    if (!service || !field) {
      console.warn("lcars-slider-button: configure control_service and control_value_field for this domain");
      return;
    }
    await this._hass.callService(domain, service, {
      entity_id: this._config.control_entity,
      [field]: temperature,
      ...(this._config.control_data || {}),
    });
    this._pendingTarget = undefined;
  }

  _bindEvents() {
    const track = this.shadowRoot.querySelector(".track");
    if (!track || !this._isInteractive()) return;
    const finishDrag = async (event, commit = true) => {
      if (!this._dragging) return;
      this._dragging = false;
      if (track.hasPointerCapture?.(event.pointerId)) {
        track.releasePointerCapture(event.pointerId);
      }
      if (commit) await this._commitTarget();
      else this._pendingTarget = undefined;
    };
    track.addEventListener("pointerdown", (event) => {
      this._dragging = true;
      track.setPointerCapture(event.pointerId);
      this._setTargetFromPointer(event);
    });
    track.addEventListener("pointermove", (event) => {
      if (!this._dragging) return;
      const rect = track.getBoundingClientRect();
      const outside = event.clientX < rect.left || event.clientX > rect.right
        || event.clientY < rect.top || event.clientY > rect.bottom;
      if (outside) {
        void finishDrag(event, true);
        return;
      }
      this._setTargetFromPointer(event);
    });
    track.addEventListener("pointerleave", (event) => void finishDrag(event, true));
    track.addEventListener("pointerup", (event) => void finishDrag(event, true));
    track.addEventListener("pointercancel", (event) => void finishDrag(event, false));
    track.addEventListener("lostpointercapture", () => { this._dragging = false; });
    track.addEventListener("keydown", async (event) => {
      const horizontal = this._config.orientation === "horizontal";
      const positiveKey = horizontal ? "ArrowRight" : "ArrowUp";
      const negativeKey = horizontal ? "ArrowLeft" : "ArrowDown";
      if (![positiveKey, negativeKey].includes(event.key)) return;
      event.preventDefault();
      const base = this._pendingTarget ?? this._targetValue() ?? this._config.min;
      const direction = event.key === positiveKey ? 1 : -1;
      this._pendingTarget = Math.max(this._config.min, Math.min(this._config.max,
        base + direction * this._config.step));
      this._render();
      await this._commitTarget();
    });
  }

  _scaleValues(availablePixels, minimumLabelGap) {
    const min = Number(this._config.min);
    const max = Number(this._config.max);
    const range = max - min;
    if (!Number.isFinite(range) || range <= 0) return [min];

    const usablePixels = Math.max(1, availablePixels - 20);
    const maximumLabels = Math.max(2, Math.floor(usablePixels / minimumLabelGap) + 1);
    const rawStep = range / Math.max(1, maximumLabels - 1);
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const normalized = rawStep / magnitude;
    const niceFactor = [1, 2, 2.5, 5, 10].find((factor) => factor >= normalized) ?? 10;
    const niceStep = niceFactor * magnitude;
    const epsilon = niceStep / 100000;
    const values = [min];
    let value = Math.ceil((min + epsilon) / niceStep) * niceStep;
    while (value < max - epsilon) {
      values.push(Number(value.toPrecision(12)));
      value += niceStep;
    }
    values.push(max);
    return [...new Set(values)];
  }

  _render() {
    if (!this.shadowRoot || !this._config) return;
    if (this._config.visual === "transporter") {
      this._renderTransporter();
      return;
    }
    const current = this._currentValue();
    const target = this._pendingTarget ?? this._targetValue();
    const gauge = this._gaugeValue();
    const pointer = this._pointerValue();
    const gaugePct = this._percent(gauge) * 100;
    const pointerPct = this._percent(pointer) * 100;
    const reverse = this._config.direction === "reverse";
    const displayPointerPct = reverse ? 100 - pointerPct : pointerPct;
    const horizontal = this._config.orientation === "horizontal";
    const componentWidth = horizontal
      ? Math.max(72, Number(this._config.height) || Number(this._config.width) || 88)
      : Math.max(72, Number(this._config.width) || 88);
    const scaleLength = horizontal
      ? Math.max(120, this._layoutWidth || this.getBoundingClientRect().width || 230)
      : Math.max(120, Number(this._config.height) || 230);
    const scaleValues = this._scaleValues(scaleLength, 22);
    const tickRatio = (value) => reverse
      ? (value - this._config.min) / (this._config.max - this._config.min)
      : (this._config.max - value) / (this._config.max - this._config.min);
    const majorTicks = scaleValues.map((value) => {
      const ratio = tickRatio(value);
      return `<span class="major" style="top:calc(${ratio * 100}% + ${10 - ratio * 20}px)"><b>${this._format(value)}</b></span>`;
    });
    const minorTicks = scaleValues.slice(0, -1).map((value, index) => {
      const midpoint = (value + scaleValues[index + 1]) / 2;
      const ratio = tickRatio(midpoint);
      return `<span class="minor" style="top:calc(${ratio * 100}% + ${10 - ratio * 20}px)"></span>`;
    });
    const ticks = [...majorTicks, ...minorTicks].join("");
    const showSeverityBands = this._showSeverityBands();
    const segments = Array.from({ length: 14 }, (_, i) => {
      const levelValue = this._config.min + ((i + 0.5) / 14) * (this._config.max - this._config.min);
      const band = this._severityBand(levelValue);
      const active = showSeverityBands || (i + 1) / 14 <= gaugePct / 100;
      return `<i class="${active ? "on" : ""} ${band ? `severity-${band}` : ""}"></i>`;
    }).join("");
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:inline-block; width:${horizontal ? "100%" : `${componentWidth}px`}; height:${horizontal ? componentWidth : scaleLength}px !important; min-height:${horizontal ? componentWidth : scaleLength}px; --c:${this._cssColor(this._config.color)}; --a:${this._cssColor(this._config.accent, "accent")}; }
        ha-card { width:${componentWidth}px; height:${scaleLength}px; min-height:${scaleLength}px; box-sizing:border-box; overflow:visible; background:transparent; border:0; box-shadow:none; color:#fff; font-family:'Arial Narrow','Roboto Condensed',sans-serif; transform-origin:top left; ${horizontal ? `transform:translateX(${scaleLength}px) rotate(90deg);` : ''} }
        .gauge { position:relative; width:${componentWidth}px; height:${scaleLength}px; }
        .track { position:absolute; inset:0 28px 0 0; border:2px solid #6b5960; border-radius:22px; background:#050505; touch-action:none; cursor:pointer; outline:none; }
        .segments { position:absolute; left:4px; right:4px; top:4px; bottom:4px; display:grid; grid-template-rows:repeat(14,minmax(0,1fr)); grid-auto-flow:dense; gap:2px; overflow:hidden; border-radius:17px; transform:${reverse ? 'none' : 'rotate(180deg)'}; }
        .segments i { display:block; min-height:0; background:#282124; border-radius:1px; }
        .segments i { --level-color:var(--c); }
        .segments i.severity-green { --level-color:${this._cssColor(this._config.severity_green_color || "theme", "success")}; }
        .segments i.severity-yellow { --level-color:${this._cssColor(this._config.severity_yellow_color || "theme", "warning")}; }
        .segments i.severity-red { --level-color:${this._cssColor(this._config.severity_red_color || "theme", "error")}; }
        .segments i.on { background:linear-gradient(90deg,color-mix(in srgb,var(--level-color) 58%,white),var(--level-color)); box-shadow:0 0 5px color-mix(in srgb,var(--level-color) 55%,transparent); }
        .pointer { position:absolute; left:calc(100% - 28px); width:0; height:0; border-top:8px solid transparent; border-bottom:8px solid transparent; border-right:10px solid var(--c); }
        .ticks span { position:absolute; left:calc(100% - 17px); transform:translateY(-50%); color:var(--a); font-size:11px; white-space:nowrap; }
        .ticks span::before { content:''; position:absolute; right:100%; top:50%; width:11px; border-top:1px solid var(--a); }
        .ticks span.minor::before { width:6px; }
        .ticks b { display:block; min-width:24px; font:inherit; font-weight:400; text-align:left; ${horizontal ? 'transform:rotate(-90deg); transform-origin:center; text-align:center;' : ''} }
        .foot { padding:0 18px 12px; font-size:10px; color:#999; letter-spacing:.08em; text-align:right; }
      </style>
      <ha-card>
        <div class="gauge">
          <div class="track" role="${this._isInteractive() ? "slider" : "meter"}" tabindex="${this._isInteractive() ? 0 : -1}" aria-valuemin="${this._config.min}" aria-valuemax="${this._config.max}" aria-valuenow="${pointer ?? ""}">
            <div class="segments">${segments}</div>
          </div>
          <div class="pointer" style="bottom:calc(${displayPointerPct}% + ${2 - displayPointerPct * 0.2}px)"></div>
          <div class="ticks">${ticks}</div>
        </div>
      </ha-card>`;
    this._bindEvents();
  }

  _renderTransporter() {
    const gauge = this._gaugeValue();
    const pointer = this._pointerValue();
    const gaugePct = this._percent(gauge) * 100;
    const pointerPct = this._percent(pointer) * 100;
    const reverse = this._config.direction === "reverse";
    const displayPointerPct = reverse ? 100 - pointerPct : pointerPct;
    const horizontal = this._config.orientation === "horizontal";
    const componentWidth = horizontal
      ? Math.max(118, Number(this._config.height) || Number(this._config.width) || 154)
      : Math.max(118, Number(this._config.width) || 154);
    const scaleLength = horizontal
      ? Math.max(160, this._layoutWidth || this.getBoundingClientRect().width || 300)
      : Math.max(160, Number(this._config.height) || 300);
    const scaleValues = this._scaleValues(scaleLength, 32);
    const ticks = scaleValues.map((value) => {
      const ratio = reverse
        ? (value - this._config.min) / (this._config.max - this._config.min)
        : (this._config.max - value) / (this._config.max - this._config.min);
      return `<div class="tick" style="top:calc(${ratio * 100}% + ${10 - ratio * 20}px)"><b>${this._format(value)}</b></div>`;
    }).join("");
    const cursorBottom = `calc(${displayPointerPct}% + ${10 - displayPointerPct * 0.2}px)`;
    const levelCount = Math.max(1, Math.round((this._config.max - this._config.min) / this._config.step));
    const activeLevels = Math.max(0, Math.min(levelCount,
      Math.round((gauge - this._config.min) / this._config.step)));
    const showSeverityBands = this._showSeverityBands();
    const indicatorLevels = Array.from({ length: levelCount }, (_, index) => {
      const active = showSeverityBands || (reverse ? index < activeLevels : index >= levelCount - activeLevels);
      const ratio = reverse ? (index + 0.5) / levelCount : 1 - ((index + 0.5) / levelCount);
      const levelValue = this._config.min + ratio * (this._config.max - this._config.min);
      const band = this._severityBand(levelValue);
      return `<i class="${active ? "on" : ""} ${band ? `severity-${band}` : ""}"></i>`;
    }).join("");
    const role = this._isInteractive() ? "slider" : "meter";
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:inline-block; width:${horizontal ? "100%" : `${componentWidth}px`}; height:${horizontal ? componentWidth : scaleLength}px !important; min-height:${horizontal ? componentWidth : scaleLength}px; --c:${this._cssColor(this._config.color)}; --a:${this._cssColor(this._config.accent, "accent")}; --p:${this._config.panel}; }
        ha-card { width:${componentWidth}px; height:${scaleLength}px; min-height:${scaleLength}px; overflow:visible; padding:0; background:transparent; border:0; box-shadow:none; font-family:'Arial Narrow','Roboto Condensed',sans-serif; transform-origin:top left; ${horizontal ? `transform:translateX(${scaleLength}px) rotate(90deg);` : ''} }
        .control { display:grid; grid-template-columns:minmax(60px,calc(100% - 46px)) 46px; height:${scaleLength}px; }
        .assembly { position:relative; width:100%; height:${scaleLength}px; }
        .column { position:absolute; inset:0 18px 0 0; overflow:hidden; box-sizing:border-box; background:#21181a; border:2px solid #4a3d42; border-radius:22px 22px 30px 30px; }
        .indicator-levels { position:absolute; inset:4px; display:grid; grid-template-rows:repeat(${levelCount},minmax(0,1fr)); gap:2px; overflow:hidden; border-radius:17px 17px 25px 25px; }
        .indicator-levels i { display:block; min-height:0; background:#2b2022; }
        .indicator-levels i { --level-color:var(--c); }
        .indicator-levels i.severity-green { --level-color:${this._cssColor(this._config.severity_green_color || "theme", "success")}; }
        .indicator-levels i.severity-yellow { --level-color:${this._cssColor(this._config.severity_yellow_color || "theme", "warning")}; }
        .indicator-levels i.severity-red { --level-color:${this._cssColor(this._config.severity_red_color || "theme", "error")}; }
        .indicator-levels i.on { background:linear-gradient(90deg,color-mix(in srgb,var(--level-color) 62%,black) 0%,var(--level-color) 46%,color-mix(in srgb,var(--level-color) 62%,white) 100%); box-shadow:0 0 8px color-mix(in srgb,var(--level-color) 65%,transparent); }
        .selector-rail { position:absolute; top:10px; bottom:10px; right:7px; width:5px; background:#282232; box-shadow:0 0 0 1px #40384c; }
        .selector-level { position:absolute; right:0; ${reverse ? 'top:0;' : 'bottom:0;'} left:0; height:${pointerPct}%; background:var(--a); box-shadow:0 0 8px var(--a); }
        .cursor-arrow { position:absolute; left:0; right:2px; bottom:${cursorBottom}; height:18px; transform:translateY(50%); background:#050505; clip-path:polygon(0 5.25px,calc(100% - 12px) 5.25px,calc(100% - 12px) 0,100% 50%,calc(100% - 12px) 100%,calc(100% - 12px) 12.75px,0 12.75px); filter:drop-shadow(0 0 5px var(--a)); pointer-events:none; }
        .cursor-arrow::after { content:''; position:absolute; inset:1px; background:var(--a); clip-path:polygon(0 5.25px,calc(100% - 10px) 5.25px,calc(100% - 10px) 0,100% 50%,calc(100% - 10px) 100%,calc(100% - 10px) 10.75px,0 10.75px); }
        .track { position:absolute; inset:0; z-index:4; touch-action:none; cursor:pointer; outline:none; }
        .scale { position:relative; height:100%; }
        .tick { position:absolute; left:-2px; transform:translateY(-50%); color:var(--a); font-size:13px; font-weight:900; line-height:1; letter-spacing:.02em; white-space:nowrap; }
        .tick b { display:flex; align-items:center; height:16px; min-width:34px; font:inherit; text-align:left; -webkit-text-stroke:1px #050505; paint-order:stroke fill; text-shadow:-1px -1px 0 #050505,1px -1px 0 #050505,-1px 1px 0 #050505,1px 1px 0 #050505,0 0 4px #050505; ${horizontal ? 'transform:rotate(-90deg); transform-origin:center; justify-content:center;' : ''} }
      </style>
      <ha-card>
        <div class="control">
          <div class="assembly">
            <div class="column"><div class="indicator-levels">${indicatorLevels}</div></div>
            <div class="selector-rail"><div class="selector-level"></div></div>
            <div class="cursor-arrow"></div>
            <div class="track" role="${role}" tabindex="${this._isInteractive() ? 0 : -1}" aria-label="${this._config.title}" aria-valuemin="${this._config.min}" aria-valuemax="${this._config.max}" aria-valuenow="${pointer ?? ''}"></div>
          </div>
          <div class="scale">${ticks}</div>
        </div>
      </ha-card>`;
    this._bindEvents();
  }
}

class LcarsSliderButtonEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    this._hass = hass;
    const form = this.shadowRoot?.querySelector("ha-form");
    if (form) form.hass = hass;
    else this._render();
  }

  setConfig(config) {
    const previous = this._config ? JSON.stringify(this._config) : null;
    const incoming = JSON.stringify(config || {});
    this._config = { ...config };
    const form = this.shadowRoot?.querySelector("ha-form");
    if (form && (incoming === previous || incoming === this._lastEmittedConfig)) return;
    this._render();
  }

  _label(schema) {
    const labels = {
      visual: "Visual",
      mode: "Modo",
      orientation: "Orientação",
      direction: "Sentido do preenchimento",
      width: "Largura (px; horizontal ocupa 100%)",
      height: "Altura (px)",
      entity: "Entidade principal",
      value_entity: "Entidade exibida",
      gauge_entity: "Entidade do indicador",
      pointer_entity: "Entidade do seletor",
      pointer_attribute: "Atributo do seletor",
      target_entity: "Entidade alvo",
      target_attribute: "Atributo alvo",
      control_entity: "Entidade controlada",
      unit: "Unidade",
      min: "Mínimo",
      max: "Máximo",
      step: "Passo",
      decimals: "Casas decimais",
      color: "Cor do preenchimento (theme ou CSS)",
      accent: "Cor do seletor (theme ou CSS)",
      panel: "Cor das marcas",
      needle: "Comportamento de gauge (faixas completas)",
      severity_mode: "Exibição das faixas",
      severity_green: "Início da faixa verde",
      severity_yellow: "Início da faixa amarela",
      severity_red: "Início da faixa vermelha",
      severity_green_color: "Cor verde (theme ou CSS)",
      severity_yellow_color: "Cor amarela (theme ou CSS)",
      severity_red_color: "Cor vermelha (theme ou CSS)",
    };
    return labels[schema.name] || schema.name;
  }

  _render() {
    if (!this.shadowRoot || !this._config) return;
    const editorData = {
      visual: "environment",
      mode: "display",
      orientation: "vertical",
      direction: "normal",
      width: this._config.visual === "transporter" ? 154 : 88,
      height: this._config.height ?? (this._config.orientation === "horizontal"
        ? (this._config.width ?? (this._config.visual === "transporter" ? 154 : 88))
        : (this._config.visual === "transporter" ? 300 : 230)),
      severity_green: this._config.severity?.green ?? this._config.severity_green,
      severity_yellow: this._config.severity?.yellow ?? this._config.severity_yellow,
      severity_red: this._config.severity?.red ?? this._config.severity_red,
      ...this._config,
    };
    this.shadowRoot.innerHTML = `<style>:host{display:block;padding:4px 0}ha-form{display:block}</style><ha-form></ha-form>`;
    const form = this.shadowRoot.querySelector("ha-form");
    form.hass = this._hass;
    form.data = editorData;
    form.schema = [
      { name: "visual", selector: { select: { mode: "dropdown", options: [
        { value: "environment", label: "Environment" },
        { value: "transporter", label: "Transporter" },
      ] } } },
      { name: "mode", selector: { select: { mode: "dropdown", options: [
        { value: "slider", label: "Slider" },
        { value: "display", label: "Somente exibição" },
      ] } } },
      { name: "orientation", selector: { select: { mode: "dropdown", options: [
        { value: "vertical", label: "Vertical" },
        { value: "horizontal", label: "Horizontal" },
      ] } } },
      { name: "direction", selector: { select: { mode: "dropdown", options: [
        { value: "normal", label: "Normal" },
        { value: "reverse", label: "Invertido" },
      ] } } },
      { name: "needle", selector: { boolean: {} } },
      { name: "severity_mode", selector: { select: { mode: "dropdown", options: [
        { value: "fill", label: "Somente até o valor" },
        { value: "bands", label: "Escala completa, como gauge" },
      ] } } },
      { name: "width", selector: { number: { mode: "box", min: 72, max: 1000, step: 1, unit_of_measurement: "px" } } },
      { name: "height", selector: { number: { mode: "box", min: 72, max: 1000, step: 1, unit_of_measurement: "px" } } },
      { name: "entity", required: true, selector: { entity: {} } },
      { name: "value_entity", selector: { entity: {} } },
      { name: "gauge_entity", selector: { entity: {} } },
      { name: "pointer_entity", selector: { entity: {} } },
      { name: "pointer_attribute", selector: { text: {} } },
      { name: "target_entity", selector: { entity: {} } },
      { name: "target_attribute", selector: { text: {} } },
      { name: "control_entity", selector: { entity: {} } },
      { name: "unit", selector: { text: {} } },
      { name: "min", selector: { number: { mode: "box" } } },
      { name: "max", selector: { number: { mode: "box" } } },
      { name: "step", selector: { number: { mode: "box" } } },
      { name: "decimals", selector: { number: { mode: "box", min: 0, max: 4, step: 1 } } },
      { name: "severity_green", selector: { number: { mode: "box" } } },
      { name: "severity_yellow", selector: { number: { mode: "box" } } },
      { name: "severity_red", selector: { number: { mode: "box" } } },
      { name: "severity_green_color", selector: { text: {} } },
      { name: "severity_yellow_color", selector: { text: {} } },
      { name: "severity_red_color", selector: { text: {} } },
      { name: "color", selector: { text: {} } },
      { name: "accent", selector: { text: {} } },
      { name: "panel", selector: { text: {} } },
    ];
    form.computeLabel = (schema) => this._label(schema);
    form.addEventListener("value-changed", (event) => {
      this._config = { ...editorData, ...event.detail.value };
      this._lastEmittedConfig = JSON.stringify(this._config);
      this.dispatchEvent(new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      }));
    });
  }
}

if (!customElements.get("lcars-slider-button-editor")) {
  customElements.define("lcars-slider-button-editor", LcarsSliderButtonEditor);
}
if (!customElements.get("lcars-slider-button")) {
  customElements.define("lcars-slider-button", LcarsEnvironmentCard);
}
window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "lcars-slider-button")) {
  window.customCards.push({
    type: "lcars-slider-button",
    name: "LCARS Slider Button",
    description: "Slider LCARS com visuais Environment e Transporter.",
    preview: false,
  });
}
