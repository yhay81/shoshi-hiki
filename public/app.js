(() => {
  "use strict";

  const sessionKey = "shoshi-hiki-session-v1";
  const savedKey = "shoshi-hiki-saved-v1";
  const seenKey = "shoshi-hiki-seen-v1";
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  const officialPattern = /^https:\/\/ndlsearch\.ndl\.go\.jp\/books\/[A-Za-z0-9-]{8,80}$/u;
  const isQa =
    new URLSearchParams(location.search).get("qa") === "1" ||
    location.hostname === "localhost" ||
    navigator.webdriver === true;

  const readJson = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
    } catch {
      return fallback;
    }
  };

  const oldSession = localStorage.getItem(sessionKey) ?? "";
  const session = uuidPattern.test(oldSession) ? oldSession : crypto.randomUUID();
  localStorage.setItem(sessionKey, session);
  const headers = () => ({
    "Content-Type": "application/json",
    "X-Shoshi-QA": isQa ? "1" : "0",
    "X-Shoshi-Session": session,
  });
  const emit = (name) => {
    fetch("/api/telemetry", {
      body: JSON.stringify({ name }),
      headers: headers(),
      keepalive: true,
      method: "POST",
    }).catch(() => undefined);
  };
  const previousVisit = Number(localStorage.getItem(seenKey) ?? 0);
  emit("visited");
  if (previousVisit && Date.now() - previousVisit > 8 * 60 * 60 * 1000) emit("returned");
  localStorage.setItem(seenKey, String(Date.now()));

  const button = (label, className, action) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    if (className) element.className = className;
    element.addEventListener("click", action);
    return element;
  };

  const copy = async (value, target) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    const previous = target.textContent;
    target.textContent = "コピーしました";
    target.classList.add("is-done");
    setTimeout(() => {
      target.textContent = previous;
      target.classList.remove("is-done");
    }, 1400);
    emit("citation_copied");
  };

  const validSaved = () => {
    const items = readJson(savedKey, []);
    if (!Array.isArray(items)) return [];
    return items
      .filter(
        (item) =>
          item &&
          typeof item === "object" &&
          typeof item.id === "string" &&
          typeof item.title === "string" &&
          typeof item.officialUrl === "string" &&
          officialPattern.test(item.officialUrl),
      )
      .slice(0, 80);
  };
  let saved = validSaved();
  const persistSaved = () => localStorage.setItem(savedKey, JSON.stringify(saved.slice(0, 80)));
  const savedStack = document.querySelector("#saved-stack");
  const savedCount = document.querySelector("#saved-count");
  const clearSaved = document.querySelector("#clear-saved");

  const citation = (item) => {
    const creator = item.creators?.length ? `${item.creators.join("、")}『` : "『";
    const publisher = item.publishers?.join("、") ?? "";
    const edition = item.edition ? `、${item.edition}` : "";
    const isbn = item.isbns?.length ? `、ISBN ${item.isbns.at(-1)}` : "";
    const publication = [publisher, item.issued].filter(Boolean).join("、");
    return `${creator}${item.title}』${edition}${publication ? `、${publication}` : ""}${isbn}。国立国会図書館サーチ ${item.officialUrl}（${new Date().toLocaleDateString("ja-JP")}閲覧）`;
  };

  const renderSaved = () => {
    if (!savedStack || !savedCount || !clearSaved) return;
    savedStack.replaceChildren();
    savedCount.textContent = String(saved.length);
    clearSaved.hidden = saved.length === 0;
    if (!saved.length) {
      const empty = document.createElement("p");
      empty.className = "empty-saved";
      empty.textContent = "残した本が、ここにカードで並びます。";
      savedStack.append(empty);
      return;
    }
    saved.forEach((item, index) => {
      const card = document.createElement("article");
      card.className = "saved-slip";
      const mark = document.createElement("span");
      mark.textContent = item.classifications?.[0] ?? "図書";
      const title = document.createElement("a");
      title.href = item.officialUrl;
      title.rel = "noopener noreferrer";
      title.target = "_blank";
      title.textContent = item.title;
      title.addEventListener("click", () => emit("official_opened"));
      const detail = document.createElement("small");
      detail.textContent = [item.creators?.[0], item.issued].filter(Boolean).join(" / ");
      const remove = button("外す", "remove-saved", () => {
        saved.splice(index, 1);
        persistSaved();
        renderSaved();
        updateSaveButtons();
      });
      card.append(mark, title, detail, remove);
      savedStack.append(card);
    });
  };

  const updateSaveButtons = () => {
    document.querySelectorAll("[data-save-book]").forEach((itemButton) => {
      const active = saved.some((item) => item.id === itemButton.dataset.saveBook);
      itemButton.textContent = active ? "カード箱に保存済み" : "カード箱へ";
      itemButton.classList.toggle("is-saved", active);
      itemButton.setAttribute("aria-pressed", String(active));
    });
  };

  const saveBook = (item) => {
    const existing = saved.findIndex((savedItem) => savedItem.id === item.id);
    if (existing >= 0) saved.splice(existing, 1);
    else {
      saved.unshift(item);
      saved = saved.slice(0, 80);
      emit("saved");
    }
    persistSaved();
    renderSaved();
    updateSaveButtons();
  };

  clearSaved?.addEventListener("click", () => {
    saved = [];
    persistSaved();
    renderSaved();
    updateSaveButtons();
  });
  renderSaved();

  const form = document.querySelector("#search-form");
  const query = document.querySelector("#query");
  const creator = document.querySelector("#creator");
  const creatorRefine = document.querySelector("#creator-refine");
  const results = document.querySelector("#results");
  const status = document.querySelector("#search-status");
  const count = document.querySelector("#result-count");
  const modeInputs = [...document.querySelectorAll('input[name="mode"]')];
  const selectedMode = () => modeInputs.find((input) => input.checked)?.value ?? "title";

  const modeCopy = {
    title: {
      placeholder: "こころ",
      status: "タイトルに著者を添えると、目的の版を見つけやすくなります",
    },
    creator: { placeholder: "夏目漱石", status: "著者名の一部から探せます" },
    isbn: { placeholder: "9784101010014", status: "10桁または13桁のISBNを入れてください" },
  };
  const updatePlaceholder = () => {
    const mode = selectedMode();
    query.placeholder = modeCopy[mode].placeholder;
    query.inputMode = mode === "isbn" ? "numeric" : "search";
    creatorRefine.hidden = mode !== "title";
    status.textContent = modeCopy[mode].status;
  };
  modeInputs.forEach((input) => input.addEventListener("change", updatePlaceholder));

  const addMeta = (list, label, value) => {
    if (!value) return;
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value;
    list.append(term, detail);
  };

  const barcode = (isbn) => {
    const block = document.createElement("span");
    block.className = "book-barcode";
    block.setAttribute("aria-hidden", "true");
    [...(isbn || "9784101010014")].forEach((digit, index) => {
      const line = document.createElement("i");
      line.style.setProperty("--bar", `${1 + ((Number(digit) + index) % 3)}px`);
      block.append(line);
    });
    return block;
  };

  const resultCard = (item) => {
    const card = document.createElement("article");
    card.className = "book-card";
    const index = document.createElement("span");
    index.className = "book-index";
    index.textContent = item.classifications?.[0] ?? "図書";
    const head = document.createElement("div");
    head.className = "book-head";
    const source = document.createElement("span");
    source.textContent = "国立国会図書館作成書誌";
    head.append(source, barcode(item.isbns?.at(-1)));
    const title = document.createElement("h3");
    title.textContent = item.title;
    const reading = document.createElement("p");
    reading.className = "book-reading";
    reading.textContent = item.titleReading;
    const creators = document.createElement("p");
    creators.className = "book-creators";
    creators.textContent = item.creators?.join(" / ") || "責任表示なし";
    const meta = document.createElement("dl");
    meta.className = "book-meta";
    addMeta(meta, "出版", [item.publishers?.join(" / "), item.issued].filter(Boolean).join("・"));
    addMeta(meta, "版", item.edition);
    addMeta(meta, "シリーズ", item.series);
    addMeta(meta, "形態", item.extent);
    addMeta(meta, "ISBN", item.isbns?.join(" / "));
    addMeta(meta, "全国書誌番号", item.jpNumber);
    const actions = document.createElement("div");
    actions.className = "book-actions";
    const official = document.createElement("a");
    official.href = item.officialUrl;
    official.rel = "noopener noreferrer";
    official.target = "_blank";
    official.textContent = "公式記録を開く";
    official.addEventListener("click", () => emit("official_opened"));
    const copyButton = button("書誌情報をコピー", "", (event) =>
      copy(citation(item), event.currentTarget),
    );
    const saveButton = button("カード箱へ", "", () => saveBook(item));
    saveButton.dataset.saveBook = item.id;
    actions.append(official, copyButton, saveButton);
    card.append(index, head, title);
    if (reading.textContent) card.append(reading);
    card.append(creators, meta, actions);
    return card;
  };

  const renderResults = (payload) => {
    results.replaceChildren();
    if (!payload.results.length) {
      const empty = document.createElement("div");
      empty.className = "no-result";
      const seal = document.createElement("span");
      seal.textContent = "書";
      const box = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = "該当する書誌を引けませんでした";
      const note = document.createElement("p");
      note.textContent = "副題を外す、著者名を短くする、ISBNのハイフンを確認する方法も試せます。";
      box.append(title, note);
      empty.append(seal, box);
      results.append(empty);
      count.textContent = "0件";
      return;
    }
    payload.results.forEach((item) => results.append(resultCard(item)));
    count.textContent = `${payload.total.toLocaleString("ja-JP")}件中 ${payload.results.length}件`;
    updateSaveButtons();
  };

  const isbnLooksValid = (value) => /^\d{9}[\dXx]$|^\d{13}$/u.test(value.replace(/[-\s]/gu, ""));
  const search = async () => {
    const mode = selectedMode();
    if (mode === "isbn" ? !isbnLooksValid(query.value) : query.value.trim().length < 2) {
      status.textContent =
        mode === "isbn" ? "ISBNは10桁または13桁で入れてください" : "2文字以上入れてください";
      query.focus();
      return;
    }
    status.textContent = "国立国会図書館の書誌索引を確認しています…";
    form.classList.add("is-loading");
    form.querySelector('button[type="submit"]').disabled = true;
    try {
      const response = await fetch("/api/search", {
        body: JSON.stringify({
          creator: mode === "title" ? creator.value : "",
          mode,
          q: query.value,
        }),
        headers: headers(),
        method: "POST",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (error.error === "invalid_isbn") {
          status.textContent = "ISBNの数字またはチェック桁を確認してください";
          return;
        }
        if (error.error === "query_too_short") {
          status.textContent = "2文字以上入れてください";
          return;
        }
        throw new Error("search_failed");
      }
      const payload = await response.json();
      renderResults(payload);
      status.textContent = payload.results.length
        ? `${payload.results.length}枚の書誌カードを表示しました`
        : "一致する書誌はありませんでした";
      results.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch {
      status.textContent =
        "国立国会図書館サーチAPIへ接続できませんでした。少し待って、もう一度お試しください";
    } finally {
      form.classList.remove("is-loading");
      form.querySelector('button[type="submit"]').disabled = false;
    }
  };

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void search();
  });
  document.querySelectorAll("[data-example]").forEach((example) => {
    example.addEventListener("click", () => {
      const mode = example.dataset.mode ?? "title";
      const target = modeInputs.find((input) => input.value === mode);
      if (target) target.checked = true;
      query.value = example.dataset.example ?? "";
      creator.value = example.dataset.creator ?? "";
      updatePlaceholder();
      void search();
    });
  });
})();
