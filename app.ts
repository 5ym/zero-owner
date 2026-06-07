export type PropertyImage = {
	id: number;
	propertyId: number;
	imageUrl: string;
	sortOrder: number;
	caption: string | null;
	createdAt: string;
	isDummy: boolean;
	seedBatchId: number | null;
};

export type Items = {
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
			"Content-Type": "application/json",
			Accept: "*/*",
			"User-Agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
			Origin: "https://zero.estate",
			Referer: "https://zero.estate/login",
		},
		body: JSON.stringify({
			email,
			password,
			callbackURL: "/",
		}),
	});

	const cookie = res.headers.get("set-cookie");
	if (!cookie) {
		console.log("レスポンスヘッダー:", res.headers);
		throw new Error("ログイン失敗: Cookie が取得できません");
	}

	return cookie;
}

// -----------------------------
// 2. API から全件取得して data.json に保存
// -----------------------------
async function fetchAll() {
	const cookie = await loginAndGetCookie(
		process.env.EMAIL,
		process.env.PASSWORD,
	);

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
// 3. data.json を読み込んで CSV を生成
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
// 4. bun run script.ts <command>
// -----------------------------
const command = process.argv[2];

if (!command) {
	// ★ オプション無し → 両方実行
	await fetchAll();
	await generateCsv();
} else if (command === "fetch") {
	await fetchAll();
} else if (command === "csv") {
	await generateCsv();
} else {
	console.log("使い方:");
	console.log("  bun run script.ts           # fetch + csv 両方実行");
	console.log(
		"  bun run script.ts fetch     # API から取得して data.json を作る",
	);
	console.log("  bun run script.ts csv       # data.json から CSV を作る");
}
