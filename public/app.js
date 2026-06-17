import Fuse from "/vendor/fuse.min.mjs";

const state = {
  services: [],
  results: [],
  budget: [],
  fuse: null,
  selectedService: null,
  isSyncing: false
};

const storageKeys = {
  budget: "seinfra-budget-items",
  lastUpdate: "seinfra-last-update"
};

const elements = {
  searchInput: document.querySelector("#searchInput"),
  unitFilter: document.querySelector("#unitFilter"),
  searchButton: document.querySelector("#searchButton"),
  pdfButton: document.querySelector("#pdfButton"),
  statusMessage: document.querySelector("#statusMessage"),
  resultCount: document.querySelector("#resultCount"),
  resultsBody: document.querySelector("#resultsBody"),
  budgetBody: document.querySelector("#budgetBody"),
  grandTotal: document.querySelector("#grandTotal"),
  suggestions: document.querySelector("#suggestions"),
  modal: document.querySelector("#itemModal"),
  itemForm: document.querySelector("#itemForm"),
  modalServiceCode: document.querySelector("#modalServiceCode"),
  modalServiceDescription: document.querySelector("#modalServiceDescription"),
  activityInput: document.querySelector("#activityInput"),
  quantityInput: document.querySelector("#quantityInput"),
  loadingOverlay: document.querySelector("#loadingOverlay")
};

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});

const numberFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4
});

function formatCurrency(value) {
  return currencyFormatter.format(Number(value || 0));
}

function formatNumber(value) {
  return numberFormatter.format(Number(value || 0));
}

function normalizeText(value) {
  return String(value || "")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/ª/g, "a")
    .replace(/º/g, "o")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function setStatus(message, type = "default") {
  elements.statusMessage.textContent = message;
  elements.statusMessage.classList.toggle("warning", type === "warning");
}

