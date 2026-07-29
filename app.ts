type PropertyImage = {
	id: number;
	propertyId: number;
	imageUrl: string;
	sortOrder: number;
	caption: string | null;
	createdAt: string;
	isDummy: boolean;
	seedBatchId: number | null;
};

type Items = {
	id: number;
	title: string;
	status: string;
	propertyType: string;
	address: string;
	prefecture: string | null;
	city: string | null;
	region: string | null;
	builtYear: string | null;
	viewCount: number;
	createdAt: string;
	approvedAt: string | null;
	publicStatus: string;
	isSuspended: boolean;
	specialNotes: string | null;
	latitude: string | null;
	longitude: string | null;
	approximateLatitude: string | null;
	approximateLongitude: string | null;
	slug: string | null;
	plan: string;
	images: PropertyImage[];
	ownerName: string | null;
	ownerPrefecture: string | null;
	isFavorite: boolean;
	favoriteCount: number;
};

// -----------------------------
// 1. ログインして Cookie を取得
// -----------------------------
async function loginAndGetCookie(email: string, password: string) {
	const res = await fetch("https://zero.estate/api/auth/sign-in/email", {
		method: "POST",
		headers: {
			accept: "*/*",
			"accept-language": "ja,en-US;q=0.9,en;q=0.8",
			"cache-control": "no-cache",
			"content-type": "application/json",
			dnt: "1",
			origin: "https://zero.estate",
			pragma: "no-cache",
			priority: "u=1, i",
			referer: "https://zero.estate/login",
			// ★ これが無いと絶対に弾かれる
			"sec-ch-ua":
				'"Microsoft Edge";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
			"sec-ch-ua-mobile": "?0",
			"sec-ch-ua-platform": '"Windows"',
			"sec-fetch-dest": "empty",
			"sec-fetch-mode": "cors",
			"sec-fetch-site": "same-origin",
			"user-agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0",
		},
		body: JSON.stringify({
			email,
			password,
			callbackURL: "/",
		}),
	});

	const cookie = res.headers.get("set-cookie");
	if (!cookie) {
		console.log("レスポンス:", res);
		throw new Error("ログイン失敗: Cookie が取得できません");
	}

	return cookie;
}

// -----------------------------
// 2. API から全件取得して data.json に保存
// -----------------------------
async function fetchAll() {
	// 認証情報は環境変数から。ローカルでは .env、CI では Actions の Secrets を使う
	const email = Bun.env.EMAIL;
	const password = Bun.env.PASSWORD;
	if (!email || !password) {
		throw new Error("環境変数 EMAIL / PASSWORD を設定してください");
	}

	const cookie = await loginAndGetCookie(email, password);

	let page = 1;
	const baseUrl = "https://zero.estate/api/trpc/property.list";
	const results: Items[] = [];

	while (true) {
		const inputJson = {
			"0": {
				json: {
					page,
					limit: 100,
					keyword: null,
					region: null,
					prefecture: null,
					status: null,
					propertyType: null,
					specialNotes: null,
					sortBy: "newest",
					publishedWithin: null,
				},
				meta: {
					values: {
						keyword: ["undefined"],
						region: ["undefined"],
						prefecture: ["undefined"],
						status: ["undefined"],
						propertyType: ["undefined"],
						specialNotes: ["undefined"],
						publishedWithin: ["undefined"],
					},
				},
			},
		};

		const params = new URLSearchParams({
			batch: "1",
			input: JSON.stringify(inputJson),
		});

		const url = `${baseUrl}?${params.toString()}`;

		console.log("request page:", page);

		const ret = await fetch(url, {
			headers: {
				Cookie: cookie,
				"User-Agent": "Mozilla/5.0",
				Accept: "application/json",
			},
		});

		const body = await ret.json();
		const items = body[0].result.data.json.items as Items[];

		if (items.length === 0) break;

		results.push(...items);
		page++;
	}

	await Bun.write("data.json", JSON.stringify(results, null, "\t"));
	console.log("data.json 保存完了");
}

// -----------------------------
// 3. data.json を読み込んで地図用 JSON を生成
// -----------------------------

/** 画像はすべてこの R2 バケット配下なので、共通部分は JSON から省く */
const IMAGE_BASE = "https://pub-a219a93f532e41ea8c7013e00d34c61b.r2.dev/";

