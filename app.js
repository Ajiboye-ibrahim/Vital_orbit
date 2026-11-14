const FARMS = {
  kano: { name: "Kano Savanna Plot #4", lat: 12.0022, lon: 8.592 },
  oyo: { name: "Oyo Derived Savanna Farm", lat: 7.85, lon: 3.93 },
  iowa: { name: "Story County Corn Belt", lat: 42.0308, lon: -93.62 },
};

const STRATEGIES = [
  {
    id: "baseline",
    name: "Current: Continuous Maize → Bare Fallow",
    crops: ["Monocrop Maize", "Bare Dry-Season Soil"],
    traits: { water: 3, soil: 2, profit: 7 },
    evidence: (s) =>
      `Leaves soil exposed during ${s.dryStressPct}% of moisture-deficit months (root wetness < 0.35) under peak heat of ${s.peakTemp}°C, increasing evaporation.`,
    benefits:
      "Familiar management, zero transition seed cost, established grain buyers.",
    risks:
      "Coarse NASA grid (~55 km) masks local drainage. Continuous maize depletes nitrogen and raises fall armyworm risk—consult local extension agents.",
  },
  {
    id: "legume_relay",
    name: "Option A: Maize + Cowpea Relay → Mucuna Cover",
    crops: ["Maize", "Drought-Tolerant Cowpea", "Mucuna Cover Crop"],
    traits: { water: 7, soil: 9, profit: 7 },
    evidence: (s) =>
      `Captures residual root-zone moisture (avg ${s.avgWetness}) across ${s.annualRain} mm annual rainfall while shading soil against ${s.peakTemp}°C heat.`,
    benefits:
      "Fixes natural nitrogen, eliminates bare-soil erosion windows, adds protein crop revenue.",
    risks:
      "Requires timely relay planting before rains taper off. Satellite moisture does not measure soil pH or phosphorus—perform a local soil test first.",
  },
  {
    id: "sorghum_groundnut",
    name: "Option B: Resilient Sorghum → Groundnut Rotation",
    crops: ["Improved Sorghum", "Rosette-Resistant Groundnut"],
    traits: { water: 9, soil: 8, profit: 8 },
    evidence: (s) =>
      `Optimized for ${s.dryStressPct}% dry-stress months: sorghum's deep root system extracts water efficiently during low-GWETROOT windows.`,
    benefits:
      "Cuts crop water demand by ~30%, breaks cereal pest cycles, yields cash-crop groundnuts + fodder.",
    risks:
      "Depends on local groundnut shelling/market access. Multi-year satellite averages can hide sudden early-season dry spells.",
  },
];

let currentStats = null;
let chartInstance = null;

async function fetchNasaData(farmKey) {
  const farm = FARMS[farmKey];
  const banner = document.getElementById("statusBanner");
  banner.style.color = "var(--accent)";
  banner.textContent = `Fetching live NASA POWER satellite data for ${farm.name}...`;

  const url = `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=PRECTOTCORR,T2M_MAX,GWETROOT&community=AG&longitude=${farm.lon}&latitude=${farm.lat}&start=2020&end=2023&format=JSON`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`NASA POWER API returned status ${res.status}`);
  }

  const json = await res.json();
  banner.textContent = `✓ Live NASA POWER Data Loaded (${farm.lat.toFixed(2)}°, ${farm.lon.toFixed(2)}°)`;
  return json.properties.parameter;
}