async function readApiJson(response, fallbackMessage) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  if (!contentType.includes("application/json")) {
    const preview = text.replace(/\s+/g, " ").trim().slice(0, 160);
    const detail = preview ? ` Trecho recebido: ${preview}` : "";
    throw new Error(`${fallbackMessage} A API retornou uma resposta que não é JSON.${detail}`);
  }

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${fallbackMessage} A API retornou um JSON inválido.`);
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.message || fallbackMessage);
  }

  return data;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("A verificação da SEINFRA demorou demais. A base local será usada agora.");
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function setLoading(isLoading) {
  state.isSyncing = isLoading;
  elements.loadingOverlay.hidden = !isLoading;
  elements.searchButton.disabled = isLoading || state.services.length === 0;
  elements.searchInput.disabled = isLoading || state.services.length === 0;
  elements.unitFilter.disabled = isLoading || state.services.length === 0;
}

function saveBudget() {
  localStorage.setItem(storageKeys.budget, JSON.stringify(state.budget));
}

function loadBudget() {
  try {
    state.budget = JSON.parse(localStorage.getItem(storageKeys.budget) || "[]");
  } catch {
    state.budget = [];
  }
}

function updateBaseInfo(_total, lastUpdate) {
  if (lastUpdate) {
    localStorage.setItem(storageKeys.lastUpdate, lastUpdate);
  }
}

function buildFuse() {
  state.fuse = new Fuse(state.services, {
    keys: ["codigo", "descricao", "unidade", "conta", "caminho", "texto_busca"],
    threshold: 0.34,
    ignoreLocation: true,
    minMatchCharLength: 2
  });
}

function applySearch() {
  if (state.services.length === 0) {
    state.results = [];
    renderResults();
    setStatus("A base SEINFRA ainda não está disponível.", "warning");
    return;
  }

  const term = elements.searchInput.value.trim();
  const normalizedTerm = normalizeText(term);
  const unit = elements.unitFilter.value;
  const baseResults =
    normalizedTerm.length >= 2
      ? state.fuse.search(normalizedTerm).map((entry) => entry.item)
      : [...state.services];

  state.results = baseResults
    .filter((service) => !unit || service.unidade === unit)
    .slice(0, 120);

  renderResults();

  if (state.results.length === 0) {
    setStatus("Nenhum serviço encontrado para este termo.", "warning");
  } else if (normalizedTerm.length === 0) {
    setStatus("Digite um termo para refinar a busca. Mostrando os primeiros serviços da base.");
  } else {
    setStatus(`${state.results.length} resultado(s) encontrados para "${term}".`);
  }
}

function renderSuggestions() {
  const term = normalizeText(elements.searchInput.value);

  if (!state.fuse || term.length < 2 || state.services.length === 0) {
    elements.suggestions.classList.remove("open");
    elements.suggestions.innerHTML = "";
    return;
  }

  const unit = elements.unitFilter.value;
  const suggestions = state.fuse
    .search(term)
    .map((entry) => entry.item)
    .filter((service) => !unit || service.unidade === unit)
    .slice(0, 8);

  if (suggestions.length === 0) {
    elements.suggestions.classList.remove("open");
    elements.suggestions.innerHTML = "";
    return;
  }

  elements.suggestions.innerHTML = suggestions
    .map(
      (service) => `
        <button class="suggestion-item" type="button" data-code="${service.codigo}">
          <strong>${service.codigo} · ${service.descricao}</strong>
          <span>${service.conta} · ${service.unidade} · ${formatCurrency(service.valor_unitario)}</span>
        </button>
      `
    )
    .join("");
  elements.suggestions.classList.add("open");
}

function renderResults() {
  elements.resultCount.textContent = `${state.results.length} ${state.results.length === 1 ? "item" : "itens"}`;

  if (state.services.length === 0) {
    elements.resultsBody.innerHTML = `
      <tr><td colspan="7" class="empty-cell">Aguardando a verificação automática da base SEINFRA.</td></tr>
    `;
    return;
  }

  if (state.results.length === 0) {
    elements.resultsBody.innerHTML = `
      <tr><td colspan="7" class="empty-cell">Nenhum serviço encontrado para este termo.</td></tr>
    `;
    return;
  }

  elements.resultsBody.innerHTML = state.results
    .map(
      (service) => `
        <tr>
          <td>${service.conta}</td>
          <td><span class="code-pill">${service.codigo}</span></td>
          <td class="service-text">${service.descricao}</td>
          <td class="muted">${service.caminho || "-"}</td>
          <td>${service.unidade}</td>
          <td class="money">${formatCurrency(service.valor_unitario)}</td>
          <td>
            <button class="button primary row-action" type="button" data-add-code="${service.codigo}" data-add-conta="${service.conta}">
              <i data-lucide="plus" aria-hidden="true"></i>
              Adicionar
            </button>
          </td>
        </tr>
      `
    )
    .join("");

  renderIcons();
}

function renderBudget() {
  if (state.budget.length === 0) {
    elements.budgetBody.innerHTML = `
      <tr><td colspan="8" class="empty-cell">Nenhum item no orçamento.</td></tr>
    `;
  } else {
    elements.budgetBody.innerHTML = state.budget
      .map((item) => {
        const total = Number(item.quantidade || 0) * Number(item.valor_unitario || 0);
        return `
          <tr>
            <td>${item.atividade}</td>
            <td><span class="code-pill">${item.codigo}</span></td>
            <td class="service-text">${item.descricao}</td>
            <td>${item.unidade}</td>
            <td class="number">${formatNumber(item.quantidade)}</td>
            <td class="money">${formatCurrency(item.valor_unitario)}</td>
            <td class="money">${formatCurrency(total)}</td>
            <td>
              <button class="icon-button" type="button" data-remove-id="${item.id}" aria-label="Remover ${item.codigo}">
                <i data-lucide="trash-2" aria-hidden="true"></i>
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  const grandTotal = state.budget.reduce(
    (sum, item) => sum + Number(item.quantidade || 0) * Number(item.valor_unitario || 0),
    0
  );

  elements.grandTotal.textContent = formatCurrency(grandTotal);
  elements.pdfButton.disabled = state.budget.length === 0;
  renderIcons();
}

function openModal(service) {
  state.selectedService = service;
  elements.modalServiceCode.textContent = `${service.codigo} · ${service.unidade} · ${formatCurrency(service.valor_unitario)}`;
  elements.modalServiceDescription.textContent = service.descricao;
  elements.activityInput.value = "";
  elements.quantityInput.value = "";
  elements.modal.classList.add("open");
  elements.modal.setAttribute("aria-hidden", "false");
  elements.activityInput.focus();
}

function closeModal() {
  state.selectedService = null;
  elements.modal.classList.remove("open");
  elements.modal.setAttribute("aria-hidden", "true");
}

