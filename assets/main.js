/* zero.estate の0円物件を衛星写真の地図に載せる。データは map.json (app.ts が生成) */

const GSI_ATTR =
	'<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';
const ESRI_ATTR = "Esri, Maxar, Earthstar Geographics";

const STATUS_COLORS = {
	募集中: "#34d399",
	受付停止: "#fbbf24",
	成約済み: "#f87171",
	取引中止: "#60a5fa",
	未公開: "#a78bfa",
};
const FALLBACK_COLOR = "#94a3b8";
const LIST_LIMIT = 120;

const $ = (id) => document.getElementById(id);

const escapeHtml = (value) =>
	String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");

const statusColor = (status) => STATUS_COLORS[status] ?? FALLBACK_COLOR;

const formatDate = (iso) => {
	const d = new Date(iso);
	return Number.isNaN(d.getTime())
		? ""
		: `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
};

/* ---------- 地図 ---------- */

function createMap(container) {
	// 空き家・空き地は現地の様子が知りたいので衛星写真を既定にする
	const gsiPhoto = L.tileLayer(
		"https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
		{ maxZoom: 19, maxNativeZoom: 18, attribution: `衛星写真: ${GSI_ATTR}` },
	);
	const esriPhoto = L.tileLayer(
		"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
		{ maxZoom: 19, maxNativeZoom: 19, attribution: `衛星写真: ${ESRI_ATTR}` },
	);
	const gsiPale = L.tileLayer(
		"https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
		{ maxZoom: 19, maxNativeZoom: 18, attribution: `地図: ${GSI_ATTR}` },
	);

	// 衛星写真だけでは地名が分からないのでラベルを重ねられるようにする
	const labels = L.tileLayer(
		"https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
		{ maxZoom: 19, maxNativeZoom: 19, attribution: "地名: Esri", opacity: 0.9 },
	);

	const map = L.map(container, {
		center: [37.2, 138.5],
		zoom: 5,
		// 地理院の写真は日本国内しか無く全国表示だと余白が灰色になるので、既定は全球の Esri
		layers: [esriPhoto, labels],
		zoomControl: false,
		preferCanvas: true,
	});

	L.control.zoom({ position: "bottomright" }).addTo(map);
	L.control
		.layers(
			{
				"衛星写真 (Esri)": esriPhoto,
				"衛星写真 (地理院)": gsiPhoto,
				淡色地図: gsiPale,
			},
			{ 地名ラベル: labels },
			{ position: "bottomright", collapsed: true },
		)
		.addTo(map);
	L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);

	map.attributionControl.setPrefix(
		'<a href="https://leafletjs.com/" target="_blank" rel="noopener">Leaflet</a>',
	);
	map.attributionControl.addAttribution(
		'物件: <a href="https://zero.estate/" target="_blank" rel="noopener">zero.estate</a>',
	);

	return map;
}

const map = createMap($("map"));

const clusters = L.markerClusterGroup({
	chunkedLoading: true,
	maxClusterRadius: 55,
	showCoverageOnHover: false,
	spiderfyOnMaxZoom: true,
	disableClusteringAtZoom: 16,
	iconCreateFunction(cluster) {
		const children = cluster.getAllChildMarkers();
		const open = children.filter(
			(m) => m.options.zeroStatus === "募集中",
		).length;
		const count = children.length;
		return L.divIcon({
			className: "pin-wrap",
			html: `<div class="cluster ${count >= 100 ? "cluster--lg" : ""}" style="--pin:${
				open ? STATUS_COLORS.募集中 : FALLBACK_COLOR
			}">${count}</div>`,
			iconSize: count >= 100 ? [46, 46] : [38, 38],
		});
	},
});
clusters.addTo(map);

/* ---------- 状態 ---------- */

let data = { properties: [], imageBase: "", total: 0, unmapped: 0 };
let state = {
	q: "",
	statuses: new Set(),
	types: new Set(),
	region: "",
	pref: "",
	notes: new Set(),
	sort: "new",
	inView: false,
};
const markers = new Map();

