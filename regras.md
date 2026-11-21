# Regras do Firebase

## Firestore

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAdmin() {
      return request.auth != null
        && request.auth.token.email == "SEU_EMAIL_ADMIN@exemplo.com";
    }

    match /profissionais/{id} {
      allow read: if true;
      allow write: if isAdmin();

      match /excecoes/{dia} {
        allow read: if true;
        allow write: if isAdmin();
      }
    }

    match /servicos/{id} {
      allow read: if true;
      allow write: if isAdmin();
    }

    match /config/{doc=**} {
      allow read: if true;
      allow write: if isAdmin();
    }

    match /excecoes/{dia} {
      allow read: if true;
      allow write: if isAdmin();
    }

    match /{col}/{id} {
      allow read, create, update, delete: if col.matches('reservas_.*');
    }

    match /busca_entrega/{id} {
      allow read, update: if true;
      allow create, delete: if isAdmin();
    }

    match /{document=**} {
      allow read, write: if isAdmin();
    }
  }
}
```
