async function testDDG() {
    const q = encodeURIComponent("icc t20 world cup 2026 winner");
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    const text = await res.text();
    const matches = [...text.matchAll(/<a class="result__snippet[^>]*>(.*?)<\/a>/gi)];
    const snippets = matches.map(m => m[1].replace(/<[^>]+>/g, '').trim()).slice(0, 3);
    console.log("Found Snippets:");
    console.log(snippets);
}
testDDG();
