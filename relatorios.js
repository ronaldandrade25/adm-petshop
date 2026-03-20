// js/relatorios.js
// ✅ AJUSTES ADICIONADOS (sem remover funções existentes):
// 1) Resumo geral de gestão (mg* spans + mgPaySummaryTbody) agora é preenchido ao gerar relatório
// 2) Saídas / Despesas:
//    - CRUD básico (salvar + listar + excluir) na aba Relatórios (expenseForm / expenseTableBody)
//    - CRUD básico (salvar + listar + excluir) no Modal Resumo Geral (exp* / expTbody)
//    - Busca despesas por período (relDe / relAte)
// 3) Modal "Resumo geral / Despesas":
//    - ao abrir (evento resumoGeral:open disparado pelo firebase.js) atualiza KPIs e lista despesas do período
//
// Observação: não mudei sua estrutura de gráficos/tabelas de serviços e produtos,
// apenas acoplei gestão e despesas no fluxo já existente.
//
// ✅ FIX PERMISSÕES (IMPORTANTE):
// Suas rules liberam despesas em /rabarbearia_expenses.
// Então aqui trocamos a collection "despesas" -> "rabarbearia_expenses" (sem quebrar nada).

import {
  db, $, showNotification,
  state, waitForAuth,
  ONLY_PRO, getProfLabelByColecao, getSelectedColecao,
  collection, query, where, getDocs,
  addDoc, deleteDoc, doc, updateDoc, serverTimestamp,
  formatCurrency, formatDate, ymdToDateObj, todayYmd, parseMoney,
  PAYMENT_METHODS,
} from "./firebase.js";