async function loadServices() {
  const response = await fetch("/api/services");
  const data = await readApiJson(response, "Não foi possível carregar os serviços.");

  state.services = data.services || [];
  buildFuse();
  updateBaseInfo(state.services.length, data.lastUpdate);
  setLoading(false);

  if (state.services.length === 0) {
    setStatus("A base SEINFRA ainda não retornou serviços. O sistema tentará verificar novamente ao abrir.", "warning");
  } else {
    setStatus("Base local carregada. A busca já está pronta para uso.");
  }

  applySearch();
}

async function checkBaseUpdates() {
  setLoading(true);
  setStatus("Verificando atualizações da base SEINFRA...");

  const response = await fetchWithTimeout("/api/sync-seinfra", { method: "POST" });
  const data = await readApiJson(response, "Não foi possível verificar a base SEINFRA.");

  if (data.updatedAt) {
    localStorage.setItem(storageKeys.lastUpdate, data.updatedAt);
  }

  return data;
}

async function generatePdf() {
  if (state.budget.length === 0) {
    setStatus("Adicione itens ao orçamento antes de gerar o PDF.", "warning");
    return;
  }

  elements.pdfButton.disabled = true;

  try {
    const response = await fetch("/api/budget/pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(state.budget)
    });

    if (!response.ok) {
      await readApiJson(response, "Não foi possível gerar o PDF.");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "orcamento-seinfra.pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("PDF gerado com sucesso.");
  } catch (error) {
    setStatus(error.message, "warning");
  } finally {
    elements.pdfButton.disabled = state.budget.length === 0;
  }
}

function bindEvents() {
  elements.searchInput.addEventListener("input", () => {
    renderSuggestions();
    applySearch();
  });

  elements.unitFilter.addEventListener("change", () => {
    renderSuggestions();
    applySearch();
  });

  elements.searchButton.addEventListener("click", applySearch);
  elements.pdfButton.addEventListener("click", generatePdf);

  elements.suggestions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-code]");
    if (!button) {
      return;
    }

    const service = state.services.find((item) => item.codigo === button.dataset.code);
    if (!service) {
      return;
    }

    elements.searchInput.value = service.codigo;
    elements.suggestions.classList.remove("open");
    applySearch();
  });

  elements.resultsBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-add-code]");
    if (!button) {
      return;
    }

    const service = state.services.find(
      (item) => item.codigo === button.dataset.addCode && item.conta === button.dataset.addConta
    );

    if (service) {
      openModal(service);
    }
  });

  elements.budgetBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-id]");
    if (!button) {
      return;
    }

    state.budget = state.budget.filter((item) => item.id !== button.dataset.removeId);
    saveBudget();
    renderBudget();
  });

  elements.itemForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!state.selectedService) {
      return;
    }

    const quantity = Number(elements.quantityInput.value);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setStatus("Informe uma quantidade válida.", "warning");
      return;
    }

    state.budget.push({
      id: `${Date.now()}-${state.selectedService.codigo}-${Math.random().toString(16).slice(2)}`,
      atividade: elements.activityInput.value.trim(),
      conta: state.selectedService.conta,
      codigo: state.selectedService.codigo,
      descricao: state.selectedService.descricao,
      unidade: state.selectedService.unidade,
      quantidade: quantity,
      valor_unitario: Number(state.selectedService.valor_unitario)
    });

    saveBudget();
    renderBudget();
    closeModal();
    setStatus("Item adicionado ao orçamento.");
  });

  document.querySelectorAll("[data-close-modal]").forEach((element) => {
    element.addEventListener("click", closeModal);
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-field")) {
      elements.suggestions.classList.remove("open");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal();
      elements.suggestions.classList.remove("open");
    }
  });
}

async function init() {
  renderIcons();
  loadBudget();
  renderBudget();
  bindEvents();
  setLoading(true);

  try {
    const syncResult = await checkBaseUpdates();
    await loadServices();
    setStatus(syncResult.message || "Base SEINFRA verificada.");
  } catch (error) {
    try {
      await loadServices();
      setStatus(`Não foi possível verificar a base SEINFRA agora. Usando a base local. ${error.message}`, "warning");
    } catch (loadError) {
      setStatus(loadError.message || error.message, "warning");
      updateBaseInfo(0, null);
      setLoading(false);
    }
  }
}

init();