type MapProperty = {
	id: number;
	title: string;
	status: string;
	type: string;
	prefecture: string;
	city: string;
	region: string;
	address: string;
	lat: number;
	lng: number;
	builtYear: string | null;
	views: number;
	favorites: number;
	notes: string[];
	publishedAt: string;
	image: string | null;
};

/** specialNotes は JSON 文字列の配列として入っている */
function parseNotes(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((n): n is string => typeof n === "string")
			: [];
	} catch {
		return [];
	}
}

/** null や空文字を Number() に渡すと 0 になってしまうので明示的に弾く */
function toCoord(value: string | null | undefined): number {
	if (value === null || value === undefined || value.trim() === "")
		return Number.NaN;
	return Number(value);
}

function pickImage(images: PropertyImage[] | undefined): string | null {
	const usable = (images ?? [])
		.filter((image) => !image.isDummy && image.imageUrl)
		.sort((a, b) => a.sortOrder - b.sortOrder);

	const url = usable[0]?.imageUrl;
	if (!url) return null;
	return url.startsWith(IMAGE_BASE) ? url.slice(IMAGE_BASE.length) : url;
}

async function generateJson() {
	const file = Bun.file("data.json");
	const items = JSON.parse(await file.text()) as Items[];

	const properties: MapProperty[] = [];
	let unmapped = 0;

	for (const item of items) {
		const lat = toCoord(item.latitude ?? item.approximateLatitude);
		const lng = toCoord(item.longitude ?? item.approximateLongitude);

		// 座標が無い物件は地図に置けないので件数だけ数えておく
		if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
			unmapped++;
			continue;
		}

		properties.push({
			id: item.id,
			title: item.title,
			status: item.status,
			type: item.propertyType,
			prefecture: item.prefecture ?? "",
			city: item.city ?? "",
			region: item.region ?? "",
			address: item.address?.replace(/\s*\n\s*/g, " ") ?? "",
			lat,
			lng,
			builtYear: item.builtYear,
			views: item.viewCount ?? 0,
			favorites: item.favoriteCount ?? 0,
			notes: parseNotes(item.specialNotes),
			publishedAt: item.approvedAt ?? item.createdAt,
			image: pickImage(item.images),
		});
	}

	properties.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

	await Bun.write(
		"map.json",
		JSON.stringify({
			generatedAt: new Date().toISOString(),
			total: items.length,
			unmapped,
			imageBase: IMAGE_BASE,
			properties,
		}),
	);

	console.log(
		`map.json 出力完了 (${properties.length} 件 / 座標なし ${unmapped} 件)`,
	);
}

// -----------------------------
// 4. data.json を読み込んで CSV を生成
// -----------------------------
async function generateCsv() {
	const file = Bun.file("data.json");
	const text = await file.text();
	const items = JSON.parse(text) as Items[];

	const csvFile = Bun.file("map.csv");
	const writer = csvFile.writer();

	writer.write("title,url,status,longitude,latitude,address\n");

	for (const json of items) {
		const longitude = json.longitude ?? json.approximateLongitude ?? "";
		const latitude = json.latitude ?? json.approximateLatitude ?? "";
		const safeAddress =
			json.address?.replace(/\n/g, "\\n") ?? json.prefecture + json.city;

		writer.write(
			`"${json.title}",https://zero.estate/properties/${json.id},${json.status},${longitude},${latitude},${safeAddress}\n`,
		);
	}

	writer.end();
	console.log("CSV 出力完了");
}

// -----------------------------
// 5. bun run app.ts <command>
// -----------------------------
const command = process.argv[2];

if (!command) {
	// ★ オプション無し → 取得 + 地図用 JSON 生成
	await fetchAll();
	await generateJson();
} else if (command === "fetch") {
	await fetchAll();
} else if (command === "json") {
	await generateJson();
} else if (command === "csv") {
	await generateCsv();
} else {
	console.log("使い方:");
	console.log("  bun run app.ts           # fetch + json 両方実行");
	console.log("  bun run app.ts fetch     # API から取得して data.json を作る");
	console.log(
		"  bun run app.ts json      # data.json から地図用 map.json を作る",
	);
	console.log("  bun run app.ts csv       # data.json から CSV を作る");
}