/** skip に渡した条件だけ無視して判定する (チップの件数表示に使う) */
function matches(property, skip) {
	if (
		skip !== "status" &&
		state.statuses.size &&
		!state.statuses.has(property.status)
	) {
		return false;
	}
	if (skip !== "type" && state.types.size && !state.types.has(property.type))
		return false;
	if (skip !== "region" && state.region && property.region !== state.region)
		return false;
	if (skip !== "pref" && state.pref && property.prefecture !== state.pref)
		return false;
	if (skip !== "note" && state.notes.size) {
		if (!property.notes.some((note) => state.notes.has(note))) return false;
	}
	if (state.q) {
		const haystack =
			`${property.title} ${property.address} ${property.prefecture} ${property.city}`.toLowerCase();
		if (!haystack.includes(state.q)) return false;
	}
	return true;
}

const SORTERS = {
	new: (a, b) => b.publishedAt.localeCompare(a.publishedAt),
	views: (a, b) => b.views - a.views,
	favorites: (a, b) => b.favorites - a.favorites,
};

function filtered() {
	return data.properties.filter((p) => matches(p)).sort(SORTERS[state.sort]);
}

/* ---------- 描画 ---------- */

function popupHtml(property) {
	const color = statusColor(property.status);
	const photo = property.image
		? `<img class="pop__photo" src="${escapeHtml(data.imageBase + property.image)}" alt="" loading="lazy">`
		: "";
	const notes = property.notes
		.map((note) => `<span class="pop__tag">${escapeHtml(note)}</span>`)
		.join("");
	const rows = [
		["所在地", `${property.prefecture}${property.city} ${property.address}`],
		["築年", property.builtYear],
		["公開日", formatDate(property.publishedAt)],
		[
			"閲覧・お気に入り",
			`${property.views.toLocaleString()} 回 / ${property.favorites} 件`,
		],
	]
		.filter(([, value]) => value)
		.map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`)
		.join("");

	return `
		<div class="pop" style="--pin:${color}">
			${photo}
			<div class="pop__inner">
				<h3 class="pop__name">${escapeHtml(property.title)}</h3>
				<div class="pop__tags">
					<span class="pop__badge">${escapeHtml(property.status)}</span>
					<span class="pop__tag">${escapeHtml(property.type)}</span>
					${notes}
				</div>
				<dl class="pop__rows">${rows}</dl>
				<div class="pop__links">
					<a class="pop__link pop__link--primary" href="https://zero.estate/properties/${property.id}" target="_blank" rel="noopener">詳細ページ</a>
					<a class="pop__link" href="https://www.google.com/maps/dir/?api=1&destination=${property.lat},${property.lng}" target="_blank" rel="noopener">経路</a>
				</div>
			</div>
		</div>`;
}

function createMarker(property) {
	const color = statusColor(property.status);
	const marker = L.marker([property.lat, property.lng], {
		icon: L.divIcon({
			className: "pin-wrap",
			html: `<div class="pin" style="--pin:${color}"></div>`,
			iconSize: [16, 16],
			iconAnchor: [8, 8],
			popupAnchor: [0, -8],
		}),
		title: property.title,
		riseOnHover: true,
		zeroStatus: property.status,
	});
	marker.bindPopup(() => popupHtml(property), { maxWidth: 280, minWidth: 280 });
	return marker;
}

function renderList(entries) {
	const list = $("list");
	const visible = state.inView
		? entries.filter((p) => map.getBounds().contains([p.lat, p.lng]))
		: entries;

	$("count").textContent = `${visible.length.toLocaleString()} 件`;

	if (visible.length === 0) {
		list.innerHTML = `<li class="list__empty">条件に合う物件がありません</li>`;
		return;
	}

	const thumb = (property) =>
		property.image
			? `<img class="list__thumb" src="${escapeHtml(data.imageBase + property.image)}" alt="" loading="lazy">`
			: `<span class="list__thumb"></span>`;

	list.innerHTML =
		visible
			.slice(0, LIST_LIMIT)
			.map(
				(property) => `
			<li class="list__item" data-id="${property.id}" style="--pin:${statusColor(property.status)}">
				${thumb(property)}
				<span class="list__body">
					<span class="list__name">${escapeHtml(property.title)}</span>
					<span class="list__meta">
						<span class="list__status">${escapeHtml(property.status)}</span>
						<span>${escapeHtml(property.prefecture)}${escapeHtml(property.city)}</span>
						<span>${formatDate(property.publishedAt)}</span>
					</span>
				</span>
			</li>`,
			)
			.join("") +
		(visible.length > LIST_LIMIT
			? `<li class="list__more">ほか ${(visible.length - LIST_LIMIT).toLocaleString()} 件（絞り込むと表示されます）</li>`
			: "");
}

function renderChipCounts() {
	for (const [box, skip] of [
		["statuses", "status"],
		["types", "type"],
		["notes", "note"],
	]) {
		const counts = new Map();
		for (const property of data.properties) {
			if (!matches(property, skip)) continue;
			const values =
				skip === "note"
					? property.notes
					: [skip === "status" ? property.status : property.type];
			for (const value of values)
				counts.set(value, (counts.get(value) ?? 0) + 1);
		}
		for (const chip of $(box).querySelectorAll(".chip")) {
			const countEl = chip.querySelector(".chip__count");
			if (countEl)
				countEl.textContent = (
					counts.get(chip.dataset.value) ?? 0
				).toLocaleString();
		}
	}
}

function render() {
	const entries = filtered();

	clusters.clearLayers();
	clusters.addLayers(entries.map((p) => markers.get(p.id)));

	renderList(entries);
	renderChipCounts();
}

/** パネルに隠れる分を余白として扱い、実際に見えている範囲に収める */
function viewPadding() {
	const margin = 20;
	const panel = $("panel");
	if (document.body.classList.contains("panel-hidden")) {
		return {
			topLeft: L.point(margin, margin),
			bottomRight: L.point(margin, margin),
		};
	}
	const rect = panel.getBoundingClientRect();
	return isNarrow()
		? {
				topLeft: L.point(margin, margin),
				bottomRight: L.point(margin, rect.height + margin),
			}
		: {
				topLeft: L.point(rect.width + margin * 2, margin),
				bottomRight: L.point(margin, margin),
			};
}

function fitToSelection() {
	const entries = filtered();
	if (entries.length === 0) return;
	const pad = viewPadding();
	map.fitBounds(L.latLngBounds(entries.map((p) => [p.lat, p.lng])), {
		paddingTopLeft: pad.topLeft,
		paddingBottomRight: pad.bottomRight,
		maxZoom: 14,
	});
}

/** パネルで隠れていない領域の中央に来るように寄せる */
function centerOn(latlng, zoom) {
	const pad = viewPadding();
	const point = map.project(latlng, zoom);
	point.x -= (pad.topLeft.x - pad.bottomRight.x) / 2;
	point.y -= (pad.topLeft.y - pad.bottomRight.y) / 2;
	map.setView(map.unproject(point, zoom), zoom, { animate: true });
}

const isNarrow = () => window.matchMedia("(max-width: 640px)").matches;

function setPanel(hidden) {
	document.body.classList.toggle("panel-hidden", hidden);
	map.invalidateSize();
}

function focusProperty(id) {
	const marker = markers.get(id);
	if (!marker) return;
	// 画面が狭いときはパネルがポップアップを覆ってしまうので閉じる
	if (isNarrow()) setPanel(true);
	centerOn(marker.getLatLng(), Math.max(map.getZoom(), 16));
	clusters.zoomToShowLayer(marker, () => marker.openPopup());
}

/* ---------- URL への状態保存 ---------- */

function readState() {
	const p = new URLSearchParams(location.hash.slice(1));
	const set = (key) => new Set((p.get(key) ?? "").split(",").filter(Boolean));
	return {
		q: (p.get("q") ?? "").toLowerCase(),
		statuses: set("st"),
		types: set("ty"),
		region: p.get("rg") ?? "",
		pref: p.get("pf") ?? "",
		notes: set("nt"),
		sort: SORTERS[p.get("sort")] ? p.get("sort") : "new",
		inView: p.get("view") === "1",
	};
}

function writeState() {
	const p = new URLSearchParams();
	if (state.q) p.set("q", state.q);
	if (state.statuses.size) p.set("st", [...state.statuses].join(","));
	if (state.types.size) p.set("ty", [...state.types].join(","));
	if (state.region) p.set("rg", state.region);
	if (state.pref) p.set("pf", state.pref);
	if (state.notes.size) p.set("nt", [...state.notes].join(","));
	if (state.sort !== "new") p.set("sort", state.sort);
	if (state.inView) p.set("view", "1");
	const hash = p.toString();
	history.replaceState(null, "", hash ? `#${hash}` : location.pathname);
}

