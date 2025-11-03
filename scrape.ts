import { load } from "cheerio";

const url = "https://zero.estate/page/";

let page = 1;
const property: string[] = [];
while (true) {
	const ret = await fetch(url + page);
	if (ret.status === 404) {
		break;
	}
	const $ = load(await ret.text());
	$("main aside h3 a").each((_, element) => {
		const child = $(element);
		const href = child.attr("href");
		if (href) {
			property.push(href);
		}
	});
	page++;
}
const file = Bun.file("map.csv");
const writer = file.writer();
writer.write("title,url,status,longitude,latitude\n");

for (const value of property) {
	const ret = await fetch(value);
	const $ = load(await ret.text());
	const mapSrc = $('h4:contains("物件所在地の地図")')
		.next()
		.children()
		.attr("src");
	const longitude = mapSrc?.match(/!2d([\d|\.]+)/)?.[1];
	const latitude = mapSrc?.match(/!3d([\d|\.]+)/)?.[1];
	const statusText = $("article .st-catgroup").text();
	let status = "募集中";
	if (/受付終了/.test(statusText)) {
		status = "受付終了";
	} else if (/一時停止/.test(statusText)) {
		status = "一時停止";
	} else if (/取引中止/.test(statusText)) {
		status = "取引中止";
	}
	writer.write(
		`${$("h1").text()},${value},${status},${longitude},${latitude}\n`,
	);
}
writer.flush();
