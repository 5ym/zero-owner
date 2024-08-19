import * as cheerio from 'cheerio'

const url = 'https://zero.estate/category/zero/kanto/chiba/page/'

let page: number = 1
const property: string[] = []
while (true) {
    const ret = await fetch(url + page)
    if (ret.status === 404) {
        break;
    }
    const $ = cheerio.load(await ret.text())
    $('main aside h3 a').each((_, element) => {
        const child = $(element)
        const href = child.attr('href')
        if (href) {
            property.push(href)
        }
    })
    page++
}
const file = Bun.file('map.csv');
const writer = file.writer();
writer.write('title,url,longitude,latitude\n')
property.forEach(async (value) => {
    const ret = await fetch(value)
    const $ = cheerio.load(await ret.text())
    const mapSrc = $('h4:contains("物件所在地の地図")').next().children().attr('src')
    const longitude = mapSrc?.match(/!2d([\d|\.]+)/)![1]
    const latitude = mapSrc?.match(/!3d([\d|\.]+)/)![1]
    writer.write(`${$('h1').text()},${value},${longitude},${latitude}\n`)    
})
writer.flush()
