// /js/clientes.js
import {
  db, $, formatCurrency, showNotification, mainModal,
  state, waitForAuth,
  addDoc, updateDoc, deleteDoc, doc, collection, onSnapshot, query, orderBy, serverTimestamp,
  formatDate
} from "./firebase.js";

export function initClientesTab() {
  const cliNome = $("#cliNome");
  const cliSobrenome = $("#cliSobrenome"); // no Pet Shop = nome do pet
  const cliTelefone = $("#cliTelefone");
  const cliRaclub = $("#cliRaclub"); // no Pet Shop = Clube Pet
  const cliSalvarBtn = $("#cliSalvarBtn");
  const cliLimparBtn = $("#cliLimparBtn");
  const clientesTbody = $("#clientesTbody");
  const raclubPayTbody = $("#raclubPayTbody");

  if (!clientesTbody) return;

  function clearForm() {
    if (cliNome) cliNome.value = "";
    if (cliSobrenome) cliSobrenome.value = "";
    if (cliTelefone) cliTelefone.value = "";
    if (cliRaclub) cliRaclub.value = "nao";
  }

  function normalizeClientDoc(id, v) {
    const nome = v.nome || v.name || "";
    const pet = v.pet || v.clienteSobrenome || v.sobrenome || "";
    const telefone = v.telefone || v.phone || "";
    const clubePet =
      v.clubePet ||
      v.raclub ||
      v.plano ||
      (v.type === "plano_jc" ? "membro" : "nao") ||
      "nao";

    const isMember =
      clubePet === "membro" ||
      clubePet === "ra_club" ||
      clubePet === "clube_pet" ||
      clubePet === "PLANO_RA" ||
      v.type === "plano_jc" ||
      v.isPlan === true;

    return {
      id,
      nome,
      pet,
      telefone,
      clubePet: isMember ? "membro" : "nao",
      status: v.status || v.situacao || (isMember ? "ativo" : "—"),
      createdAt: v.createdAt || null,
    };
  }

  function renderClients() {
    if (!clientesTbody) return;

    const clients = [...(state.allClients || [])].sort((a, b) =>
      (a.nome || "").localeCompare(b.nome || "", "pt-BR")
    );

    if (!clients.length) {
      clientesTbody.innerHTML = `
        <tr>
          <td colspan="4" class="loading-row">Nenhum tutor cadastrado.</td>
        </tr>
      `;
      return;
    }

    clientesTbody.innerHTML = clients
      .map((c) => {
        const clubeLabel = c.clubePet === "membro" ? "Membro" : "Não é membro";

        return `
          <tr>
            <td>
              <strong>${escapeHtml(c.nome || "—")}</strong>
              ${c.pet ? `<div class="muted">Pet: ${escapeHtml(c.pet)}</div>` : ""}
            </td>
            <td>${escapeHtml(c.telefone || "—")}</td>
            <td>${clubeLabel}</td>
            <td style="text-align:right;">
              <div class="timeslot-actions">
                <button class="btn btn-sm btn-edit" data-action="edit-client" data-id="${c.id}" title="Editar">
                  <i class="bx bx-pencil"></i>
                </button>

                ${
                  c.clubePet === "membro"
                    ? `
                  <button class="btn btn-sm btn-success" data-action="pay-client" data-id="${c.id}" title="Registrar pagamento">
                    <i class="bx bx-dollar"></i>
                  </button>
                `
                    : ""
                }

                <button class="btn btn-sm btn-del" data-action="delete-client" data-id="${c.id}" title="Excluir">
                  <i class="bx bx-trash"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function renderPayments(payments) {
    if (!raclubPayTbody) return;

    const rows = [...payments].sort((a, b) => {
      const da = getPaymentDate(a);
      const db = getPaymentDate(b);
      return db - da;
    });

    if (!rows.length) {
      raclubPayTbody.innerHTML = `
        <tr>
          <td colspan="4" class="loading-row">Sem pagamentos para exibir.</td>
        </tr>
      `;
      return;
    }

    raclubPayTbody.innerHTML = rows
      .map((p) => {
        const d = getPaymentDate(p);
        const mesAno = d
          ? d.toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })
          : "—";

        const tutor =
          p.clientName ||
          p.nomeCliente ||
          p.nome ||
          "—";

        const valor = Number(p.value ?? p.valor ?? 0);
        const status = p.status || "Pago";

        return `
          <tr>
            <td>${escapeHtml(tutor)}</td>
            <td>${mesAno}</td>
            <td>${formatCurrency(valor)}</td>
            <td>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <span>${escapeHtml(status)}</span>
                <button class="btn btn-sm btn-del" data-payment-id="${p.id}" title="Excluir pagamento">
                  <i class="bx bx-trash"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  async function saveClient() {
    await waitForAuth();

    const nome = (cliNome?.value || "").trim();
    const pet = (cliSobrenome?.value || "").trim();
    const telefone = (cliTelefone?.value || "").trim();
    const clubePet = cliRaclub?.value || "nao";

    if (!nome) {
      showNotification("Informe o nome do tutor.", "error");
      return;
    }

    const isMember = clubePet === "membro";

    const dataFirestore = {
      // padrão novo / pet
      nome,
      pet,
      telefone,
      clubePet,

      // compatibilidade com projeto antigo
      name: nome,
      phone: telefone,
      clienteSobrenome: pet,
      sobrenome: pet,
      raclub: clubePet,
      plano: isMember ? "ra_club" : "cliente",
      type: isMember ? "plano_jc" : "cliente",
      status: isMember ? "ativo" : null,
      situacao: isMember ? "ativo" : null,

      createdAt: serverTimestamp(),
    };

    try {
      cliSalvarBtn && (cliSalvarBtn.disabled = true);
      await addDoc(collection(db, "raclub_clients"), dataFirestore);
      clearForm();
      showNotification("Tutor cadastrado com sucesso!", "success");
    } catch (err) {
      console.error("Erro ao salvar tutor:", err);
      showNotification("Erro ao cadastrar tutor.", "error");
    } finally {
      cliSalvarBtn && (cliSalvarBtn.disabled = false);
    }
  }

  async function openEditClientModal(id) {
    const client = (state.allClients || []).find((c) => c.id === id);
    if (!client) return;

    mainModal.show({
      title: "Editar tutor",
      body: `
        <div class="form-grid">
          <div class="field">
            <label>Nome do tutor</label>
            <input id="editCliNome" value="${escapeAttr(client.nome || "")}" />
          </div>
          <div class="field">
            <label>Nome do pet</label>
            <input id="editCliPet" value="${escapeAttr(client.pet || "")}" />
          </div>
          <div class="field">
            <label>Telefone</label>
            <input id="editCliTelefone" value="${escapeAttr(client.telefone || "")}" />
          </div>
          <div class="field">
            <label>Clube Pet</label>
            <select id="editCliRaclub">
              <option value="nao" ${client.clubePet === "nao" ? "selected" : ""}>Não é membro</option>
              <option value="membro" ${client.clubePet === "membro" ? "selected" : ""}>Membro</option>
            </select>
          </div>
        </div>
      `,
      buttons: [
        { text: "Cancelar", class: "btn-light" },
        {
          text: "Salvar",
          class: "btn-edit",
          onClick: async () => {
            await waitForAuth();

            const nome = ($("#editCliNome")?.value || "").trim();
            const pet = ($("#editCliPet")?.value || "").trim();
            const telefone = ($("#editCliTelefone")?.value || "").trim();
            const clubePet = $("#editCliRaclub")?.value || "nao";

            if (!nome) {
              showNotification("Informe o nome do tutor.", "error");
              return false;
            }

            const isMember = clubePet === "membro";

            try {
              await updateDoc(doc(db, "raclub_clients", id), {
                nome,
                pet,
                telefone,
                clubePet,

                // compatibilidade
                name: nome,
                phone: telefone,
                clienteSobrenome: pet,
                sobrenome: pet,
                raclub: clubePet,
                plano: isMember ? "ra_club" : "cliente",
                type: isMember ? "plano_jc" : "cliente",
                status: isMember ? "ativo" : null,
                situacao: isMember ? "ativo" : null,
              });

              showNotification("Tutor atualizado com sucesso!", "success");
            } catch (err) {
              console.error("Erro ao atualizar tutor:", err);
              showNotification("Erro ao atualizar tutor.", "error");
              return false;
            }
          },
        },
      ],
    });
  }

  async function deleteClient(id) {
    const client = (state.allClients || []).find((c) => c.id === id);
    if (!client) return;

    mainModal.show({
      title: "Excluir tutor",
      body: `<p>Deseja remover <strong>${escapeHtml(client.nome)}</strong>?</p>`,
      buttons: [
        { text: "Cancelar", class: "btn-light" },
        {
          text: "Excluir",
          class: "btn-del",
          onClick: async () => {
            await waitForAuth();

            try {
              await deleteDoc(doc(db, "raclub_clients", id));
              showNotification("Tutor removido com sucesso!", "success");
            } catch (err) {
              console.error("Erro ao excluir tutor:", err);
              showNotification("Erro ao excluir tutor.", "error");
              return false;
            }
          },
        },
      ],
    });
  }

  async function openPaymentModalForClient(id) {
    const client = (state.allClients || []).find((c) => c.id === id);
    if (!client) return;

    mainModal.show({
      title: "Registrar pagamento do Clube Pet",
      body: `
        <div class="form-grid">
          <div class="field">
            <label>Tutor</label>
            <input value="${escapeAttr(client.nome || "")}" disabled />
          </div>
          <div class="field">
            <label>Valor</label>
            <input id="payValue" type="number" step="0.01" placeholder="0,00" />
          </div>
        </div>
      `,
      buttons: [
        { text: "Cancelar", class: "btn-light" },
        {
          text: "Registrar",
          class: "btn-edit",
          onClick: async () => {
            await waitForAuth();

            const value = Number($("#payValue")?.value || 0);
            if (!value) {
              showNotification("Informe um valor válido.", "error");
              return false;
            }

            try {
              await addDoc(collection(db, "raclub_payments"), {
                clientId: client.id,
                clientName: client.nome || "",
                nomeCliente: client.nome || "",
                value,
                valor: value,
                status: "Pago",
                date: serverTimestamp(),
                dataPagamento: serverTimestamp(),
                createdAt: serverTimestamp(),
              });

              showNotification("Pagamento registrado com sucesso!", "success");
            } catch (err) {
              console.error("Erro ao registrar pagamento:", err);
              showNotification("Erro ao registrar pagamento.", "error");
              return false;
            }
          },
        },
      ],
    });
  }

  // ações da tabela de tutores
  clientesTbody.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const { action, id } = btn.dataset;
    if (!id) return;

    if (action === "edit-client") openEditClientModal(id);
    if (action === "pay-client") openPaymentModalForClient(id);
    if (action === "delete-client") deleteClient(id);
  });

  // ações da tabela de pagamentos
  raclubPayTbody?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-payment-id]");
    if (!btn) return;

    const paymentId = btn.dataset.paymentId;
    if (!paymentId) return;

    mainModal.show({
      title: "Excluir pagamento",
      body: "<p>Deseja remover este pagamento?</p>",
      buttons: [
        { text: "Cancelar", class: "btn-light" },
        {
          text: "Excluir",
          class: "btn-del",
          onClick: async () => {
            await waitForAuth();

            try {
              await deleteDoc(doc(db, "raclub_payments", paymentId));
              showNotification("Pagamento removido com sucesso!", "success");
            } catch (err) {
              console.error("Erro ao excluir pagamento:", err);
              showNotification("Erro ao excluir pagamento.", "error");
              return false;
            }
          },
        },
      ],
    });
  });

  cliSalvarBtn?.addEventListener("click", saveClient);
  cliLimparBtn?.addEventListener("click", clearForm);

  // listeners
  (async () => {
    await waitForAuth();

    onSnapshot(
      query(collection(db, "raclub_clients"), orderBy("nome")),
      (snap) => {
        state.allClients = snap.docs.map((d) => normalizeClientDoc(d.id, d.data() || {}));
        renderClients();
      },
      (error) => {
        console.error("Erro listener tutores:", error);
        clientesTbody.innerHTML = `
          <tr>
            <td colspan="4" class="loading-row">Erro ao carregar tutores.</td>
          </tr>
        `;
      }
    );

    onSnapshot(
      query(collection(db, "raclub_payments"), orderBy("date", "desc")),
      (snap) => {
        const payments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderPayments(payments);
      },
      (error) => {
        console.error("Erro listener pagamentos:", error);
        if (raclubPayTbody) {
          raclubPayTbody.innerHTML = `
            <tr>
              <td colspan="4" class="loading-row">Erro ao carregar pagamentos.</td>
            </tr>
          `;
        }
      }
    );
  })();
}

/* ========= helpers locais ========= */
function getPaymentDate(p) {
  const ts = p.date || p.dataPagamento || p.createdAt;
  if (ts?.toDate) return ts.toDate();
  if (ts instanceof Date) return ts;
  return null;
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(str) {
  return escapeHtml(str);
}