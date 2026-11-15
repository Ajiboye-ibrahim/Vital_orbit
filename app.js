const CROP_RULES = {
  maize: {
    id: "maize",
    label: "Maize",
    family: "cereal",
    nitrogen_effect: "heavy_user",
    water_need_class: "high",
    drought_tolerance: "low",
    market_value: 8,
    source: "FAO Crop Water Information: Maize",
  },
  sorghum: {
    id: "sorghum",
    label: "Sorghum",
    family: "cereal",
    nitrogen_effect: "heavy_user",
    water_need_class: "low",
    drought_tolerance: "high",
    market_value: 7,
    source: "FAO Crop Water Information: Sorghum",
  },
  millet: {
    id: "millet",
    label: "Pearl Millet",
    family: "cereal",
    nitrogen_effect: "heavy_user",
    water_need_class: "low",
    drought_tolerance: "high",
    market_value: 6,
    source: "ICRISAT / FAO Dryland Cereals Guide",
  },
  cowpea: {
    id: "cowpea",
    label: "Cowpea",
    family: "legume",
    nitrogen_effect: "fixes",
    water_need_class: "low",
    drought_tolerance: "high",
    market_value: 8,
    source: "IITA / FAO Cowpea Production Guide",
  },
  groundnut: {
    id: "groundnut",
    label: "Groundnut",
    family: "legume",
    nitrogen_effect: "fixes",
    water_need_class: "medium",
    drought_tolerance: "medium",
    market_value: 9,
    source: "FAO Crop Water Information: Groundnut",
  },
  soybean: {
    id: "soybean",
    label: "Soybean",
    family: "legume",
    nitrogen_effect: "fixes",
    water_need_class: "medium",
    drought_tolerance: "medium",
    market_value: 8,
    source: "IITA Soybean Agronomy Guide",
  },
  cassava: {
    id: "cassava",
    label: "Cassava",
    family: "root",
    nitrogen_effect: "neutral",
    water_need_class: "low",
    drought_tolerance: "high",
    market_value: 7,
    source: "FAO Save and Grow: Cassava",
  },
  yam: {
    id: "yam",
    label: "Yam",
    family: "root",
    nitrogen_effect: "heavy_user",
    water_need_class: "high",
    drought_tolerance: "low",
    market_value: 9,
    source: "IITA Yam Cropping Systems Guide",
  },
};

const CANDIDATE_PLANS = [
  {
    id: "plan_1",
    name: "Cereal–Legume Resilience Plan",
    sequence: ["sorghum", "cowpea"],
  },
  {
    id: "plan_2",
    name: "Nitrogen-Fixer & Cash Legume Plan",
    sequence: ["cowpea", "groundnut"],
  },
  {
    id: "plan_3",
    name: "Drought-Buffered Root & Legume Plan",
    sequence: ["cassava", "soybean"],
  },
  {
    id: "plan_4",
    name: "High-Output Maize–Soybean Rotation",
    sequence: ["soybean", "maize"],
  },
  {
    id: "plan_5",
    name: "Dryland Millet–Groundnut Sequence",
    sequence: ["millet", "groundnut"],
  },
  {
    id: "plan_6",
    name: "Continuous Baseline Comparison",
    sequence: ["maize", "maize"],
  },
];

const DRY_SCENARIO_FACTOR = 0.75;

// Global app state
let currentLat = 12.0022;
let currentLon = 8.592;
let scenarioMode = "normal"; // "normal" | "dry"
let rawNasaParams = null;
let chartInstance = null;
let mapInstance = null;
let mapMarker = null;

function initMap() {
  mapInstance = L.map("map").setView([currentLat, currentLon], 7);

  // Switch from OpenStreetMap to Esri World Street / Satellite tiles (works on localhost)
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution:
        "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
    },
  ).addTo(mapInstance);

  // Optional: Add city/road labels on top of satellite imagery
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  ).addTo(mapInstance);

  mapMarker = L.marker([currentLat, currentLon]).addTo(mapInstance);

  mapInstance.on("click", (e) => {
    currentLat = +e.latlng.lat.toFixed(4);
    currentLon = +e.latlng.lng.toFixed(4);
    mapMarker.setLatLng([currentLat, currentLon]);
    updateCoordsDisplay();
    runPipeline();
  });
}

