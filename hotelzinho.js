// ===============================
// HOTELZINHO.JS
// Ajustado para o HTML atual
// Com filtro no Firebase
// Com sincronização com busca_entrega
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

// -------- Coleções --------
const HOTEL_COLLECTION = "hotelzinho";
const BUSCA_ENTREGA_COLLECTION = "busca_entrega";

// -------- Estado --------
const hotelState = {
    editId: null,
    items: []
};

// -------- Elementos --------
const hotelEls = {
    main: document.getElementById("hotelzinhoMain"),

    form: {
        editId: document.getElementById("hotelEditId"),
        tutor: document.getElementById("hotelTutorNome"),
        animal: document.getElementById("hotelAnimalNome"),
        endereco: document.getElementById("hotelEndereco"),
        telefone: document.getElementById("hotelContato"),
        entrada: document.getElementById("hotelDataEntrada"),
        saida: document.getElementById("hotelDataSaida"),
        chegadaTipo: document.getElementById("hotelFormaChegada"),
        status: document.getElementById("hotelStatus"),
        obs: document.getElementById("hotelObs"),
        salvarBtn: document.getElementById("hotelSalvarBtn"),
        limparBtn: document.getElementById("hotelLimparBtn")
    },

    filtro: {
        tutor: document.getElementById("hotelFiltroTutor"),
        animal: document.getElementById("hotelFiltroAnimal"),
        entrada: document.getElementById("hotelFiltroEntrada"),
        saida: document.getElementById("hotelFiltroSaida"),
        transporte: document.getElementById("hotelFiltroTransporte"),
        buscarBtn: document.getElementById("hotelFiltrarBtn"),
        limparBtn: document.getElementById("hotelLimparFiltroBtn")
    },

    tabela: {
        tbody: document.getElementById("hotelTbody")
    }
};

// -------- Helpers --------
function hotelOnlyDigits(v = "") {
    return String(v).replace(/\D+/g, "");
}