function update() {
	writeState();
	render();
}

/* ---------- UI 構築 ---------- */

const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort();

function chipHtml(value, count, pressed, color) {
	const dot = color ? `<span class="chip__dot"></span>` : "";
	return `<button type="button" class="chip" data-value="${escapeHtml(value)}" aria-pressed="${pressed}"${
		color ? ` style="--chip:${color}"` : ""
	}>${dot}${escapeHtml(value)}<span class="chip__count">${count}</span></button>`;
}

function buildControls() {
	const properties = data.properties;

	const statuses = uniqueSorted(properties.map((p) => p.status));
	$("statuses").innerHTML = statuses
		.map((s) => chipHtml(s, "", state.statuses.has(s), statusColor(s)))
		.join("");

	const types = uniqueSorted(properties.map((p) => p.type));
	$("types").innerHTML = types
		.map((t) => chipHtml(t, "", state.types.has(t)))
		.join("");

	const notes = uniqueSorted(properties.flatMap((p) => p.notes));
	$("notes").innerHTML = notes
		.map((n) => chipHtml(n, "", state.notes.has(n)))
		.join("");

	const regions = uniqueSorted(properties.map((p) => p.region));
	$("region").innerHTML =
		`<option value="">すべて</option>` +
		regions
			.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`)
			.join("");
	$("region").value = state.region;

	buildPrefOptions();
	$("sort").value = state.sort;
	$("in-view").checked = state.inView;
	$("search").value = state.q;

	const unmapped = data.unmapped
		? `・座標なし ${data.unmapped} 件は非表示`
		: "";
	$("meta").innerHTML =
		`${data.properties.length.toLocaleString()} 件を表示${unmapped}<br>更新 ${formatDate(
			data.generatedAt,
		)}`;
}

/** 地方を選んだら、その地方の都道府県だけを選べるようにする */
function buildPrefOptions() {
	const prefs = uniqueSorted(
		data.properties
			.filter((p) => !state.region || p.region === state.region)
			.map((p) => p.prefecture),
	);
	if (state.pref && !prefs.includes(state.pref)) state.pref = "";
	$("pref").innerHTML =
		`<option value="">すべて</option>` +
		prefs
			.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)
			.join("");
	$("pref").value = state.pref;
}

function wireChipGroup(boxId, key, resetId) {
	$(boxId).addEventListener("click", (event) => {
		const chip = event.target.closest("button[data-value]");
		if (!chip) return;
		const value = chip.dataset.value;
		if (state[key].has(value)) state[key].delete(value);
		else state[key].add(value);
		chip.setAttribute("aria-pressed", String(state[key].has(value)));
		update();
	});

	$(resetId).addEventListener("click", () => {
		state[key].clear();
		for (const chip of $(boxId).querySelectorAll(".chip")) {
			chip.setAttribute("aria-pressed", "false");
		}
		update();
	});
}

function wireEvents() {
	wireChipGroup("statuses", "statuses", "status-reset");
	wireChipGroup("types", "types", "type-reset");
	wireChipGroup("notes", "notes", "note-reset");

	$("region").addEventListener("change", (event) => {
		state.region = event.target.value;
		buildPrefOptions();
		update();
		fitToSelection();
	});

	$("pref").addEventListener("change", (event) => {
		state.pref = event.target.value;
		update();
		fitToSelection();
	});

	$("sort").addEventListener("change", (event) => {
		state.sort = event.target.value;
		update();
	});

	$("in-view").addEventListener("change", (event) => {
		state.inView = event.target.checked;
		update();
	});

	let searchTimer;
	$("search").addEventListener("input", (event) => {
		const value = event.target.value.toLowerCase();
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			state.q = value;
			update();
		}, 200);
	});

	$("list").addEventListener("click", (event) => {
		const item = event.target.closest(".list__item");
		if (item) focusProperty(Number(item.dataset.id));
	});

	// 表示範囲で絞る設定のときだけ、地図の移動に合わせて一覧を作り直す
	map.on("moveend", () => {
		if (state.inView) renderList(filtered());
	});

	$("panel-close").addEventListener("click", () => setPanel(true));
	$("panel-toggle").addEventListener("click", () => setPanel(false));
}

function toast(message) {
	const el = $("toast");
	el.textContent = message;
	el.hidden = false;
}

async function boot() {
	try {
		const res = await fetch("./map.json", { cache: "no-cache" });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		data = await res.json();
	} catch (error) {
		toast(`物件データを読み込めませんでした (${error.message})`);
		return;
	}

	state = readState();
	for (const property of data.properties)
		markers.set(property.id, createMarker(property));

	buildControls();
	wireEvents();
	render();
	fitToSelection();
}

void boot();
