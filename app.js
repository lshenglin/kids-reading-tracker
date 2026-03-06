
(function () {
  "use strict";

  const SUPABASE_URL = "https://rzcpicnwtvwsspgdhgbb.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_NFi0OVjdGvlNscza_wzosA_ICAZzhQt";
  const supabase = window.supabase && window.supabase.createClient
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;
  const LOOKUP_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/google-books-lookup`;

  const STORAGE_KEY = "kidsReadingTracker.v1";
  const VIEW_KEY = "kidsReadingTracker.view";
  const MIGRATED_FLAG_KEY = "kidsReadingTracker.migratedToCloud";
  const BASE_KIDS = ["Isa", "Josh"];

  let currentUserId = null;
  let currentAccessToken = "";
  let books = [];
  let activeTab = "Isa";
  let editingId = null;
  let activeView = localStorage.getItem(VIEW_KEY) === "shelf" ? "shelf" : "list";
  let modalBookId = null;
  let hasCoverUrlColumn = true;
  let formCoverUrl = "";

  const coverCache = {};
  const coverPending = {};
  let renderQueued = false;

  const filterState = { search: "", year: "All", rating: "All" };

  const lookupCache = {};
  let lookupTimer = null;
  let lookupResults = [];
  let lookupActiveIndex = -1;
  let lookupAbortController = null;
  let lookupRequestId = 0;

  const el = {
    form: document.getElementById("book-form"),
    kid: document.getElementById("kid"),
    title: document.getElementById("title"),
    titleSuggestions: document.getElementById("title-suggestions"),
    author: document.getElementById("author"),
    date: document.getElementById("dateFinished"),
    rating: document.getElementById("rating"),
    notes: document.getElementById("notes"),
    submit: document.getElementById("submit-btn"),
    cancel: document.getElementById("cancel-edit-btn"),
    tabs: Array.from(document.querySelectorAll(".tab")),
    views: Array.from(document.querySelectorAll(".view-btn")),
    search: document.getElementById("searchFilter"),
    year: document.getElementById("yearFilter"),
    ratingFilter: document.getElementById("ratingFilter"),
    list: document.getElementById("book-list"),
    shelf: document.getElementById("bookshelf-grid"),
    stats: document.getElementById("stats"),
    chart: document.getElementById("month-chart"),
    msg: document.getElementById("data-message"),
    exportBtn: document.getElementById("export-btn"),
    importBtn: document.getElementById("import-btn"),
    migrateBtn: document.getElementById("migrate-btn"),
    file: document.getElementById("import-file"),
    modal: document.getElementById("book-modal"),
    modalClose: document.getElementById("modal-close"),
    modalTitle: document.getElementById("modal-title"),
    modalMeta: document.getElementById("modal-meta"),
    modalRating: document.getElementById("modal-rating"),
    modalNotes: document.getElementById("modal-notes"),
    modalEdit: document.getElementById("modal-edit"),
    modalDelete: document.getElementById("modal-delete")
  };

  const todayIso = () => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  };
  const normalizeRating = (v) => {
    if (v === "" || v == null) return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  };
  const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString() : "Unknown date");
  const stars = (r) => (r ? "\u2605\u2605\u2605\u2605\u2605".slice(0, r) + "\u2606\u2606\u2606\u2606\u2606".slice(0, 5 - r) : "");
  const byDateDesc = (a, b) => {
    const t = new Date(b.dateFinished + "T00:00:00") - new Date(a.dateFinished + "T00:00:00");
    if (t !== 0) return t;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  };

  const showMsg = (text, isErr) => {
    el.msg.textContent = text;
    el.msg.classList.remove("hidden", "error");
    el.msg.classList.toggle("error", !!isErr);
  };
  const clearMsg = () => {
    el.msg.textContent = "";
    el.msg.classList.add("hidden");
    el.msg.classList.remove("error");
  };

  async function ensureAuth() {
    if (!supabase) throw new Error("Supabase client did not load.");
    let session = (await supabase.auth.getSession()).data.session;
    if (!session) {
      const signIn = await supabase.auth.signInAnonymously();
      if (signIn.error) throw signIn.error;
      session = (await supabase.auth.getSession()).data.session;
    }
    if (!session?.user?.id) throw new Error("Anonymous auth unavailable.");
    currentUserId = session.user.id;
    currentAccessToken = session.access_token || "";
  }

  const rowToBook = (r) => ({
    id: r.id,
    kid: r.kid_name,
    title: r.title,
    author: r.author || "",
    dateFinished: r.date_finished,
    rating: r.rating,
    notes: r.notes || "",
    createdAt: r.created_at,
    coverUrl: r.cover_url || ""
  });

  function isMissingCoverColumnError(err) {
    const msg = String(err?.message || "").toLowerCase();
    return msg.includes("cover_url") && (msg.includes("does not exist") || msg.includes("column"));
  }

  async function loadCloudBooks() {
    let res = await supabase
      .from("books")
      .select("id,user_id,kid_name,title,author,date_finished,rating,notes,cover_url,created_at")
      .eq("user_id", currentUserId)
      .order("date_finished", { ascending: false })
      .order("created_at", { ascending: false });

    if (res.error && isMissingCoverColumnError(res.error)) {
      hasCoverUrlColumn = false;
      res = await supabase
        .from("books")
        .select("id,user_id,kid_name,title,author,date_finished,rating,notes,created_at")
        .eq("user_id", currentUserId)
        .order("date_finished", { ascending: false })
        .order("created_at", { ascending: false });
    } else if (!res.error) {
      hasCoverUrlColumn = true;
    }

    if (res.error) throw res.error;
    books = (res.data || []).map(rowToBook);
  }

  const deriveKids = () => {
    const seen = {};
    return BASE_KIDS.concat(books.map((b) => b.kid)).filter((k) => {
      if (!k || seen[k]) return false;
      seen[k] = true;
      return true;
    });
  };

  const tabBooks = () => (activeTab === "All" ? books.slice() : books.filter((b) => b.kid === activeTab));
  const yearsFor = (arr) => Array.from(new Set(arr.map((b) => String(b.dateFinished || "").slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))).sort((a, b) => Number(b) - Number(a));
  const yearCount = (arr) => arr.filter((b) => String(b.dateFinished || "").slice(0, 4) === String(new Date().getFullYear())).length;

  function applyFilters(arr) {
    return arr.filter((b) => {
      if (filterState.search) {
        const hay = [b.title, b.author, b.notes].join(" ").toLowerCase();
        if (!hay.includes(filterState.search)) return false;
      }
      if (filterState.year !== "All" && String(b.dateFinished || "").slice(0, 4) !== filterState.year) return false;
      if (filterState.rating !== "All") {
        const r = Number(b.rating);
        if (!r) return false;
        if (filterState.rating === "5" && r !== 5) return false;
        if (filterState.rating === "4+" && r < 4) return false;
        if (filterState.rating === "3+" && r < 3) return false;
      }
      return true;
    });
  }

  function renderChart(arr) {
    const months = [];
    const base = new Date();
    base.setDate(1);
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString(undefined, { month: "short" }) });
    }
    const counts = {};
    months.forEach((m) => (counts[m.key] = 0));
    arr.forEach((b) => {
      const key = String(b.dateFinished || "").slice(0, 7);
      if (key in counts) counts[key] += 1;
    });
    const max = Math.max(1, ...months.map((m) => counts[m.key]));
    el.chart.innerHTML = "";
    months.forEach((m) => {
      const col = document.createElement("div");
      col.className = "chart-col";
      col.innerHTML = `<div class="chart-value">${counts[m.key]}</div><div class="chart-bar-wrap"><div class="chart-bar" style="height:${Math.round((counts[m.key] / max) * 100)}%" title="${m.label}: ${counts[m.key]}"></div></div><div class="chart-label">${m.label}</div>`;
      el.chart.appendChild(col);
    });
  }

  const initials = (t) => {
    const p = String(t || "").trim().split(/\s+/).filter(Boolean);
    if (!p.length) return "BK";
    return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
  };
  const hue = (id, t) => {
    const s = `${id || ""}|${t || ""}`;
    let h = 0;
    for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
    return String((h + 360) % 360);
  };

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function coverKey(book) {
    return `${(book.title || "").trim().toLowerCase()}|${(book.author || "").trim().toLowerCase()}`;
  }

  function pickImageFromItems(items) {
    if (!Array.isArray(items)) return null;
    for (const item of items) {
      const img = item?.volumeInfo?.imageLinks;
      const url = img?.thumbnail || img?.smallThumbnail || img?.small || img?.medium || "";
      if (url) return url.replace(/^http:\/\//i, "https://");
    }
    return null;
  }

  async function fetchCoverByQuery(query) {
    const url = `https://www.googleapis.com/books/v1/volumes?maxResults=5&printType=books&fields=items(volumeInfo(imageLinks))&q=${encodeURIComponent(query)}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    return pickImageFromItems(data?.items);
  }

  function requestCover(book) {
    const key = coverKey(book);
    if (!key || key in coverCache || coverPending[key]) return;
    coverPending[key] = true;

    const title = (book.title || "").trim();
    const author = (book.author || "").trim();

    (async () => {
      let cover = null;
      if (title) {
        const strictQuery = `intitle:${title}${author ? ` inauthor:${author}` : ""}`;
        cover = await fetchCoverByQuery(strictQuery);
        if (!cover) {
          cover = await fetchCoverByQuery(title);
        }
      }
      coverCache[key] = cover || null;
    })()
      .catch(() => {
        coverCache[key] = null;
      })
      .finally(() => {
        delete coverPending[key];
        if (activeView === "shelf") scheduleRender();
      });
  }

  function getCover(book) {
    const manual = String(book.coverUrl || "").trim();
    if (manual) return manual.replace(/^http:\/\//i, "https://");
    const key = coverKey(book);
    if (!(key in coverCache)) requestCover(book);
    return coverCache[key] || null;
  }

  function hideTitleSuggestions() {
    lookupResults = [];
    lookupActiveIndex = -1;
    el.titleSuggestions.classList.add("hidden");
    el.titleSuggestions.innerHTML = "";
    el.title.setAttribute("aria-expanded", "false");
    el.title.removeAttribute("aria-activedescendant");
  }


  function showSuggestionMessage(message) {
    el.titleSuggestions.innerHTML = `<div class="title-suggestion empty" role="note">${message}</div>`;
    el.titleSuggestions.classList.remove("hidden");
    el.title.setAttribute("aria-expanded", "true");
    el.title.removeAttribute("aria-activedescendant");
  }


  function applyLookupSelection(index) {
    const item = lookupResults[index];
    if (!item) return;
    const volume = item.volumeInfo || {};
    const title = volume.title || "";
    const subtitle = volume.subtitle ? `: ${volume.subtitle}` : "";
    const authors = Array.isArray(volume.authors) ? volume.authors.join(", ") : "";
    const imageLinks = volume.imageLinks || {};
    const coverUrl = imageLinks.thumbnail || imageLinks.smallThumbnail || "";

    el.title.value = `${title}${subtitle}`.trim();
    if (authors) {
      el.author.value = authors;
    }
    if (coverUrl) {
      formCoverUrl = coverUrl.replace(/^http:\/\//i, "https://");
    }
    hideTitleSuggestions();
  }

  function renderTitleSuggestions() {
    if (!lookupResults.length) {
      showSuggestionMessage("No suggestions found on Google Books");
      return;
    }

    el.titleSuggestions.innerHTML = "";
    lookupResults.forEach((item, index) => {
      const volume = item.volumeInfo || {};
      const title = volume.title || "Untitled";
      const subtitle = volume.subtitle ? `: ${volume.subtitle}` : "";
      const authorText = Array.isArray(volume.authors) && volume.authors.length
        ? volume.authors.join(", ")
        : "Unknown author";
      const year = (volume.publishedDate || "").slice(0, 4);

      const option = document.createElement("button");
      option.type = "button";
      option.id = `title-suggestion-${index}`;
      option.className = "title-suggestion" + (index === lookupActiveIndex ? " active" : "");
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", index === lookupActiveIndex ? "true" : "false");
      option.innerHTML = `<strong>${title}${subtitle}</strong><span>${authorText}${year ? ` - ${year}` : ""}</span>`;
      const choose = (ev) => {
        ev.preventDefault();
        applyLookupSelection(index);
      };
      option.addEventListener("pointerdown", choose);
      option.addEventListener("mousedown", choose);
      option.addEventListener("click", choose);
      el.titleSuggestions.appendChild(option);
    });

    el.titleSuggestions.classList.remove("hidden");
    el.title.setAttribute("aria-expanded", "true");
    if (lookupActiveIndex >= 0) {
      el.title.setAttribute("aria-activedescendant", `title-suggestion-${lookupActiveIndex}`);
    } else {
      el.title.removeAttribute("aria-activedescendant");
    }
  }

  async function lookupViaSupabaseFunction(query, signal) {
    const headers = {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY
    };
    if (currentAccessToken) {
      headers.Authorization = `Bearer ${currentAccessToken}`;
    }

    const response = await fetch(LOOKUP_FUNCTION_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, maxResults: 5 }),
      signal,
      cache: "no-store"
    });

    if (!response.ok) return { ok: false, items: [] };
    const payload = await response.json();
    const items = Array.isArray(payload?.items) ? payload.items.slice(0, 5) : [];
    return { ok: true, items };
  }

  async function lookupDirectGoogle(query, signal) {
    const bases = [
      "https://books.googleapis.com/books/v1/volumes",
      "https://www.googleapis.com/books/v1/volumes"
    ];
    const queryModes = ["intitle:", ""];
    const params = "maxResults=5";

    let items = [];
    let ok = false;
    for (const base of bases) {
      for (const mode of queryModes) {
        const q = mode ? `${mode}${query}` : query;
        const url = `${base}?q=${encodeURIComponent(q)}&${params}`;
        const response = await fetch(url, { signal, cache: "no-store" });
        if (!response.ok) continue;
        ok = true;
        const data = await response.json();
        items = Array.isArray(data?.items) ? data.items.slice(0, 5) : [];
        if (items.length) break;
      }
      if (items.length) break;
    }

    return { ok, items };
  }
  async function fetchTitleSuggestions(query, requestId, signal) {
    const key = query.trim().toLowerCase();

    if (Array.isArray(lookupCache[key]) && lookupCache[key].length) {
      if (requestId !== lookupRequestId) return;
      if (el.title.value.trim().toLowerCase() !== key) return;
      lookupResults = lookupCache[key];
      lookupActiveIndex = lookupResults.length ? 0 : -1;
      renderTitleSuggestions();
      return;
    }

    try {
      let result = await lookupViaSupabaseFunction(query, signal);
      if (!result.ok) {
        result = await lookupDirectGoogle(query, signal);
      }

      if (!result.ok) {
        if (requestId === lookupRequestId) {
          showSuggestionMessage("Could not reach Google Books lookup");
        }
        return;
      }

      const results = Array.isArray(result.items) ? result.items.slice(0, 5) : [];

      if (results.length) {
        lookupCache[key] = results;
      } else {
        delete lookupCache[key];
      }

      if (requestId !== lookupRequestId) return;
      if (el.title.value.trim().toLowerCase() !== key) return;
      lookupResults = results;
      lookupActiveIndex = results.length ? 0 : -1;
      renderTitleSuggestions();
    } catch (err) {
      if (err && err.name === "AbortError") return;
      if (requestId === lookupRequestId) {
        showSuggestionMessage("Could not reach Google Books lookup");
      }
    }
  }
  function scheduleTitleLookup() {
    const query = el.title.value.trim();
    formCoverUrl = "";

    if (lookupTimer) {
      clearTimeout(lookupTimer);
      lookupTimer = null;
    }
    if (lookupAbortController) {
      lookupAbortController.abort();
      lookupAbortController = null;
    }

    if (query.length < 3) {
      hideTitleSuggestions();
      return;
    }

    showSuggestionMessage("Searching...");

    lookupTimer = setTimeout(() => {
      lookupRequestId += 1;
      lookupAbortController = new AbortController();
      void fetchTitleSuggestions(query, lookupRequestId, lookupAbortController.signal);
    }, 400);
  }

  function onTitleKeyDown(ev) {
    if (el.titleSuggestions.classList.contains("hidden") || !lookupResults.length) {
      if (ev.key === "Escape") {
        hideTitleSuggestions();
      }
      return;
    }

    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      lookupActiveIndex = (lookupActiveIndex + 1) % lookupResults.length;
      renderTitleSuggestions();
      return;
    }

    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      lookupActiveIndex = (lookupActiveIndex - 1 + lookupResults.length) % lookupResults.length;
      renderTitleSuggestions();
      return;
    }

    if (ev.key === "Enter") {
      ev.preventDefault();
      applyLookupSelection(lookupActiveIndex >= 0 ? lookupActiveIndex : 0);
      return;
    }

    if (ev.key === "Escape") {
      ev.preventDefault();
      hideTitleSuggestions();
    }
  }

  function openModal(book) {
    modalBookId = book.id;
    el.modalTitle.textContent = book.title;
    el.modalMeta.textContent = `${book.kid}${book.author ? ` by ${book.author}` : ""} | Finished: ${fmtDate(book.dateFinished)}`;
    el.modalRating.classList.toggle("hidden", !book.rating);
    el.modalRating.textContent = book.rating ? `${stars(book.rating)} (${book.rating}/5)` : "";
    el.modalNotes.classList.toggle("hidden", !book.notes);
    el.modalNotes.textContent = book.notes || "";
    el.modal.classList.remove("hidden");
    el.modalClose.focus();
  }
  function closeModal() {
    modalBookId = null;
    el.modal.classList.add("hidden");
  }

  function render() {
    books.sort(byDateDesc);
    const kids = deriveKids();
    const currentKid = el.kid.value;
    el.kid.innerHTML = kids.map((k) => `<option value="${k}">${k}</option>`).join("");
    el.kid.value = kids.includes(currentKid) ? currentKid : kids[0];

    const base = tabBooks();
    const years = yearsFor(base);
    const prevYear = filterState.year;
    el.year.innerHTML = `<option value="All">All</option>${years.map((y) => `<option value="${y}">${y}</option>`).join("")}`;
    filterState.year = years.includes(prevYear) ? prevYear : "All";
    el.year.value = filterState.year;

    renderChart(base);
    const visible = applyFilters(base);
    el.stats.textContent = `Total books: ${visible.length} | Books this year: ${yearCount(visible)}`;

    el.list.innerHTML = "";
    el.shelf.innerHTML = "";
    el.list.classList.toggle("hidden", activeView !== "list");
    el.shelf.classList.toggle("hidden", activeView !== "shelf");

    if (!visible.length) {
      const txt = activeTab === "All" ? "No books match this view." : `No books match this view for ${activeTab}.`;
      const empty = document.createElement(activeView === "list" ? "li" : "div");
      empty.className = "empty";
      empty.textContent = txt;
      (activeView === "list" ? el.list : el.shelf).appendChild(empty);
      return;
    }

    if (activeView === "list") {
      visible.forEach((b) => {
        const li = document.createElement("li");
        li.className = "book-item";
        li.innerHTML = `<div class="book-head"><h3>${b.title}</h3>${b.rating ? `<span class="stars" title="Rating: ${b.rating}/5">${stars(b.rating)}</span>` : ""}</div><p class="meta">${b.kid}${b.author ? ` by ${b.author}` : ""} | Finished: ${fmtDate(b.dateFinished)}</p>`;
        if (b.notes) {
          const wrap = document.createElement("div");
          wrap.className = "notes-wrap";
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "notes-toggle";
          btn.textContent = "Show Notes";
          const p = document.createElement("p");
          p.className = "notes hidden";
          p.textContent = b.notes;
          btn.addEventListener("click", () => {
            const open = p.classList.contains("hidden");
            p.classList.toggle("hidden", !open);
            btn.textContent = open ? "Hide Notes" : "Show Notes";
          });
          wrap.append(btn, p);
          li.appendChild(wrap);
        }
        const acts = document.createElement("div");
        acts.className = "item-actions";
        const e = document.createElement("button"); e.type = "button"; e.textContent = "Edit"; e.addEventListener("click", () => startEdit(b));
        const d = document.createElement("button"); d.type = "button"; d.className = "danger"; d.textContent = "Delete"; d.addEventListener("click", () => void deleteBook(b.id));
        acts.append(e, d);
        li.appendChild(acts);
        el.list.appendChild(li);
      });
    } else {
      visible.forEach((b) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "shelf-card";
        const c = document.createElement("div");
        c.className = "cover";
        c.style.setProperty("--cover-hue", hue(b.id, b.title));
        const initialsEl = document.createElement("span");
        initialsEl.className = "cover-initials";
        initialsEl.textContent = initials(b.title);
        c.appendChild(initialsEl);

        const img = getCover(b);
        if (img) {
          const imgEl = document.createElement("img");
          imgEl.className = "cover-img";
          imgEl.alt = "Cover for " + b.title;
          imgEl.loading = "lazy";
          imgEl.referrerPolicy = "no-referrer";
          imgEl.src = img;
          imgEl.addEventListener("error", () => {
            c.classList.remove("has-image");
            imgEl.remove();
          });
          c.classList.add("has-image");
          c.appendChild(imgEl);
        }
        card.append(c);
        card.insertAdjacentHTML("beforeend", `<p class="shelf-title">${b.title}</p><p class="shelf-author">${b.author || "Author unknown"}</p><p class="shelf-date">Finished: ${fmtDate(b.dateFinished)}</p>${b.rating ? `<p class="stars">${stars(b.rating)}</p>` : ""}`);
        card.addEventListener("click", () => openModal(b));
        card.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); openModal(b); } });
        el.shelf.appendChild(card);
      });
    }
  }

  async function createBook(entry) {
    const payload = {
      user_id: currentUserId,
      kid_name: entry.kid,
      title: entry.title,
      author: entry.author || null,
      date_finished: entry.dateFinished,
      rating: entry.rating,
      notes: entry.notes || null
    };
    if (hasCoverUrlColumn && entry.coverUrl) payload.cover_url = entry.coverUrl;

    let res = await supabase
      .from("books")
      .insert(payload)
      .select("id,user_id,kid_name,title,author,date_finished,rating,notes,cover_url,created_at")
      .single();

    if (res.error && isMissingCoverColumnError(res.error)) {
      hasCoverUrlColumn = false;
      delete payload.cover_url;
      res = await supabase
        .from("books")
        .insert(payload)
        .select("id,user_id,kid_name,title,author,date_finished,rating,notes,created_at")
        .single();
    } else if (!res.error) {
      hasCoverUrlColumn = true;
    }

    if (res.error) throw res.error;
    books.push(rowToBook(res.data));
  }

  async function updateBook(id, entry) {
    const payload = {
      kid_name: entry.kid,
      title: entry.title,
      author: entry.author || null,
      date_finished: entry.dateFinished,
      rating: entry.rating,
      notes: entry.notes || null
    };
    if (hasCoverUrlColumn) payload.cover_url = entry.coverUrl || null;

    let res = await supabase
      .from("books")
      .update(payload)
      .eq("id", id)
      .select("id,user_id,kid_name,title,author,date_finished,rating,notes,cover_url,created_at")
      .single();

    if (res.error && isMissingCoverColumnError(res.error)) {
      hasCoverUrlColumn = false;
      delete payload.cover_url;
      res = await supabase
        .from("books")
        .update(payload)
        .eq("id", id)
        .select("id,user_id,kid_name,title,author,date_finished,rating,notes,created_at")
        .single();
    } else if (!res.error) {
      hasCoverUrlColumn = true;
    }

    if (res.error) throw res.error;
    books = books.map((b) => (b.id === id ? rowToBook(res.data) : b));
  }

  async function deleteBook(id) {
    const res = await supabase.from("books").delete().eq("id", id);
    if (res.error) return showMsg(`Delete failed: ${res.error.message}`, true);
    books = books.filter((b) => b.id !== id);
    if (editingId === id) clearForm();
    if (modalBookId === id) closeModal();
    render();
  }

  function clearForm() {
    editingId = null;
    formCoverUrl = "";
    el.form.reset();
    el.date.value = todayIso();
    el.submit.textContent = "Add Book";
    el.cancel.classList.add("hidden");
    hideTitleSuggestions();
  }

  function startEdit(book) {
    closeModal();
    hideTitleSuggestions();
    editingId = book.id;
    el.kid.value = book.kid;
    el.title.value = book.title;
    el.author.value = book.author || "";
    el.date.value = book.dateFinished || todayIso();
    el.rating.value = book.rating || "";
    el.notes.value = book.notes || "";
    formCoverUrl = book.coverUrl || "";
    el.submit.textContent = "Save Changes";
    el.cancel.classList.remove("hidden");
    el.title.focus();
  }

  function validImportBook(b) {
    return b && typeof b.id === "string" && b.id && typeof b.kid === "string" && b.kid && typeof b.title === "string" && b.title && typeof b.dateFinished === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.dateFinished);
  }

  function isUuid(v) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ""));
  }

  async function importPayload(payload) {
    const existing = new Set(books.map((b) => b.id));
    const rows = [];
    let skipped = 0;
    payload.books.forEach((b) => {
      if (existing.has(b.id)) {
        skipped += 1;
        return;
      }
      const row = { user_id: currentUserId, kid_name: b.kid, title: b.title, author: b.author || null, date_finished: b.dateFinished, rating: normalizeRating(b.rating), notes: b.notes || null };
      if (hasCoverUrlColumn && b.coverUrl) row.cover_url = String(b.coverUrl);
      if (isUuid(b.id)) row.id = b.id;
      rows.push(row);
    });
    if (rows.length) {
      const res = await supabase.from("books").insert(rows);
      if (res.error) throw res.error;
    }
    await loadCloudBooks();
    render();
    showMsg(`Import complete. Added ${rows.length} book(s), skipped ${skipped} duplicate id(s).`, false);
  }

  function legacyBooks() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function migrateLegacy() {
    const rows = legacyBooks()
      .filter((b) => b && b.kid && b.title && /^\d{4}-\d{2}-\d{2}$/.test(String(b.dateFinished || "")))
      .map((b) => {
        const row = { user_id: currentUserId, kid_name: String(b.kid).trim(), title: String(b.title).trim(), author: b.author ? String(b.author).trim() : null, date_finished: String(b.dateFinished), rating: normalizeRating(b.rating), notes: b.notes ? String(b.notes).trim() : null };
        if (hasCoverUrlColumn && b.coverUrl) row.cover_url = String(b.coverUrl);
        return row;
      });

    if (!rows.length) {
      localStorage.setItem(MIGRATED_FLAG_KEY, "1");
      el.migrateBtn.classList.add("hidden");
      return showMsg("No valid local books found to migrate.", false);
    }

    const res = await supabase.from("books").insert(rows);
    if (res.error) throw res.error;

    localStorage.setItem(MIGRATED_FLAG_KEY, "1");
    el.migrateBtn.classList.add("hidden");
    await loadCloudBooks();
    render();
    showMsg(`Migration complete. Moved ${rows.length} local book(s) to cloud.`, false);
  }

  function wireUi() {
    el.date.value = todayIso();

    el.form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const title = el.title.value.trim();
      if (!title) return el.title.focus();
      const entry = { kid: el.kid.value, title, author: el.author.value.trim(), dateFinished: el.date.value || todayIso(), rating: normalizeRating(el.rating.value), notes: el.notes.value.trim(), coverUrl: formCoverUrl };
      try {
        if (editingId) await updateBook(editingId, entry); else await createBook(entry);
        clearForm();
        clearMsg();
        render();
      } catch (err) {
        showMsg(`Save failed: ${err.message || "cloud error"}`, true);
      }
    });

    el.cancel.addEventListener("click", clearForm);

    el.title.addEventListener("input", scheduleTitleLookup);
    el.title.addEventListener("keydown", onTitleKeyDown);
    el.title.addEventListener("blur", () => {
      setTimeout(() => {
        if (document.activeElement !== el.title) hideTitleSuggestions();
      }, 120);
    });

    document.addEventListener("click", (ev) => {
      if (ev.target !== el.title && !el.titleSuggestions.contains(ev.target)) {
        hideTitleSuggestions();
      }
    });

    el.tabs.forEach((btn, i) => {
      btn.addEventListener("click", () => {
        activeTab = btn.dataset.tab;
        el.tabs.forEach((b) => {
          const a = b === btn;
          b.classList.toggle("active", a);
          b.setAttribute("aria-selected", a ? "true" : "false");
          b.setAttribute("tabindex", a ? "0" : "-1");
        });
        render();
      });
      btn.addEventListener("keydown", (ev) => {
        let n = i;
        if (ev.key === "ArrowRight") n = (i + 1) % el.tabs.length;
        else if (ev.key === "ArrowLeft") n = (i - 1 + el.tabs.length) % el.tabs.length;
        else if (ev.key === "Home") n = 0;
        else if (ev.key === "End") n = el.tabs.length - 1;
        else return;
        ev.preventDefault();
        el.tabs[n].click();
        el.tabs[n].focus();
      });
    });

    el.views.forEach((btn) => {
      btn.addEventListener("click", () => {
        activeView = btn.dataset.view === "shelf" ? "shelf" : "list";
        localStorage.setItem(VIEW_KEY, activeView);
        el.views.forEach((b) => {
          const a = b === btn;
          b.classList.toggle("active", a);
          b.setAttribute("aria-pressed", a ? "true" : "false");
        });
        render();
      });
    });

    el.search.addEventListener("input", () => { filterState.search = el.search.value.trim().toLowerCase(); render(); });
    el.year.addEventListener("change", () => { filterState.year = el.year.value; render(); });
    el.ratingFilter.addEventListener("change", () => { filterState.rating = el.ratingFilter.value; render(); });

    el.exportBtn.addEventListener("click", () => {
      try {
        const payload = { kids: deriveKids(), books: books.map((b) => ({ id: b.id, kid: b.kid, title: b.title, author: b.author || "", dateFinished: b.dateFinished, rating: b.rating, notes: b.notes || "", coverUrl: b.coverUrl || "" })) };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = "kids-reading-tracker.json"; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        showMsg("Export complete. File downloaded: kids-reading-tracker.json", false);
      } catch {
        showMsg("Export failed. Please try again.", true);
      }
    });

    el.importBtn.addEventListener("click", () => el.file.click());
    el.file.addEventListener("change", () => {
      const f = el.file.files?.[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = async () => {
        try {
          const payload = JSON.parse(String(r.result || ""));
          if (!payload || !Array.isArray(payload.kids) || !Array.isArray(payload.books) || payload.books.some((b) => !validImportBook(b))) {
            throw new Error("JSON must be { kids: array, books: array } with valid books.");
          }
          await importPayload(payload);
        } catch (err) {
          showMsg(`Import failed: ${err.message || "invalid JSON"}`, true);
        } finally {
          el.file.value = "";
        }
      };
      r.onerror = () => showMsg("Import failed: unable to read file.", true);
      r.readAsText(f);
    });

    el.migrateBtn.addEventListener("click", async () => {
      try { await migrateLegacy(); } catch (err) { showMsg(`Migration failed: ${err.message || "cloud error"}`, true); }
    });

    el.modalClose.addEventListener("click", closeModal);
    el.modal.addEventListener("click", (ev) => { if (ev.target === el.modal) closeModal(); });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !el.modal.classList.contains("hidden")) closeModal(); });
    el.modalEdit.addEventListener("click", () => { const b = books.find((x) => x.id === modalBookId); if (b) startEdit(b); });
    el.modalDelete.addEventListener("click", () => { if (modalBookId) void deleteBook(modalBookId); });

    const activeViewBtn = el.views.find((v) => v.dataset.view === activeView) || el.views[0];
    activeViewBtn?.click();
    el.tabs[0]?.click();
  }

  async function init() {
    wireUi();
    if (!supabase) return showMsg("Supabase client failed to load. Check connection and reload.", true);
    try {
      await ensureAuth();
      await loadCloudBooks();
      if (localStorage.getItem(MIGRATED_FLAG_KEY) !== "1" && legacyBooks().length > 0) el.migrateBtn.classList.remove("hidden");
      render();
      clearMsg();
    } catch (err) {
      render();
      showMsg(`Cloud setup failed: ${err.message || "unknown error"}`, true);
    }
  }

  void init();
})();










