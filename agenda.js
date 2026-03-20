// agenda.js
import {
    db, $, showNotification, mainModal,
    state, generateHours, toKey,
    waitForAuth, getSelectedColecao, getProfLabelByColecao,
    setDoc, updateDoc, deleteDoc, doc, getDoc, getDocs, collection, query, where, serverTimestamp,
    PAYMENT_METHODS, BOOKING_URL,
    openServicosModal,
    bindProfessionalSync,
    populateProfessionalSelects
} from "./firebase.js";

export function initAgendaTab() {
    const agendaGrid = $("#agenda-grid");
    const dataFiltro = $("#dataFiltro");
    const horaFiltro = $("#horaFiltro");
    const buscarBtn = $("#buscarBtn");
    const bloquearBtn = $("#bloquearBtn");
    const desbloquearBtn = $("#desbloquearBtn");
    const profissionalSelect = $("#profissionalSelect");

    if (!agendaGrid) return;

    // evita duplicar listeners
    if (window.__agendaTabStarted) return;
    window.__agendaTabStarted = true;

    // ============================
    // CONFIG: passo padrão 30min
    // ============================
    const STEP_MIN = 30;

    // ============================
    // Helpers de tempo (HH:mm)
    // ============================
    function isValidHHmm(s) {
        return typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
    }

    function normalizeTime(t) {
        const v = (t || "").trim();
        return isValidHHmm(v) ? v : "";
    }

    function hhmmToMin(hhmm) {
        const v = normalizeTime(hhmm);
        if (!v) return null;
        const [h, m] = v.split(":").map(Number);
        if (Number.isNaN(h) || Number.isNaN(m)) return null;
        return h * 60 + m;
    }

    function minToHHmm(min) {
        const h = Math.floor(min / 60);
        const m = min % 60;
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }

    function addMinHHmm(hhmm, deltaMin) {
        const base = hhmmToMin(hhmm);
        if (base == null) return "";
        return minToHHmm(base + Number(deltaMin || 0));
    }

    function overlaps(aStart, aEnd, bStart, bEnd) {
        // intervalos [start, end)
        return aStart < bEnd && bStart < aEnd;
    }

    // prioridade: prof > geral > semana > fallback
    function pickTime({ prof, geral, semana, fallback }) {
        return normalizeTime(prof) || normalizeTime(geral) || normalizeTime(semana) || fallback;
    }

    /**
     * ✅ Geração de horários "certinha" (fim EXCLUSIVO)
     * - Evita aparecer horário "sobrando"
     * - Só gera horários onde o início do slot é < fim
     */
    function safeGenerateHours(startHH, endHH, stepMin) {
        const start = hhmmToMin(startHH);
        const end = hhmmToMin(endHH);
        const step = Math.max(1, Number(stepMin || STEP_MIN));

        if (start == null || end == null) return [];
        if (start >= end) return [];

        const out = [];
        let cur = start;

        const mod = (cur - start) % step;
        if (mod !== 0) cur += (step - mod);

        while (cur < end) {
            out.push(minToHHmm(cur));
            cur += step;
        }

        return out.filter((h) => {
            const m = hhmmToMin(h);
            return m != null && m >= start && m < end;
        });
    }

    // ============================
    // Helpers de data / semana
    // ============================
    function getWeekdayIndex(dateYmd) {
        const [y, m, d] = String(dateYmd).split("-").map(Number);
        const dt = new Date(y, (m || 1) - 1, d || 1);
        return dt.getDay(); // 0 dom ... 6 sab
    }

    // ============================
    // Exceções: tenta ler em múltiplos formatos
    // ============================
    async function readExceptionGeral(ymd) {
        // Formato A (recomendado): config/excecoes/dias/{YYYY-MM-DD}
        try {
            const snapA = await getDoc(doc(db, "config", "excecoes", "dias", ymd));
            if (snapA.exists()) return snapA.data() || null;
        } catch (e) { }

        // Formato B: excecoes/{YYYY-MM-DD}
        try {
            const snapB = await getDoc(doc(db, "excecoes", ymd));
            if (snapB.exists()) return snapB.data() || null;
        } catch (e) { }

        return null;
    }

    async function readExceptionProf(profId, ymd) {
        if (!profId) return null;
        try {
            const snap = await getDoc(doc(db, "profissionais", profId, "excecoes", ymd));
            if (snap.exists()) return snap.data() || null;
        } catch (e) { }
        return null;
    }

    // ============================
    // Lê disponibilidade (semana + exceções)
    // ============================
    async function getDayAvailabilityForColecao(ymd, colecao) {
        await waitForAuth();

        const cfgWeekdays = Array.isArray(state?.CFG_WEEK?.weekdays) ? state.CFG_WEEK.weekdays : [1, 2, 3, 4, 5];
        const weekStart =
            normalizeTime(state?.CFG_WEEK?.dayStart) ||
            normalizeTime(state?.BUSINESS_HOURS?.inicio) ||
            "09:00";
        const weekEnd =
            normalizeTime(state?.CFG_WEEK?.dayEnd) ||
            normalizeTime(state?.BUSINESS_HOURS?.fim) ||
            "19:00";

        const wd = getWeekdayIndex(ymd);
        const weekOpen = cfgWeekdays.includes(wd);

        let exGeral = null;
        try {
            exGeral = await readExceptionGeral(ymd);
        } catch (e) {
            console.error("Erro ao ler exceção geral:", e);
        }

        let exProf = null;
        const profId = (state.PROFESSIONALS || []).find((p) => p?.colecao === colecao)?.id || "";
        try {
            exProf = await readExceptionProf(profId, ymd);
        } catch (e) {
            console.error("Erro ao ler exceção profissional:", e);
        }

        if (exProf?.fechado === true) return { aberto: false, inicio: "", fim: "", motivo: "Fechado (exceção do profissional)" };
        if (exGeral?.fechado === true) return { aberto: false, inicio: "", fim: "", motivo: "Fechado (exceção do salão)" };

        const exInicio = normalizeTime(exProf?.inicio) || normalizeTime(exGeral?.inicio);
        const exFim = normalizeTime(exProf?.fim) || normalizeTime(exGeral?.fim);

        if (!weekOpen && !(exInicio && exFim)) {
            return { aberto: false, inicio: "", fim: "", motivo: "Fechado no padrão da semana" };
        }

        const inicio = pickTime({
            prof: exProf?.inicio,
            geral: exGeral?.inicio,
            semana: weekStart,
            fallback: "09:00",
        });

        const fim = pickTime({
            prof: exProf?.fim,
            geral: exGeral?.fim,
            semana: weekEnd,
            fallback: "19:00",
        });

        if (!isValidHHmm(inicio) || !isValidHHmm(fim)) {
            return { aberto: false, inicio: "", fim: "", motivo: "Horário inválido" };
        }
        if (inicio >= fim) {
            return { aberto: false, inicio: "", fim: "", motivo: "Início maior/igual ao fim" };
        }

        return { aberto: true, inicio, fim, motivo: "" };
    }

    async function getAvailableHoursForSelection(ymd, colecaoSel) {
        if (!ymd) return [];

        const profs = (state.PROFESSIONALS || []).filter((p) => p && p.ativo !== false);
        if (!profs.length) return [];

        if (colecaoSel === "todos") {
            const union = new Set();
            for (const p of profs) {
                const av = await getDayAvailabilityForColecao(ymd, p.colecao);
                if (!av.aberto) continue;
                safeGenerateHours(av.inicio, av.fim, STEP_MIN).forEach((h) => union.add(h));
            }
            return Array.from(union).sort((a, b) => String(a).localeCompare(String(b)));
        }

        const av = await getDayAvailabilityForColecao(ymd, colecaoSel);
        if (!av.aberto) return [];
        return safeGenerateHours(av.inicio, av.fim, STEP_MIN);
    }

    // ============================
    // Hora filtro dinâmico
    // ============================
    async function fillHoraFiltroDynamic({ keepSelection = true } = {}) {
        if (!horaFiltro) return;

        const prev = keepSelection ? (horaFiltro.value || "") : "";
        const ymd = dataFiltro?.value;
        const colecaoSel = getSelectedColecao();

        horaFiltro.innerHTML = `<option value="">Todas</option>`;

        const hours = await getAvailableHoursForSelection(ymd, colecaoSel);

        hours.forEach((h) => {
            const opt = document.createElement("option");
            opt.value = h;
            opt.textContent = h;
            horaFiltro.appendChild(opt);
        });

        if (keepSelection && prev) {
            const ok = [...horaFiltro.options].some((o) => o.value === prev);
            if (ok) horaFiltro.value = prev;
        }
    }

    // ============================
    // Fetch agendamentos
    // ============================
    async function fetchAppointmentsDayForColecao(dateYmd, colecao) {
        await waitForAuth();
        const rows = [];

        const qy = query(collection(db, colecao), where("data", "==", dateYmd));
        const snap = await getDocs(qy);

        snap.forEach((d) => {
            const v = d.data() || {};
            const hora = (v.hora || "").trim();
            if (!hora) return;

            const firstName = (v.clienteNome || "").trim();
            const lastName = (v.clienteSobrenome || "").trim();
            const fullName =
                (v.clienteNomeCompleto || "").trim() ||
                [firstName, lastName].filter(Boolean).join(" ") ||
                (v.cliente || "");

            const valor =
                v.valor !== undefined && v.valor !== null
                    ? Number(v.valor)
                    : v.servicoValor !== undefined && v.servicoValor !== null
                        ? Number(v.servicoValor)
                        : 0;

            const forma = v.pagamentoForma || "";
            const raclub = v?.raclub?.status === "membro";
            const bloqueado = !!v.bloqueado;
            const servicoNome = v.servicoNome || "";
            const telefone = v.clienteTelefone || v.telefoneCliente || v.phone || v.telefone || "";

            const tempoMin = Number(v.servicoTempoMin ?? v.tempoMin ?? 30) || 30;

            rows.push({
                id: d.id,
                colecao,
                profissional: v.profissional || getProfLabelByColecao(colecao),
                hora,
                clienteNome: bloqueado && !fullName ? "" : fullName || "—",
                telefone,
                valor,
                pagamentoForma: forma,
                raclub,
                bloqueado,
                servico: servicoNome || "Serviço",
                tempoMin,
            });
        });

        return rows;
    }

    async function fetchAppointmentsDay(dateYmd) {
        await waitForAuth();
        const colecaoSel = getSelectedColecao();

        if (colecaoSel === "todos") {
            const profs = (state.PROFESSIONALS || []).filter((p) => p.ativo !== false);
            const tasks = profs.map((p) => fetchAppointmentsDayForColecao(dateYmd, p.colecao));
            const results = await Promise.all(tasks);
            const rows = results.flat();
            rows.sort((a, b) => (a.hora || "").localeCompare(b.hora || ""));
            return rows;
        }

        const rows = await fetchAppointmentsDayForColecao(dateYmd, colecaoSel);
        rows.sort((a, b) => (a.hora || "").localeCompare(b.hora || ""));
        return rows;
    }

    // ============================
    // Validação por duração (dinâmico)
    // ============================
    function canPlaceServiceAtTime({
        startHH,
        serviceMin,
        dayStartHH,
        dayEndHH,
        appointments
    }) {
        const start = hhmmToMin(startHH);
        const end = start + Number(serviceMin || 0);

        const dayStart = hhmmToMin(dayStartHH);
        const dayEnd = hhmmToMin(dayEndHH);

        if (start == null || dayStart == null || dayEnd == null) return false;
        if (start < dayStart) return false;
        if (end > dayEnd) return false;

        const apps = Array.isArray(appointments) ? appointments : [];
        for (const a of apps) {
            const aStart = hhmmToMin(a.hora);
            if (aStart == null) continue;
            const aDur = Number(a.tempoMin || 30) || 30;
            const aEnd = aStart + aDur;

            if (overlaps(start, end, aStart, aEnd)) return false;
        }

        return true;
    }

    // ============================
    // ✅ NOVO: ocupa slots por intervalo (duração do serviço)
    // ============================
    function findOccupancyForSlot(slotHH, appointments) {
        const slotStart = hhmmToMin(slotHH);
        if (slotStart == null) return null;
        const slotEnd = slotStart + STEP_MIN;

        // se houver sobreposição, esse slot está ocupado
        for (const a of (appointments || [])) {
            const aStart = hhmmToMin(a.hora);
            if (aStart == null) continue;

            const aDur = Number(a.tempoMin || 30) || 30;
            const aEnd = aStart + aDur;

            if (overlaps(slotStart, slotEnd, aStart, aEnd)) {
                return {
                    appt: a,
                    isStart: normalizeTime(a.hora) === normalizeTime(slotHH),
                    apptStartHH: a.hora,
                    apptEndHH: minToHHmm(aEnd),
                };
            }
        }
        return null;
    }

    // ============================
    // Render grid (30 em 30) + duração dinâmica
    // ============================
    async function renderAgendaGrid(appointments, filterHour, ymd, colecaoSel) {
        const allowedHours = ymd ? await getAvailableHoursForSelection(ymd, colecaoSel) : [];

        if (!allowedHours.length && ymd && colecaoSel !== "todos") {
            const av = await getDayAvailabilityForColecao(ymd, colecaoSel);
            agendaGrid.innerHTML = `
        <div class="loading-row">
          Nenhum horário disponível para este filtro.<br/>
          <span style="color:#94a3b8;font-size:.9em">${av?.motivo || ""}</span>
        </div>
      `;
            return;
        }

        if (!allowedHours.length) {
            agendaGrid.innerHTML = `<div class="loading-row">Nenhum horário disponível para este filtro.</div>`;
            return;
        }

        const allowedSet = new Set(allowedHours);

        const hoursToRender = filterHour
            ? (allowedSet.has(filterHour) ? [filterHour] : [])
            : allowedHours;

        if (!hoursToRender.length) {
            agendaGrid.innerHTML = `<div class="loading-row">Nenhum horário disponível para este filtro.</div>`;
            return;
        }

        // 🔥 aqui é o segredo: a grade olha "sobreposição" por duração
        agendaGrid.innerHTML = hoursToRender.map((h) => {
            const occ = findOccupancyForSlot(h, appointments);

            // ============================
            // Slot LIVRE
            // ============================
            if (!occ) {
                return `
          <div class="timeslot">
            <div class="timeslot-header">
              <span class="timeslot-hour">${h}</span>
              <span class="timeslot-badge">Disponível</span>
            </div>
            <div class="timeslot-body">
              <p>Nenhum agendamento para este horário.</p>
            </div>
            <div class="timeslot-actions">
              <button class="btn btn-sm btn-edit" data-action="schedule" data-time="${h}">
                <i class="bx bx-calendar-plus"></i> Agendar
              </button>
            </div>
          </div>
        `;
            }

            const a = occ.appt;

            // ============================
            // Slot OCUPADO - BLOQUEIO
            // ============================
            if (a.bloqueado && (!a.clienteNome || a.clienteNome === "—")) {
                // se for continuação de um bloqueio (quase nunca, mas previne), só mostra ocupado
                if (!occ.isStart) {
                    return `
            <div class="timeslot">
              <div class="timeslot-header">
                <span class="timeslot-hour">${h}</span>
                <span class="timeslot-badge">Ocupado</span>
              </div>
              <div class="timeslot-body">
                <div class="timeslot-blocked">
                  <strong>Horário bloqueado</strong>
                  <div style="color:#94a3b8;font-size:.85em;margin-top:6px">
                    Continuação do bloqueio (${occ.apptStartHH}–${occ.apptEndHH})
                  </div>
                </div>
              </div>
            </div>
          `;
                }

                return `
          <div class="timeslot">
            <div class="timeslot-header">
              <span class="timeslot-hour">${h}</span>
              <span class="timeslot-badge">1 agendamento(s)</span>
            </div>
            <div class="timeslot-body">
              <div class="timeslot-blocked">
                <strong>Horário bloqueado</strong>
                <div class="timeslot-actions">
                  <button class="btn btn-sm btn-del" data-action="cancel-agenda" data-id="${a.id}" data-colecao="${a.colecao}">
                    <i class="bx bx-lock-open"></i> Desbloquear
                  </button>
                </div>
              </div>
            </div>
          </div>
        `;
            }

            // ============================
            // Slot OCUPADO - AGENDAMENTO
            // ============================
            const phoneInline = a.telefone
                ? `<span style="color:#94a3b8;font-size:.85em;margin-left:10px">Tel: ${a.telefone}</span>`
                : "";

            const durLabel = a.tempoMin ? ` • ${Number(a.tempoMin)} min` : "";

            // Slot de continuação: mostra ocupação e remove ações de editar/excluir (pra não confundir)
            if (!occ.isStart) {
                return `
          <div class="timeslot">
            <div class="timeslot-header">
              <span class="timeslot-hour">${h}</span>
              <span class="timeslot-badge">Ocupado</span>
            </div>
            <div class="timeslot-body">
              <div>
                <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
                  <strong>${a.clienteNome}</strong>
                  ${phoneInline}
                </div>
                <div>${a.servico}${durLabel}</div>
                <div style="color:#94a3b8;font-size:.85em;margin-top:6px">
                  Continuação (${occ.apptStartHH}–${occ.apptEndHH})
                </div>
                <div class="timeslot-prof">Profissional: ${a.profissional || "-"}</div>
              </div>
            </div>
          </div>
        `;
            }

            // Slot inicial: mostra completo com ações
            return `
        <div class="timeslot">
          <div class="timeslot-header">
            <span class="timeslot-hour">${h}</span>
            <span class="timeslot-badge">1 agendamento(s)</span>
          </div>
          <div class="timeslot-body">
            <div>
              <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
                <strong>${a.clienteNome}</strong>
                ${phoneInline}
              </div>
              <div>${a.servico}${durLabel}</div>
              <div>${(Number(a.valor) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} • ${a.pagamentoForma || "Forma não informada"}</div>
              ${a.raclub ? `<span class="timeslot-badge">RA Club</span>` : ""}
              <div style="color:#94a3b8;font-size:.85em;margin-top:6px">
                Ocupa: ${occ.apptStartHH}–${occ.apptEndHH}
              </div>
              <div class="timeslot-prof">Profissional: ${a.profissional || "-"}</div>
            </div>
            <div class="timeslot-actions">
              <button class="btn btn-sm btn-edit" data-action="edit-agenda" data-id="${a.id}" data-colecao="${a.colecao}">
                <i class="bx bx-pencil"></i>
              </button>
              <button class="btn btn-sm btn-del" data-action="cancel-agenda" data-id="${a.id}" data-colecao="${a.colecao}">
                <i class="bx bx-x"></i>
              </button>
            </div>
          </div>
        </div>
      `;
        }).join("");
    }

    // ============================
    // Buscar
    // ============================
    async function buscarAgenda() {
        const ymd = dataFiltro?.value;
        if (!ymd) return;

        try {
            agendaGrid.innerHTML = `<div class="loading-row">Carregando...</div>`;

            await fillHoraFiltroDynamic({ keepSelection: true });

            const apps = await fetchAppointmentsDay(ymd);
            const filterHour = horaFiltro?.value || "";
            const colecaoSel = getSelectedColecao();

            await renderAgendaGrid(apps, filterHour, ymd, colecaoSel);
        } catch (err) {
            console.error(err);
            agendaGrid.innerHTML = `<div class="loading-row">Erro ao carregar agenda.</div>`;
        }
    }

    // ============================
    // Sync profissional -> recarrega
    // ============================
    bindProfessionalSync({
        onAgendaChange: async () => {
            if (horaFiltro) horaFiltro.value = "";
            await fillHoraFiltroDynamic({ keepSelection: false });
            await buscarAgenda();
        },
    });

    buscarBtn?.addEventListener("click", buscarAgenda);

    dataFiltro?.addEventListener("change", async () => {
        if (horaFiltro) horaFiltro.value = "";
        await fillHoraFiltroDynamic({ keepSelection: false });
        await buscarAgenda();
    });

    horaFiltro?.addEventListener("change", buscarAgenda);

    profissionalSelect?.addEventListener("change", async () => {
        if (horaFiltro) horaFiltro.value = "";
        await fillHoraFiltroDynamic({ keepSelection: false });
        await buscarAgenda();
    });

    // Abrir link externo
    $("#openBookingModal")?.addEventListener("click", () => {
        mainModal.show({
            title: "Abrir agendamentos",
            body: `
        <p>Escolha como deseja abrir a página de agendamentos.</p>
        <div style="margin-top:12px;padding:10px;border-radius:10px;border:1px solid rgba(148,163,184,0.6);background:#020617;font-size:.85rem">
          <div style="color:#9ca3af;margin-bottom:4px">Endereço</div>
          <a href="${BOOKING_URL}" target="_blank" rel="noopener" style="word-break:break-all;color:#a5b4fc">${BOOKING_URL}</a>
        </div>
      `,
            buttons: [
                { text: "Cancelar", class: "btn-light" },
                { text: "<i class='bx bx-link-external'></i> Abrir em nova aba", class: "btn", onClick: () => window.open(BOOKING_URL, "_blank", "noopener") },
                {
                    text: "<i class='bx bx-copy'></i> Copiar link",
                    class: "btn-light",
                    onClick: async () => {
                        try {
                            await navigator.clipboard.writeText(BOOKING_URL);
                        } catch {
                            const ta = document.createElement("textarea");
                            ta.value = BOOKING_URL;
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand("copy");
                            ta.remove();
                        }
                        showNotification("Link copiado!");
                        return false;
                    },
                },
            ],
        });
    });

    // clique na agenda
    agendaGrid?.addEventListener("click", (e) => {
        const target = e.target.closest("[data-action]");
        if (!target) return;

        const { action, id, time } = target.dataset;
        const colecao = target.dataset.colecao || getSelectedColecao();

        if (action === "edit-agenda") openEditAgendaModal(colecao, id);
        if (action === "cancel-agenda") cancelarAgendamento(colecao, id);

        if (action === "schedule") {
            if (getSelectedColecao() === "todos") {
                showNotification("Selecione um profissional para agendar.", "error");
                return;
            }
            openNewAgendaModal(colecao, time);
        }
    });

    async function openNewAgendaModal(colecao, time) {
        const profLabel = getProfLabelByColecao(colecao);

        mainModal.show({
            title: `Novo agendamento - ${profLabel} • ${time}`,
            body: `
        <div class="form-grid">
          <div class="field">
            <label>Cliente</label>
            <input id="newCliente" placeholder="Nome completo do cliente" />
          </div>
          <div class="field">
            <label>Telefone</label>
            <input id="newTelefone" placeholder="(00) 00000-0000" />
          </div>
          <div class="field">
            <label>Serviço</label>
            <input id="newServico" placeholder="Clique para selecionar o serviço" />
            <input id="newTempoMin" type="hidden" value="30" />
          </div>
          <div class="field">
            <label>Valor (R$)</label>
            <input id="newValor" type="number" step="0.01" />
          </div>
          <div class="field">
            <label>Forma de pagamento</label>
            <select id="newForma">
              <option value="">Selecione</option>
              ${PAYMENT_METHODS.map((m) => `<option>${m}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label><input id="newRaclub" type="checkbox" /> Cliente é do RA Club</label>
          </div>
        </div>
      `,
            buttons: [
                { text: "Cancelar", class: "btn-light" },
                {
                    text: "Salvar",
                    class: "btn-edit",
                    onClick: async () => {
                        const cliente = $("#newCliente").value.trim();
                        if (!cliente) {
                            showNotification("Informe o nome do cliente.", "error");
                            return false;
                        }

                        const telefone = ($("#newTelefone")?.value || "").trim();
                        const servico = $("#newServico").value.trim() || "Serviço";
                        const valor = Number($("#newValor").value || 0);
                        const forma = $("#newForma").value || "Outro";
                        const raclub = $("#newRaclub").checked;
                        const ymd = dataFiltro.value;

                        const tempoMin = Number($("#newTempoMin")?.value || 30) || 30;

                        // valida conflito por duração do serviço (dinâmico)
                        try {
                            const av = await getDayAvailabilityForColecao(ymd, colecao);
                            if (!av.aberto) {
                                showNotification("Dia fechado para este profissional.", "error");
                                return false;
                            }

                            const dayApps = await fetchAppointmentsDayForColecao(ymd, colecao);

                            const ok = canPlaceServiceAtTime({
                                startHH: time,
                                serviceMin: tempoMin,
                                dayStartHH: av.inicio,
                                dayEndHH: av.fim,
                                appointments: dayApps
                            });

                            if (!ok) {
                                showNotification("Esse horário conflita com outro agendamento/bloqueio pelo tempo do serviço.", "error");
                                return false;
                            }
                        } catch (e) {
                            console.error(e);
                            showNotification("Não foi possível validar conflito de horário.", "error");
                            return false;
                        }

                        const id = toKey(ymd, time);
                        const refDoc = doc(db, colecao, id);
                        const [firstName, ...rest] = cliente.split(" ");
                        const lastName = rest.join(" ");

                        try {
                            await setDoc(
                                refDoc,
                                {
                                    data: ymd,
                                    hora: time,
                                    profissional: profLabel,
                                    clienteNomeCompleto: cliente,
                                    clienteNome: firstName,
                                    clienteSobrenome: lastName,
                                    clienteTelefone: telefone,
                                    telefoneCliente: telefone,
                                    telefone: telefone,
                                    phone: telefone,
                                    servicoNome: servico,
                                    servicoTempoMin: tempoMin,
                                    valor,
                                    pagamentoForma: forma,
                                    raclub: { status: raclub ? "membro" : "nao" },
                                    updatedAt: serverTimestamp(),
                                    createdAt: serverTimestamp(),
                                },
                                { merge: true }
                            );
                            showNotification("Agendamento criado!", "success");
                            await buscarAgenda();
                        } catch (err) {
                            console.error(err);
                            showNotification("Erro ao criar agendamento.", "error");
                        }
                    },
                },
            ],
        });

        const servicoInput = $("#newServico");
        const valorInput = $("#newValor");
        const tempoInput = $("#newTempoMin");

        if (servicoInput) {
            servicoInput.setAttribute("readonly", "readonly");
            servicoInput.style.cursor = "pointer";
            const openPicker = (e) => {
                e.preventDefault();
                openServicosModal((serv) => {
                    servicoInput.value = serv.nome;
                    if (valorInput && serv.valor != null) valorInput.value = Number(serv.valor).toFixed(2);

                    const t = Number(serv.tempoMin ?? serv.tempo ?? 30) || 30;
                    if (tempoInput) tempoInput.value = String(t);
                });
            };
            servicoInput.addEventListener("click", openPicker);
            servicoInput.addEventListener("focus", openPicker);
        }
    }

    async function openEditAgendaModal(colecao, id) {
        if (!colecao || !id) return;
        try {
            const refDoc = doc(db, colecao, id);
            const snap = await getDoc(refDoc);
            if (!snap.exists()) {
                showNotification("Agendamento não encontrado.", "error");
                return;
            }

            const v = snap.data() || {};
            const fullName =
                v.clienteNomeCompleto || [v.clienteNome, v.clienteSobrenome].filter(Boolean).join(" ") || v.cliente || "";
            const telefone = v.clienteTelefone || v.telefoneCliente || v.phone || v.telefone || "";
            const profLabel = v.profissional || getProfLabelByColecao(colecao);

            const tempoMinAtual = Number(v.servicoTempoMin ?? v.tempoMin ?? 30) || 30;

            mainModal.show({
                title: "Editar agendamento",
                body: `
          <div class="form-grid">
            <div class="field">
              <label>Cliente</label>
              <input id="editCliente" value="${fullName || ""}" />
            </div>
            <div class="field">
              <label>Telefone</label>
              <input id="editTelefone" value="${telefone || ""}" placeholder="(00) 00000-0000" />
            </div>
            <div class="field">
              <label>Profissional</label>
              <select id="editProfissional" disabled>
                <option selected>${profLabel}</option>
              </select>
            </div>
            <div class="field">
              <label>Serviço</label>
              <input id="editServico" value="${v.servicoNome || ""}" placeholder="Clique para selecionar o serviço" />
              <input id="editTempoMin" type="hidden" value="${tempoMinAtual}" />
            </div>
            <div class="field">
              <label>Valor (R$)</label>
              <input id="editValor" type="number" step="0.01" value="${v.valor ?? v.servicoValor ?? 0}" />
            </div>
            <div class="field">
              <label>Forma de pagamento</label>
              <select id="editForma">
                <option value="">Selecione</option>
                ${PAYMENT_METHODS.map((m) => `<option ${v.pagamentoForma === m ? "selected" : ""}>${m}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label>
                <input id="editRaclub" type="checkbox" ${v?.raclub?.status === "membro" ? "checked" : ""}/>
                Cliente é do RA Club
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
                            const cliente = $("#editCliente").value.trim();
                            if (!cliente) {
                                showNotification("Informe o nome do cliente.", "error");
                                return false;
                            }
                            const telefoneEdit = ($("#editTelefone")?.value || "").trim();
                            const servico = $("#editServico").value.trim() || "Serviço";
                            const valor = Number($("#editValor").value || 0);
                            const forma = $("#editForma").value || "Outro";
                            const raclub = $("#editRaclub").checked;

                            const tempoMin = Number($("#editTempoMin")?.value || 30) || 30;

                            const [firstName, ...rest] = cliente.split(" ");
                            const lastName = rest.join(" ");

                            // valida conflito por duração (considerando outros horários do dia)
                            try {
                                const ymd = dataFiltro.value;
                                const av = await getDayAvailabilityForColecao(ymd, colecao);
                                if (!av.aberto) {
                                    showNotification("Dia fechado para este profissional.", "error");
                                    return false;
                                }

                                const dayApps = await fetchAppointmentsDayForColecao(ymd, colecao);
                                const filtered = dayApps.filter((x) => x.id !== id);

                                const startHH = (v.hora || "").trim();
                                const ok = canPlaceServiceAtTime({
                                    startHH,
                                    serviceMin: tempoMin,
                                    dayStartHH: av.inicio,
                                    dayEndHH: av.fim,
                                    appointments: filtered
                                });

                                if (!ok) {
                                    showNotification("Esse agendamento conflita com outro horário pelo tempo do serviço.", "error");
                                    return false;
                                }
                            } catch (e) {
                                console.error(e);
                                showNotification("Não foi possível validar conflito de horário.", "error");
                                return false;
                            }

                            const updateData = {
                                clienteNomeCompleto: cliente,
                                clienteNome: firstName,
                                clienteSobrenome: lastName,
                                clienteTelefone: telefoneEdit,
                                telefoneCliente: telefoneEdit,
                                telefone: telefoneEdit,
                                phone: telefoneEdit,
                                servicoNome: servico,
                                servicoTempoMin: tempoMin,
                                valor,
                                pagamentoForma: forma,
                                raclub: { status: raclub ? "membro" : "nao" },
                                profissional: profLabel,
                                updatedAt: serverTimestamp(),
                            };

                            try {
                                await updateDoc(refDoc, updateData);
                                showNotification("Agendamento atualizado!", "success");
                                await buscarAgenda();
                            } catch (err) {
                                console.error(err);
                                showNotification("Erro ao atualizar agendamento.", "error");
                            }
                        },
                    },
                ],
            });

            const servicoInput = $("#editServico");
            const valorInput = $("#editValor");
            const tempoInput = $("#editTempoMin");

            if (servicoInput) {
                servicoInput.setAttribute("readonly", "readonly");
                servicoInput.style.cursor = "pointer";
                const openPicker = (e) => {
                    e.preventDefault();
                    openServicosModal((serv) => {
                        servicoInput.value = serv.nome;
                        if (valorInput && serv.valor != null) valorInput.value = Number(serv.valor).toFixed(2);

                        const t = Number(serv.tempoMin ?? serv.tempo ?? 30) || 30;
                        if (tempoInput) tempoInput.value = String(t);
                    });
                };
                servicoInput.addEventListener("click", openPicker);
                servicoInput.addEventListener("focus", openPicker);
            }
        } catch (err) {
            console.error(err);
            showNotification("Erro ao carregar agendamento.", "error");
        }
    }

    async function cancelarAgendamento(colecao, id) {
        if (!colecao || !id) return;
        mainModal.show({
            title: "Cancelar agendamento",
            body: "<p>Tem certeza que deseja desmarcar este horário?</p>",
            buttons: [
                { text: "Voltar", class: "btn-light" },
                {
                    text: "Desmarcar",
                    class: "btn-del",
                    onClick: async () => {
                        try {
                            await deleteDoc(doc(db, colecao, id));
                            showNotification("Agendamento cancelado.", "success");
                            await buscarAgenda();
                        } catch (err) {
                            console.error(err);
                            showNotification("Erro ao cancelar agendamento.", "error");
                        }
                    },
                },
            ],
        });
    }

    // Bloquear/desbloquear
    async function bloquear(ymd, horas) {
        await waitForAuth();
        if (!ymd) return showNotification("Selecione a data.", "error");

        const colecao = getSelectedColecao();
        if (colecao === "todos") return showNotification("Selecione um profissional para bloquear horários.", "error");

        const profLabel = getProfLabelByColecao(colecao);

        const dayHours = await getAvailableHoursForSelection(ymd, colecao);

        const slots = Array.isArray(horas)
            ? horas
            : horas
                ? [horas]
                : dayHours;

        let criados = 0;
        let pulados = 0;

        for (const hh of slots) {
            const id = toKey(ymd, hh);
            const refDoc = doc(db, colecao, id);
            const snap = await getDoc(refDoc);

            if (snap.exists()) {
                pulados++;
                continue;
            }

            await setDoc(
                refDoc,
                { data: ymd, hora: hh, profissional: profLabel, bloqueado: true, servicoTempoMin: STEP_MIN, createdAt: serverTimestamp() },
                { merge: true }
            );
            criados++;
        }

        showNotification(`Horários bloqueados: ${criados}. Já ocupados: ${pulados}.`, "success");
        await buscarAgenda();
    }

    async function desbloquear(ymd, horas) {
        await waitForAuth();
        if (!ymd) return showNotification("Selecione a data.", "error");

        const colecao = getSelectedColecao();
        if (colecao === "todos") return showNotification("Selecione um profissional para desbloquear horários.", "error");

        const dayHours = await getAvailableHoursForSelection(ymd, colecao);

        const slots = Array.isArray(horas)
            ? horas
            : horas
                ? [horas]
                : dayHours;

        let removidos = 0;
        let mantidos = 0;

        for (const hh of slots) {
            const id = toKey(ymd, hh);
            const refDoc = doc(db, colecao, id);
            const snap = await getDoc(refDoc);
            if (!snap.exists()) continue;

            const v = snap.data() || {};
            const hasClient = !!(v?.cliente || v?.clienteNome || v?.clienteNomeCompleto);

            if (v?.bloqueado && !hasClient) {
                await deleteDoc(refDoc);
                removidos++;
            } else {
                mantidos++;
            }
        }

        showNotification(`Horários liberados: ${removidos}. Mantidos por já estarem reservados: ${mantidos}.`, "success");
        await buscarAgenda();
    }

    bloquearBtn?.addEventListener("click", async () => {
        const start = (horaFiltro?.value || "").trim();
        const ymd = dataFiltro.value;
        const colecao = getSelectedColecao();
        const dayHours = await getAvailableHoursForSelection(ymd, colecao);

        const range = start ? [start] : dayHours;
        bloquear(ymd, range);
    });

    desbloquearBtn?.addEventListener("click", async () => {
        const start = (horaFiltro?.value || "").trim();
        const ymd = dataFiltro.value;
        const colecao = getSelectedColecao();
        const dayHours = await getAvailableHoursForSelection(ymd, colecao);

        const range = start ? [start] : dayHours;
        desbloquear(ymd, range);
    });

    // ============================
    // INIT
    // ============================

    // Data padrão hoje (se vazio)
    if (dataFiltro && !dataFiltro.value) {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, "0");
        const d = String(now.getDate()).padStart(2, "0");
        dataFiltro.value = `${y}-${m}-${d}`;
    }

    // espera profissionais carregarem
    async function waitProfessionals(tries = 60, delay = 150) {
        for (let i = 0; i < tries; i++) {
            if (Array.isArray(state.PROFESSIONALS) && state.PROFESSIONALS.length) return true;
            await new Promise((r) => setTimeout(r, delay));
        }
        return false;
    }

    (async () => {
        populateProfessionalSelects();
        await waitProfessionals();
        populateProfessionalSelects();

        // força "todos"
        if (profissionalSelect) {
            const hasTodos = [...profissionalSelect.options].some((o) => o.value === "todos");
            if (!hasTodos) {
                const opt = document.createElement("option");
                opt.value = "todos";
                opt.textContent = "Todos";
                profissionalSelect.insertBefore(opt, profissionalSelect.firstChild);
            }
            profissionalSelect.value = "todos";
        }

        await fillHoraFiltroDynamic({ keepSelection: false });
        await buscarAgenda();
    })();
}
