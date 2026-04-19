// ===============================
// BUSCAENTREGA.JS
// Aba Busca / Entrega
// Ajustado para o HTML atual
// Com filtro no Firebase
// Com suporte para rotas vindas do hotelzinho
// ===============================

import { db } from "./firebase.js";

import {
    collection,
    addDoc,
    getDocs,
    doc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
    query,
    where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// -------- Coleção --------
const BUSCA_ENTREGA_COLLECTION = "busca_entrega";

// -------- Estado --------
const beState = {
    editId: null,
    items: []
};

// -------- Elementos --------
const beEls = {
    main: document.getElementById("buscaentregaMain"),

    form: {
        editId: document.getElementById("beEditId"),
        nome: document.getElementById("beNome"),
        endereco: document.getElementById("beEndereco"),
        contato: document.getElementById("beContato"),
        dataBusca: document.getElementById("beDataBusca"),
        horaBusca: document.getElementById("beHoraBusca"),
        dataEntrega: document.getElementById("beDataEntrega"),
        horaEntrega: document.getElementById("beHoraEntrega"),
        status: document.getElementById("beStatus"),
        obs: document.getElementById("beObs"),
        salvarBtn: document.getElementById("beSalvarBtn"),
        limparBtn: document.getElementById("beLimparBtn")
    },

    filtro: {
        cliente: document.getElementById("beFiltroCliente"),
        data: document.getElementById("beFiltroData"),
        status: document.getElementById("beFiltroStatus"),
        buscarBtn: document.getElementById("beFiltrarBtn"),
        limparBtn: document.getElementById("beLimparFiltroBtn")
    },

    tabela: {
        tbody: document.getElementById("beTbody")
    }
};

// -------- Helpers --------
function beOnlyDigits(v = "") {
    return String(v).replace(/\D+/g, "");
}

function beMaskPhone(v = "") {
    const digits = beOnlyDigits(v).slice(0, 11);

    if (digits.length <= 10) {
        return digits.replace(/^(\d{2})(\d{0,4})(\d{0,4}).*/, (_, a, b, c) => {
            let out = "";
            if (a) out += `(${a}`;
            if (a && a.length === 2) out += ") ";
            if (b) out += b;
            if (c) out += `-${c}`;
            return out;
        });
    }

    return digits.replace(/^(\d{2})(\d{0,5})(\d{0,4}).*/, (_, a, b, c) => {
        let out = "";
        if (a) out += `(${a}`;
        if (a && a.length === 2) out += ") ";
        if (b) out += b;
        if (c) out += `-${c}`;
        return out;
    });
}

function beNormalizeText(value = "") {
    return String(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function beEscapeHtml(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function beFormatDate(value) {
    if (!value) return "-";
    const [y, m, d] = String(value).split("-");
    if (!y || !m || !d) return value;
    return `${d}/${m}/${y}`;
}

function beFormatDateTime(dateValue, timeValue) {
    const date = beFormatDate(dateValue || "");
    const time = (timeValue || "").slice(0, 5);

    if (date === "-" && !time) return "-";
    if (date !== "-" && time) return `${date} ${time}`;
    if (date !== "-") return date;
    return time || "-";
}

function beStatusLabel(status) {
    const map = {
        busca: "Busca",
        "no-local": "No local",
        "saiu-para-entrega": "Saiu para entrega",
        entregue: "Entregue"
    };
    return map[status] || status || "-";
}

function beStatusBadgeClass(status) {
    const map = {
        busca: "be-status-badge be-status-busca",
        "no-local": "be-status-badge be-status-no-local",
        "saiu-para-entrega": "be-status-badge be-status-saiu-entrega",
        entregue: "be-status-badge be-status-entregue"
    };
    return map[status] || "be-status-badge";
}

function beSortItems(items = []) {
    return [...items].sort((a, b) => {
        const aKey = `${a.dataBusca || ""}|${a.horaBusca || ""}|${a.nome || ""}`;
        const bKey = `${b.dataBusca || ""}|${b.horaBusca || ""}|${b.nome || ""}`;
        return bKey.localeCompare(aKey);
    });
}

function beIsFromHotelzinho(item = {}) {
    return String(item.origemCadastro || "").startsWith("hotelzinho:");
}

function beSourceBadge(item = {}) {
    if (!beIsFromHotelzinho(item)) return "";
    return `
        <div style="margin-top:4px;">
            <small style="
                display:inline-block;
                padding:4px 8px;
                border-radius:999px;
                background:rgba(243,154,61,.12);
                color:#b56a17;
                font-weight:700;
            ">Hotelzinho</small>
        </div>
    `;
}

// -------- Loading --------
function beSetTableLoading(message = "Carregando registros...") {
    const tbody = beEls.tabela.tbody;
    if (!tbody) return;

    tbody.innerHTML = `
        <tr>
            <td colspan="7" class="loading-row">${message}</td>
        </tr>
    `;
}

// -------- Form --------
function beClearForm() {
    beState.editId = null;

    if (beEls.form.editId) beEls.form.editId.value = "";
    if (beEls.form.nome) beEls.form.nome.value = "";
    if (beEls.form.endereco) beEls.form.endereco.value = "";
    if (beEls.form.contato) beEls.form.contato.value = "";
    if (beEls.form.dataBusca) beEls.form.dataBusca.value = "";
    if (beEls.form.horaBusca) beEls.form.horaBusca.value = "";
    if (beEls.form.dataEntrega) beEls.form.dataEntrega.value = "";
    if (beEls.form.horaEntrega) beEls.form.horaEntrega.value = "";
    if (beEls.form.status) beEls.form.status.value = "busca";
    if (beEls.form.obs) beEls.form.obs.value = "";

    if (beEls.form.salvarBtn) {
        beEls.form.salvarBtn.innerHTML = '<i class="bx bx-save"></i> Salvar rota';
    }
}

function beFillForm(item = {}) {
    beState.editId = item.id || null;

    if (beEls.form.editId) beEls.form.editId.value = item.id || "";
    if (beEls.form.nome) beEls.form.nome.value = item.nome || "";
    if (beEls.form.endereco) beEls.form.endereco.value = item.endereco || "";
    if (beEls.form.contato) beEls.form.contato.value = item.contatoFormatado || item.contato || "";
    if (beEls.form.dataBusca) beEls.form.dataBusca.value = item.dataBusca || "";
    if (beEls.form.horaBusca) beEls.form.horaBusca.value = item.horaBusca || "";
    if (beEls.form.dataEntrega) beEls.form.dataEntrega.value = item.dataEntrega || "";
    if (beEls.form.horaEntrega) beEls.form.horaEntrega.value = item.horaEntrega || "";
    if (beEls.form.status) beEls.form.status.value = item.status || "busca";
    if (beEls.form.obs) beEls.form.obs.value = item.obs || "";

    if (beEls.form.salvarBtn) {
        beEls.form.salvarBtn.innerHTML = beIsFromHotelzinho(item)
            ? '<i class="bx bx-save"></i> Atualizar rota do hotelzinho'
            : '<i class="bx bx-save"></i> Atualizar rota';
    }

    beEls.main?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function beBuildPayload() {
    const currentItem = beState.items.find(item => item.id === beState.editId);

    return {
        nome: beEls.form.nome?.value.trim() || "",
        endereco: beEls.form.endereco?.value.trim() || "",
        contato: beOnlyDigits(beEls.form.contato?.value || ""),
        contatoFormatado: beMaskPhone(beEls.form.contato?.value || ""),
        dataBusca: beEls.form.dataBusca?.value || "",
        horaBusca: beEls.form.horaBusca?.value || "",
        dataEntrega: beEls.form.dataEntrega?.value || "",
        horaEntrega: beEls.form.horaEntrega?.value || "",
        status: beEls.form.status?.value || "busca",
        obs: beEls.form.obs?.value.trim() || "",
        motoristaId: currentItem?.motoristaId ?? null,
        ordemRota: currentItem?.ordemRota ?? null,
        origemCadastro: currentItem?.origemCadastro || "admin"
    };
}

function beValidatePayload(payload) {
    if (!payload.nome) {
        alert("Informe o nome do cliente.");
        beEls.form.nome?.focus();
        return false;
    }

    if (!payload.endereco) {
        alert("Informe o endereço.");
        beEls.form.endereco?.focus();
        return false;
    }

    if (!payload.contato) {
        alert("Informe o contato.");
        beEls.form.contato?.focus();
        return false;
    }

    if (!payload.dataBusca) {
        alert("Informe a data da busca.");
        beEls.form.dataBusca?.focus();
        return false;
    }

    if (!payload.horaBusca) {
        alert("Informe o horário da busca.");
        beEls.form.horaBusca?.focus();
        return false;
    }

    if (!payload.dataEntrega) {
        alert("Informe a data da entrega.");
        beEls.form.dataEntrega?.focus();
        return false;
    }

    if (!payload.horaEntrega) {
        alert("Informe o horário da entrega.");
        beEls.form.horaEntrega?.focus();
        return false;
    }

    const buscaKey = `${payload.dataBusca}T${payload.horaBusca}`;
    const entregaKey = `${payload.dataEntrega}T${payload.horaEntrega}`;

    if (entregaKey < buscaKey) {
        alert("A data/hora da entrega não pode ser menor que a data/hora da busca.");
        beEls.form.dataEntrega?.focus();
        return false;
    }

    return true;
}

// -------- Normalização doc --------
function beMapDoc(docSnap) {
    const data = docSnap.data() || {};

    return {
        id: docSnap.id,
        nome: data.nome || "",
        endereco: data.endereco || "",
        contato: data.contato || "",
        contatoFormatado: data.contatoFormatado || beMaskPhone(data.contato || ""),
        dataBusca: data.dataBusca || "",
        horaBusca: data.horaBusca || "",
        dataEntrega: data.dataEntrega || "",
        horaEntrega: data.horaEntrega || "",
        status: data.status || "busca",
        obs: data.obs || "",
        motoristaId: data.motoristaId ?? null,
        ordemRota: data.ordemRota ?? null,
        origemCadastro: data.origemCadastro || "admin",
        createdAt: data.createdAt || null,
        updatedAt: data.updatedAt || null
    };
}

// -------- Filtro local complementar --------
function beApplyLocalTextFilter(items = []) {
    const cliente = beNormalizeText(beEls.filtro.cliente?.value || "");

    if (!cliente) return items;

    return items.filter(item => {
        const text = beNormalizeText(
            `${item.nome || ""} ${item.endereco || ""} ${item.contatoFormatado || item.contato || ""}`
        );
        return text.includes(cliente);
    });
}

// -------- Monta query do Firebase --------
function beBuildFirestoreQuery() {
    const ref = collection(db, BUSCA_ENTREGA_COLLECTION);
    const constraints = [];

    const data = beEls.filtro.data?.value || "";
    const status = beEls.filtro.status?.value || "";

    if (data) constraints.push(where("dataBusca", "==", data));
    if (status) constraints.push(where("status", "==", status));

    if (!constraints.length) {
        return ref;
    }

    return query(ref, ...constraints);
}

// -------- Tabela --------
function beRenderTable(items = []) {
    const tbody = beEls.tabela.tbody;
    if (!tbody) return;

    if (!items.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="loading-row">Nenhum registro encontrado.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = items.map(item => {
        const badgeClass = beStatusBadgeClass(item.status);

        return `
            <tr>
                <td>
                    ${beEscapeHtml(item.nome || "-")}
                    ${beSourceBadge(item)}
                </td>
                <td>${beEscapeHtml(item.contatoFormatado || item.contato || "-")}</td>
                <td>${beFormatDateTime(item.dataBusca, item.horaBusca)}</td>
                <td>${beFormatDateTime(item.dataEntrega, item.horaEntrega)}</td>
                <td><span class="${badgeClass}">${beEscapeHtml(beStatusLabel(item.status))}</span></td>
                <td>${beEscapeHtml(item.obs || "-")}</td>
                <td style="text-align:right;">
                    <button class="btn btn-light btn-sm" type="button" data-action="edit" data-id="${item.id}">
                        <i class="bx bx-edit"></i>
                    </button>
                    <button class="btn btn-warning btn-sm" type="button" data-action="delete" data-id="${item.id}">
                        <i class="bx bx-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

// -------- CRUD --------
async function beLoadItems() {
    if (!beEls.main) return;

    try {
        beSetTableLoading("Carregando registros...");

        const ref = collection(db, BUSCA_ENTREGA_COLLECTION);
        const snap = await getDocs(ref);

        beState.items = beSortItems(snap.docs.map(beMapDoc));
        beRenderTable(beApplyLocalTextFilter(beState.items));
    } catch (error) {
        console.error("Erro ao carregar busca/entrega:", error);
        beSetTableLoading("Erro ao carregar registros.");
        alert("Não foi possível carregar os registros de busca e entrega.");
    }
}

async function beFilterFromFirebase() {
    if (!beEls.main) return;

    try {
        beSetTableLoading("Filtrando registros...");

        const qy = beBuildFirestoreQuery();
        const snap = await getDocs(qy);

        let items = snap.docs.map(beMapDoc);
        items = beSortItems(items);
        items = beApplyLocalTextFilter(items);

        beRenderTable(items);
    } catch (error) {
        console.error("Erro ao filtrar busca/entrega no Firebase:", error);
        beSetTableLoading("Erro ao filtrar registros.");
        alert("Não foi possível filtrar os registros.");
    }
}

async function beCreateItem(payload) {
    const ref = collection(db, BUSCA_ENTREGA_COLLECTION);

    await addDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
}

async function beUpdateItem(id, payload) {
    const ref = doc(db, BUSCA_ENTREGA_COLLECTION, id);

    await updateDoc(ref, {
        ...payload,
        updatedAt: serverTimestamp()
    });
}

async function beDeleteItem(id) {
    try {
        await deleteDoc(doc(db, BUSCA_ENTREGA_COLLECTION, id));

        beState.items = beState.items.filter(item => item.id !== id);

        await beFilterFromFirebase();

        if (beState.editId === id) {
            beClearForm();
        }

        alert("Registro removido com sucesso.");
    } catch (error) {
        console.error("Erro ao excluir registro:", error);
        alert("Não foi possível excluir o registro.");
    }
}

// -------- Salvar --------
async function beHandleSave() {
    const payload = beBuildPayload();

    if (!beValidatePayload(payload)) {
        return;
    }

    try {
        if (beEls.form.salvarBtn) {
            beEls.form.salvarBtn.disabled = true;
        }

        if (beState.editId) {
            await beUpdateItem(beState.editId, payload);
            alert("Registro atualizado com sucesso.");
        } else {
            await beCreateItem(payload);
            alert("Registro salvo com sucesso.");
        }

        beClearForm();
        await beLoadItems();
    } catch (error) {
        console.error("Erro ao salvar registro:", error);
        alert("Não foi possível salvar o registro.");
    } finally {
        if (beEls.form.salvarBtn) {
            beEls.form.salvarBtn.disabled = false;
        }
    }
}

// -------- Eventos --------
function beBindTableActions() {
    const tbody = beEls.tabela.tbody;
    if (!tbody) return;

    tbody.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-action]");
        if (!btn) return;

        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const item = beState.items.find(x => x.id === id);

        if (!item) return;

        if (action === "edit") {
            beFillForm(item);
        }

        if (action === "delete") {
            const confirmed = confirm(`Deseja remover o registro de ${item.nome || "cliente"}?`);
            if (!confirmed) return;
            beDeleteItem(id);
        }
    });
}

function beBindInputMasks() {
    if (beEls.form.contato) {
        beEls.form.contato.addEventListener("input", () => {
            beEls.form.contato.value = beMaskPhone(beEls.form.contato.value);
        });
    }
}

function beBindButtons() {
    beEls.form.salvarBtn?.addEventListener("click", beHandleSave);
    beEls.form.limparBtn?.addEventListener("click", beClearForm);

    beEls.filtro.buscarBtn?.addEventListener("click", async () => {
        await beFilterFromFirebase();
    });

    beEls.filtro.limparBtn?.addEventListener("click", async () => {
        if (beEls.filtro.cliente) beEls.filtro.cliente.value = "";
        if (beEls.filtro.data) beEls.filtro.data.value = "";
        if (beEls.filtro.status) beEls.filtro.status.value = "";

        await beLoadItems();
    });
}

function beBindAutoFilters() {
    beEls.filtro.cliente?.addEventListener("input", async () => {
        await beFilterFromFirebase();
    });

    beEls.filtro.data?.addEventListener("change", async () => {
        await beFilterFromFirebase();
    });

    beEls.filtro.status?.addEventListener("change", async () => {
        await beFilterFromFirebase();
    });
}

// -------- Init --------
async function initBuscaEntrega() {
    if (!beEls.main) return;

    beBindInputMasks();
    beBindButtons();
    beBindAutoFilters();
    beBindTableActions();
    beClearForm();
    await beLoadItems();
}

initBuscaEntrega();