function updateCoordsDisplay() {
  const latDir = currentLat >= 0 ? "N" : "S";
  const lonDir = currentLon >= 0 ? "E" : "W";
  document.getElementById("coordsReadout").textContent =
    `Pinned Field: ${Math.abs(currentLat).toFixed(4)}° ${latDir}, ${Math.abs(currentLon).toFixed(4)}° ${lonDir} (Click map to move pin)`;
}

// ============================================================================
// STAGE 2: DATA FETCH (Live NASA POWER API Only — No Mock Fallback)
// ============================================================================
async function fetchNasaPower(lat, lon) {
  const banner = document.getElementById("statusBanner");
  banner.style.color = "var(--accent)";
  banner.textContent = `Fetching live NASA POWER observations for (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)...`;

  const url = `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=PRECTOTCORR,T2M,GWETROOT&community=AG&longitude=${lon}&latitude=${lat}&start=2020&end=2023&format=JSON`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`NASA POWER HTTP ${response.status}`);
  }

  const data = await response.json();
  banner.textContent = `✓ Live NASA POWER Data Loaded (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`;
  return data.properties.parameter;
}

// ============================================================================
// STAGE 3: FEATURE BUILDER (Turns raw time series into clean location features)
// ============================================================================
function buildClimateFeatures(params, scenario) {
  const factor = scenario === "dry" ? DRY_SCENARIO_FACTOR : 1.0;
  const monthlyRain = Array(12).fill(0);
  const monthlyWet = Array(12).fill(0);
  const counts = Array(12).fill(0);

  let allRain = [],
    allTemp = [],
    allWet = [];

  Object.keys(params.PRECTOTCORR).forEach((ym) => {
    const mIdx = parseInt(ym.slice(4, 6), 10) - 1;
    if (mIdx < 0 || mIdx > 11) return;
    const r = params.PRECTOTCORR[ym];
    const t = params.T2M[ym];
    const w = params.GWETROOT[ym];

    if (r > -900 && t > -900 && w > -900) {
      const adjRain = r * factor;
      const adjWet = Math.min(1, w * (scenario === "dry" ? 0.85 : 1.0));
      monthlyRain[mIdx] += adjRain * 30;
      monthlyWet[mIdx] += adjWet;
      counts[mIdx]++;
      allRain.push(adjRain);
      allTemp.push(t);
      allWet.push(adjWet);
    }
  });

  const avgMonthlyRain = monthlyRain.map((s, i) =>
    counts[i] ? Math.round(s / counts[i]) : 0,
  );
  const avgMonthlyWet = monthlyWet.map((s, i) =>
    counts[i] ? +(s / counts[i]).toFixed(2) : 0,
  );

  const annualRain = Math.round(
    (allRain.reduce((a, b) => a + b, 0) / allRain.length) * 365,
  );
  const meanTemp = (
    allTemp.reduce((a, b) => a + b, 0) / allTemp.length
  ).toFixed(1);
  const avgWetness = +(
    allWet.reduce((a, b) => a + b, 0) / allWet.length
  ).toFixed(2);

  const rainfall_class =
    annualRain < 750 ? "low" : annualRain <= 1250 ? "medium" : "high";
  const soil_wetness_class =
    avgWetness < 0.35 ? "dry" : avgWetness <= 0.55 ? "moderate" : "wet";

  return {
    annualRain,
    meanTemp,
    avgWetness,
    rainfall_class,
    soil_wetness_class,
    dry_scenario_factor: factor,
    avgMonthlyRain,
    avgMonthlyWet,
  };
}

