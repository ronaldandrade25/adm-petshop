// js/clientes.js
import {
  db, $, formatCurrency, showNotification, mainModal,
  state, waitForAuth,
  addDoc, updateDoc, deleteDoc, doc, collection, onSnapshot, query, orderBy, serverTimestamp
} from "./firebase.js";

export function initClientesTab() {
  const cliNome = $("#cliNome");
  const cliSobrenome = $("#cliSobrenome");
  const cliTelefone = $("#cliTelefone");
  const cliRaclub = $("#cliRaclub");
  const cliSalvarBtn = $("#cliSalvarBtn");
  const cliLimparBtn = $("#cliLimparBtn");
  const clientesTbody = $("#clientesTbody");
  const raclubPayTbody = $("#raclubPayTbody");

  if (!clientesTbody) return;

  function onlyDigits(v) {
    return String(v || "").replace(/\D/g, "");
  }

  function formatPhone(v) {
    const d = onlyDigits(v).slice(0, 11);

    if (d.length <= 2) return d;
    if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
  }

  function monthLabelFromDate(dateObj) {
    const d = dateObj instanceof Date ? dateObj : new Date();
    return d.toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" });
  }

  function resetClientForm() {
    if (cliNome) cliNome.value = "";
    if (cliSobrenome) cliSobrenome.value = "";
    if (cliTelefone) cliTelefone.value = "";
    if (cliRaclub) cliRaclub.value = "nao";
    cliNome?.focus();
  }

  function mapClientDoc(id, v) {
    const nome = (v.nome || v.name || "").trim();
    const sobrenome = (v.sobrenome || "").trim();
    const nomeCompleto =
      (v.nomeCompleto || v.clientName || `${nome} ${sobrenome}`).trim() ||
      nome ||
      "—";

    const telefone = (v.telefone || v.phone || "").trim();

    const membro =
      v.raclub === "membro" ||
      v.raClub === "membro" ||
      v.plano === "ra_club" ||
      v.type === "plano_jc" ||
      v.type === "plano_ra" ||
      v.isPlan === true;

    const status = v.status || v.situacao || (membro ? "ativo" : "nao_membro");
    const valorMensal = Number(v.valorMensal ?? v.value ?? v.valor ?? 0);

    return {
      id,
      nome,
      sobrenome,
      nomeCompleto,
      telefone,
      raclub: membro ? "membro" : "nao",
      status,
      valorMensal
    };
  }

  function renderClients() {
    const rows = state.allClients || [];

    if (!rows.length) {
      clientesTbody.innerHTML = `
        <tr>
          <td colspan="4" class="loading-row">Nenhum cliente cadastrado.</td>
        </tr>
      `;
      return;
    }

    clientesTbody.innerHTML = rows
      .map((c) => {
        const raclubLabel =
          c.raclub === "membro"
            ? `<span class="status-badge status-confirmed">Membro</span>`
            : `<span class="status-badge">Não é membro</span>`;

        return `
          <tr>
            <td>${c.nomeCompleto || "—"}</td>
            <td>${c.telefone || "—"}</td>
            <td>${raclubLabel}</td>
            <td style="text-align:right;">
              <div class="timeslot-actions" style="justify-content:flex-end;">
                <button class="btn btn-sm btn-edit" data-action="edit-client" data-id="${c.id}" title="Editar">
                  <i class="bx bx-pencil"></i>
                </button>

                ${
                  c.raclub === "membro"
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

    if (!payments.length) {
      raclubPayTbody.innerHTML = `
        <tr>
          <td colspan="4" class="loading-row">Sem pagamentos para exibir.</td>
        </tr>
      `;
      return;
    }

    raclubPayTbody.innerHTML = payments
      .map((p) => {
        const ts = p.date || p.dataPagamento || p.createdAt;
        const d = ts?.toDate ? ts.toDate() : null;
        const mes = d ? monthLabelFromDate(d) : "—";
        const valor = Number(p.value ?? p.valor ?? 0);
        const cliente = p.clientName || p.nomeCliente || p.nome || "—";
        const status = p.status || "Pago";

        return `
          <tr>
            <td>${cliente}</td>
            <td>${mes}</td>
            <td>${formatCurrency(valor)}</td>
            <td>${status}</td>
          </tr>
        `;
      })
      .join("");
  }

  async function saveClient() {
    await waitForAuth();

    const nome = (cliNome?.value || "").trim();
    const sobrenome = (cliSobrenome?.value || "").trim();
    const telefone = formatPhone(cliTelefone?.value || "");
    const raclub = cliRaclub?.value || "nao";

    if (!nome) {
      showNotification("Informe o nome do cliente.", "error");
      cliNome?.focus();
      return;
    }

    const nomeCompleto = `${nome} ${sobrenome}`.trim();
    const isMember = raclub === "membro";

    const payload = {
      nome,
      sobrenome,
      nomeCompleto,
      telefone,
      raclub,
      status: isMember ? "ativo" : "nao_membro",
      createdAt: serverTimestamp(),

      // compatibilidade com estrutura antiga
      name: nomeCompleto,
      phone: telefone,
      type: isMember ? "plano_jc" : "cliente",
      plano: isMember ? "ra_club" : "cliente",
      isPlan: isMember,
      valorMensal: 0,
      diaPagamento: null,
      situacao: isMember ? "ativo" : "nao_membro"
    };

    try {
      await addDoc(collection(db, "raclub_clients"), payload);
      resetClientForm();
      showNotification("Cliente salvo com sucesso!", "success");
    } catch (err) {
      console.error("Erro ao salvar cliente:", err);
      showNotification("Erro ao salvar cliente.", "error");
    }
  }

  async function deleteClient(id) {
    const client = (state.allClients || []).find((c) => c.id === id);
    if (!client) return;

    mainModal.show({
      title: "Excluir cliente",
      body: `<p>Tem certeza que deseja excluir <strong>${client.nomeCompleto}</strong>?</p>`,
      buttons: [
        { text: "Cancelar", class: "btn-light" },
        {
          text: "Excluir",
          class: "btn-del",
          onClick: async () => {
            await waitForAuth();
            try {
              await deleteDoc(doc(db, "raclub_clients", id));
              showNotification("Cliente excluído com sucesso!", "success");
            } catch (err) {
              console.error("Erro ao excluir cliente:", err);
              showNotification("Erro ao excluir cliente.", "error");
            }
          }
        }
      ]
    });
  }

  async function openEditClientModal(id) {
    const client = (state.allClients || []).find((c) => c.id === id);
    if (!client) return;

    mainModal.show({
      title: "Editar cliente",
      body: `
        <div class="form-grid">
          <div class="field">
            <label>Nome</label>
            <input id="editCliNome" value="${client.nome || ""}" />
          </div>

          <div class="field">
            <label>Sobrenome</label>
            <input id="editCliSobrenome" value="${client.sobrenome || ""}" />
          </div>

          <div class="field">
            <label>Telefone</label>
            <input id="editCliTelefone" value="${client.telefone || ""}" />
          </div>

          <div class="field">
            <label>RA Club</label>
            <select id="editCliRaclub">
              <option value="nao" ${client.raclub === "nao" ? "selected" : ""}>Não é membro</option>
              <option value="membro" ${client.raclub === "membro" ? "selected" : ""}>Membro</option>
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
            const sobrenome = ($("#editCliSobrenome")?.value || "").trim();
            const telefone = formatPhone($("#editCliTelefone")?.value || "");
            const raclub = $("#editCliRaclub")?.value || "nao";

            if (!nome) {
              showNotification("Informe o nome do cliente.", "error");
              return false;
            }

            const nomeCompleto = `${nome} ${sobrenome}`.trim();
            const isMember = raclub === "membro";

            try {
              await updateDoc(doc(db, "raclub_clients", id), {
                nome,
                sobrenome,
                nomeCompleto,
                telefone,
                raclub,
                status: isMember ? "ativo" : "nao_membro",

                // compatibilidade com estrutura antiga
                name: nomeCompleto,
                phone: telefone,
                type: isMember ? "plano_jc" : "cliente",
                plano: isMember ? "ra_club" : "cliente",
                isPlan: isMember,
                situacao: isMember ? "ativo" : "nao_membro"
              });

              showNotification("Cliente atualizado com sucesso!", "success");
            } catch (err) {
              console.error("Erro ao atualizar cliente:", err);
              showNotification("Erro ao atualizar cliente.", "error");
              return false;
            }
          }
        }
      ]
    });
  }

  async function openPaymentModalForClient(id) {
    const client = (state.allClients || []).find((c) => c.id === id);
    if (!client) return;

    mainModal.show({
      title: "Registrar pagamento RA Club",
      body: `
        <div class="form-grid">
          <div class="field">
            <label>Cliente</label>
            <input value="${client.nomeCompleto}" disabled />
          </div>

          <div class="field">
            <label>Valor</label>
            <input id="payValue" type="number" step="0.01" min="0" placeholder="0.00" />
          </div>

          <div class="field">
            <label>Status</label>
            <select id="payStatus">
              <option value="Pago">Pago</option>
              <option value="Pendente">Pendente</option>
            </select>
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
            const status = $("#payStatus")?.value || "Pago";

            if (!value || value <= 0) {
              showNotification("Informe um valor válido.", "error");
              return false;
            }

            try {
              await addDoc(collection(db, "raclub_payments"), {
                clientId: client.id,
                clientName: client.nomeCompleto,
                value,
                status,
                date: serverTimestamp(),

                // compatibilidade com estrutura antiga
                nomeCliente: client.nomeCompleto,
                valor: value,
                dataPagamento: serverTimestamp(),
                nome: client.nomeCompleto
              });

              showNotification("Pagamento registrado com sucesso!", "success");
            } catch (err) {
              console.error("Erro ao registrar pagamento:", err);
              showNotification("Erro ao registrar pagamento.", "error");
              return false;
            }
          }
        }
      ]
    });
  }

  cliTelefone?.addEventListener("input", () => {
    cliTelefone.value = formatPhone(cliTelefone.value);
  });

  cliSalvarBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    await saveClient();
  });

  cliLimparBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    resetClientForm();
  });

  clientesTbody?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const { action, id } = btn.dataset;
    if (!id) return;

    if (action === "edit-client") openEditClientModal(id);
    if (action === "pay-client") openPaymentModalForClient(id);
    if (action === "delete-client") deleteClient(id);
  });

  (async () => {
    await waitForAuth();

    onSnapshot(
      collection(db, "raclub_clients"),
      (snap) => {
        state.allClients = snap.docs
          .map((d) => mapClientDoc(d.id, d.data() || {}))
          .sort((a, b) => (a.nomeCompleto || "").localeCompare(b.nomeCompleto || ""));
        renderClients();
      },
      (error) => {
        console.error("Erro listener clientes:", error);
        clientesTbody.innerHTML = `
          <tr>
            <td colspan="4" class="loading-row">Erro ao carregar clientes.</td>
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
      async (error) => {
        console.error("Erro listener pagamentos:", error);

        // fallback para registros antigos que podem não ter o campo "date"
        onSnapshot(
          collection(db, "raclub_payments"),
          (snap) => {
            const payments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            payments.sort((a, b) => {
              const da = (a.date || a.dataPagamento)?.toDate?.()?.getTime?.() || 0;
              const dbb = (b.date || b.dataPagamento)?.toDate?.()?.getTime?.() || 0;
              return dbb - da;
            });
            renderPayments(payments);
          },
          (err2) => {
            console.error("Erro fallback pagamentos:", err2);
            raclubPayTbody.innerHTML = `
              <tr>
                <td colspan="4" class="loading-row">Erro ao carregar pagamentos.</td>
              </tr>
            `;
          }
        );
      }
    );
  })();
}