// js/pdv.js
import {
  db, $, showNotification, mainModal,
  state, waitForAuth,
  PAYMENT_METHODS,
  getSelectedColecao, setSelectedColecao, getProfLabelByColecao,
  populateProfessionalSelects,
  addDoc, updateDoc, deleteDoc, doc, collection, onSnapshot, serverTimestamp,
  // ✅ novos imports (para listar/filtrar vendas)
  query, where, getDocs, orderBy, limit
} from "./firebase.js";

export function initPdvTab() {
  // ============================================================
  // ✅ IDs (compatível com seu HTML atual + seu JS antigo)
  // ============================================================

  // --- Produto (HTML atual)
  const pdvProdNome = $("#pdvProdNome");
  const pdvProdValor = $("#pdvProdValor");
  const pdvProdSalvarBtn = $("#pdvProdSalvarBtn");

  // --- Produto (JS antigo)
  const pdvProductForm = $("#pdvProductForm");
  const pdvProductNameInput = $("#pdvProductName");
  const pdvProductPriceInput = $("#pdvProductPrice");
  const pdvProductStockInput = $("#pdvProductStock");

  const pdvProductsTbody = $("#pdvProductsTbody");

  // --- Venda (HTML atual)
  const pdvSaleProfSelect = $("#pdvSaleProf");
  const pdvSaleProductSelect = $("#pdvSaleProduto") || $("#pdvSaleProduct");
  const pdvSaleQtyInput = $("#pdvSaleQtd") || $("#pdvSaleQty");
  const pdvSaleAddBtn = $("#pdvSaleAddBtn");

  // --- Venda (JS antigo)
  const pdvSaleForm = $("#pdvSaleForm");
  const pdvSaleMethodSelect = $("#pdvSaleMethod"); // (se existir no seu projeto antigo)

  // --- Últimas vendas (HTML atual)
  const pdvSalesTbody = $("#pdvSalesTbody");
  const pdvSalesDe = $("#pdvSalesDe");
  const pdvSalesAte = $("#pdvSalesAte");
  const pdvFiltrarVendas = $("#pdvFiltrarVendas");

  if (!pdvProductsTbody && !pdvSaleForm && !pdvSaleAddBtn) return;

  // ============================================================
  // Helpers
  // ============================================================
  const pad2 = (n) => String(n).padStart(2, "0");
  const todayYmd = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };
  const formatBRL = (v) =>
    (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const ymdToBr = (ymd) => {
    if (!ymd || typeof ymd !== "string" || !ymd.includes("-")) return "—";
    const [y, m, d] = ymd.split("-");
    if (!y || !m || !d) return ymd;
    return `${d}/${m}/${y}`;
  };

  function fillPdvPaymentMethods() {
    if (!pdvSaleMethodSelect) return;
    pdvSaleMethodSelect.innerHTML =
      `<option value="">Selecione</option>` +
      PAYMENT_METHODS.map((m) => `<option value="${m}">${m}</option>`).join("");
  }

  function fillPdvProfOptions() {
    if (!pdvSaleProfSelect) return;

    const opts = (state.PROFESSIONALS || [])
      .map((p) => `<option value="${p.colecao}">${p.label || p.nome || p.colecao}</option>`)
      .join("");

    pdvSaleProfSelect.innerHTML =
      opts || `<option value="${getSelectedColecao()}">${getProfLabelByColecao(getSelectedColecao())}</option>`;

    pdvSaleProfSelect.disabled = false;
    setSelectedColecao(getSelectedColecao());
  }

  // ============================================================
  // ✅ PRODUTOS: render + editar + excluir
  // ============================================================
  function renderPdvProducts() {
    // tabela produtos
    if (pdvProductsTbody) {
      if (!state.pdvProducts?.length) {
        // seu HTML atual tem 3 colunas (Produto, Valor, Ações)
        pdvProductsTbody.innerHTML = `<tr><td colspan="3" class="loading-row">Nenhum produto cadastrado.</td></tr>`;
      } else {
        pdvProductsTbody.innerHTML = state.pdvProducts
          .map((p) => {
            const price = p.price == null ? "—" : formatBRL(p.price);
            return `
              <tr>
                <td>${p.name || "—"}</td>
                <td>${price}</td>
                <td style="text-align:right;">
                  <div class="table-actions" style="justify-content:flex-end; gap:8px;">
                    <!-- ✅ editar -->
                    <button type="button" class="btn btn-sm btn-light" data-pdv-edit="${p.id}" title="Editar produto">
                      <i class="bx bx-edit-alt"></i>
                    </button>
                    <!-- ✅ excluir -->
                    <button type="button" class="btn btn-sm btn-del" data-pdv-del="${p.id}" title="Remover produto">
                      <i class="bx bx-trash"></i>
                    </button>
                  </div>
                </td>
              </tr>
            `;
          })
          .join("");
      }
    }

    // select de produtos na venda
    if (pdvSaleProductSelect) {
      pdvSaleProductSelect.innerHTML =
        `<option value="">Selecione</option>` +
        (state.pdvProducts || [])
          .filter((p) => p.ativo !== false)
          .map((p) => {
            const label =
              p.price != null
                ? `${p.name} • ${formatBRL(p.price)}`
                : p.name;
            return `<option value="${p.id}">${label}</option>`;
          })
          .join("");
    }
  }

  async function openEditProductModal(productId) {
    await waitForAuth();
    const p = (state.pdvProducts || []).find((x) => x.id === productId);
    if (!p) return showNotification("Produto não encontrado.", "error");

    const currentName = p.name || "";
    const currentPrice = p.price == null ? "" : String(p.price);
    const currentStock = p.stock == null ? "" : String(p.stock);
    const currentAtivo = p.ativo !== false;

    mainModal.show({
      title: "Editar produto",
      body: `
        <div class="form-grid">
          <div class="field">
            <label>Nome</label>
            <input id="pdvEditNome" value="${String(currentName).replaceAll('"', "&quot;")}" />
          </div>

          <div class="field">
            <label>Preço (R$)</label>
            <input id="pdvEditPreco" type="number" step="0.01" value="${String(currentPrice).replaceAll('"', "&quot;")}" />
          </div>

          <div class="field">
            <label>Estoque (opcional)</label>
            <input id="pdvEditEstoque" type="number" step="1" value="${String(currentStock).replaceAll('"', "&quot;")}" />
          </div>

          <div class="field">
            <label>Ativo</label>
            <select id="pdvEditAtivo">
              <option value="true" ${currentAtivo ? "selected" : ""}>Sim</option>
              <option value="false" ${!currentAtivo ? "selected" : ""}>Não</option>
            </select>
            <small class="muted">Se ficar "Não", ele some do seletor de venda.</small>
          </div>
        </div>
      `,
      buttons: [
        { text: "Cancelar", class: "btn-light" },
        {
          text: "Salvar",
          class: "btn-edit",
          onClick: async () => {
            try {
              const nome = ($("#pdvEditNome")?.value || "").trim();
              const precoRaw = $("#pdvEditPreco")?.value;
              const estoqueRaw = $("#pdvEditEstoque")?.value;
              const ativoRaw = $("#pdvEditAtivo")?.value;

              if (!nome) return showNotification("Informe o nome do produto.", "error");

              const preco =
                precoRaw === "" || precoRaw == null ? null : Number(precoRaw);
              const estoque =
                estoqueRaw === "" || estoqueRaw == null ? 0 : Number(estoqueRaw);

              await updateDoc(doc(db, "produtos", productId), {
                nome,
                preco: Number.isNaN(preco) ? null : preco,
                estoque: Number.isNaN(estoque) ? 0 : estoque,
                ativo: ativoRaw !== "false",
                updatedAt: serverTimestamp(),
              });

              showNotification("Produto atualizado!", "success");
            } catch (err) {
              console.error(err);
              showNotification("Erro ao atualizar produto.", "error");
            }
          },
        },
      ],
    });
  }

  // cadastrar produto (compatível com botão do HTML atual OU form antigo)
  async function handleCreateProduct() {
    try {
      await waitForAuth();

      const name =
        (pdvProdNome?.value || pdvProductNameInput?.value || "").trim();

      const priceVal =
        pdvProdValor?.value ?? pdvProductPriceInput?.value ?? "";

      const stockVal =
        pdvProductStockInput?.value ?? ""; // só existe no JS antigo / alguns layouts

      const price = priceVal !== "" ? Number(priceVal) : null;
      const stock = stockVal !== "" ? Number(stockVal) : 0;

      if (!name) return showNotification("Informe o nome do produto.", "error");

      await addDoc(collection(db, "produtos"), {
        nome: name,
        preco: Number.isNaN(price) ? null : price,
        estoque: Number.isNaN(stock) ? 0 : stock,
        ativo: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // limpa campos
      if (pdvProductForm) pdvProductForm.reset();
      if (pdvProdNome) pdvProdNome.value = "";
      if (pdvProdValor) pdvProdValor.value = "";

      showNotification("Produto cadastrado!", "success");
    } catch (err) {
      console.error(err);
      showNotification("Erro ao cadastrar produto.", "error");
    }
  }

  pdvProductForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await handleCreateProduct();
  });

  pdvProdSalvarBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    await handleCreateProduct();
  });

  // ações na tabela de produtos (editar/excluir)
  pdvProductsTbody?.addEventListener("click", async (e) => {
    const btnEdit = e.target.closest("[data-pdv-edit]");
    const btnDel = e.target.closest("[data-pdv-del]");

    if (btnEdit) {
      const id = btnEdit.dataset.pdvEdit;
      if (!id) return;
      return openEditProductModal(id);
    }

    if (btnDel) {
      const id = btnDel.dataset.pdvDel;
      if (!id) return;

      mainModal.show({
        title: "Remover produto",
        body: "<p>Deseja remover este produto?</p>",
        buttons: [
          { text: "Cancelar", class: "btn-light" },
          {
            text: "Remover",
            class: "btn-del",
            onClick: async () => {
              try {
                await waitForAuth();
                await deleteDoc(doc(db, "produtos", id));
                showNotification("Produto removido!", "success");
              } catch (err) {
                console.error(err);
                showNotification("Erro ao remover produto.", "error");
              }
            },
          },
        ],
      });
    }
  });

  // ============================================================
  // ✅ VENDAS: registrar + listar + filtrar por data
  // ============================================================
  function renderSalesTable(rows) {
    if (!pdvSalesTbody) return;

    if (!rows?.length) {
      pdvSalesTbody.innerHTML = `<tr><td colspan="5" class="loading-row">Sem vendas para exibir.</td></tr>`;
      return;
    }

    pdvSalesTbody.innerHTML = rows
      .map((s) => {
        const data = ymdToBr(s.dateYmd || "");
        const prof = s.profNome || getProfLabelByColecao(s.profColecao) || "—";
        const produto = s.productName || s.product || "—";
        const qtd = Number(s.qty || 0);
        const total = formatBRL(s.total || 0);

        return `
          <tr>
            <td>${data}</td>
            <td>${prof}</td>
            <td>${produto}</td>
            <td>${qtd}</td>
            <td>${total}</td>
          </tr>
        `;
      })
      .join("");
  }

  async function loadSalesRange(deYmd, ateYmd) {
    await waitForAuth();

    // Se não vier período, carrega as últimas 20 (mais recente)
    if (!deYmd || !ateYmd) {
      try {
        const qy = query(
          collection(db, "pdv_sales"),
          orderBy("dateYmd", "desc"),
          limit(20)
        );
        const snap = await getDocs(qy);
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
        renderSalesTable(rows);
        return;
      } catch (err) {
        console.warn("Falha ao carregar últimas vendas com orderBy(dateYmd). Tentando fallback:", err);
        const snap = await getDocs(collection(db, "pdv_sales"));
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
        rows.sort((a, b) => String(b.dateYmd || "").localeCompare(String(a.dateYmd || "")));
        renderSalesTable(rows.slice(0, 20));
        return;
      }
    }

    // Com período, filtra por dateYmd (YYYY-MM-DD)
    try {
      const qy = query(
        collection(db, "pdv_sales"),
        where("dateYmd", ">=", deYmd),
        where("dateYmd", "<=", ateYmd),
        orderBy("dateYmd", "desc")
      );
      const snap = await getDocs(qy);
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
      renderSalesTable(rows);
    } catch (err) {
      // fallback: lê tudo e filtra client-side (evita travar por índice)
      console.warn("Falha query vendas por range, usando fallback:", err);
      const snap = await getDocs(collection(db, "pdv_sales"));
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
      const filtered = rows.filter((x) => {
        const dt = String(x.dateYmd || "");
        return dt >= deYmd && dt <= ateYmd;
      });
      filtered.sort((a, b) => String(b.dateYmd || "").localeCompare(String(a.dateYmd || "")));
      renderSalesTable(filtered);
    }
  }

  async function handleRegisterSale() {
    try {
      await waitForAuth();

      const productId = pdvSaleProductSelect?.value || "";
      const profColecao = pdvSaleProfSelect?.value || getSelectedColecao();
      const qty = Number(pdvSaleQtyInput?.value || 1);

      // method pode não existir no seu HTML novo (se não tiver, salva "Outro")
      const method = pdvSaleMethodSelect?.value || "Outro";

      if (!productId) return showNotification("Selecione um produto.", "error");
      if (!qty || qty <= 0) return showNotification("Quantidade inválida.", "error");
      if (pdvSaleMethodSelect && !pdvSaleMethodSelect.value) {
        return showNotification("Selecione a forma de pagamento.", "error");
      }

      const product = (state.pdvProducts || []).find((p) => p.id === productId);
      if (!product) return showNotification("Produto não encontrado.", "error");

      const unitPrice = product.price == null ? 0 : Number(product.price);
      const total = unitPrice * qty;

      const profNome = getProfLabelByColecao(profColecao);
      const currentStock = Number(product.stock || 0);

      await addDoc(collection(db, "pdv_sales"), {
        productId,
        productName: product.name || "",
        unitPrice,
        qty,
        total,
        method,
        profColecao,
        profNome,
        createdAt: serverTimestamp(),
        dateYmd: todayYmd(),
      });

      // decrementa estoque (se você usa estoque)
      try {
        await updateDoc(doc(db, "produtos", productId), {
          estoque: currentStock - qty,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.warn("Não consegui atualizar estoque (ok se não usa estoque):", err);
      }

      // limpa UI
      if (pdvSaleForm) pdvSaleForm.reset();
      if (pdvSaleQtyInput) pdvSaleQtyInput.value = 1;

      fillPdvPaymentMethods();
      fillPdvProfOptions();
      setSelectedColecao(profColecao);

      showNotification("Venda registrada!", "success");

      // atualiza lista (mantém período se usuário filtrou)
      await loadSalesRange(pdvSalesDe?.value || "", pdvSalesAte?.value || "");
    } catch (err) {
      console.error(err);
      showNotification("Erro ao registrar venda.", "error");
    }
  }

  // compat: submit de form (antigo)
  pdvSaleForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await handleRegisterSale();
  });

  // HTML novo: botão registrar venda
  pdvSaleAddBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    await handleRegisterSale();
  });

  // Filtrar vendas por data
  pdvFiltrarVendas?.addEventListener("click", async (e) => {
    e.preventDefault();
    const de = (pdvSalesDe?.value || "").trim();
    const ate = (pdvSalesAte?.value || "").trim();

    if ((de && !ate) || (!de && ate)) {
      return showNotification("Selecione 'De' e 'Até' para filtrar.", "error");
    }

    await loadSalesRange(de, ate);
  });

  // ============================================================
  // ✅ listeners (produtos realtime) + carga inicial vendas
  // ============================================================
  (async () => {
    await waitForAuth();

    // se você usa esse helper para popular selects em outros lugares
    try { populateProfessionalSelects?.(); } catch {}

    onSnapshot(
      collection(db, "produtos"),
      (snap) => {
        state.pdvProducts = snap.docs.map((d) => {
          const v = d.data() || {};
          return {
            id: d.id,
            name: v.nome || v.name || "",
            price: v.preco ?? v.price ?? null,
            stock: v.estoque ?? v.stock ?? 0,
            ativo: v.ativo !== false,
          };
        });

        state.pdvProducts.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        renderPdvProducts();
      },
      (error) => console.error("Erro listener produtos:", error)
    );

    fillPdvPaymentMethods();
    fillPdvProfOptions();
    renderPdvProducts();

    // carrega últimas vendas (ou período já preenchido)
    if (pdvSalesDe && pdvSalesAte && (pdvSalesDe.value || pdvSalesAte.value)) {
      await loadSalesRange(pdvSalesDe.value || "", pdvSalesAte.value || "");
    } else {
      await loadSalesRange("", "");
    }
  })();
}