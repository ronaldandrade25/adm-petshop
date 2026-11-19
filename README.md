# ADM Agendamento — Pet Shop

Painel administrativo (**gestão e agenda**) para um **pet shop**.

> **Importante:** este projeto é apenas a parte de **gestão e agenda**. O **site de agendamento** (usado pelos clientes) fica em **outra pasta/projeto**. Os dois se comunicam através do **mesmo projeto Firebase (Firestore)**: ao configurar este painel e o site de agendamento com o **mesmo `firebaseConfig`**, tudo o que o cliente agenda aparece aqui em tempo real, e tudo o que é configurado aqui (profissionais, serviços, horários, bloqueios) é lido pelo site.

```
 Site de agendamento  <──►  Firebase (Firestore + Storage)  <──►  Este painel (ADM)
   (outra pasta)              mesmo projeto / mesmas coleções
```

## Funcionalidades (abas)

- **Agenda**: visualização por dia/profissional, novo agendamento, bloqueios e pausas
- **Hotelzinho**: controle de hospedagem dos pets
- **Busca e entrega (Leva e Traz)**: solicitações de transporte dos pets
- **Links**: links do site de agendamento (`https://site-petshop-vt.vercel.app/`) e do site de busca e entrega (`https://buscaentrega-petshop.vercel.app/`)
- **Clientes**: cadastro de tutores e pets
- **PDV**: vendas de serviços e produtos
- **Relatórios**: faturamento e gráficos
- **Configurações**: profissionais (com foto), serviços, produtos, horários e exceções

## Tecnologias

- HTML, CSS e JavaScript puro (ES Modules), sem build e sem `npm install`
- Firebase **Firestore** e **Storage** (SDK 10.12.2 via CDN `gstatic`)
- Chart.js (gráficos dos relatórios) e Boxicons (ícones), via CDN
- Firebase Authentication (e-mail/senha) para o login do administrador (ver passo 5)

## Estrutura

| Arquivo | Função |
|---|---|
| `index.html` | Layout, abas e modais |
| `firebase.js` | **Configuração do Firebase**, helpers, modal, abas e estado compartilhado |
| `agenda.js` | Agenda, horários e agendamentos |
| `clientes.js` | Cadastro de clientes |
| `pdv.js` | Vendas / PDV |
| `relatorios.js` | Relatórios e gráficos |
| `configuracoes.js` | Profissionais, serviços, produtos, horários e exceções |
| `hotelzinho.js` | Hotelzinho |
| `buscaentrega.js` | Busca e entrega |
| `links.js` | Links dos sites públicos |
| `style.css` | Estilos |

## Como integrar com o Firebase

