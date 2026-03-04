(function () {
  "use strict";

  var STORAGE_KEY = "kidsReadingTracker.v1";
  var KIDS_KEY = "kidsReadingTracker.kids.v1";
  var VIEW_KEY = "kidsReadingTracker.view";
  var BASE_KIDS = ["Isa", "Josh"];

  var activeTab = "Isa";
  var editingId = null;
  var activeView = "list";
  var modalBookId = null;

  var filterState = {
    search: "",
    year: "All",
    rating: "All"
  };

  var form = document.getElementById("book-form");
  var kidInput = document.getElementById("kid");
  var titleInput = document.getElementById("title");
  var authorInput = document.getElementById("author");
  var dateInput = document.getElementById("dateFinished");
  var ratingInput = document.getElementById("rating");
  var notesInput = document.getElementById("notes");

  var searchFilterInput = document.getElementById("searchFilter");
  var yearFilterInput = document.getElementById("yearFilter");
  var ratingFilterInput = document.getElementById("ratingFilter");

  var viewButtons = Array.prototype.slice.call(document.querySelectorAll(".view-btn"));

  var exportBtn = document.getElementById("export-btn");
  var importBtn = document.getElementById("import-btn");
  var importFileInput = document.getElementById("import-file");
  var dataMessageEl = document.getElementById("data-message");

  var listEl = document.getElementById("book-list");
  var shelfEl = document.getElementById("bookshelf-grid");
  var statsEl = document.getElementById("stats");
  var monthChartEl = document.getElementById("month-chart");

  var submitBtn = document.getElementById("submit-btn");
  var cancelEditBtn = document.getElementById("cancel-edit-btn");
  var tabButtons = Array.prototype.slice.call(document.querySelectorAll(".tab"));

  var modalEl = document.getElementById("book-modal");
  var modalCloseBtn = document.getElementById("modal-close");
  var modalTitleEl = document.getElementById("modal-title");
  var modalMetaEl = document.getElementById("modal-meta");
  var modalRatingEl = document.getElementById("modal-rating");
  var modalNotesEl = document.getElementById("modal-notes");
  var modalEditBtn = document.getElementById("modal-edit");
  var modalDeleteBtn = document.getElementById("modal-delete");

  function todayIso() {
    var now = new Date();
    var offset = now.getTimezoneOffset();
    var local = new Date(now.getTime() - offset * 60000);
    return local.toISOString().slice(0, 10);
  }

  function seedBooks() {
    var year = new Date().getFullYear();
    return [
      {
        id: makeId(),
        kid: "Isa",
        title: "Charlotte's Web",
        author: "E. B. White",
        dateFinished: year + "-02-14",
        rating: 5,
        notes: "Loved Wilbur and Fern."
      },
      {
        id: makeId(),
        kid: "Isa",
        title: "The Tale of Despereaux",
        author: "Kate DiCamillo",
        dateFinished: year + "-01-20",
        rating: 4,
        notes: "Great adventure."
      },
      {
        id: makeId(),
        kid: "Josh",
        title: "Dog Man",
        author: "Dav Pilkey",
        dateFinished: year + "-02-10",
        rating: 5,
        notes: "Very funny."
      },
      {
        id: makeId(),
        kid: "Josh",
        title: "Magic Tree House: Dinosaurs Before Dark",
        author: "Mary Pope Osborne",
        dateFinished: year + "-01-08",
        rating: 4,
        notes: "Asked for the next one right away."
      }
    ];
  }

  function makeId() {
    return "b_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function uniqStrings(values) {
    var seen = {};
    var out = [];

    values.forEach(function (value) {
      if (typeof value !== "string") {
        return;
      }
      var trimmed = value.trim();
      if (!trimmed || seen[trimmed]) {
        return;
      }
      seen[trimmed] = true;
      out.push(trimmed);
    });

    return out;
  }

  function loadBooks() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      var seeded = seedBooks();
      saveBooks(seeded);
      return seeded;
    }

    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (parsed && Array.isArray(parsed.books)) {
        return parsed.books;
      }
      return [];
    } catch (err) {
      return [];
    }
  }

  function saveBooks(books) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
  }

  function loadKids() {
    var raw = localStorage.getItem(KIDS_KEY);
    var kidsFromStorage = [];

    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          kidsFromStorage = parsed;
        }
      } catch (err) {
        kidsFromStorage = [];
      }
    }

    var kidsFromBooks = loadBooks().map(function (book) {
      return book.kid;
    });

    return uniqStrings(BASE_KIDS.concat(kidsFromStorage, kidsFromBooks));
  }

  function saveKids(kids) {
    var merged = uniqStrings(BASE_KIDS.concat(kids));
    localStorage.setItem(KIDS_KEY, JSON.stringify(merged));
  }

  function syncKidsFromBooks() {
    var existingKids = loadKids();
    var kidsFromBooks = loadBooks().map(function (book) {
      return book.kid;
    });
    saveKids(existingKids.concat(kidsFromBooks));
  }

  function loadViewPreference() {
    var raw = localStorage.getItem(VIEW_KEY);
    if (raw === "shelf" || raw === "list") {
      return raw;
    }
    return "list";
  }

  function saveViewPreference(view) {
    localStorage.setItem(VIEW_KEY, view);
  }

  function updateKidSelectOptions(kids) {
    var currentValue = kidInput.value;
    kidInput.innerHTML = "";

    kids.forEach(function (kid) {
      var option = document.createElement("option");
      option.value = kid;
      option.textContent = kid;
      kidInput.appendChild(option);
    });

    if (kids.indexOf(currentValue) >= 0) {
      kidInput.value = currentValue;
    } else {
      kidInput.value = kids[0] || BASE_KIDS[0];
    }
  }

  function normalizeRating(value) {
    if (value === "" || value === null || typeof value === "undefined") {
      return null;
    }
    var parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
      return null;
    }
    return parsed;
  }

  function formatDate(isoDate) {
    if (!isoDate) {
      return "Unknown date";
    }
    var d = new Date(isoDate + "T00:00:00");
    if (Number.isNaN(d.getTime())) {
      return isoDate;
    }
    return d.toLocaleDateString();
  }

  function sortByDateDesc(a, b) {
    var aTime = new Date(a.dateFinished + "T00:00:00").getTime();
    var bTime = new Date(b.dateFinished + "T00:00:00").getTime();
    return bTime - aTime;
  }

  function filteredBooks(books, tab) {
    if (tab === "All") {
      return books;
    }
    return books.filter(function (book) {
      return book.kid === tab;
    });
  }

  function booksThisYear(books) {
    var year = String(new Date().getFullYear());
    return books.filter(function (book) {
      return String(book.dateFinished || "").slice(0, 4) === year;
    }).length;
  }

  function emptyMessageForTab(tab, filteredByControls) {
    if (filteredByControls) {
      if (tab === "Isa") {
        return "No books match the current filters for Isa.";
      }
      if (tab === "Josh") {
        return "No books match the current filters for Josh.";
      }
      return "No books match the current filters for Isa or Josh.";
    }

    if (tab === "Isa") {
      return "Isa has no finished books yet. Add one above.";
    }
    if (tab === "Josh") {
      return "Josh has no finished books yet. Add one above.";
    }
    return "No finished books yet for Isa or Josh.";
  }

  function ratingStars(rating) {
    if (!rating) {
      return "";
    }
    var full = "★★★★★".slice(0, rating);
    var empty = "☆☆☆☆☆".slice(0, 5 - rating);
    return full + empty;
  }

  function getYears(books) {
    var yearsMap = {};

    books.forEach(function (book) {
      var year = String(book.dateFinished || "").slice(0, 4);
      if (/^\d{4}$/.test(year)) {
        yearsMap[year] = true;
      }
    });

    return Object.keys(yearsMap).sort(function (a, b) {
      return Number(b) - Number(a);
    });
  }

  function populateYearFilterOptions(tabBooks) {
    var years = getYears(tabBooks);
    var previous = filterState.year;

    yearFilterInput.innerHTML = "";

    var allOption = document.createElement("option");
    allOption.value = "All";
    allOption.textContent = "All";
    yearFilterInput.appendChild(allOption);

    years.forEach(function (year) {
      var option = document.createElement("option");
      option.value = year;
      option.textContent = year;
      yearFilterInput.appendChild(option);
    });

    filterState.year = years.indexOf(previous) >= 0 ? previous : "All";
    yearFilterInput.value = filterState.year;
  }

  function applyCombinedFilters(tabBooks) {
    return tabBooks.filter(function (book) {
      var searchText = filterState.search;
      if (searchText) {
        var haystack = [book.title, book.author, book.notes].join(" ").toLowerCase();
        if (haystack.indexOf(searchText) === -1) {
          return false;
        }
      }

      if (filterState.year !== "All") {
        var bookYear = String(book.dateFinished || "").slice(0, 4);
        if (bookYear !== filterState.year) {
          return false;
        }
      }

      if (filterState.rating !== "All") {
        var bookRating = Number(book.rating);
        if (!bookRating) {
          return false;
        }

        if (filterState.rating === "5" && bookRating !== 5) {
          return false;
        }
        if (filterState.rating === "4+" && bookRating < 4) {
          return false;
        }
        if (filterState.rating === "3+" && bookRating < 3) {
          return false;
        }
      }

      return true;
    });
  }

  function isAnyFilterActive() {
    return filterState.search !== "" || filterState.year !== "All" || filterState.rating !== "All";
  }

  function getLastSixMonths() {
    var labels = [];
    var base = new Date();
    base.setDate(1);

    for (var i = 5; i >= 0; i -= 1) {
      var d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      labels.push({
        key: String(d.getFullYear()) + "-" + String(d.getMonth() + 1).padStart(2, "0"),
        label: d.toLocaleDateString(undefined, { month: "short" })
      });
    }

    return labels;
  }

  function renderMonthChart(tabBooks) {
    if (!monthChartEl) {
      return;
    }

    var months = getLastSixMonths();
    var counts = {};

    months.forEach(function (month) {
      counts[month.key] = 0;
    });

    tabBooks.forEach(function (book) {
      var key = String(book.dateFinished || "").slice(0, 7);
      if (Object.prototype.hasOwnProperty.call(counts, key)) {
        counts[key] += 1;
      }
    });

    var maxCount = 1;
    months.forEach(function (month) {
      if (counts[month.key] > maxCount) {
        maxCount = counts[month.key];
      }
    });

    monthChartEl.innerHTML = "";

    months.forEach(function (month) {
      var count = counts[month.key];
      var col = document.createElement("div");
      col.className = "chart-col";

      var value = document.createElement("div");
      value.className = "chart-value";
      value.textContent = String(count);

      var barWrap = document.createElement("div");
      barWrap.className = "chart-bar-wrap";

      var bar = document.createElement("div");
      bar.className = "chart-bar";
      bar.style.height = String(Math.round((count / maxCount) * 100)) + "%";
      bar.setAttribute("aria-label", month.label + ": " + count + " books");
      bar.title = month.label + ": " + count;

      var label = document.createElement("div");
      label.className = "chart-label";
      label.textContent = month.label;

      barWrap.appendChild(bar);
      col.appendChild(value);
      col.appendChild(barWrap);
      col.appendChild(label);
      monthChartEl.appendChild(col);
    });
  }

  function titleInitials(title) {
    var parts = String(title || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return "BK";
    }
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function coverHue(id, title) {
    var seed = String(id || "") + "|" + String(title || "");
    var hash = 0;
    var i;
    for (i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) % 360;
    }
    return String((hash + 360) % 360);
  }

  function showDataMessage(message, isError) {
    dataMessageEl.textContent = message;
    dataMessageEl.classList.remove("hidden", "error");
    if (isError) {
      dataMessageEl.classList.add("error");
    }
  }

  function clearDataMessage() {
    dataMessageEl.textContent = "";
    dataMessageEl.classList.add("hidden");
    dataMessageEl.classList.remove("error");
  }

  function renderEmptyState(message) {
    if (activeView === "list") {
      var emptyList = document.createElement("li");
      emptyList.className = "empty";
      emptyList.textContent = message;
      listEl.appendChild(emptyList);
    } else {
      var emptyShelf = document.createElement("div");
      emptyShelf.className = "empty";
      emptyShelf.textContent = message;
      shelfEl.appendChild(emptyShelf);
    }
  }

  function renderList(books) {
    books.forEach(function (book) {
      var item = document.createElement("li");
      item.className = "book-item";

      var head = document.createElement("div");
      head.className = "book-head";

      var title = document.createElement("h3");
      title.textContent = book.title;
      head.appendChild(title);

      if (book.rating) {
        var stars = document.createElement("span");
        stars.className = "stars";
        stars.textContent = ratingStars(book.rating);
        stars.setAttribute("aria-label", "Rating: " + book.rating + " out of 5");
        stars.title = "Rating: " + book.rating + "/5";
        head.appendChild(stars);
      }

      item.appendChild(head);

      var meta = document.createElement("p");
      meta.className = "meta";
      var authorPart = book.author ? " by " + book.author : "";
      meta.textContent = book.kid + authorPart + " | Finished: " + formatDate(book.dateFinished);
      item.appendChild(meta);

      if (book.notes) {
        var notesWrap = document.createElement("div");
        notesWrap.className = "notes-wrap";

        var notesId = "notes_" + book.id;
        var notesToggle = document.createElement("button");
        notesToggle.type = "button";
        notesToggle.className = "notes-toggle";
        notesToggle.textContent = "Show Notes";
        notesToggle.setAttribute("aria-expanded", "false");
        notesToggle.setAttribute("aria-controls", notesId);

        var notes = document.createElement("p");
        notes.className = "notes hidden";
        notes.id = notesId;
        notes.textContent = book.notes;

        notesToggle.addEventListener("click", function () {
          var isHidden = notes.classList.contains("hidden");
          notes.classList.toggle("hidden", !isHidden);
          notesToggle.textContent = isHidden ? "Hide Notes" : "Show Notes";
          notesToggle.setAttribute("aria-expanded", isHidden ? "true" : "false");
        });

        notesWrap.appendChild(notesToggle);
        notesWrap.appendChild(notes);
        item.appendChild(notesWrap);
      }

      var actions = document.createElement("div");
      actions.className = "item-actions";

      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", function () {
        startEdit(book);
      });

      var deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.textContent = "Delete";
      deleteBtn.className = "danger";
      deleteBtn.addEventListener("click", function () {
        removeBook(book.id);
      });

      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
      item.appendChild(actions);
      listEl.appendChild(item);
    });
  }

  function openBookModal(book) {
    modalBookId = book.id;
    modalTitleEl.textContent = book.title;

    var authorPart = book.author ? " by " + book.author : "";
    modalMetaEl.textContent = book.kid + authorPart + " | Finished: " + formatDate(book.dateFinished);

    if (book.rating) {
      modalRatingEl.classList.remove("hidden");
      modalRatingEl.textContent = ratingStars(book.rating) + " (" + book.rating + "/5)";
    } else {
      modalRatingEl.classList.add("hidden");
      modalRatingEl.textContent = "";
    }

    if (book.notes) {
      modalNotesEl.classList.remove("hidden");
      modalNotesEl.textContent = book.notes;
    } else {
      modalNotesEl.classList.add("hidden");
      modalNotesEl.textContent = "";
    }

    modalEl.classList.remove("hidden");
    modalCloseBtn.focus();
  }

  function closeBookModal() {
    modalBookId = null;
    modalEl.classList.add("hidden");
  }

  function renderShelf(books) {
    books.forEach(function (book) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "shelf-card";
      card.setAttribute("aria-label", "Open details for " + book.title);

      var cover = document.createElement("div");
      cover.className = "cover";
      cover.style.setProperty("--cover-hue", coverHue(book.id, book.title));

      var initials = document.createElement("span");
      initials.className = "cover-initials";
      initials.textContent = titleInitials(book.title);
      cover.appendChild(initials);

      var title = document.createElement("p");
      title.className = "shelf-title";
      title.textContent = book.title;

      var author = document.createElement("p");
      author.className = "shelf-author";
      author.textContent = book.author ? book.author : "Author unknown";

      var date = document.createElement("p");
      date.className = "shelf-date";
      date.textContent = "Finished: " + formatDate(book.dateFinished);

      card.appendChild(cover);
      card.appendChild(title);
      card.appendChild(author);
      card.appendChild(date);

      if (book.rating) {
        var stars = document.createElement("p");
        stars.className = "stars";
        stars.textContent = ratingStars(book.rating);
        card.appendChild(stars);
      }

      card.addEventListener("click", function () {
        openBookModal(book);
      });

      card.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          openBookModal(book);
        }
      });

      shelfEl.appendChild(card);
    });
  }

  function render() {
    var books = loadBooks();
    books.sort(sortByDateDesc);

    updateKidSelectOptions(loadKids());

    var tabBooks = filteredBooks(books, activeTab);
    populateYearFilterOptions(tabBooks);
    renderMonthChart(tabBooks);

    var visible = applyCombinedFilters(tabBooks);
    statsEl.textContent = "Total books: " + visible.length + " | Books this year: " + booksThisYear(visible);

    listEl.innerHTML = "";
    shelfEl.innerHTML = "";

    listEl.classList.toggle("hidden", activeView !== "list");
    shelfEl.classList.toggle("hidden", activeView !== "shelf");

    if (visible.length === 0) {
      renderEmptyState(emptyMessageForTab(activeTab, isAnyFilterActive()));
      return;
    }

    if (activeView === "list") {
      renderList(visible);
    } else {
      renderShelf(visible);
    }
  }

  function clearForm() {
    editingId = null;
    form.reset();
    dateInput.value = todayIso();
    submitBtn.textContent = "Add Book";
    cancelEditBtn.classList.add("hidden");
  }

  function startEdit(book) {
    closeBookModal();
    editingId = book.id;
    kidInput.value = book.kid;
    titleInput.value = book.title;
    authorInput.value = book.author || "";
    dateInput.value = book.dateFinished || todayIso();
    ratingInput.value = book.rating || "";
    notesInput.value = book.notes || "";
    submitBtn.textContent = "Save Changes";
    cancelEditBtn.classList.remove("hidden");
    titleInput.focus();
  }

  function removeBook(id) {
    var books = loadBooks().filter(function (book) {
      return book.id !== id;
    });
    saveBooks(books);
    syncKidsFromBooks();

    if (editingId === id) {
      clearForm();
    }
    if (modalBookId === id) {
      closeBookModal();
    }

    render();
  }

  function upsertBook(entry) {
    var books = loadBooks();

    if (editingId) {
      books = books.map(function (book) {
        return book.id === editingId ? Object.assign({}, book, entry, { id: editingId }) : book;
      });
    } else {
      books.push(Object.assign({}, entry, { id: makeId() }));
    }

    saveBooks(books);
    syncKidsFromBooks();
    clearForm();
    render();
  }

  function handleSubmit(event) {
    event.preventDefault();

    var title = titleInput.value.trim();
    if (!title) {
      titleInput.focus();
      return;
    }

    var entry = {
      kid: kidInput.value,
      title: title,
      author: authorInput.value.trim(),
      dateFinished: dateInput.value || todayIso(),
      rating: normalizeRating(ratingInput.value),
      notes: notesInput.value.trim()
    };

    upsertBook(entry);
    clearDataMessage();
  }

  function setActiveTab(newTab, shouldFocus) {
    activeTab = newTab;

    tabButtons.forEach(function (btn) {
      var isActive = btn.getAttribute("data-tab") === activeTab;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
      btn.setAttribute("tabindex", isActive ? "0" : "-1");
      if (isActive && shouldFocus) {
        btn.focus();
      }
    });

    render();
  }

  function setActiveView(newView, shouldFocus) {
    activeView = newView === "shelf" ? "shelf" : "list";
    saveViewPreference(activeView);

    viewButtons.forEach(function (btn) {
      var isActive = btn.getAttribute("data-view") === activeView;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      if (isActive && shouldFocus) {
        btn.focus();
      }
    });

    render();
  }

  function setupTabs() {
    tabButtons.forEach(function (button, index) {
      button.addEventListener("click", function () {
        setActiveTab(button.getAttribute("data-tab"), false);
      });

      button.addEventListener("keydown", function (event) {
        var key = event.key;
        var nextIndex = index;

        if (key === "ArrowRight") {
          nextIndex = (index + 1) % tabButtons.length;
        } else if (key === "ArrowLeft") {
          nextIndex = (index - 1 + tabButtons.length) % tabButtons.length;
        } else if (key === "Home") {
          nextIndex = 0;
        } else if (key === "End") {
          nextIndex = tabButtons.length - 1;
        } else {
          return;
        }

        event.preventDefault();
        setActiveTab(tabButtons[nextIndex].getAttribute("data-tab"), true);
      });
    });

    setActiveTab(activeTab, false);
  }

  function setupViewToggle() {
    activeView = loadViewPreference();

    viewButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        setActiveView(button.getAttribute("data-view"), false);
      });

      button.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setActiveView(button.getAttribute("data-view"), true);
        }
      });
    });

    setActiveView(activeView, false);
  }

  function setupFilters() {
    searchFilterInput.addEventListener("input", function () {
      filterState.search = searchFilterInput.value.trim().toLowerCase();
      render();
    });

    yearFilterInput.addEventListener("change", function () {
      filterState.year = yearFilterInput.value;
      render();
    });

    ratingFilterInput.addEventListener("change", function () {
      filterState.rating = ratingFilterInput.value;
      render();
    });
  }

  function buildExportPayload() {
    return {
      kids: loadKids(),
      books: loadBooks()
    };
  }

  function downloadJson(filename, payload) {
    var json = JSON.stringify(payload, null, 2);
    var blob = new Blob([json], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function isValidBookShape(book) {
    if (!book || typeof book !== "object") {
      return false;
    }

    if (typeof book.id !== "string" || !book.id.trim()) {
      return false;
    }
    if (typeof book.kid !== "string" || !book.kid.trim()) {
      return false;
    }
    if (typeof book.title !== "string" || !book.title.trim()) {
      return false;
    }
    if (typeof book.dateFinished !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(book.dateFinished)) {
      return false;
    }

    return true;
  }

  function validateImportPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return "JSON must be an object with kids and books arrays.";
    }
    if (!Array.isArray(payload.kids)) {
      return "Import failed: 'kids' must be an array.";
    }
    if (!Array.isArray(payload.books)) {
      return "Import failed: 'books' must be an array.";
    }

    for (var i = 0; i < payload.books.length; i += 1) {
      if (!isValidBookShape(payload.books[i])) {
        return "Import failed: each book needs id, kid, title, and dateFinished (YYYY-MM-DD).";
      }
    }

    return "";
  }

  function mergeImportedData(payload) {
    var existingBooks = loadBooks();
    var existingIds = {};

    existingBooks.forEach(function (book) {
      existingIds[book.id] = true;
    });

    var importedBooks = payload.books.filter(function (book) {
      return !existingIds[book.id];
    });

    var mergedBooks = existingBooks.concat(importedBooks);

    var importedKids = uniqStrings(payload.kids.concat(payload.books.map(function (book) {
      return book.kid;
    })));

    var mergedKids = uniqStrings(loadKids().concat(importedKids));

    saveBooks(mergedBooks);
    saveKids(mergedKids);

    return {
      addedBooks: importedBooks.length,
      skippedBooks: payload.books.length - importedBooks.length
    };
  }

  function handleExport() {
    try {
      downloadJson("kids-reading-tracker.json", buildExportPayload());
      showDataMessage("Export complete. File downloaded: kids-reading-tracker.json", false);
    } catch (err) {
      showDataMessage("Export failed. Please try again.", true);
    }
  }

  function handleImportFile(file) {
    if (!file) {
      return;
    }

    var reader = new FileReader();

    reader.onload = function () {
      try {
        var payload = JSON.parse(String(reader.result || ""));
        var validationError = validateImportPayload(payload);

        if (validationError) {
          showDataMessage(validationError, true);
          return;
        }

        var result = mergeImportedData(payload);
        render();
        showDataMessage(
          "Import complete. Added " + result.addedBooks + " book(s), skipped " + result.skippedBooks + " duplicate id(s).",
          false
        );
      } catch (err) {
        showDataMessage("Import failed: invalid JSON file.", true);
      } finally {
        importFileInput.value = "";
      }
    };

    reader.onerror = function () {
      importFileInput.value = "";
      showDataMessage("Import failed: unable to read file.", true);
    };

    reader.readAsText(file);
  }

  function setupDataTools() {
    exportBtn.addEventListener("click", handleExport);

    importBtn.addEventListener("click", function () {
      importFileInput.click();
    });

    importFileInput.addEventListener("change", function () {
      var file = importFileInput.files && importFileInput.files[0] ? importFileInput.files[0] : null;
      handleImportFile(file);
    });
  }

  function findBookById(id) {
    return loadBooks().find(function (book) {
      return book.id === id;
    }) || null;
  }

  function setupModal() {
    modalCloseBtn.addEventListener("click", closeBookModal);

    modalEl.addEventListener("click", function (event) {
      if (event.target === modalEl) {
        closeBookModal();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !modalEl.classList.contains("hidden")) {
        closeBookModal();
      }
    });

    modalEditBtn.addEventListener("click", function () {
      if (!modalBookId) {
        return;
      }
      var book = findBookById(modalBookId);
      if (book) {
        startEdit(book);
      }
    });

    modalDeleteBtn.addEventListener("click", function () {
      if (!modalBookId) {
        return;
      }
      removeBook(modalBookId);
    });
  }

  form.addEventListener("submit", handleSubmit);
  cancelEditBtn.addEventListener("click", clearForm);

  dateInput.value = todayIso();
  syncKidsFromBooks();
  setupFilters();
  setupDataTools();
  setupModal();
  setupViewToggle();
  setupTabs();
})();