// ============================================================================
// STAGE 4: TRANSPARENT SCORING ENGINE (Sub-scores 0-100 + Weighted Total)
// ============================================================================
function scoreSoilHealth(sequence, history, soilType) {
  let score = 50;
  let prevCrop = CROP_RULES[history[history.length - 1]];

  sequence.forEach((cropId) => {
    const crop = CROP_RULES[cropId];
    // Penalize repeating the exact same crop family back-to-back (pest/disease buildup)
    if (crop.family === prevCrop.family) {
      score -= 22;
    } else {
      score += 14;
    }
    // Reward nitrogen fixers following heavy nitrogen feeders
    if (
      prevCrop.nitrogen_effect === "heavy_user" &&
      crop.nitrogen_effect === "fixes"
    ) {
      score += 20;
    }
    // Soil type interaction bonus
    if (soilType === "sandy" && crop.nitrogen_effect === "fixes") score += 6;
    if (soilType === "clay" && crop.family === "root") score -= 6;
    prevCrop = crop;
  });

  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreWaterFit(sequence, features, soilType) {
  let score = 60;
  // Sandy soils lose moisture faster, shifting effective water availability down
  const effectiveDry =
    features.rainfall_class === "low" ||
    features.soil_wetness_class === "dry" ||
    (soilType === "sandy" && features.rainfall_class === "medium");

  sequence.forEach((cropId) => {
    const crop = CROP_RULES[cropId];
    if (effectiveDry) {
      if (crop.water_need_class === "low" && crop.drought_tolerance === "high")
        score += 18;
      else if (crop.water_need_class === "medium") score += 4;
      else if (crop.water_need_class === "high") score -= 24;
    } else {
      if (
        crop.water_need_class === "high" ||
        crop.water_need_class === "medium"
      )
        score += 15;
      else score += 8;
    }
  });

  return Math.max(0, Math.min(100, Math.round(score)));
}

function scorePriorityFit(sequence, priorities) {
  let totalVal = 0;
  sequence.forEach((cropId) => {
    const crop = CROP_RULES[cropId];
    const incomeScore = (crop.market_value / 10) * 100;
    const soilScore =
      crop.nitrogen_effect === "fixes"
        ? 95
        : crop.nitrogen_effect === "neutral"
          ? 65
          : 40;
    const waterScore =
      crop.water_need_class === "low"
        ? 95
        : crop.water_need_class === "medium"
          ? 65
          : 35;

    const wSum = priorities.water + priorities.soil + priorities.profit;
    totalVal +=
      (waterScore * priorities.water +
        soilScore * priorities.soil +
        incomeScore * priorities.profit) /
      wSum;
  });
  return Math.max(0, Math.min(100, Math.round(totalVal / sequence.length)));
}

// ============================================================================
// STAGE 5: PLAIN-LANGUAGE EXPLAINER
// ============================================================================
function buildExplanation(plan, subScores, features, history, scenario) {
  const c1 = CROP_RULES[plan.sequence[0]];
  const c2 = CROP_RULES[plan.sequence[1]];
  const lastCrop = CROP_RULES[history[history.length - 1]];

  const sentences = [];
  if (c1.family !== lastCrop.family) {
    sentences.push(
      `Rotating from ${lastCrop.label} (${lastCrop.family}) into ${c1.label} (${c1.family}) breaks pest and disease cycles.`,
    );
  } else {
    sentences.push(
      `Continuing with ${c1.label} keeps a ${c1.family} in rotation, which increases pest and nutrient pressure.`,
    );
  }

  if (c1.nitrogen_effect === "fixes" || c2.nitrogen_effect === "fixes") {
    const fixer = c1.nitrogen_effect === "fixes" ? c1.label : c2.label;
    sentences.push(
      `Including ${fixer} naturally fixes soil nitrogen for the following season.`,
    );
  }

  if (scenario === "dry" || features.rainfall_class === "low") {
    sentences.push(
      `Under ${features.annualRain} mm effective rainfall (${features.rainfall_class}), ${c1.label} (${c1.drought_tolerance} drought tolerance) and ${c2.label} (${c2.drought_tolerance}) help buffer moisture stress.`,
    );
  } else {
    sentences.push(
      `Matches local NASA moisture conditions (${features.annualRain} mm rainfall, ${features.soil_wetness_class} root-zone wetness).`,
    );
  }

  return sentences.join(" ");
}

// ============================================================================
// STAGE 6: RENDER CHART & RANKED RESULTS UI
// ============================================================================
function renderChart(features) {
  const ctx = document.getElementById("climateChart").getContext("2d");
  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ],
      datasets: [
        {
          label:
            scenarioMode === "dry"
              ? "Dry Scenario Rainfall (0.75x mm)"
              : "NASA Rainfall (mm)",
          data: features.avgMonthlyRain,
          backgroundColor:
            scenarioMode === "dry"
              ? "rgba(245, 158, 11, 0.5)"
              : "rgba(56, 189, 248, 0.45)",
          borderColor: scenarioMode === "dry" ? "#f59e0b" : "#38bdf8",
          borderWidth: 1,
          yAxisID: "yRain",
        },
        {
          label: "Root-Zone Soil Wetness (0–1)",
          data: features.avgMonthlyWet,
          type: "line",
          borderColor: "#10b981",
          backgroundColor: "#10b981",
          tension: 0.35,
          borderWidth: 3,
          yAxisID: "yWet",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#cbd5e1", font: { size: 11 } } } },
      scales: {
        x: {
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(148,163,184,0.1)" },
        },
        yRain: {
          type: "linear",
          position: "left",
          ticks: { color: "#38bdf8" },
          grid: { color: "rgba(148,163,184,0.1)" },
          title: {
            display: true,
            text: "Rainfall (mm)",
            color: "#38bdf8",
            font: { size: 11 },
          },
        },
        yWet: {
          type: "linear",
          position: "right",
          min: 0,
          max: 1,
          ticks: { color: "#10b981" },
          grid: { drawOnChartArea: false },
          title: {
            display: true,
            text: "Soil Wetness",
            color: "#10b981",
            font: { size: 11 },
          },
        },
      },
    },
  });
}

