import * as cheerio from "cheerio";

const url =
  "https://zero.estate/wp-json/wp/v2/posts?categories_exclude[]=46&categories_exclude[]=49&categories_exclude[]=26&categories_exclude[]=27&categories_exclude[]=28&per_page=100&page=";
let page = 1;
type Response = {
  guid: {
    rendered: string;
  };
  title: {
    rendered: string;
  };
  content: {
    rendered: string;
  };
  categories: number[];
};
const jsons: Response[] = [];
while (true) {
  const ret = await fetch(url + page);
  console.log(page, ret.status);
  if (ret.status === 400) {
    break;
  }
  jsons.push(...((await ret.json()) as Response[]));
  page++;
}
Bun.write("data.json", JSON.stringify(jsons, null, "\t"));
const file = Bun.file("map.csv");
const writer = file.writer();
writer.write("title,url,status,longitude,latitude,address\n");

for (const json of jsons) {
  const $ = cheerio.load(json.content.rendered);
  let mapSrc = $('h4:contains("物件所在地の地図")')
    .nextUntil(":not(p)")
    .has("iframe")
    .last()
    .children("iframe")
    .attr("src");
  if (!mapSrc) {
    mapSrc = $('h4:contains("物件所在地付近の地図")')
      .nextUntil(":not(p)")
      .has("iframe")
      .last()
      .children("iframe")
      .attr("src");
  }
  if (json.guid.rendered === "https://zero.estate/?p=11917") {
    console.log(mapSrc);
  }
  const longitude = mapSrc?.match(/!2d([\d|\.]+)/)?.[1] ?? "";
  const latitude = mapSrc?.match(/!3d([\d|\.]+)/)?.[1] ?? "";
  let address = "";
  if (!longitude || !latitude) {
    address = $(".detail-spread>tbody>tr")
      .filter(
        (_k, v) => $(v).children("th:first-child").text().trim() === "所在地"
      )
      .children("th:last-child")
      .text()
      .split("\n")[0];
  }
  let status = "募集中";
  if (json.categories.includes(32)) {
    status = "受付終了";
  } else if (json.categories.includes(91)) {
    status = "一時停止";
  } else if (json.categories.includes(87)) {
    status = "取引中止";
  }
  writer.write(
    `"${json.title.rendered}",${json.guid.rendered},${status},${longitude},${latitude},${address}\n`
  );
}
