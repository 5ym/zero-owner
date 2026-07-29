/** ローカル確認用の静的サーバ (bun run dev) */
const port = Number(Bun.env.PORT ?? 5173);

Bun.serve({
	port,
	async fetch(req) {
		const url = new URL(req.url);
		const path =
			url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
		const file = Bun.file(`.${path}`);
		return (await file.exists())
			? new Response(file)
			: new Response("Not Found", { status: 404 });
	},
});

console.log(`http://localhost:${port}/`);
