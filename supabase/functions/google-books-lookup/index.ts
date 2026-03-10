import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const OCPL_SEARCH_BASE = "https://catalog.ocpl.org/client/en_US/default/search/results?qu=";
const IRVINE_SEARCH_BASES = [
  "https://catalog.irvinepubliclibrary.org/client/en_US/default/search/results?qu=",
  "https://irvinepubliclibrary.ent.sirsi.net/client/en_US/default/search/results?qu=",
  "https://catalog.cityofirvine.org/client/en_US/default/search/results?qu=",
  "https://cityofirvine.org/node/90045?keys="
];

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

function normalizeText(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function htmlToText(html: string) {
  return normalizeText(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
  );
}

async function fetchText(url: string) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "user-agent": "Mozilla/5.0 Codex Kids Reading Tracker"
      }
    });
    if (!response.ok) {
      return { ok: false, text: "", status: response.status };
    }
    return { ok: true, text: await response.text(), status: response.status };
  } catch {
    return { ok: false, text: "", status: 0 };
  }
}

function looksLikeMatch(text: string, title: string, author = "") {
  const normalizedTitle = normalizeText(title);
  if (!normalizedTitle) return false;
  if (!text.includes(normalizedTitle)) return false;
  const normalizedAuthor = normalizeText(author);
  return !normalizedAuthor || text.includes(normalizedAuthor) || normalizedAuthor.split(" ").some((token) => token.length > 2 && text.includes(token));
}

async function checkCatalog(baseUrl: string, title: string, author = "") {
  const query = author ? `${title} ${author}` : title;
  const url = `${baseUrl}${encodeURIComponent(query)}`;
  const result = await fetchText(url);

  if (!result.ok) {
    return { status: "unknown", label: "Unable to check", url };
  }

  const text = htmlToText(result.text);
  if (looksLikeMatch(text, title, author)) {
    return { status: "has_it", label: "Has it", url };
  }

  return { status: "not_found", label: "No match found", url };
}

async function checkIrvineAvailability(title: string, author = "") {
  let hadReachableCatalog = false;
  for (const baseUrl of IRVINE_SEARCH_BASES) {
    const result = await checkCatalog(baseUrl, title, author);
    if (result.status === "has_it") return result;
    if (result.status === "not_found") hadReachableCatalog = true;
  }

  return hadReachableCatalog
    ? { status: "not_found", label: "No match found", url: `${IRVINE_SEARCH_BASES[0]}${encodeURIComponent(title)}` }
    : { status: "unknown", label: "Unable to check", url: `${IRVINE_SEARCH_BASES[0]}${encodeURIComponent(title)}` };
}

async function checkLibraryAvailability(books: Array<{ title?: string; authors?: string }>) {
  const items = [];
  for (const book of books.slice(0, 8)) {
    const title = String(book?.title || "").trim();
    const authors = String(book?.authors || "").trim();
    if (!title) continue;

    const [ocpl, irvine] = await Promise.all([
      checkCatalog(OCPL_SEARCH_BASE, title, authors),
      checkIrvineAvailability(title, authors)
    ]);

    items.push({
      title,
      authors,
      libraries: {
        irvine,
        ocpl
      }
    });
  }
  return items;
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
    const mode = String(body?.mode || "lookup").trim();

    if (mode === "availability") {
      const books = Array.isArray(body?.books) ? body.books : [];
      const items = await checkLibraryAvailability(books);
      return jsonResponse(200, { items, source: "libraries" });
    }

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