function evaluateAndRender() {
  if (!rawNasaParams) return;

  const features = buildClimateFeatures(rawNasaParams, scenarioMode);
  const soilType = document.getElementById("soilType").value;
  const history = [
    document.getElementById("seasonMinus2").value,
    document.getElementById("seasonMinus1").value,
  ];

  const priorities = {
    water: parseInt(document.getElementById("sliderWater").value, 10),
    soil: parseInt(document.getElementById("sliderSoil").value, 10),
    profit: parseInt(document.getElementById("sliderProfit").value, 10),
  };

  document.getElementById("valWater").textContent = `${priorities.water} / 10`;
  document.getElementById("valSoil").textContent = `${priorities.soil} / 10`;
  document.getElementById("valProfit").textContent =
    `${priorities.profit} / 10`;

  // Update summary cards
  document.getElementById("statRain").textContent = `${features.annualRain} mm`;
  document.getElementById("tagRainClass").textContent =
    `${features.rainfall_class} rainfall`;
  document.getElementById("statTemp").textContent = `${features.meanTemp} °C`;
  document.getElementById("tagScenario").textContent =
    scenarioMode === "dry"
      ? "Dry Assumption (0.75x)"
      : "Normal Baseline (1.0x)";
  document.getElementById("statWet").textContent = features.avgWetness;
  document.getElementById("tagWetClass").textContent =
    `${features.soil_wetness_class} moisture`;
  document.getElementById("activeScenarioBadge").textContent =
    scenarioMode === "dry"
      ? "Showing: Dry Scenario (-25% Rain)"
      : "Showing: Normal Baseline";

  renderChart(features);

  // Score all candidate plans
  const wSum = priorities.water + priorities.soil + priorities.profit;
  const ranked = CANDIDATE_PLANS.map((plan) => {
    const soil_score = scoreSoilHealth(plan.sequence, history, soilType);
    const water_score = scoreWaterFit(plan.sequence, features, soilType);
    const priority_score = scorePriorityFit(plan.sequence, priorities);

    const total_score = Math.round(
      (soil_score * priorities.soil +
        water_score * priorities.water +
        priority_score * priorities.profit) /
        wSum,
    );

    return {
      ...plan,
      soil_score,
      water_score,
      priority_score,
      total_score,
      explanation: buildExplanation(
        plan,
        { soil_score, water_score, priority_score },
        features,
        history,
        scenarioMode,
      ),
    };
  })
    .sort((a, b) => b.total_score - a.total_score)
    .slice(0, 3);

  const container = document.getElementById("strategiesContainer");
  container.innerHTML = ranked
    .map((item, idx) => {
      const c1 = CROP_RULES[item.sequence[0]];
      const c2 = CROP_RULES[item.sequence[1]];
      return `
      <div class="strategy-card ${idx === 0 ? "recommended" : ""}">
        <div>
          <span class="rank-tag">${idx === 0 ? "★ TOP RECOMMENDED PLAN" : `RANK #${idx + 1}`} • ${item.total_score} / 100</span>
          <h3>${item.name}</h3>
          <div class="sequence-flow">
            <span class="crop-pill">Upcoming Season: ${c1.label}</span>
            <span class="arrow">→</span>
            <span class="crop-pill">Following Season: ${c2.label}</span>
          </div>

          <div class="score-breakdown">
            <div class="score-row">
              <span style="width:76px;">Soil Health</span>
              <div class="bar-track"><div class="bar-fill" style="width:${item.soil_score}%"></div></div>
              <strong>${item.soil_score}</strong>
            </div>
            <div class="score-row">
              <span style="width:76px;">Water Fit</span>
              <div class="bar-track"><div class="bar-fill" style="width:${item.water_score}%"></div></div>
              <strong>${item.water_score}</strong>
            </div>
            <div class="score-row">
              <span style="width:76px;">Priority Fit</span>
              <div class="bar-track"><div class="bar-fill" style="width:${item.priority_score}%"></div></div>
              <strong>${item.priority_score}</strong>
            </div>
          </div>

          <div class="detail-block">
            <strong>Plain-Language Reason</strong>
            ${item.explanation}
          </div>
        </div>

        <div class="risk-box">
          <strong>Sources &amp; Local Check:</strong> ${c1.source}; ${c2.source}. Validate seed availability &amp; soil pH with local extension officers.
        </div>
      </div>
    `;
    })
    .join("");
}

async function runPipeline() {
  try {
    rawNasaParams = await fetchNasaPower(currentLat, currentLon);
    evaluateAndRender();
  } catch (err) {
    const banner = document.getElementById("statusBanner");
    banner.style.color = "var(--danger)";
    banner.textContent = `✕ NASA POWER fetch failed (${err.message}). Verify internet access and retry.`;
  }
}

// Event Listeners
document.getElementById("presetSelect").addEventListener("change", (e) => {
  const [lat, lon] = e.target.value.split(",").map(Number);
  currentLat = lat;
  currentLon = lon;
  mapInstance.setView([currentLat, currentLon], 7);
  mapMarker.setLatLng([currentLat, currentLon]);
  updateCoordsDisplay();
  runPipeline();
});

document.getElementById("btnNormal").addEventListener("click", () => {
  scenarioMode = "normal";
  document.getElementById("btnNormal").classList.add("active");
  document.getElementById("btnDry").classList.remove("active");
  evaluateAndRender();
});

document.getElementById("btnDry").addEventListener("click", () => {
  scenarioMode = "dry";
  document.getElementById("btnDry").classList.add("active");
  document.getElementById("btnNormal").classList.remove("active");
  evaluateAndRender();
});

[
  "soilType",
  "seasonMinus2",
  "seasonMinus1",
  "sliderWater",
  "sliderSoil",
  "sliderProfit",
].forEach((id) => {
  document.getElementById(id).addEventListener("input", evaluateAndRender);
});

// Boot
initMap();
updateCoordsDisplay();
runPipeline();