function hotelMaskPhone(v = "") {
    const digits = hotelOnlyDigits(v).slice(0, 11);

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

function hotelFormatDate(value) {
    if (!value) return "-";
    const [y, m, d] = String(value).split("-");
    if (!y || !m || !d) return value;
    return `${d}/${m}/${y}`;
}

function hotelNormalizeText(value = "") {
    return String(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function hotelEscapeHtml(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function hotelStatusLabel(status) {
    const map = {
        reserva: "Reserva",
        confirmado: "Confirmado",
        hospedado: "Hospedado",
        finalizado: "Finalizado",
        cancelado: "Cancelado"
    };
    return map[status] || status || "-";
}

function hotelChegadaLabel(tipo) {
    const map = {
        traz: "Tutor vai trazer",
        buscar: "Pet shop vai buscar"
    };
    return map[tipo] || tipo || "-";
}

function hotelGetStatusBadgeClass(status) {
    const map = {
        reserva: "hotel-status-badge hotel-status-reserva",
        confirmado: "hotel-status-badge hotel-status-confirmado",
        hospedado: "hotel-status-badge hotel-status-hospedado",
        finalizado: "hotel-status-badge hotel-status-finalizado",
        cancelado: "hotel-status-badge hotel-status-cancelado"
    };
    return map[status] || "hotel-status-badge";
}

function hotelSortItems(items = []) {
    return [...items].sort((a, b) => {
        const aKey = `${a.dataEntrada || ""}|${a.dataSaida || ""}|${a.tutorNome || ""}`;
        const bKey = `${b.dataEntrada || ""}|${b.dataSaida || ""}|${b.tutorNome || ""}`;
        return bKey.localeCompare(aKey);
    });
}

function hotelBuildBuscaEntregaOrigin(hotelId) {
    return `hotelzinho:${hotelId}`;
}

function hotelDefaultBuscaHora() {
    return "09:00";
}

function hotelDefaultEntregaHora() {
    return "18:00";
}

// -------- Loading --------
function hotelSetTableLoading(message = "Carregando hospedagens...") {
    const tbody = hotelEls.tabela.tbody;
    if (!tbody) return;

    tbody.innerHTML = `
        <tr>
            <td colspan="8" class="loading-row">${message}</td>
        </tr>
    `;
}

// -------- Form --------
function hotelClearForm() {
    hotelState.editId = null;

    if (hotelEls.form.editId) hotelEls.form.editId.value = "";
    if (hotelEls.form.tutor) hotelEls.form.tutor.value = "";
    if (hotelEls.form.animal) hotelEls.form.animal.value = "";
    if (hotelEls.form.endereco) hotelEls.form.endereco.value = "";
    if (hotelEls.form.telefone) hotelEls.form.telefone.value = "";
    if (hotelEls.form.entrada) hotelEls.form.entrada.value = "";
    if (hotelEls.form.saida) hotelEls.form.saida.value = "";
    if (hotelEls.form.chegadaTipo) hotelEls.form.chegadaTipo.value = "";
    if (hotelEls.form.status) hotelEls.form.status.value = "reserva";
    if (hotelEls.form.obs) hotelEls.form.obs.value = "";

    if (hotelEls.form.salvarBtn) {
        hotelEls.form.salvarBtn.innerHTML = '<i class="bx bx-save"></i> Salvar hospedagem';
    }
}

function hotelFillForm(item = {}) {
    hotelState.editId = item.id || null;

    if (hotelEls.form.editId) hotelEls.form.editId.value = item.id || "";
    if (hotelEls.form.tutor) hotelEls.form.tutor.value = item.tutorNome || "";
    if (hotelEls.form.animal) hotelEls.form.animal.value = item.animalNome || "";
    if (hotelEls.form.endereco) hotelEls.form.endereco.value = item.endereco || "";
    if (hotelEls.form.telefone) hotelEls.form.telefone.value = item.telefoneFormatado || item.telefone || "";
    if (hotelEls.form.entrada) hotelEls.form.entrada.value = item.dataEntrada || "";
    if (hotelEls.form.saida) hotelEls.form.saida.value = item.dataSaida || "";
    if (hotelEls.form.chegadaTipo) hotelEls.form.chegadaTipo.value = item.chegadaTipo || "";
    if (hotelEls.form.status) hotelEls.form.status.value = item.status || "reserva";
    if (hotelEls.form.obs) hotelEls.form.obs.value = item.obs || "";

    if (hotelEls.form.salvarBtn) {
        hotelEls.form.salvarBtn.innerHTML = '<i class="bx bx-save"></i> Atualizar hospedagem';
    }

    hotelEls.main?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hotelBuildPayload() {
    return {
        tutorNome: hotelEls.form.tutor?.value.trim() || "",
        animalNome: hotelEls.form.animal?.value.trim() || "",
        endereco: hotelEls.form.endereco?.value.trim() || "",
        telefone: hotelOnlyDigits(hotelEls.form.telefone?.value || ""),
        telefoneFormatado: hotelMaskPhone(hotelEls.form.telefone?.value || ""),
        dataEntrada: hotelEls.form.entrada?.value || "",
        dataSaida: hotelEls.form.saida?.value || "",
        chegadaTipo: hotelEls.form.chegadaTipo?.value || "",
        status: hotelEls.form.status?.value || "reserva",
        obs: hotelEls.form.obs?.value.trim() || "",
        origemCadastro: "admin"
    };
}

function hotelValidatePayload(payload) {
    if (!payload.tutorNome) {
        alert("Informe o nome do tutor.");
        hotelEls.form.tutor?.focus();
        return false;
    }

    if (!payload.animalNome) {
        alert("Informe o nome do animal.");
        hotelEls.form.animal?.focus();
        return false;
    }

    if (!payload.endereco) {
        alert("Informe o endereço.");
        hotelEls.form.endereco?.focus();
        return false;
    }

    if (!payload.telefone) {
        alert("Informe o telefone para contato.");
        hotelEls.form.telefone?.focus();
        return false;
    }

    if (!payload.dataEntrada) {
        alert("Informe a data de entrada.");
        hotelEls.form.entrada?.focus();
        return false;
    }

    if (!payload.dataSaida) {
        alert("Informe a data de saída.");
        hotelEls.form.saida?.focus();
        return false;
    }

    if (payload.dataSaida < payload.dataEntrada) {
        alert("A data de saída não pode ser menor que a data de entrada.");
        hotelEls.form.saida?.focus();
        return false;
    }

    if (!payload.chegadaTipo) {
        alert("Selecione a forma de chegada.");
        hotelEls.form.chegadaTipo?.focus();
        return false;
    }

    return true;
}

// -------- Normalização doc --------
function hotelMapDoc(docSnap) {
    const data = docSnap.data() || {};

    return {
        id: docSnap.id,
        tutorNome: data.tutorNome || "",
        animalNome: data.animalNome || "",
        endereco: data.endereco || "",
        telefone: data.telefone || "",
        telefoneFormatado: data.telefoneFormatado || hotelMaskPhone(data.telefone || ""),
        dataEntrada: data.dataEntrada || "",
        dataSaida: data.dataSaida || "",
        chegadaTipo: data.chegadaTipo || "",
        status: data.status || "reserva",
        obs: data.obs || "",
        origemCadastro: data.origemCadastro || "admin",
        createdAt: data.createdAt || null,
        updatedAt: data.updatedAt || null
    };
}

// -------- Filtro local complementar --------
function hotelApplyLocalTextFilters(items = []) {
    const tutor = hotelNormalizeText(hotelEls.filtro.tutor?.value || "");
    const animal = hotelNormalizeText(hotelEls.filtro.animal?.value || "");

    return items.filter(item => {
        const matchTutor = !tutor || hotelNormalizeText(item.tutorNome || "").includes(tutor);
        const matchAnimal = !animal || hotelNormalizeText(item.animalNome || "").includes(animal);
        return matchTutor && matchAnimal;
    });
}

// -------- Monta query do Firebase --------
function hotelBuildFirestoreQuery() {
    const ref = collection(db, HOTEL_COLLECTION);
    const constraints = [];

    const entrada = hotelEls.filtro.entrada?.value || "";
    const saida = hotelEls.filtro.saida?.value || "";
    const transporte = hotelEls.filtro.transporte?.value || "";

    if (entrada) constraints.push(where("dataEntrada", "==", entrada));
    if (saida) constraints.push(where("dataSaida", "==", saida));
    if (transporte) constraints.push(where("chegadaTipo", "==", transporte));

    if (!constraints.length) {
        return ref;
    }

    return query(ref, ...constraints);
}

// -------- Busca / Entrega sync --------
function hotelBuildBuscaEntregaPayload(hotelId, hotelPayload) {
    const obsBase = hotelPayload.obs?.trim() || "";
    const obsPrefix = `[Gerado pelo hotelzinho • ${hotelPayload.animalNome}]`;
    const obs = obsBase ? `${obsPrefix} ${obsBase}` : obsPrefix;

    return {
        nome: hotelPayload.tutorNome,
        endereco: hotelPayload.endereco,
        contato: hotelPayload.telefone,
        contatoFormatado: hotelPayload.telefoneFormatado,
        dataBusca: hotelPayload.dataEntrada,
        horaBusca: hotelDefaultBuscaHora(),
        dataEntrega: hotelPayload.dataSaida,
        horaEntrega: hotelDefaultEntregaHora(),
        status: "busca",
        obs,
        motoristaId: null,
        ordemRota: null,
        origemCadastro: hotelBuildBuscaEntregaOrigin(hotelId)
    };
}

async function hotelFindLinkedBuscaEntregaDocs(hotelId) {
    const ref = collection(db, BUSCA_ENTREGA_COLLECTION);
    const qy = query(ref, where("origemCadastro", "==", hotelBuildBuscaEntregaOrigin(hotelId)));
    const snap = await getDocs(qy);
    return snap.docs;
}

async function hotelSyncBuscaEntrega(hotelId, hotelPayload) {
    const linkedDocs = await hotelFindLinkedBuscaEntregaDocs(hotelId);

    if (hotelPayload.chegadaTipo !== "buscar") {
        for (const item of linkedDocs) {
            await deleteDoc(doc(db, BUSCA_ENTREGA_COLLECTION, item.id));
        }
        return;
    }

    const rotaPayload = hotelBuildBuscaEntregaPayload(hotelId, hotelPayload);

    if (!linkedDocs.length) {
        await addDoc(collection(db, BUSCA_ENTREGA_COLLECTION), {
            ...rotaPayload,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        return;
    }

    for (const item of linkedDocs) {
        await updateDoc(doc(db, BUSCA_ENTREGA_COLLECTION, item.id), {
            ...rotaPayload,
            updatedAt: serverTimestamp()
        });
    }
}

async function hotelRemoveLinkedBuscaEntrega(hotelId) {
    const linkedDocs = await hotelFindLinkedBuscaEntregaDocs(hotelId);

    for (const item of linkedDocs) {
        await deleteDoc(doc(db, BUSCA_ENTREGA_COLLECTION, item.id));
    }
}

// -------- Tabela --------
function hotelRenderTable(items = []) {
    const tbody = hotelEls.tabela.tbody;
    if (!tbody) return;

    if (!items.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="loading-row">Nenhuma hospedagem encontrada.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = items.map(item => {
        const badgeClass = hotelGetStatusBadgeClass(item.status);

        return `
            <tr>
                <td>${hotelEscapeHtml(item.tutorNome || "-")}</td>
                <td>${hotelEscapeHtml(item.animalNome || "-")}</td>
                <td>${hotelEscapeHtml(item.telefoneFormatado || item.telefone || "-")}</td>
                <td>${hotelFormatDate(item.dataEntrada || "")}</td>
                <td>${hotelFormatDate(item.dataSaida || "")}</td>
                <td>${hotelEscapeHtml(hotelChegadaLabel(item.chegadaTipo))}</td>
                <td><span class="${badgeClass}">${hotelEscapeHtml(hotelStatusLabel(item.status))}</span></td>
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
async function hotelLoadItems() {
    if (!hotelEls.main) return;

    try {
        hotelSetTableLoading("Carregando hospedagens...");

        const ref = collection(db, HOTEL_COLLECTION);
        const snap = await getDocs(ref);

        hotelState.items = hotelSortItems(snap.docs.map(hotelMapDoc));
        hotelRenderTable(hotelApplyLocalTextFilters(hotelState.items));
    } catch (error) {
        console.error("Erro ao carregar hospedagens:", error);
        hotelSetTableLoading("Erro ao carregar hospedagens.");
        alert("Não foi possível carregar as hospedagens.");
    }
}

async function hotelFilterFromFirebase() {
    if (!hotelEls.main) return;

    try {
        hotelSetTableLoading("Filtrando hospedagens...");

        const qy = hotelBuildFirestoreQuery();
        const snap = await getDocs(qy);

        let items = snap.docs.map(hotelMapDoc);
        items = hotelSortItems(items);
        items = hotelApplyLocalTextFilters(items);

        hotelRenderTable(items);
    } catch (error) {
        console.error("Erro ao filtrar hospedagens no Firebase:", error);
        hotelSetTableLoading("Erro ao filtrar hospedagens.");
        alert("Não foi possível filtrar as hospedagens.");
    }
}

async function hotelCreateItem(payload) {
    const ref = collection(db, HOTEL_COLLECTION);

    const docRef = await addDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });

    await hotelSyncBuscaEntrega(docRef.id, payload);
    return docRef.id;
}

async function hotelUpdateItem(id, payload) {
    const ref = doc(db, HOTEL_COLLECTION, id);

    await updateDoc(ref, {
        ...payload,
        updatedAt: serverTimestamp()
    });

    await hotelSyncBuscaEntrega(id, payload);
}

async function hotelDeleteItem(id) {
    try {
        await hotelRemoveLinkedBuscaEntrega(id);
        await deleteDoc(doc(db, HOTEL_COLLECTION, id));

        hotelState.items = hotelState.items.filter(item => item.id !== id);

        await hotelFilterFromFirebase();

        if (hotelState.editId === id) {
            hotelClearForm();
        }

        alert("Hospedagem removida com sucesso.");
    } catch (error) {
        console.error("Erro ao excluir hospedagem:", error);
        alert("Não foi possível excluir a hospedagem.");
    }
}

// -------- Eventos --------
function hotelBindTableActions() {
    const tbody = hotelEls.tabela.tbody;
    if (!tbody) return;

    tbody.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-action]");
        if (!btn) return;

        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const item = hotelState.items.find(x => x.id === id);

        if (!item) return;

        if (action === "edit") {
            hotelFillForm(item);
        }

        if (action === "delete") {
            const confirmed = confirm(`Deseja remover a hospedagem de ${item.animalNome || item.tutorNome}?`);
            if (!confirmed) return;
            hotelDeleteItem(id);
        }
    });
}

function hotelBindInputMasks() {
    if (hotelEls.form.telefone) {
        hotelEls.form.telefone.addEventListener("input", () => {
            hotelEls.form.telefone.value = hotelMaskPhone(hotelEls.form.telefone.value);
        });
    }
}

async function hotelHandleSave() {
    const payload = hotelBuildPayload();

    if (!hotelValidatePayload(payload)) {
        return;
    }

    try {
        if (hotelEls.form.salvarBtn) {
            hotelEls.form.salvarBtn.disabled = true;
        }

        if (hotelState.editId) {
            await hotelUpdateItem(hotelState.editId, payload);
            alert("Hospedagem atualizada com sucesso.");
        } else {
            await hotelCreateItem(payload);
            alert("Hospedagem salva com sucesso.");
        }

        hotelClearForm();
        await hotelLoadItems();
    } catch (error) {
        console.error("Erro ao salvar hospedagem:", error);
        alert("Não foi possível salvar a hospedagem.");
    } finally {
        if (hotelEls.form.salvarBtn) {
            hotelEls.form.salvarBtn.disabled = false;
        }
    }
}

function hotelBindButtons() {
    hotelEls.form.salvarBtn?.addEventListener("click", hotelHandleSave);
    hotelEls.form.limparBtn?.addEventListener("click", hotelClearForm);

    hotelEls.filtro.buscarBtn?.addEventListener("click", async () => {
        await hotelFilterFromFirebase();
    });

    hotelEls.filtro.limparBtn?.addEventListener("click", async () => {
        if (hotelEls.filtro.tutor) hotelEls.filtro.tutor.value = "";
        if (hotelEls.filtro.animal) hotelEls.filtro.animal.value = "";
        if (hotelEls.filtro.entrada) hotelEls.filtro.entrada.value = "";
        if (hotelEls.filtro.saida) hotelEls.filtro.saida.value = "";
        if (hotelEls.filtro.transporte) hotelEls.filtro.transporte.value = "";

        await hotelLoadItems();
    });
}

function hotelBindAutoFilters() {
    hotelEls.filtro.tutor?.addEventListener("input", async () => {
        await hotelFilterFromFirebase();
    });

    hotelEls.filtro.animal?.addEventListener("input", async () => {
        await hotelFilterFromFirebase();
    });

    hotelEls.filtro.entrada?.addEventListener("change", async () => {
        await hotelFilterFromFirebase();
    });

    hotelEls.filtro.saida?.addEventListener("change", async () => {
        await hotelFilterFromFirebase();
    });

    hotelEls.filtro.transporte?.addEventListener("change", async () => {
        await hotelFilterFromFirebase();
    });
}

// -------- Init --------
async function initHotelzinho() {
    if (!hotelEls.main) return;

    hotelBindInputMasks();
    hotelBindButtons();
    hotelBindAutoFilters();
    hotelBindTableActions();
    hotelClearForm();
    await hotelLoadItems();
}

initHotelzinho();