function processNasaParams(params) {
  const monthlyRain = Array(12).fill(0);
  const monthlyWetness = Array(12).fill(0);
  const counts = Array(12).fill(0);

  let allRain = [],
    allTemp = [],
    allWet = [];

  Object.keys(params.PRECTOTCORR).forEach((ym) => {
    const monthIdx = parseInt(ym.slice(4, 6), 10) - 1;
    if (monthIdx < 0 || monthIdx > 11) return;
    const r = params.PRECTOTCORR[ym];
    const t = params.T2M_MAX[ym];
    const w = params.GWETROOT[ym];
    if (r > -900 && t > -900 && w > -900) {
      monthlyRain[monthIdx] += r * 30;
      monthlyWetness[monthIdx] += w;
      counts[monthIdx]++;
      allRain.push(r);
      allTemp.push(t);
      allWet.push(w);
    }
  });

  const avgMonthlyRain = monthlyRain.map((sum, i) =>
    counts[i] ? Math.round(sum / counts[i]) : 0,
  );
  const avgMonthlyWet = monthlyWetness.map((sum, i) =>
    counts[i] ? +(sum / counts[i]).toFixed(2) : 0,
  );

  const annualRain = Math.round(
    (allRain.reduce((a, b) => a + b, 0) / allRain.length) * 365,
  );
  const peakTemp = Math.max(...allTemp).toFixed(1);
  const avgWetness = (
    allWet.reduce((a, b) => a + b, 0) / allWet.length
  ).toFixed(2);
  const dryStressPct = Math.round(
    (allWet.filter((v) => v < 0.35).length / allWet.length) * 100,
  );

  return {
    annualRain,
    peakTemp,
    avgWetness,
    dryStressPct,
    isWaterStressed: dryStressPct > 40 || annualRain < 850,
    avgMonthlyRain,
    avgMonthlyWet,
  };
}

function renderChart(stats) {
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
          label: "Monthly Rainfall (mm)",
          data: stats.avgMonthlyRain,
          backgroundColor: "rgba(56, 189, 248, 0.45)",
          borderColor: "#38bdf8",
          borderWidth: 1,
          yAxisID: "yRain",
        },
        {
          label: "Root-Zone Soil Wetness (0–1)",
          data: stats.avgMonthlyWet,
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

function updateRecommendations() {
  if (!currentStats) return;
  const wWater = parseInt(document.getElementById("sliderWater").value, 10);
  const wSoil = parseInt(document.getElementById("sliderSoil").value, 10);
  const wProfit = parseInt(document.getElementById("sliderProfit").value, 10);

  document.getElementById("valWater").textContent = `${wWater} / 10`;
  document.getElementById("valSoil").textContent = `${wSoil} / 10`;
  document.getElementById("valProfit").textContent = `${wProfit} / 10`;

  const adaptiveWater = currentStats.isWaterStressed ? wWater * 1.25 : wWater;

  const ranked = STRATEGIES.map((st) => {
    const score =
      st.traits.water * adaptiveWater +
      st.traits.soil * wSoil +
      st.traits.profit * wProfit;
    const max = 10 * (adaptiveWater + wSoil + wProfit);
    return { ...st, match: Math.round((score / max) * 100) };
  }).sort((a, b) => b.match - a.match);

  const container = document.getElementById("strategiesContainer");
  container.innerHTML = ranked
    .map(
      (item, idx) => `
    <div class="strategy-card ${idx === 0 ? "recommended" : ""}">
      <div>
        <span class="rank-tag">${idx === 0 ? "★ TOP NASA FIT" : `RANK #${idx + 1}`} • ${item.match}% Match</span>
        <h3>${item.name}</h3>
        <div class="crops-list">
          ${item.crops.map((c) => `<span class="crop-pill">${c}</span>`).join("")}
        </div>
        <div class="detail-block">
          <strong>NASA Data Evidence</strong>
          ${item.evidence(currentStats)}
        </div>
        <div class="detail-block">
          <strong>Agronomic &amp; Economic Benefits</strong>
          ${item.benefits}
        </div>
      </div>
      <div class="risk-box">
        <strong>⚠ Data Gaps &amp; Local Review:</strong> ${item.risks}
      </div>
    </div>
  `,
    )
    .join("");
}

async function loadFarm(farmKey) {
  try {
    const raw = await fetchNasaData(farmKey);
    currentStats = processNasaParams(raw);
    document.getElementById("statRain").textContent =
      `${currentStats.annualRain} mm`;
    document.getElementById("statTemp").textContent =
      `${currentStats.peakTemp} °C`;
    document.getElementById("statDry").textContent =
      `${currentStats.dryStressPct}%`;
    renderChart(currentStats);
    updateRecommendations();
  } catch (err) {
    const banner = document.getElementById("statusBanner");
    banner.style.color = "var(--danger)";
    banner.textContent = `✕ Failed to load NASA POWER data: ${err.message}. Check your internet connection.`;
  }
}

document
  .getElementById("farmSelect")
  .addEventListener("change", (e) => loadFarm(e.target.value));
["sliderWater", "sliderSoil", "sliderProfit"].forEach((id) => {
  document.getElementById(id).addEventListener("input", updateRecommendations);
});

loadFarm("kano");