export function initRelatoriosTab() {
  const relProf = $("#relProf");
  const relDe = $("#relDe");
  const relAte = $("#relAte");
  const relGrupo = $("#relGrupo");
  const relGerarBtn = $("#relGerarBtn");
  const exportCsv = $("#exportCsv");

  const relDetalheTbody = $("#relDetalheTbody");
  const kpiQtd = $("#kpiQtd");
  const kpiBruto = $("#kpiBruto");
  const kpiTicket = $("#kpiTicket");

  const reportsChartCanvas = $("#reportsChart");
  const reportsChartLegend = $("#reportsChartLegend");
  const reportsProfChartCanvas = $("#reportsProfChart");
  const reportsProfLegend = $("#reportsProfLegend");
  const reportsGrupoChartCanvas = $("#reportsGrupoChart");
  const reportsGrupoLegend = $("#reportsGrupoLegend");

  const prodRelTbody = $("#prodRelTbody");

  // ✅ Gestão (visível na aba)
  const mgTotalAppointments = $("#mgTotalAppointments");
  const mgServicesRevenue = $("#mgServicesRevenue");
  const mgProductsRevenue = $("#mgProductsRevenue");
  const mgProductsQty = $("#mgProductsQty");
  const mgOverallRevenue = $("#mgOverallRevenue");
  const mgExpensesTotal = $("#mgExpensesTotal");
  const mgNetResult = $("#mgNetResult");
  const mgPaySummaryTbody = $("#mgPaySummaryTbody");

  // ✅ Despesas (visível na aba)
  const expenseForm = $("#expenseForm");
  const expenseDate = $("#expenseDate");
  const expenseDesc = $("#expenseDesc");
  const expenseCategory = $("#expenseCategory");
  const expenseMethod = $("#expenseMethod");
  const expenseValue = $("#expenseValue");
  const expenseTableBody = $("#expenseTableBody");

  // ✅ Modal Resumo Geral / Despesas
  const rgKpiQtd = $("#rgKpiQtd");
  const rgKpiServicos = $("#rgKpiServicos");
  const rgKpiProdutos = $("#rgKpiProdutos");
  const rgKpiDespesas = $("#rgKpiDespesas");
  const rgKpiLiquido = $("#rgKpiLiquido");

  const expData = $("#expData");
  const expCategoria = $("#expCategoria");
  const expDesc = $("#expDesc");
  const expValor = $("#expValor");
  const expSalvarBtn = $("#expSalvarBtn");
  const expLimparBtn = $("#expLimparBtn");
  const expTbody = $("#expTbody");

  if (!relGerarBtn || !relDetalheTbody) return;

  // ✅ Coleção correta de despesas (bate com as regras do Firestore)
  const EXPENSES_COLLECTION = "rabarbearia_expenses";

  function destroyChart(inst) {
    try { inst?.destroy?.(); } catch { }
  }

  function setLegend(el, items) {
    if (!el) return;
    el.innerHTML = (items || [])
      .map((it) => `
        <div class="legend-item">
          <span class="legend-dot" style="background:${it.color}"></span>
          <span>${it.label}</span>
        </div>
      `)
      .join("");
  }

  function buildLegendFromChart(chart) {
    if (!chart) return [];
    const meta = chart.data?.datasets?.[0];
    const bg = meta?.backgroundColor;
    const labels = chart.data?.labels || [];
    if (!labels.length) return [];
    return labels.map((l, i) => ({
      label: l,
      color: Array.isArray(bg) ? (bg[i] || "#94a3b8") : (bg || "#94a3b8"),
    }));
  }

  /* ============================================================
     SERVIÇOS (agendamentos) - leitura
  ============================================================ */
  async function fetchAppointmentsRange(colecao, deYmd, ateYmd) {
    await waitForAuth();
    const rows = [];

    const qy = query(
      collection(db, colecao),
      where("data", ">=", deYmd),
      where("data", "<=", ateYmd)
    );

    const snap = await getDocs(qy);

    snap.forEach((d) => {
      const v = d.data() || {};
      const hora = (v.hora || "").trim();
      const data = (v.data || "").trim();
      const bloqueado = !!v.bloqueado;

      const firstName = (v.clienteNome || "").trim();
      const lastName = (v.clienteSobrenome || "").trim();
      const fullName =
        (v.clienteNomeCompleto || "").trim() ||
        [firstName, lastName].filter(Boolean).join(" ") ||
        (v.cliente || "");

      const telefone = v.clienteTelefone || v.telefoneCliente || v.phone || v.telefone || "";

      const valor =
        v.valor !== undefined && v.valor !== null
          ? Number(v.valor)
          : v.servicoValor !== undefined && v.servicoValor !== null
            ? Number(v.servicoValor)
            : 0;

      const forma = v.pagamentoForma || "";
      const raclub = v?.raclub?.status === "membro";
      const servicoNome = v.servicoNome || v.servico || "";

      rows.push({
        id: d.id,
        colecao,
        profissional: v.profissional || getProfLabelByColecao(colecao),
        data,
        hora,
        clienteNome: bloqueado && !fullName ? "" : fullName || "—",
        telefone,
        valor,
        pagamentoForma: forma,
        raclub,
        bloqueado,
        servico: servicoNome || "Serviço",
      });
    });

    rows.sort((a, b) => {
      const da = `${a.data || ""} ${a.hora || ""}`;
      const dbb = `${b.data || ""} ${b.hora || ""}`;
      return da.localeCompare(dbb);
    });

    return rows;
  }

  async function fetchAppointmentsForReports(deYmd, ateYmd, selected) {
    if (selected === "todos") {
      const all = [];
      const list = (state.PROFESSIONALS || []).length ? state.PROFESSIONALS : [ONLY_PRO];

      await Promise.all(
        list.map(async (p) => {
          const rows = await fetchAppointmentsRange(p.colecao, deYmd, ateYmd);
          all.push(...rows);
        })
      );
      return all;
    }
    return await fetchAppointmentsRange(selected, deYmd, ateYmd);
  }

  function filterAppointmentsForReports(rows, grupo) {
    return rows.filter((r) => {
      const hasClient = !!(r.clienteNome && r.clienteNome !== "—");
      if (r.bloqueado && !hasClient) return false;
      if (grupo === "membros") return r.raclub === true;
      if (grupo === "nao-membros") return r.raclub !== true;
      return true;
    });
  }

  function renderReportsTable(rows) {
    if (!relDetalheTbody) return;
    if (!rows.length) {
      relDetalheTbody.innerHTML = `<tr><td colspan="6" class="loading-row">Sem dados no período.</td></tr>`;
      return;
    }
    relDetalheTbody.innerHTML = rows
      .map((r) => `
        <tr>
          <td>${r.data ? formatDate(ymdToDateObj(r.data)) : "—"}</td>
          <td>${r.profissional || "—"}</td>
          <td>${r.clienteNome || "—"}</td>
          <td>${r.servico || "—"}</td>
          <td>${r.pagamentoForma || "—"}</td>
          <td>${formatCurrency(r.valor || 0)}</td>
        </tr>
      `)
      .join("");
  }

  function updateReportKPIs(rows) {
    const qtd = rows.length;
    const bruto = rows.reduce((sum, r) => sum + (Number(r.valor) || 0), 0);
    const comissao40 = bruto * 0.4;
    if (kpiQtd) kpiQtd.textContent = String(qtd);
    if (kpiBruto) kpiBruto.textContent = formatCurrency(bruto);
    if (kpiTicket) kpiTicket.textContent = formatCurrency(comissao40);
  }

  function buildServiceAggregation(rows) {
    const map = new Map();
    rows.forEach((r) => {
      const key = (r.servico || "Serviço").trim() || "Serviço";
      map.set(key, (map.get(key) || 0) + (Number(r.valor) || 0));
    });
    const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
    return { labels: entries.map((e) => e[0]), values: entries.map((e) => e[1]) };
  }

  function buildProfessionalCountAggregation(rows) {
    const map = new Map();
    rows.forEach((r) => {
      const key = (r.profissional || "—").trim() || "—";
      map.set(key, (map.get(key) || 0) + 1);
    });
    const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
    return { labels: entries.map((e) => e[0]), values: entries.map((e) => e[1]) };
  }

  function buildGroupAggregation(rows) {
    let qtdM = 0, qtdN = 0;
    let valM = 0, valN = 0;
    rows.forEach((r) => {
      if (r.raclub) {
        qtdM++; valM += Number(r.valor) || 0;
      } else {
        qtdN++; valN += Number(r.valor) || 0;
      }
    });
    return { labels: ["RA Club", "Cliente final"], qtd: [qtdM, qtdN], val: [valM, valN] };
  }

  function renderReportsCharts(rows) {
    // 1) serviço (pie)
    if (reportsChartCanvas) {
      destroyChart(state.charts.reportsChartInstance);
      const { labels, values } = buildServiceAggregation(rows);
      state.charts.reportsChartInstance = new Chart(reportsChartCanvas, {
        type: "pie",
        data: { labels, datasets: [{ data: values }] },
        options: { responsive: true, plugins: { legend: { display: false } } },
      });
      setLegend(reportsChartLegend, buildLegendFromChart(state.charts.reportsChartInstance));
    }

    // 2) por profissional (bar)
    if (reportsProfChartCanvas) {
      destroyChart(state.charts.reportsProfChartInstance);
      const { labels, values } = buildProfessionalCountAggregation(rows);
      state.charts.reportsProfChartInstance = new Chart(reportsProfChartCanvas, {
        type: "bar",
        data: { labels, datasets: [{ data: values }] },
        options: { responsive: true, plugins: { legend: { display: false } } },
      });
      setLegend(reportsProfLegend, buildLegendFromChart(state.charts.reportsProfChartInstance));
    }

    // 3) grupo (combo) — mantive sua ideia, só deixei mais “estável”
    if (reportsGrupoChartCanvas) {
      destroyChart(state.charts.reportsGrupoChartInstance);
      const g = buildGroupAggregation(rows);
      state.charts.reportsGrupoChartInstance = new Chart(reportsGrupoChartCanvas, {
        type: "bar",
        data: {
          labels: g.labels,
          datasets: [
            { label: "Qtd", data: g.qtd, yAxisID: "yQtd" },
            { label: "Valor", data: g.val, type: "line", yAxisID: "yVal" },
          ],
        },
        options: {
          responsive: true,
          scales: {
            yQtd: { beginAtZero: true, position: "left", ticks: { precision: 0 } },
            yVal: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false } },
          }
        },
      });
      if (reportsGrupoLegend) reportsGrupoLegend.innerHTML = "";
    }
  }

  /* ============================================================
     PRODUTOS (vendas) - leitura
  ============================================================ */
  async function fetchProductSalesForReports(deYmd, ateYmd) {
    await waitForAuth();
    const qy = query(
      collection(db, "pdv_sales"),
      where("dateYmd", ">=", deYmd),
      where("dateYmd", "<=", ateYmd)
    );
    const snap = await getDocs(qy);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  }

  function renderProductReportTable(sales, selectedProfColecao) {
    if (!prodRelTbody) return;

    const filtered = selectedProfColecao && selectedProfColecao !== "todos"
      ? sales.filter((s) => s.profColecao === selectedProfColecao)
      : sales;

    if (!filtered.length) {
      prodRelTbody.innerHTML = `<tr><td colspan="4" class="loading-row">Sem vendas de produtos no período.</td></tr>`;
      return;
    }

    const map = new Map();
    filtered.forEach((s) => {
      const prof = s.profNome || getProfLabelByColecao(s.profColecao) || "—";
      const qty = Number(s.qty || 0);
      const total = Number(s.total || 0);
      const prev = map.get(prof) || { qty: 0, total: 0 };
      map.set(prof, { qty: prev.qty + qty, total: prev.total + total });
    });

    const rows = [...map.entries()].sort((a, b) => b[1].total - a[1].total);

    prodRelTbody.innerHTML = rows
      .map(([prof, agg]) => {
        const comissao = agg.total * 0.1;
        return `
          <tr>
            <td>${prof}</td>
            <td>${agg.qty}</td>
            <td>${formatCurrency(agg.total)}</td>
            <td>${formatCurrency(comissao)}</td>
          </tr>
        `;
      })
      .join("");
  }

  /* ============================================================
     ✅ DESPESAS (Saídas) — leitura e render
  ============================================================ */
  function fillExpenseMethods() {
    // select da aba
    if (expenseMethod) {
      const current = expenseMethod.value || "";
      expenseMethod.innerHTML =
        `<option value="">Selecione</option>` +
        PAYMENT_METHODS.map((m) => `<option value="${m}">${m}</option>`).join("");
      if ([...expenseMethod.options].some(o => o.value === current)) expenseMethod.value = current;
    }
  }

  function renderExpensesTable(rows, tbodyEl) {
    if (!tbodyEl) return;

    if (!rows.length) {
      const colspan = tbodyEl === expTbody ? 5 : 6;
      tbodyEl.innerHTML = `<tr><td colspan="${colspan}" class="loading-row">Sem despesas no período.</td></tr>`;
      return;
    }

    if (tbodyEl === expenseTableBody) {
      // tabela da aba (6 colunas)
      tbodyEl.innerHTML = rows.map((x) => `
        <tr>
          <td>${x.data ? formatDate(ymdToDateObj(x.data)) : "—"}</td>
          <td>${x.descricao || "-"}</td>
          <td>${x.categoria || "-"}</td>
          <td>${x.forma || "-"}</td>
          <td>${formatCurrency(x.valor || 0)}</td>
          <td class="table-actions">
            <button type="button" class="btn btn-sm btn-del" data-exp-action="del" data-exp-id="${x.id}">
              <i class="bx bx-trash"></i>
            </button>
          </td>
        </tr>
      `).join("");
      return;
    }

    // tabela do modal (5 colunas)
    tbodyEl.innerHTML = rows.map((x) => `
      <tr>
        <td>${x.data ? formatDate(ymdToDateObj(x.data)) : "—"}</td>
        <td>${x.categoria || "-"}</td>
        <td>${x.descricao || "-"}</td>
        <td>${formatCurrency(x.valor || 0)}</td>
        <td class="table-actions" style="justify-content:flex-end;">
          <button type="button" class="btn btn-sm btn-del" data-exp-action="del" data-exp-id="${x.id}">
            <i class="bx bx-trash"></i>
          </button>
        </td>
      </tr>
    `).join("");
  }

  async function fetchExpensesRange(deYmd, ateYmd) {
    await waitForAuth();

    // ✅ tenta query por range no campo "data"
    try {
      const qy = query(
        collection(db, EXPENSES_COLLECTION),
        where("data", ">=", deYmd),
        where("data", "<=", ateYmd)
      );
      const snap = await getDocs(qy);
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
      // ordena client-side
      rows.sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")));
      return rows;
    } catch (err) {
      // fallback: lê tudo e filtra (evita travar se não existir o campo/index)
      console.warn("Falha query despesas por range, usando fallback:", err);
      const snap = await getDocs(collection(db, EXPENSES_COLLECTION));
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
      const filtered = rows.filter((x) => (x.data || "") >= deYmd && (x.data || "") <= ateYmd);
      filtered.sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")));
      return filtered;
    }
  }

  async function saveExpense({ data, descricao, categoria, forma, valor }) {
    await waitForAuth();

    if (!data || !descricao || !categoria || !valor) {
      showNotification("Preencha data, descrição, categoria e valor.", "error");
      return false;
    }

    try {
      await addDoc(collection(db, EXPENSES_COLLECTION), {
        data,
        descricao,
        categoria,
        forma: forma || "Outro",
        valor: Number(valor) || 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return true;
    } catch (err) {
      console.error(err);
      showNotification("Erro ao salvar despesa.", "error");
      return false;
    }
  }

  async function deleteExpense(expId) {
    if (!expId) return;
    try {
      await deleteDoc(doc(db, EXPENSES_COLLECTION, expId));
      showNotification("Despesa excluída.", "success");
    } catch (err) {
      console.error(err);
      showNotification("Erro ao excluir despesa.", "error");
    }
  }

  /* ============================================================
     ✅ GESTÃO / RESUMO (serviços + produtos + despesas)
  ============================================================ */
  function sumServices(rows) {
    return (rows || []).reduce((acc, r) => acc + (Number(r.valor) || 0), 0);
  }
  function sumProducts(sales) {
    return (sales || []).reduce((acc, s) => acc + (Number(s.total) || 0), 0);
  }
  function sumProductsQty(sales) {
    return (sales || []).reduce((acc, s) => acc + (Number(s.qty) || 0), 0);
  }
  function sumExpenses(expenses) {
    return (expenses || []).reduce((acc, x) => acc + (Number(x.valor) || 0), 0);
  }

  function buildPaySummary(servicesRows, productSales) {
    const map = new Map(); // forma -> { serv, prod }

    (servicesRows || []).forEach((r) => {
      const k = (r.pagamentoForma || "Outro").trim() || "Outro";
      const cur = map.get(k) || { serv: 0, prod: 0 };
      cur.serv += Number(r.valor || 0) || 0;
      map.set(k, cur);
    });

    (productSales || []).forEach((s) => {
      // tenta achar o campo de pagamento na venda
      const k = (s.method || s.forma || s.pagamentoForma || "Outro").trim() || "Outro";
      const cur = map.get(k) || { serv: 0, prod: 0 };
      cur.prod += Number(s.total || 0) || 0;
      map.set(k, cur);
    });

    return Array.from(map.entries())
      .map(([forma, v]) => ({ forma, serv: v.serv, prod: v.prod, total: v.serv + v.prod }))
      .sort((a, b) => b.total - a.total);
  }

  function renderGestao({ servicesRows, productSales, expenses }) {
    const qtdAg = (servicesRows || []).length;
    const servRev = sumServices(servicesRows);
    const prodRev = sumProducts(productSales);
    const prodQty = sumProductsQty(productSales);
    const expTot = sumExpenses(expenses);
    const overall = servRev + prodRev;
    const net = overall - expTot;

    // ✅ aba
    if (mgTotalAppointments) mgTotalAppointments.textContent = String(qtdAg);
    if (mgServicesRevenue) mgServicesRevenue.textContent = formatCurrency(servRev);
    if (mgProductsRevenue) mgProductsRevenue.textContent = formatCurrency(prodRev);
    if (mgProductsQty) mgProductsQty.textContent = String(prodQty);
    if (mgOverallRevenue) mgOverallRevenue.textContent = formatCurrency(overall);
    if (mgExpensesTotal) mgExpensesTotal.textContent = formatCurrency(expTot);
    if (mgNetResult) mgNetResult.textContent = formatCurrency(net);

    if (mgPaySummaryTbody) {
      const rows = buildPaySummary(servicesRows, productSales);
      mgPaySummaryTbody.innerHTML = rows.length
        ? rows.map((r) => `
            <tr>
              <td>${r.forma}</td>
              <td>${formatCurrency(r.serv)}</td>
              <td>${formatCurrency(r.prod)}</td>
              <td>${formatCurrency(r.total)}</td>
            </tr>
          `).join("")
        : `<tr><td colspan="4" class="loading-row">Sem dados no período.</td></tr>`;
    }

    // ✅ modal
    if (rgKpiQtd) rgKpiQtd.textContent = String(qtdAg);
    if (rgKpiServicos) rgKpiServicos.textContent = formatCurrency(servRev);
    if (rgKpiProdutos) rgKpiProdutos.textContent = formatCurrency(prodRev);
    if (rgKpiDespesas) rgKpiDespesas.textContent = formatCurrency(expTot);
    if (rgKpiLiquido) rgKpiLiquido.textContent = formatCurrency(net);
  }

  /* ============================================================
     GERAR RELATÓRIOS (serviços + produtos + gestão + despesas)
  ============================================================ */
  async function gerarRelatorios() {
    const deYmd = relDe?.value;
    const ateYmd = relAte?.value;
    const grupo = relGrupo?.value || "todos";
    const sel = relProf?.value || getSelectedColecao();

    if (!deYmd || !ateYmd) return showNotification("Selecione 'De' e 'Até'.", "error");

    try {
      relDetalheTbody.innerHTML = `<tr><td colspan="6" class="loading-row">Carregando...</td></tr>`;
      if (prodRelTbody) prodRelTbody.innerHTML = `<tr><td colspan="4" class="loading-row">Carregando...</td></tr>`;
      if (expenseTableBody) expenseTableBody.innerHTML = `<tr><td colspan="6" class="loading-row">Carregando...</td></tr>`;
      if (expTbody) expTbody.innerHTML = `<tr><td colspan="5" class="loading-row">Carregando...</td></tr>`;

      // serviços
      const raw = await fetchAppointmentsForReports(deYmd, ateYmd, sel);
      const rows = filterAppointmentsForReports(raw, grupo);

      rows.sort((a, b) => {
        const aa = `${a.data || ""} ${a.hora || ""}`;
        const bb = `${b.data || ""} ${b.hora || ""}`;
        return aa.localeCompare(bb);
      });

      state.reportCache = rows;

      renderReportsTable(rows);
      updateReportKPIs(rows);
      renderReportsCharts(rows);

      // produtos
      const sales = await fetchProductSalesForReports(deYmd, ateYmd);
      renderProductReportTable(sales, sel);

      // despesas (por período)
      const expenses = await fetchExpensesRange(deYmd, ateYmd);
      renderExpensesTable(expenses, expenseTableBody);
      renderExpensesTable(expenses, expTbody);

      // gestão (usa serviços filtrados + vendas + despesas)
      renderGestao({ servicesRows: rows, productSales: sales, expenses });

      showNotification("Relatórios gerados!", "success");
    } catch (err) {
      console.error(err);
      showNotification("Erro ao gerar relatórios.", "error");
      relDetalheTbody.innerHTML = `<tr><td colspan="6" class="loading-row">Erro ao gerar relatório.</td></tr>`;
      if (prodRelTbody) prodRelTbody.innerHTML = `<tr><td colspan="4" class="loading-row">Erro ao gerar relatório.</td></tr>`;
    }
  }

  relGerarBtn?.addEventListener("click", (e) => {
    e?.preventDefault?.();
    gerarRelatorios();
  });

  /* ============================================================
     EXPORT CSV (mantido)
  ============================================================ */
  function rowsToCsv(rows) {
    const header = ["Data", "Hora", "Profissional", "Cliente", "Serviço", "Forma", "Valor", "RAClub"];
    const lines = [header.join(";")];
    rows.forEach((r) => {
      const line = [
        r.data || "",
        r.hora || "",
        (r.profissional || "").replaceAll(";", ","),
        (r.clienteNome || "").replaceAll(";", ","),
        (r.servico || "").replaceAll(";", ","),
        (r.pagamentoForma || "").replaceAll(";", ","),
        String(Number(r.valor || 0)).replace(".", ","),
        r.raclub ? "SIM" : "NAO",
      ];
      lines.push(line.join(";"));
    });
    return lines.join("\n");
  }

  exportCsv?.addEventListener("click", async (e) => {
    e?.preventDefault?.();
    try {
      if (!state.reportCache?.length) {
        showNotification("Gere um relatório primeiro.", "error");
        return;
      }
      const csv = rowsToCsv(state.reportCache);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `relatorio_servicos_${(relDe?.value || "")}_a_${(relAte?.value || "")}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      showNotification("Erro ao exportar CSV.", "error");
    }
  });

  /* ============================================================
     ✅ DESPESAS: eventos da aba (expenseForm)
  ============================================================ */
  fillExpenseMethods();

  expenseForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const data = (expenseDate?.value || "").trim();
    const descricao = (expenseDesc?.value || "").trim();
    const categoria = (expenseCategory?.value || "").trim();
    const forma = (expenseMethod?.value || "").trim();
    const valor = parseMoney(expenseValue?.value);

    const ok = await saveExpense({ data, descricao, categoria, forma, valor });
    if (!ok) return;

    showNotification("Despesa salva.", "success");
    expenseForm.reset();
    if (expenseDate) expenseDate.value = data || todayYmd();
    fillExpenseMethods();

    // atualiza período atual (se já tiver selecionado)
    if (relDe?.value && relAte?.value) await gerarRelatorios();
  });

  expenseTableBody?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-exp-action]");
    if (!btn) return;
    const action = btn.dataset.expAction;
    const expId = btn.dataset.expId;

    if (action === "del") {
      if (!confirm("Excluir esta despesa?")) return;
      await deleteExpense(expId);
      if (relDe?.value && relAte?.value) await gerarRelatorios();
    }
  });

  /* ============================================================
     ✅ DESPESAS: eventos do modal (expSalvarBtn / expTbody)
  ============================================================ */
  expSalvarBtn?.addEventListener("click", async (e) => {
    e.preventDefault();

    const data = (expData?.value || "").trim();
    const categoria = (expCategoria?.value || "").trim();
    const descricao = (expDesc?.value || "").trim();
    const valor = parseMoney(expValor?.value);

    const ok = await saveExpense({ data, descricao, categoria, forma: "Outro", valor });
    if (!ok) return;

    showNotification("Despesa salva.", "success");
    if (expDesc) expDesc.value = "";
    if (expValor) expValor.value = "";

    if (relDe?.value && relAte?.value) await gerarRelatorios();
  });

  expLimparBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    if (expDesc) expDesc.value = "";
    if (expValor) expValor.value = "";
    if (expCategoria) expCategoria.value = "outros";
    if (expData && !expData.value) expData.value = todayYmd();
  });

  expTbody?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-exp-action]");
    if (!btn) return;
    const action = btn.dataset.expAction;
    const expId = btn.dataset.expId;

    if (action === "del") {
      if (!confirm("Excluir esta despesa?")) return;
      await deleteExpense(expId);
      if (relDe?.value && relAte?.value) await gerarRelatorios();
    }
  });

  /* ============================================================
     ✅ Ao abrir o modal (evento vindo do firebase.js), atualiza KPIs/listas
  ============================================================ */
  window.addEventListener("resumoGeral:open", async () => {
    // se não tiver período preenchido, usa mês atual até hoje
    if (!relDe?.value || !relAte?.value) return;

    try {
      // reaproveita o mesmo pipeline (serviços + produtos + despesas + gestão)
      await gerarRelatorios();
    } catch (err) {
      console.error(err);
    }
  });
}