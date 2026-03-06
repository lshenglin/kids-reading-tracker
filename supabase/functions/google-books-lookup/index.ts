import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function searchGoogleBooks(query: string, maxResults: number) {
  const bases = [
    "https://books.googleapis.com/books/v1/volumes",
    "https://www.googleapis.com/books/v1/volumes"
  ];
  const queryModes = ["intitle:", ""];

  let bestItems: unknown[] = [];
  let hadSuccess = false;

  for (const base of bases) {
    for (const mode of queryModes) {
      const q = mode ? `${mode}${query}` : query;
      const url = `${base}?q=${encodeURIComponent(q)}&maxResults=${maxResults}`;

      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) continue;

        hadSuccess = true;
        const data = await response.json();
        const items = Array.isArray(data?.items) ? data.items.slice(0, maxResults) : [];

        if (items.length) return { ok: true, items, source: "google" as const };
        bestItems = items;
      } catch {
        // Try next endpoint/query mode.
      }
    }
  }

  if (!hadSuccess) {
    return { ok: false, items: [] as unknown[], source: "google" as const };
  }

  return { ok: true, items: bestItems, source: "google" as const };
}

function mapOpenLibraryDocs(docs: any[], maxResults: number) {
  return docs.slice(0, maxResults).map((doc) => {
    const title = String(doc?.title || "").trim() || "Untitled";
    const authors = Array.isArray(doc?.author_name)
      ? doc.author_name.map((a: unknown) => String(a)).filter(Boolean)
      : [];
    const year = doc?.first_publish_year ? String(doc.first_publish_year) : "";

    const coverId = doc?.cover_i;
    const imageLinks = coverId
      ? {
          thumbnail: `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`,
          smallThumbnail: `https://covers.openlibrary.org/b/id/${coverId}-S.jpg`
        }
      : undefined;

    return {
      id: `ol-${String(doc?.key || title).replace(/[^a-zA-Z0-9_-]/g, "")}`,
      volumeInfo: {
        title,
        authors,
        publishedDate: year,
        imageLinks
      }
    };
  });
}

async function searchOpenLibrary(query: string, maxResults: number) {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${maxResults}`;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return { ok: false, items: [] as unknown[], source: "openlibrary" as const };

    const data = await response.json();
    const docs = Array.isArray(data?.docs) ? data.docs : [];
    const items = mapOpenLibraryDocs(docs, maxResults);
    return { ok: true, items, source: "openlibrary" as const };
  } catch {
    return { ok: false, items: [] as unknown[], source: "openlibrary" as const };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const query = String(body?.query || "").trim();
    const maxResultsRaw = Number(body?.maxResults);
    const maxResults = Number.isFinite(maxResultsRaw)
      ? Math.max(1, Math.min(10, Math.floor(maxResultsRaw)))
      : 5;

    if (query.length < 3) {
      return jsonResponse(200, { items: [], source: "none" });
    }

    const google = await searchGoogleBooks(query, maxResults);
    if (google.ok) {
      return jsonResponse(200, { items: google.items, source: google.source });
    }

    const ol = await searchOpenLibrary(query, maxResults);
    if (ol.ok) {
      return jsonResponse(200, { items: ol.items, source: ol.source });
    }

    return jsonResponse(502, { error: "Lookup providers unavailable" });
  } catch {
    return jsonResponse(500, { error: "Lookup failed" });
  }
});
