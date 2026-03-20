// jconfiguracoes.js
import {
  db, $, showNotification, mainModal,
  state, waitForAuth,
  CFG_DOC_HORARIOS, COL_SERVICOS, COL_PROF,
  generateHours, slugify,
  populateProfessionalSelects,
  serverTimestamp,
  addDoc, setDoc, deleteDoc, doc, getDoc,
  onSnapshot, query, orderBy,
  collection,

  // ✅ EXCEÇÕES (NOVO PADRÃO CORRETO)
  CFG_COL_EXCECOES,
  cfgExcecaoDoc,
} from "./firebase.js";

export function initConfiguracoesTab() {
  if (window.__configTabStarted) return;
  window.__configTabStarted = true;

  async function waitEl(selector, tries = 60, delay = 150) {
    for (let i = 0; i < tries; i++) {
      const el = $(selector);
      if (el) return el;
      await new Promise((r) => setTimeout(r, delay));
    }
    return null;
  }

  (async () => {
    // ===== Horário do painel =====
    const cfgInicio = await waitEl("#cfgInicio");
    const cfgFim = await waitEl("#cfgFim");
    const cfgSalvarHorario = await waitEl("#cfgSalvarHorario");

    // ✅ NOVO (HTML unificado): intervalo em minutos
    const cfgIntervalMin = await waitEl("#cfgIntervalMin");

    // ✅ NOVO: pausa almoço (opcional)
    // (se não existir no HTML, não quebra nada)
    const cfgBreakStart = await waitEl("#cfgBreakStart");
    const cfgBreakEnd = await waitEl("#cfgBreakEnd");

    // ===== Semana =====
    const cfgWeekdays = await waitEl("#cfgWeekdays");
    const cfgDayStart = await waitEl("#cfgDayStart");
    const cfgDayEnd = await waitEl("#cfgDayEnd");
    const cfgSalvarSemana = await waitEl("#cfgSalvarSemana");

    // ===== Exceções =====
    const cfgExDate = await waitEl("#cfgExDate");
    const cfgExStart = await waitEl("#cfgExStart");
    const cfgExEnd = await waitEl("#cfgExEnd");
    const cfgExClosed = await waitEl("#cfgExClosed");
    const cfgAddException = await waitEl("#cfgAddException");
    const cfgExceptionsTbody = await waitEl("#cfgExceptionsTbody");

    // ===== Profissionais =====
    const profEditId = await waitEl("#profEditId");
    const profNomeInput = await waitEl("#profNome");

    // ✅ não usamos mais arquivo (se existir no HTML antigo, escondemos)
    const profFotoFileInput = await waitEl("#profFotoFile");

    const profWppInput = await waitEl("#profWpp");
    const profAtivoInput = await waitEl("#profAtivo");
    const profSalvarBtn = await waitEl("#profSalvar");
    const profCancelarEdicaoBtn = await waitEl("#profCancelarEdicao");
    const profTbody = await waitEl("#profTbody");

    // ✅ URL continua existindo, mas agora é opcional (pode salvar sem)
    const profFotoUrlInput = await waitEl("#profFotoUrl");

    // ===== Serviços =====
    const svcNomeInput = await waitEl("#svcNome");
    const svcValorInput = await waitEl("#svcValor");
    const svcTempoInput = await waitEl("#svcTempo");
    const svcSalvarBtn = await waitEl("#svcSalvar");
    const svcTbody = await waitEl("#svcTbody");

    const CFG_DOC_SEMANA = doc(db, "config", "semana");
    const CFG_COL_EXCECOES_GERAL = CFG_COL_EXCECOES;

    // =========================
    // Helpers
    // =========================
    function escapeHtml(str) {
      return String(str ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function normalizeWpp(wpp) {
      return String(wpp || "").trim().replace(/\D+/g, "");
    }

    function normalizeUrl(url) {
      const u = String(url || "").trim();
      if (!u) return "";
      if (u.startsWith("data:image")) return "";
      if (!/^https?:\/\//i.test(u)) return "";
      return u;
    }

    function normalizeTimeOrEmpty(t) {
      const v = String(t || "").trim();
      if (!v) return "";
      // hh:mm
      if (!/^\d{2}:\d{2}$/.test(v)) return "";
      return v;
    }

    function toMinutes(hhmm) {
      const [h, m] = String(hhmm).split(":").map((x) => Number(x));
      if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
      return h * 60 + m;
    }

    // ✅ intervalo (min) robusto
    function getIntervalMinFromUI() {
      const raw = String(cfgIntervalMin?.value ?? "").trim();
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) return 25;
      return Math.max(5, Math.round(n));
    }

    // ✅ pausa almoço: retorna { breakStart, breakEnd } ou vazio se inválido
    function getBreakFromUI() {
      const bs = normalizeTimeOrEmpty(cfgBreakStart?.value || "");
      const be = normalizeTimeOrEmpty(cfgBreakEnd?.value || "");

      // se não preencheu nada, não usa pausa
      if (!bs && !be) return { breakStart: "", breakEnd: "" };

      // se preencheu só um, ignora (não trava)
      if (!bs || !be) return { breakStart: "", breakEnd: "" };

      // se start >= end, ignora (não trava)
      const ms = toMinutes(bs);
      const me = toMinutes(be);
      if (!Number.isFinite(ms) || !Number.isFinite(me) || ms >= me) {
        return { breakStart: "", breakEnd: "" };
      }

      return { breakStart: bs, breakEnd: be };
    }

    function isPermissionError(err) {
      const msg = String(err?.message || err || "").toLowerCase();
      return (
        msg.includes("missing or insufficient permissions") ||
        msg.includes("permission-denied") ||
        msg.includes("permission denied")
      );
    }

    // ✅ tenta executar uma escrita 2x (às vezes auth ainda está “subindo”)
    async function runWithQuickRetry(fn) {
      try {
        return await fn();
      } catch (err) {
        if (isPermissionError(err)) {
          await new Promise((r) => setTimeout(r, 250));
          return await fn();
        }
        throw err;
      }
    }

    function showPermissionHint(context = "ação") {
      showNotification(
        `Sem permissão no Firestore para ${context}. Verifique se você está logado com o e-mail ADMIN e se as regras permitem write em "profissionais" e/ou "excecoes".`,
        "error"
      );
    }

    function resetProfForm() {
      if (profEditId) profEditId.value = "";
      if (profNomeInput) profNomeInput.value = "";
      if (profWppInput) profWppInput.value = "";
      if (profAtivoInput) profAtivoInput.checked = true;

      if (profFotoFileInput) {
        profFotoFileInput.value = "";
        const field = profFotoFileInput.closest(".field");
        if (field) field.style.display = "none";
      }

      if (profFotoUrlInput) profFotoUrlInput.value = "";
      if (profSalvarBtn) profSalvarBtn.textContent = "Salvar profissional";
    }

    function hideFileInputsEverywhere() {
      if (profFotoFileInput) {
        const field = profFotoFileInput.closest(".field");
        if (field) field.style.display = "none";
      }

      const mFile = document.getElementById("mProfFoto");
      if (mFile) {
        const field = mFile.closest(".field");
        if (field) field.style.display = "none";
      }
    }

    // =========================
    // Exceções por escopo
    // =========================
    let cfgExScopeSelect = null;
    let unsubscribeExceptions = null;

    function ensureScopeSelect() {
      if (!cfgExDate) return;
      if (cfgExScopeSelect) return;

      const dateField = cfgExDate.closest(".field");
      const grid = cfgExDate.closest(".form-grid");
      if (!grid || !dateField) return;

      const field = document.createElement("div");
      field.className = "field";
      field.innerHTML = `
        <label for="cfgExScope">Escopo</label>
        <select id="cfgExScope">
          <option value="geral" selected>Salão (geral)</option>
        </select>
      `;

      grid.insertBefore(field, dateField);
      cfgExScopeSelect = field.querySelector("#cfgExScope");

      cfgExScopeSelect.addEventListener("change", () => {
        startExceptionsListener(getSelectedScope());
      });
    }

    function fillScopeProfessionals() {
      if (!cfgExScopeSelect) return;

      const current = (cfgExScopeSelect.value || "geral").trim() || "geral";
      const profs = Array.isArray(state.PROFESSIONALS)
        ? state.PROFESSIONALS.filter((p) => p && p.ativo !== false)
        : [];

      cfgExScopeSelect.innerHTML = `
        <option value="geral">Salão (geral)</option>
        ${profs
          .map((p) => `<option value="${p.id}">Folga • ${escapeHtml(p.nome || p.label || p.id)}</option>`)
          .join("")}
      `;

      const has = [...cfgExScopeSelect.options].some((o) => o.value === current);
      cfgExScopeSelect.value = has ? current : "geral";
    }

    function getSelectedScope() {
      return (cfgExScopeSelect?.value || "geral").trim() || "geral";
    }

    function getExceptionsCollectionByScope(scope) {
      if (!scope || scope === "geral") return CFG_COL_EXCECOES_GERAL;
      return collection(db, "profissionais", scope, "excecoes");
    }

    function renderExceptionsTable(list) {
      if (!cfgExceptionsTbody) return;

      if (!list || !list.length) {
        cfgExceptionsTbody.innerHTML = `<tr><td colspan="5" class="loading-row">Nenhuma exceção cadastrada.</td></tr>`;
        return;
      }

      cfgExceptionsTbody.innerHTML = list
        .sort((a, b) => String(a.data).localeCompare(String(b.data)))
        .map((x) => {
          const status = x.fechado ? "Fechado" : "Aberto";
          const ini = x.fechado ? "—" : x.inicio || "—";
          const fim = x.fechado ? "—" : x.fim || "—";
          return `
            <tr>
              <td>${escapeHtml(x.data)}</td>
              <td>${status}</td>
              <td>${escapeHtml(ini)}</td>
              <td>${escapeHtml(fim)}</td>
              <td>
                <button class="btn btn-sm btn-del" data-exc-del="${x.id}" data-exc-scope="${x.scope || "geral"}">
                  <i class="bx bx-trash"></i>
                </button>
              </td>
            </tr>
          `;
        })
        .join("");
    }

    function startExceptionsListener(scope) {
      if (typeof unsubscribeExceptions === "function") {
        unsubscribeExceptions();
        unsubscribeExceptions = null;
      }

      const col = getExceptionsCollectionByScope(scope);

      unsubscribeExceptions = onSnapshot(
        query(col, orderBy("data")),
        (snap) => {
          const list = snap.docs.map((d) => {
            const v = d.data() || {};
            return {
              id: d.id,
              scope: scope || "geral",
              data: v.data || d.id || "",
              fechado: !!v.fechado,
              inicio: v.inicio || "",
              fim: v.fim || "",
            };
          });
          renderExceptionsTable(list);
        },
        (err) => {
          console.error("Erro listener exceções:", err);
          if (isPermissionError(err)) showPermissionHint("ler exceções");
        }
      );
    }

    // =========================
    // Tabelas
    // =========================
    function renderProfTable() {
      if (!profTbody) return;

      if (!Array.isArray(state.PROFESSIONALS) || state.PROFESSIONALS.length === 0) {
        profTbody.innerHTML = `<tr><td colspan="5" class="loading-row">Nenhum profissional cadastrado.</td></tr>`;
        return;
      }

      profTbody.innerHTML = state.PROFESSIONALS
        .map((p) => {
          const nome = p.nome || p.label || "—";
          const foto = p.fotoUrl || "";
          const colecao = p.colecao || "—";
          const ativo = p.ativo === false ? "Não" : "Sim";

          return `
            <tr>
              <td>
                ${
                  foto
                    ? `<img src="${foto}" alt="${escapeHtml(nome)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:1px solid rgba(148,163,184,.35)">`
                    : "—"
                }
              </td>
              <td>${escapeHtml(nome)}</td>
              <td>${escapeHtml(colecao)}</td>
              <td>${ativo}</td>
              <td style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn btn-sm btn-light" data-prof-edit="${p.id}" title="Editar">
                  <i class="bx bx-edit"></i>
                </button>
                <button class="btn btn-sm btn-del" data-prof-del="${p.id}" title="Excluir">
                  <i class="bx bx-trash"></i>
                </button>
              </td>
            </tr>
          `;
        })
        .join("");
    }

    function renderServicosTable() {
      if (!svcTbody) return;
      const valid = (state.SERVICOS || []).filter((s) => !s.placeholder);
      if (!valid.length) {
        svcTbody.innerHTML = `<tr><td colspan="4" class="loading-row">Nenhum serviço cadastrado.</td></tr>`;
        return;
      }
      svcTbody.innerHTML = valid
        .map(
          (s) => `
          <tr>
            <td>${escapeHtml(s.nome || "—")}</td>
            <td>${Number(s.valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td>
            <td>${Number(s.tempoMin || 0)} min</td>
            <td>
              <button class="btn btn-sm btn-del" data-svc-del="${s.id}">
                <i class="bx bx-trash"></i>
              </button>
            </td>
          </tr>
        `
        )
        .join("");
    }

    // =========================
    // Profissionais: Editar modal / Excluir
    // =========================
    function openEditProfModal(profId) {
      const p = (state.PROFESSIONALS || []).find((x) => x?.id === profId);
      if (!p) return showNotification("Profissional não encontrado.", "error");

      const nome = escapeHtml(p.nome || "");
      const wpp = escapeHtml(p.whatsapp || "");
      const fotoUrl = p.fotoUrl || "";
      const ativoChecked = p.ativo === false ? "" : "checked";

      mainModal.show({
        title: "Editar profissional",
        body: `
          <div class="form-grid">
            <div class="field">
              <label>Nome</label>
              <input id="mProfNome" value="${nome}" placeholder="Nome do profissional" />
            </div>

            <div class="field">
              <label>WhatsApp</label>
              <input id="mProfWpp" value="${wpp}" placeholder="(00) 00000-0000" />
            </div>

            <div class="field">
              <label>Foto</label>
              <div style="display:flex;align-items:center;gap:10px;margin:8px 0 6px">
                ${
                  fotoUrl
                    ? `<img src="${fotoUrl}" alt="${nome}" style="width:54px;height:54px;border-radius:50%;object-fit:cover;border:1px solid rgba(148,163,184,.35)">`
                    : `<span style="color:#94a3b8;font-size:.9em">Sem foto</span>`
                }
              </div>

              <input id="mProfFotoUrl" value="${escapeHtml(fotoUrl)}" placeholder="https://link-da-foto.jpg (opcional)" />
              <small class="muted">A foto é opcional. Se quiser, cole uma URL https.</small>
            </div>

            <div class="field">
              <label style="display:flex;gap:10px;align-items:center;">
                <input id="mProfAtivo" type="checkbox" ${ativoChecked} />
                Ativo
              </label>
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
                await waitForAuth();

                const nomeNew = ($("#mProfNome")?.value || "").trim();
                const wppNew = normalizeWpp($("#mProfWpp")?.value || "");
                const ativoNew = !!$("#mProfAtivo")?.checked;

                const urlTyped = normalizeUrl($("#mProfFotoUrl")?.value || "");

                if (!nomeNew) {
                  showNotification("Informe o nome do profissional.", "error");
                  return false;
                }

                const updateData = {
                  nome: nomeNew,
                  whatsapp: wppNew,
                  ativo: ativoNew,
                  colecao: p.colecao || `reservas_${slugify(nomeNew)}`,
                  updatedAt: serverTimestamp(),
                };

                await runWithQuickRetry(() =>
                  setDoc(doc(db, "profissionais", profId), updateData, { merge: true })
                );

                if (urlTyped) {
                  await runWithQuickRetry(() =>
                    setDoc(
                      doc(db, "profissionais", profId),
                      { fotoUrl: urlTyped, updatedAt: serverTimestamp() },
                      { merge: true }
                    )
                  );
                }

                showNotification("Profissional atualizado!", "success");
                return true;
              } catch (err) {
                console.error(err);
                if (isPermissionError(err)) showPermissionHint("salvar profissional");
                else showNotification("Erro ao atualizar profissional.", "error");
                return false;
              }
            },
          },
        ],
      });

      hideFileInputsEverywhere();
    }

    function confirmDeleteProf(profId) {
      const p = (state.PROFESSIONALS || []).find((x) => x?.id === profId);
      const nome = escapeHtml(p?.nome || "este profissional");

      mainModal.show({
        title: "Excluir profissional",
        body: `<p>Deseja excluir <strong>${nome}</strong>?</p>
               <p style="color:#94a3b8;font-size:.9em">Isso remove o cadastro do profissional. As coleções de reservas não são apagadas automaticamente.</p>`,
        buttons: [
          { text: "Cancelar", class: "btn-light" },
          {
            text: "Excluir",
            class: "btn-del",
            onClick: async () => {
              try {
                await waitForAuth();
                await runWithQuickRetry(() => deleteDoc(doc(db, "profissionais", profId)));
                showNotification("Profissional excluído!", "success");
                return true;
              } catch (err) {
                console.error(err);
                if (isPermissionError(err)) showPermissionHint("excluir profissional");
                else showNotification("Erro ao excluir profissional.", "error");
                return false;
              }
            },
          },
        ],
      });
    }

    profTbody?.addEventListener("click", (e) => {
      const btnEdit = e.target.closest("[data-prof-edit]");
      const btnDel = e.target.closest("[data-prof-del]");

      if (btnEdit) {
        const id = btnEdit.dataset.profEdit;
        if (id) openEditProfModal(id);
        return;
      }

      if (btnDel) {
        const id = btnDel.dataset.profDel;
        if (id) confirmDeleteProf(id);
        return;
      }
    });

    // ✅ SALVAR PROFISSIONAL (FORM)
    profSalvarBtn?.addEventListener("click", async (e) => {
      e.preventDefault?.();
      try {
        await waitForAuth();

        const editingId = (profEditId?.value || "").trim();
        const nome = (profNomeInput?.value || "").trim();
        const whatsapp = normalizeWpp(profWppInput?.value || "");
        const ativo = !!profAtivoInput?.checked;
        const urlTyped = normalizeUrl(profFotoUrlInput?.value || "");

        if (!nome) return showNotification("Informe o nome do profissional.", "error");

        const defaultColecao = `reservas_${slugify(nome)}`;

        let colecaoFinal = defaultColecao;
        if (editingId) {
          const p = (state.PROFESSIONALS || []).find((x) => x?.id === editingId);
          if (p?.colecao) colecaoFinal = p.colecao;
        }

        if (!editingId) {
          await runWithQuickRetry(() =>
            addDoc(COL_PROF, {
              nome,
              whatsapp,
              ativo,
              colecao: colecaoFinal,
              ...(urlTyped ? { fotoUrl: urlTyped } : {}),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            })
          );

          showNotification("Profissional cadastrado!", "success");
          resetProfForm();
          return;
        }

        const payload = {
          nome,
          whatsapp,
          ativo,
          colecao: colecaoFinal,
          updatedAt: serverTimestamp(),
        };

        if (urlTyped) payload.fotoUrl = urlTyped;

        await runWithQuickRetry(() =>
          setDoc(doc(db, "profissionais", editingId), payload, { merge: true })
        );

        showNotification("Profissional salvo!", "success");
        resetProfForm();
      } catch (err) {
        console.error(err);
        if (isPermissionError(err)) showPermissionHint("salvar profissional");
        else showNotification("Erro ao salvar profissional.", "error");
      }
    });

    profCancelarEdicaoBtn?.addEventListener("click", (e) => {
      e.preventDefault?.();
      resetProfForm();
      showNotification("Edição cancelada.", "success");
    });

    // =========================
    // Load
    // =========================
    async function loadConfigData() {
      await waitForAuth();

      // ===== horários do painel + intervalo + pausa (opcional) =====
      try {
        const snap = await getDoc(CFG_DOC_HORARIOS);
        if (snap.exists()) {
          const v = snap.data() || {};
          state.BUSINESS_HOURS = {
            inicio: v.inicio || state.BUSINESS_HOURS.inicio,
            fim: v.fim || state.BUSINESS_HOURS.fim,
          };

          // ✅ intervalo pode ter vindo como intervalMin (novo) ou intervalMinuto (legado), etc.
          const maybeInterval =
            (typeof v.intervalMin === "number" ? v.intervalMin : undefined);

          if (Number.isFinite(maybeInterval) && maybeInterval > 0) {
            state.INTERVAL_MIN = Math.max(5, Math.round(maybeInterval));
          }

          // ✅ pausa almoço salva no mesmo doc (opcional)
          const bs = normalizeTimeOrEmpty(v.breakStart || "");
          const be = normalizeTimeOrEmpty(v.breakEnd || "");
          if (bs && be && toMinutes(bs) < toMinutes(be)) {
            state.BREAK = { breakStart: bs, breakEnd: be };
          } else {
            state.BREAK = { breakStart: "", breakEnd: "" };
          }
        }

        if (cfgInicio) cfgInicio.value = state.BUSINESS_HOURS.inicio || "09:00";
        if (cfgFim) cfgFim.value = state.BUSINESS_HOURS.fim || "19:00";

        const intervalToUse = Number.isFinite(state.INTERVAL_MIN) ? state.INTERVAL_MIN : 25;
        if (cfgIntervalMin) cfgIntervalMin.value = String(intervalToUse);

        // ✅ preenche inputs da pausa (se existirem)
        const bsUI = state.BREAK?.breakStart || "";
        const beUI = state.BREAK?.breakEnd || "";
        if (cfgBreakStart) cfgBreakStart.value = bsUI;
        if (cfgBreakEnd) cfgBreakEnd.value = beUI;

        // ✅ gerar horas (compatível com generateHours antigo e novo)
        const { breakStart, breakEnd } = getBreakFromUI();
        try {
          state.HOURS = generateHours(
            state.BUSINESS_HOURS.inicio,
            state.BUSINESS_HOURS.fim,
            intervalToUse,
            breakStart,
            breakEnd
          );
        } catch {
          // fallback caso sua generateHours ainda aceite só 3 params
          state.HOURS = generateHours(state.BUSINESS_HOURS.inicio, state.BUSINESS_HOURS.fim, intervalToUse);
        }
      } catch (e) {
        console.error("Erro ao carregar horários do painel:", e);
      }

      // ===== semana =====
      try {
        const snap = await getDoc(CFG_DOC_SEMANA);
        if (snap.exists()) {
          const v = snap.data() || {};
          const weekdays = Array.isArray(v.weekdays) ? v.weekdays : [1, 2, 3, 4, 5];
          const dayStart = v.dayStart || "09:00";
          const dayEnd = v.dayEnd || "19:00";

          state.CFG_WEEK = { weekdays, dayStart, dayEnd };

          if (cfgWeekdays) {
            cfgWeekdays.querySelectorAll('input[type="checkbox"]').forEach((c) => {
              const val = Number(c.value);
              c.checked = weekdays.includes(val);
            });
          }
          if (cfgDayStart) cfgDayStart.value = dayStart;
          if (cfgDayEnd) cfgDayEnd.value = dayEnd;
        }
      } catch (e) {
        console.error("Erro ao carregar semana:", e);
      }

      ensureScopeSelect();
      fillScopeProfessionals();
      startExceptionsListener(getSelectedScope());

      onSnapshot(
        query(COL_SERVICOS, orderBy("nome")),
        (snap) => {
          state.SERVICOS = snap.docs.map((d) => {
            const v = d.data() || {};
            return {
              id: d.id,
              nome: v.nome || "",
              valor: Number(v.valor || 0),
              tempoMin: Number(v.tempoMin || 30),
              ativo: v.ativo !== false,
            };
          });
          renderServicosTable();
        },
        (err) => {
          console.error("Erro listener servicos:", err);
          if (isPermissionError(err)) showPermissionHint("ler serviços");
        }
      );

      onSnapshot(
        query(COL_PROF, orderBy("nome")),
        (snap) => {
          const list = snap.docs.map((d) => {
            const v = d.data() || {};
            const nome = v.nome || "";
            return {
              id: d.id,
              nome,
              label: nome,
              fotoUrl: v.fotoUrl || "",
              whatsapp: v.whatsapp || "",
              ativo: v.ativo !== false,
              colecao: v.colecao || `reservas_${slugify(nome)}`,
            };
          });

          state.PROFESSIONALS = list;
          renderProfTable();
          populateProfessionalSelects();

          ensureScopeSelect();
          fillScopeProfessionals();

          hideFileInputsEverywhere();
        },
        (err) => {
          console.error("Erro listener profissionais:", err);
          if (isPermissionError(err)) showPermissionHint("ler profissionais");
        }
      );
    }

    // ✅ Salvar horário painel (+ intervalo + pausa almoço)
    cfgSalvarHorario?.addEventListener("click", async (e) => {
      e.preventDefault?.();
      try {
        await waitForAuth();
        const inicio = (cfgInicio?.value || "").trim();
        const fim = (cfgFim?.value || "").trim();
        const intervalMin = getIntervalMinFromUI();

        if (!inicio || !fim) return showNotification("Informe início e fim do expediente.", "error");

        const { breakStart, breakEnd } = getBreakFromUI();

        await runWithQuickRetry(() =>
          setDoc(
            CFG_DOC_HORARIOS,
            {
              inicio,
              fim,
              intervalMin,
              // ✅ pausa almoço no mesmo doc (opcional)
              breakStart: breakStart || "",
              breakEnd: breakEnd || "",
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          )
        );

        state.BUSINESS_HOURS = { inicio, fim };
        state.INTERVAL_MIN = intervalMin;
        state.BREAK = { breakStart, breakEnd };

        // ✅ gerar horas com pausa (compatível com generateHours antigo e novo)
        try {
          state.HOURS = generateHours(inicio, fim, intervalMin, breakStart, breakEnd);
        } catch {
          state.HOURS = generateHours(inicio, fim, intervalMin);
        }

        showNotification("Horário de funcionamento salvo!", "success");
      } catch (err) {
        console.error(err);
        if (isPermissionError(err)) showPermissionHint("salvar horário");
        else showNotification("Erro ao salvar horário.", "error");
      }
    });

    // Salvar semana
    cfgSalvarSemana?.addEventListener("click", async (e) => {
      e.preventDefault?.();
      try {
        await waitForAuth();

        const selected = [];
        if (cfgWeekdays) {
          cfgWeekdays.querySelectorAll('input[type="checkbox"]').forEach((c) => {
            if (c.checked) selected.push(Number(c.value));
          });
        }

        const dayStart = (cfgDayStart?.value || "").trim();
        const dayEnd = (cfgDayEnd?.value || "").trim();

        if (!selected.length) return showNotification("Selecione pelo menos 1 dia da semana.", "error");
        if (!dayStart || !dayEnd) return showNotification("Informe início e fim padrão do dia.", "error");

        await runWithQuickRetry(() =>
          setDoc(
            CFG_DOC_SEMANA,
            { weekdays: selected, dayStart, dayEnd, updatedAt: serverTimestamp() },
            { merge: true }
          )
        );

        state.CFG_WEEK = { weekdays: selected, dayStart, dayEnd };
        showNotification("Semana salva com sucesso!", "success");
      } catch (err) {
        console.error(err);
        if (isPermissionError(err)) showPermissionHint("salvar semana");
        else showNotification("Erro ao salvar semana.", "error");
      }
    });

    // Adicionar exceção
    cfgAddException?.addEventListener("click", async (e) => {
      e.preventDefault?.();
      try {
        await waitForAuth();

        ensureScopeSelect();
        const scope = getSelectedScope();
        const data = (cfgExDate?.value || "").trim();
        const fechado = !!cfgExClosed?.checked;
        const inicio = (cfgExStart?.value || "").trim();
        const fim = (cfgExEnd?.value || "").trim();

        if (!data) return showNotification("Selecione a data da exceção.", "error");
        if (!fechado && (!inicio || !fim)) {
          return showNotification("Informe início e fim (ou marque Dia fechado).", "error");
        }

        const targetDoc =
          scope === "geral"
            ? cfgExcecaoDoc(data)
            : doc(db, "profissionais", scope, "excecoes", data);

        await runWithQuickRetry(() =>
          setDoc(
            targetDoc,
            {
              data,
              fechado,
              inicio: fechado ? "" : inicio,
              fim: fechado ? "" : fim,
              updatedAt: serverTimestamp(),
              createdAt: serverTimestamp(),
            },
            { merge: true }
          )
        );

        showNotification(
          scope === "geral" ? "Exceção do salão adicionada!" : "Folga/Exceção do profissional adicionada!",
          "success"
        );
      } catch (err) {
        console.error(err);
        if (isPermissionError(err)) showPermissionHint("adicionar exceção");
        else showNotification("Erro ao adicionar exceção.", "error");
      }
    });

    // Deletar exceção
    cfgExceptionsTbody?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-exc-del]");
      if (!btn) return;

      const id = btn.dataset.excDel;
      const scope = (btn.dataset.excScope || "geral").trim();
      if (!id) return;

      mainModal.show({
        title: "Remover exceção",
        body: "<p>Deseja remover esta exceção do calendário?</p>",
        buttons: [
          { text: "Cancelar", class: "btn-light" },
          {
            text: "Remover",
            class: "btn-del",
            onClick: async () => {
              try {
                await waitForAuth();

                const target =
                  scope === "geral"
                    ? cfgExcecaoDoc(id)
                    : doc(db, "profissionais", scope, "excecoes", id);

                await runWithQuickRetry(() => deleteDoc(target));

                showNotification("Exceção removida!", "success");
                return true;
              } catch (err) {
                console.error(err);
                if (isPermissionError(err)) showPermissionHint("remover exceção");
                else showNotification("Erro ao remover exceção.", "error");
                return false;
              }
            },
          },
        ],
      });
    });

    // ✅ Criar serviço
    svcSalvarBtn?.addEventListener("click", async (e) => {
      e.preventDefault?.();
      try {
        await waitForAuth();
        const nome = (svcNomeInput?.value || "").trim();
        const valor = Number(String(svcValorInput?.value || "0").replace(",", "."));
        const tempoMin = Number(String(svcTempoInput?.value || "0").replace(",", "."));

        if (!nome) return showNotification("Informe o nome do serviço.", "error");
        if (!tempoMin || tempoMin <= 0) return showNotification("Informe um tempo válido (min).", "error");

        await runWithQuickRetry(() =>
          addDoc(COL_SERVICOS, {
            nome,
            valor: Number.isNaN(valor) ? 0 : valor,
            tempoMin,
            ativo: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );

        if (svcNomeInput) svcNomeInput.value = "";
        if (svcValorInput) svcValorInput.value = "";
        if (svcTempoInput) svcTempoInput.value = "";
        showNotification("Serviço cadastrado!", "success");
      } catch (err) {
        console.error(err);
        if (isPermissionError(err)) showPermissionHint("cadastrar serviço");
        else showNotification("Erro ao cadastrar serviço.", "error");
      }
    });

    // ✅ start
    resetProfForm();
    hideFileInputsEverywhere();
    loadConfigData();
  })();
}