### 1. Criar/usar o projeto Firebase
1. Acesse o [Firebase Console](https://console.firebase.google.com/) e crie um projeto (ou use o existente).
2. Ative o **Firestore Database** (*Build → Firestore Database → Create database*).
3. Ative o **Storage** (usado no upload de foto do profissional).
4. Em *Project settings → Your apps*, registre um app **Web (`</>`)** e copie o objeto `firebaseConfig`.

### 2. Colar a configuração neste painel
Edite o arquivo [`firebase.js`](firebase.js) e substitua o objeto `firebaseConfig`:

```js
const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "SEU_PROJETO.firebaseapp.com",
  projectId: "SEU_PROJETO",
  storageBucket: "SEU_PROJETO.firebasestorage.app",
  messagingSenderId: "...",
  appId: "..."
};
```

Projeto Firebase atualmente configurado: **`petshop-90f21`**.

### 3. Sincronizar com o site de agendamento
No projeto do **site de agendamento** (outra pasta), use **exatamente o mesmo `firebaseConfig`** e as **mesmas coleções**. É essa configuração em comum que faz os dois sistemas se comunicarem.

### 4. Coleções usadas no Firestore

| Coleção / documento | Conteúdo |
|---|---|
| `profissionais` | Profissionais; cada um tem o campo `colecao` (ex.: `reservas_nome`) |
| `reservas_<profissional>` | Agendamentos de cada profissional (coleção definida no campo `colecao`) |
| `servicos` | Serviços oferecidos |
| `produtos` | Produtos/estoque |
| `config/horarios`, `config/semana`, `config/excecoes` | Horários de funcionamento, semana e exceções/bloqueios |
| `pdv_sales`, `vendas` | Vendas do PDV |
| `raclub_clients`, `raclub_payments` | Clientes e pagamentos |
| `despesas` | Despesas |
| `hotelzinho` | Reservas do hotelzinho |
| `busca_entrega` | Solicitações de busca e entrega (compartilhada com o site de busca e entrega) |
| `rabarbearia_expenses` | Despesas |

> As coleções de agendamento são criadas dinamicamente a partir do campo `colecao` de cada profissional; o site de agendamento deve gravar nessa mesma coleção.

### 5. Login com Firebase Authentication (e-mail e senha)

Para proteger o painel, use o método **E-mail/senha** do Firebase Authentication:

1. No Firebase Console, vá em **Build → Authentication → Get started**.
2. Na aba **Sign-in method**, clique em **E-mail/senha**, ative **Email/Password** e salve.
3. Cadastre o usuário administrador: aba **Users → Add user**, informe o **e-mail** e a **senha** e confirme. (Só quem estiver cadastrado aqui consegue entrar.)
4. Em **Authentication → Settings → Authorized domains**, adicione o domínio onde o painel for publicado (ex.: `seu-painel.vercel.app`). `localhost` já vem autorizado.
5. No código, importe o Auth no `firebase.js` (mesma versão do SDK) e use o login por e-mail e senha:

```js
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export const auth = getAuth(app);

// Login
await signInWithEmailAndPassword(auth, email, senha);

// Proteger o painel: mostrar a tela de login se não houver usuário
onAuthStateChanged(auth, (user) => {
  if (user) { /* iniciar o painel */ } else { /* mostrar login */ }
});

// Sair
await signOut(auth);
```

> **Nota:** a versão atual deste painel abre direto, sem tela de login. A integração acima descreve como ativar o Authentication; a tela de login ainda precisa ser implementada no `index.html`/`firebase.js`. O site de agendamento **não** precisa de login do cliente, apenas o painel.

#### O e-mail cadastrado também precisa estar nas regras

Criar o usuário no Authentication **não basta**. O login só protege os dados de verdade se o **mesmo e-mail** estiver nas **regras do Firestore e do Storage**. Sem isso, qualquer pessoa que conheça o `firebaseConfig` (ele fica público no navegador) consegue ler/gravar direto no banco, sem passar pelo painel.

Exemplo de regras do **Firestore** (troque pelo e-mail cadastrado). O site de agendamento continua funcionando: lê profissionais, serviços e horários, e só **cria** agendamentos:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAdmin() {
      return request.auth != null
        && request.auth.token.email == "seu-email@exemplo.com"
        && request.auth.token.email_verified == true;
    }

    // Leitura pública para o site de agendamento; escrita só do admin
    match /profissionais/{id} { allow read: if true; allow write: if isAdmin(); }
    match /servicos/{id}      { allow read: if true; allow write: if isAdmin(); }
    match /config/{id}        { allow read: if true; allow write: if isAdmin(); }

    // Agendamentos (coleções reservas_*): cliente cria, admin gerencia
    match /{col}/{id} {
      allow create: if col.matches('reservas_.*');
      allow read, update, delete: if isAdmin();
    }

    // Todo o resto (clientes, vendas, despesas, produtos...) só o admin
    match /{document=**} { allow read, write: if isAdmin(); }
  }
}
```

Exemplo do **Storage** (upload de foto do profissional):

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null
        && request.auth.token.email == "seu-email@exemplo.com";
    }
  }
}
```

> Se o e-mail do admin não tiver o e-mail verificado, remova a linha `email_verified == true`. Ajuste a regra de `create` do site de agendamento conforme os campos que ele grava.

#### O e-mail também vai no código (opcional, só para a interface)

Além das regras, o projeto de referência `adm-barbeariaRA` guarda o e-mail em uma constante no `firebase.js` e confere no login e no `onAuthStateChanged`:

```js
const ALLOWED_EMAIL = "seu-email@exemplo.com";
// no login:  if (email !== ALLOWED_EMAIL) { /* recusar */ }
// no estado: if (user && user.email?.toLowerCase() === ALLOWED_EMAIL) { /* abrir painel */ }
```

Isso **não é segurança**, apenas esconde a tela para quem tentar entrar com outro e-mail. A segurança real está nas regras. Resumo: o e-mail precisa estar **no Authentication** (usuário), **nas regras** (obrigatório) e, se quiser o bloqueio na interface, **no código** (opcional).

### 6. Regras de segurança (Firestore e Storage)
Enquanto o painel **não usar autenticação**, as regras precisam permitir leitura/escrita para ele funcionar. Depois de implementar o login (passo 5), restrinja as regras a usuários autenticados nas áreas de gestão, mantendo para o site de agendamento apenas o acesso necessário (ler profissionais/serviços/horários e criar agendamentos).

## Como executar

Por usar ES Modules, abra por um servidor local (não por `file://`):

```bash
# opção 1
npx serve .
# opção 2
python -m http.server 5500
```

Ou use a extensão **Live Server** do VS Code e abra `index.html`. Para publicar, qualquer hospedagem estática serve (Vercel, Firebase Hosting, Netlify).

## Checklist de integração

- [ ] Firestore e Storage ativados no mesmo projeto Firebase
- [ ] `firebaseConfig` colado em `firebase.js` deste painel
- [ ] `firebaseConfig` **idêntico** no site de agendamento
- [ ] Authentication com **E-mail/senha** ativado e usuário administrador cadastrado
- [ ] E-mail do administrador colocado nas **regras** do Firestore e do Storage
- [ ] Profissionais e serviços cadastrados na aba de Configurações
- [ ] Teste: fazer um agendamento pelo site e conferir se aparece na Agenda deste painel
